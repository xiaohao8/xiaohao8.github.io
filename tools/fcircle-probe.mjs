#!/usr/bin/env node
/**
 * 朋友圈实时层的离线回归探针（不联网、不碰 Blobs）。
 *
 * 覆盖三件最容易写错、且线上出错最难发现的事：
 *   1. Atom / RSS 两种格式都能解析出「标题 + 绝对链接 + 日期」；
 *   2. 条件请求真的走 304（每分钟一轮全靠它省流量，退化成整份 XML 会拖垮 30 秒预算）；
 *   3. 增量合并按链接去重（大小写、尾斜杠、hash 都算同一篇），并有上限截断。
 *
 * 用法：node tools/fcircle-probe.mjs
 * 退出码 0 = 全绿；非 0 = 有断言失败，不要发布。
 */

import http from "node:http";
import {
  parseFeed, mergeArticles, probeFeed, looksLikeFeed, dayOf, normalizeLink,
  momentsPayload, nowText, MAX_ARTICLES,
} from "../netlify/lib/fcircle.mjs";

let failed = 0;
function ok(name, cond, extra) {
  if (cond) {
    console.log("  ✓ " + name);
  } else {
    failed += 1;
    console.log("  ✗ " + name + (extra ? "  -> " + extra : ""));
  }
}

const ATOM = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>测试站</title>
  <entry>
    <title><![CDATA[第一篇 & 测试]]></title>
    <link rel="alternate" href="https://a.example/post/hello/"/>
    <published>2026-11-10T20:00:00+08:00</published>
  </entry>
  <entry>
    <title>第二篇</title>
    <link href="/post/second"/>
    <updated>2026-11-09T01:00:00Z</updated>
  </entry>
</feed>`;

const RSS = `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0"><channel><title>测试站2</title>
  <item>
    <title>RSS 篇</title>
    <link>https://b.example/p/1</link>
    <pubDate>Mon, 10 Nov 2026 12:00:00 +0800</pubDate>
  </item>
