#!/usr/bin/env node
/**
 * 朋友圈实时层的「函数级」仿真（不联网、不碰真实 Blobs）。
 *
 * 用内存版 Blobs + 本地假友链站，把 netlify/functions/fcircle-tick.mjs 完整跑四轮，
 * 验证那些只在线上才会暴露的行为：
 *   R1 首次运行：用静态基线播种 → 抓到新文章 → 只写一次
 *   R2 紧接着再触发：间隔闸门拦住（真分钟级节奏，不会被重复调用打爆）
 *   R3 到期后重跑：命中 ETag 走 304，没有新文章就不再重写文章 blob
 *   R4 死站：拿不到 feed 只累加 fails，不影响其它站点与已有文章
 *
 * 用法：node tools/fcircle-tick-sim.mjs
 */

import http from "node:http";
import { register } from "node:module";

register(new URL("./sim/blobs-hook.mjs", import.meta.url));

let failed = 0;
function ok(name, cond, extra) {
  if (cond) console.log("  ✓ " + name);
  else {
    failed += 1;
    console.log("  ✗ " + name + (extra !== undefined ? "  -> " + extra : ""));
  }
}

const ATOM = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Atom 站</title>
  <entry><title>甲文</title><link rel="alternate" href="/p/a1"/><published>2026-11-11T10:00:00+08:00</published></entry>
  <entry><title>乙文</title><link href="/p/a2"/><updated>2026-11-10T10:00:00+08:00</updated></entry>
</feed>`;

const RSS = `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0"><channel><title>RSS 站</title>
  <item><title>丙文</title><link>https://rss.example/p/1</link><pubDate>Mon, 10 Nov 2026 12:00:00 +0800</pubDate></item>