</channel></rss>`;

const HTML = "<!doctype html><html><body>not a feed</body></html>";

async function main() {
  console.log("[1] feed 解析");
  const atomRows = parseFeed(ATOM, { title: "测试站", link: "https://a.example", avatar: "av.png" }, 5);
  ok("Atom 解析出 2 篇", atomRows.length === 2, JSON.stringify(atomRows));
  ok("CDATA 标题被还原", atomRows[0] && atomRows[0].title === "第一篇 & 测试", atomRows[0] && atomRows[0].title);
  ok("相对链接补成绝对链接", atomRows.some((r) => r.link === "https://a.example/post/second"));
  ok("日期统一成 YYYY-MM-DD", atomRows.every((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.created)));
  ok("作者/头像取自友链配置", atomRows[0] && atomRows[0].author === "测试站" && atomRows[0].avatar === "av.png");

  const rssRows = parseFeed(RSS, { title: "测试站2", link: "https://b.example" }, 5);
  ok("RSS 解析出 1 篇", rssRows.length === 1, JSON.stringify(rssRows));
  ok("RSS 链接正确", rssRows[0] && rssRows[0].link === "https://b.example/p/1");

  ok("HTML 不会被误判成 feed", !looksLikeFeed(HTML) && looksLikeFeed(ATOM));

  console.log("[2] 日期与时区");
  ok("UTC 时间按北京时间切日", dayOf("2026-11-09T20:00:00Z") === "2026-11-10", dayOf("2026-11-09T20:00:00Z"));
  ok("带 +08:00 偏移按时刻换算", dayOf("2026-11-10T20:00:00+08:00") === "2026-11-10", dayOf("2026-11-10T20:00:00+08:00"));
  ok("RFC822（RSS pubDate）不乱切日", dayOf("Mon, 10 Nov 2026 23:30:00 +0800") === "2026-11-10", dayOf("Mon, 10 Nov 2026 23:30:00 +0800"));
  ok("无时区的时间取原文日期", dayOf("2026-11-10 23:30:00") === "2026-11-10", dayOf("2026-11-10 23:30:00"));
  ok("纯日期原样保留", dayOf("2026-11-10") === "2026-11-10");
  ok("nowText 是北京时间格式", /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(nowText()));

  console.log("[3] 去重与截断");
  ok("链接归一化：尾斜杠", normalizeLink("https://A.example/post/hello/#c1") === "https://a.example/post/hello");
  const base = [
    { title: "旧文", link: "https://a.example/post/hello/", created: "2026-11-01" },
    { title: "更旧", link: "https://a.example/post/old", created: "2026-10-01" },
  ];
  const fresh = [
    { title: "第一篇 & 测试", link: "https://A.example/post/hello#top", created: "2026-11-10" },
    { title: "新文", link: "https://a.example/post/new", created: "2026-11-11" },
  ];
  const merged = mergeArticles(base, fresh);
  ok("重复文章不重复计入", merged.length === 3, merged.map((r) => r.link).join(","));
  ok("新文章排在最前", merged[0].created === "2026-11-11");
  ok("保留下来的重复项是新的那份", merged.find((r) => r.link.indexOf("hello") > -1).title === "第一篇 & 测试");
  const many = Array.from({ length: MAX_ARTICLES + 50 }, (_, i) => ({
    title: "t" + i, link: "https://x.example/p/" + i, created: "2026-01-01",
  }));
  ok("超出上限时截断到 MAX_ARTICLES", mergeArticles(many, []).length === MAX_ARTICLES);

  console.log("[4] 条件请求（每分钟一轮的关键）");
  let hits = 0;
  let got304 = 0;
  const server = http.createServer((req, res) => {
    hits += 1;
    if (req.url === "/atom.xml") {
      if (req.headers["if-none-match"] === '"v1"') {
        got304 += 1;
        res.writeHead(304, { ETag: '"v1"' });
        res.end();
        return;
      }
      res.writeHead(200, { "Content-Type": "application/atom+xml", ETag: '"v1"' });
      res.end(ATOM);
      return;
    }
    if (req.url === "/") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(HTML);
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base_ = "http://127.0.0.1:" + server.address().port;
  const link = { title: "本地测试站", link: base_ + "/", avatar: "" };

  const first = await probeFeed(link, "", { timeoutMs: 4000 });
  ok("首次探测命中 feed", Boolean(first && first.xml), JSON.stringify(first));
  ok("首次探测不是 304", Boolean(first && !first.notModified));
  ok("拿到 ETag", Boolean(first && first.etag === '"v1"'), first && first.etag);

  const second = await probeFeed(link, first.url, {
    timeoutMs: 4000,
    conditional: { etag: first.etag, lastModified: first.lastModified },
  });
  ok("第二次带 ETag 得到 304", Boolean(second && second.notModified), JSON.stringify(second));
  ok("304 不返回正文（省流量）", Boolean(second && !second.xml));
  ok("服务端确实收到了条件请求", got304 === 1, "got304=" + got304);

  // 另一个只返回 HTML、所有候选路径都 404 的站点：必须判定为「拿不到 feed」
  const htmlServer = http.createServer((req, res) => {
    if (req.url === "/" || req.url.indexOf("?") > -1 && req.url === "/") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(HTML);
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((r) => htmlServer.listen(0, "127.0.0.1", r));
  const htmlBase = "http://127.0.0.1:" + htmlServer.address().port;
  const htmlOnly = await probeFeed({ title: "假站", link: htmlBase + "/", avatar: "" }, "", { timeoutMs: 3000 });
  ok("只有 HTML 的站点判定为拿不到 feed", htmlOnly === null, JSON.stringify(htmlOnly));
  htmlServer.close();
  ok("命中缓存后每轮只有 1 个请求（不再盲试候选路径）", hits === 2, "hits=" + hits);
  server.close();

  console.log("[5] 响应结构");
  const payload = momentsPayload({
    links: new Array(39).fill({ title: "x", link: "https://x.example" }),
    rows: merged,
    active: 13,
    lastUpdated: "2026-11-12 15:37:32",
    lastChecked: "2026-11-13 20:01:00",
  });
  ok("statistical_data 字段齐全",
    ["friends_num", "active_num", "error_num", "article_num", "last_updated_time", "last_checked_time"]
      .every((k) => k in payload.statistical_data));
  ok("error_num = 总数 - 活跃", payload.statistical_data.error_num === 26, String(payload.statistical_data.error_num));
  ok("article_num 跟随真实条数", payload.statistical_data.article_num === 3);
  ok("文章体原样保留", Array.isArray(payload.article_data) && payload.article_data.length === 3);

  console.log("");
  if (failed) {
    console.log("失败 " + failed + " 条");
    process.exitCode = 1;
  } else {
    console.log("全部通过");
  }
}

main().catch((e) => {
  console.error("探针异常：" + (e && e.stack || e));
  process.exitCode = 1;
});