</channel></rss>`;

function serve(handler) {
  return new Promise((resolve) => {
    const s = http.createServer(handler);
    s.listen(0, "127.0.0.1", () => resolve(s));
  });
}

const port = (s) => s.address().port;

async function main() {
  // Atom 站：支持 ETag/304
  let atomHits = 0;
  let atom304 = 0;
  const atomSrv = await serve((req, res) => {
    atomHits += 1;
    if (req.url === "/atom.xml") {
      if (req.headers["if-none-match"] === '"a1"') {
        atom304 += 1;
        res.writeHead(304, { ETag: '"a1"' });
        return res.end();
      }
      res.writeHead(200, { "Content-Type": "application/atom+xml", ETag: '"a1"' });
      return res.end(ATOM);
    }
    res.writeHead(404);
    res.end();
  });

  // RSS 站：只有 /rss.xml
  const rssSrv = await serve((req, res) => {
    if (req.url === "/rss.xml") {
      res.writeHead(200, { "Content-Type": "application/rss+xml" });
      return res.end(RSS);
    }
    res.writeHead(404);
    res.end();
  });

  // 死站：所有候选路径都 404（记录被请求次数，用来验证「失败后退避收窄」）
  let deadHits = 0;
  const deadSrv = await serve((req, res) => {
    deadHits += 1;
    res.writeHead(404);
    res.end();
  });

  const A = "http://127.0.0.1:" + port(atomSrv);
  const B = "http://127.0.0.1:" + port(rssSrv);
  const D = "http://127.0.0.1:" + port(deadSrv);

  const LINKS = {
    count: 3,
    generatedAt: new Date().toISOString(),
    items: [
      { title: "Atom 站", link: A + "/", avatar: "a.png" },
      { title: "RSS 站", link: B + "/", avatar: "b.png" },
      { title: "死站", link: D + "/", avatar: "" },
    ],
  };
  const BASELINE = {
    statistical_data: {
      friends_num: 39, active_num: 13, error_num: 26, article_num: 1,
      last_updated_time: "2026-11-01 00:00:00",
    },
    article_data: [
      { title: "基线文章", link: "https://base.example/p/0", author: "基线站", avatar: "", created: "2026-10-01", updated: "2026-10-01" },
    ],
  };

  // 本站（函数会来取 /fcircle/links.json 与 /fcircle/moments.json）
  const siteSrv = await serve((req, res) => {
    const u = req.url.split("?")[0];
    if (u === "/fcircle/links.json") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(LINKS));
    }
    if (u === "/fcircle/moments.json") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(BASELINE));
    }
    res.writeHead(404);
    res.end();
  });
  const SITE = "http://127.0.0.1:" + port(siteSrv);

  // 环境变量必须在 import 之前设好（tick 在模块顶层读取）
  process.env.SITE_URL = SITE;
  process.env.FCIRCLE_INTERVAL_SEC = "30";
  process.env.FCIRCLE_SITE_INTERVAL_SEC = "30";
  process.env.FCIRCLE_TIMEOUT_MS = "2000";
  process.env.FCIRCLE_BUDGET_MS = "8000";

  const blobs = await import("./sim/blobs-mock.mjs");
  const tick = await import("../netlify/functions/fcircle-tick.mjs");
  const handler = tick.default;

  const call = () => handler(new Request("http://localhost/.netlify/functions/fcircle-tick"));

  console.log("[R1] 首次运行：基线播种 + 抓取");
  const r1 = await (await call()).json();
  ok("R1 成功", r1.ok === true, JSON.stringify(r1));
  ok("R1 探测了 3 个站点", r1.due === 3, "due=" + r1.due);
  ok("R1 新增 3 篇（原子 2 + RSS 1）", r1.added === 3, "added=" + r1.added);
  ok("R1 文章总数 = 基线 1 + 新增 3", r1.article_num === 4, "article_num=" + r1.article_num);

  const snap1 = blobs._dump();
  const moments1 = snap1["fcircle/moments.json"];
  ok("R1 写出了实时层", Boolean(moments1));
  ok("R1 保留了基线里的旧文章", moments1 && moments1.article_data.some((r) => r.link === "https://base.example/p/0"));
  ok("R1 活跃数只算拿到 feed 的站点", moments1 && moments1.statistical_data.active_num === 2,
    moments1 && String(moments1.statistical_data.active_num));
  ok("R1 失败站点计入 error_num", moments1 && moments1.statistical_data.error_num === 1,
    moments1 && String(moments1.statistical_data.error_num));
  ok("R1 结束后锁已释放", !snap1["fcircle/lock.json"]);
  ok("R1 记录了下轮时间", snap1["fcircle/state.json"] && snap1["fcircle/state.json"].nextDue > Date.now() - 1000);
  ok("R1 死站累计失败 1 次", snap1["fcircle/state.json"].links[D + "/"].fails === 1);
  ok("R1 首次探测会把 4 条候选路径都试一遍", deadHits === 4, "deadHits=" + deadHits);

  console.log("[R2] 紧接着再触发：必须被间隔闸门拦住");
  const r2 = await (await call()).json();
  ok("R2 跳过且原因是 interval", r2.ok === true && r2.skipped === "interval", JSON.stringify(r2));
  ok("R2 没有产生新的抓取", atomHits === 1, "atomHits=" + atomHits);

  console.log("[R3] 到期重跑：304 不应重写文章 blob");
  const st = blobs._dump()["fcircle/state.json"];
  st.lastRun = 0;
  st.nextDue = 0;
  for (const k of Object.keys(st.links)) st.links[k].checkedAt = 0;
  await blobs.getStore().setJSON("fcircle/state.json", st);
  blobs._resetWrites();

  const r3 = await (await call()).json();
  ok("R3 成功", r3.ok === true, JSON.stringify(r3));
  ok("R3 探测了 3 个站点", r3.due === 3, "due=" + r3.due);
  ok("R3 命中 ETag 走 304", r3.ok304 === 1, "ok304=" + r3.ok304);
  ok("R3 没有新增（RSS 站仍有内容但已去重）", r3.added === 0, "added=" + r3.added);
  ok("R3 服务端确实收到 304", atom304 === 1, "atom304=" + atom304);
  ok("R3 失败过的站点只试 2 条候选路径", deadHits === 6, "deadHits=" + deadHits);
  ok("R3 只写了锁与状态，没有重写文章 blob",
    !blobs._writtenKeys().includes("fcircle/moments.json"),
    blobs._writtenKeys().join(","));
  const moments3 = blobs._dump()["fcircle/moments.json"];
  ok("R3 文章数量未变", moments3 && moments3.article_data.length === 4, moments3 && moments3.article_data.length);

  console.log("[R4] 死站退避：不应无限重试");
  const st2 = blobs._dump()["fcircle/state.json"];
  ok("R4 死站下次探测时间被推迟", (() => {
    const s = st2.links[D + "/"];
    return s && s.fails >= 1 && s.checkedAt > 0;
  })(), JSON.stringify(st2.links[D + "/"]));

  console.log("[R5] GET /api/fcircle 读取端点");
  const api = (await import("../netlify/functions/fcircle.mjs")).default;
  const get = (url, headers) => api(new Request(url, { headers }));
  const res1 = await get("https://x.test/api/fcircle");
  const body1 = await res1.json();
  ok("R5 返回 200", res1.status === 200);
  ok("R5 有 30 秒缓存", /max-age=30/.test(res1.headers.get("cache-control") || ""), res1.headers.get("cache-control"));
  ok("R5 文章数与实时层一致", body1.article_data.length === 4, body1.article_data.length);
  ok("R5 带上了「检查于」", /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(body1.statistical_data.last_checked_time || ""),
    body1.statistical_data.last_checked_time);
  ok("R5 活跃数来自状态而不是旧快照", body1.statistical_data.active_num === 2, String(body1.statistical_data.active_num));

  const etag = res1.headers.get("etag");
  const res2 = await get("https://x.test/api/fcircle", { "if-none-match": etag });
  ok("R5 ETag 生效返回 304 且无正文", res2.status === 304, res2.status);

  const dbg = await (await get("https://x.test/api/fcircle?debug=1")).json();
  ok("R5 debug 返回最近一轮摘要", dbg.ok === true && dbg.lastRun && dbg.sweep && dbg.sweep.total === 3,
    JSON.stringify(dbg));

  // 实时层被清空：必须 302 回落到静态基线，页面不能空
  await blobs.getStore().delete("fcircle/moments.json");
  const res3 = await get("https://x.test/api/fcircle");
  ok("R5 实时层缺失时 302 回落到静态快照",
    res3.status === 302 && (res3.headers.get("location") || "") === "/fcircle/moments.json",
    res3.status + " " + res3.headers.get("location"));

  console.log("[R6] 空转轮次不会重复写文章 blob");
  const st3 = blobs._dump()["fcircle/state.json"];
  st3.lastRun = 0;
  st3.nextDue = 0;
  for (const k of Object.keys(st3.links)) st3.links[k].checkedAt = 0;
  await blobs.getStore().setJSON("fcircle/state.json", st3);
  await blobs.getStore().setJSON("fcircle/moments.json", moments3); // 恢复实时层
  blobs._resetWrites();
  const r6 = await (await call()).json();
  ok("R6 没有新文章", r6.added === 0, "added=" + r6.added);
  ok("R6 文章 blob 未被重写", !blobs._writtenKeys().includes("fcircle/moments.json"), blobs._writtenKeys().join(","));
  ok("R6 状态被更新（下一轮才会再跑）", blobs._writtenKeys().includes("fcircle/state.json"));

  console.log("[R7] 连续失败 3 次后只花 1 个请求（保护 30 秒预算）");
  const st4 = blobs._dump()["fcircle/state.json"];
  st4.lastRun = 0;
  st4.nextDue = 0;
  for (const k of Object.keys(st4.links)) st4.links[k].checkedAt = 0;
  st4.links[D + "/"].fails = 3;
  await blobs.getStore().setJSON("fcircle/state.json", st4);
  const deadBefore = deadHits;
  const r7 = await (await call()).json();
  ok("R7 正常完成", r7.ok === true);
  ok("R7 死站只被请求 1 次", deadHits - deadBefore === 1, "delta=" + (deadHits - deadBefore));
  ok("R7 没有新增文章", r7.added === 0, "added=" + r7.added);

  [atomSrv, rssSrv, deadSrv, siteSrv].forEach((s) => s.close());

  console.log("");
  if (failed) {
    console.log("失败 " + failed + " 条");
    process.exitCode = 1;
  } else {
    console.log("全部通过");
  }
}

main().catch((e) => {
  console.error("仿真异常：" + (e && e.stack || e));
  process.exitCode = 1;
});
