/* ============================================================
   朋友圈实时刷新 — Netlify Scheduled Function，cron "* * * * *"（每分钟）

   为什么不是 GitHub Actions：Actions 的 schedule 最小间隔 5 分钟，且高峰会延迟/跳过。
   为什么不是本机：本机定时任务已按要求删除，且本机不开机就没有更新。

   每次执行做的事（严格控制在 30 秒硬上限内）：
   1. 间隔闸门：距离上次运行不足 FCIRCLE_INTERVAL_SEC 就空转退出（改频率不用动 cron）。
   2. 抢锁：fc/lock 防重入，上一轮没跑完时这一轮直接跳过，不会叠加写坏数据。
   3. 读友链清单 /fcircle/links.json（构建期由 scripts/fcircle-links.js 生成）。
   4. 读实时层 blob；第一次跑时用部署里的 /fcircle/moments.json 当基线播种。
   5. 只探测「到期」的站点（每站间隔 + 失败退避），并发 + 总预算双约束。
   6. 增量合并、去重、截断到 900 篇，有新文章才写 blob（没变就不写，省配额）。
   7. 写回状态（每个站点的 feed 地址、ETag、下次可探测时间）。

   环境变量（都可以不设，用默认值）：
     FCIRCLE_INTERVAL_SEC       全局限流秒数，默认 60；想降负载就调成 180 / 300
     FCIRCLE_SITE_INTERVAL_SEC  单个站点的最小探测间隔，默认 60
     FCIRCLE_MAX_PER_TICK       单轮最多探测几个站点，默认 40（友链 39 条即全量）
     FCIRCLE_CONCURRENCY        并发数，默认 12
     FCIRCLE_TIMEOUT_MS         单请求超时，默认 4000
     FCIRCLE_BUDGET_MS          单轮总预算，默认 20000（硬上限 25000）

   兜底：任何异常只影响本轮，blob 里已有的数据与静态基线都还在，
   页面 /api/fcircle 始终能拿到上一份完整数据。
   ============================================================ */

import { getStore } from "@netlify/blobs";
import {
  STORE_NAME, BLOB_MOMENTS, BLOB_STATE, BLOB_LOCK,
  clampInt, nowText, parseFeed, mergeArticles, momentsPayload, countActive,
  probeFeed, fetchJson, mapLimit, PER_LINK,
} from "../lib/fcircle.mjs";

/* 每分钟一次。想临时停掉：删掉 netlify.toml 里 [functions."fcircle-tick"] 的 schedule 行并重新部署。 */
export const config = { schedule: "* * * * *" };

const SITE = (process.env.SITE_URL || process.env.URL || "https://202271.xyz").replace(/\/$/, "");

const INTERVAL_MS = clampInt(process.env.FCIRCLE_INTERVAL_SEC, 60, 30, 3600) * 1000;
const SITE_GAP_MS = clampInt(process.env.FCIRCLE_SITE_INTERVAL_SEC, 60, 30, 3600) * 1000;
const MAX_PER_TICK = clampInt(process.env.FCIRCLE_MAX_PER_TICK, 40, 1, 200);
const CONCURRENCY = clampInt(process.env.FCIRCLE_CONCURRENCY, 12, 1, 32);
const TIMEOUT_MS = clampInt(process.env.FCIRCLE_TIMEOUT_MS, 4000, 1000, 12000);
const BUDGET_MS = clampInt(process.env.FCIRCLE_BUDGET_MS, 20000, 4000, 25000);
const MAX_BACKOFF_MS = 30 * 60 * 1000;
/* 上一轮若因超时被掐断，锁会留在 blob 里；超过这个时间就允许接管 */
const LOCK_TTL_MS = 28000;

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

async function readJson(store, key, fallback) {
  try {
    const v = await store.get(key, { type: "json" });
    return v && typeof v === "object" ? v : fallback;
  } catch (_) {
    return fallback;
  }
}

/* 单飞锁：只有在没有别人持锁时才继续，避免两轮并发做 read-modify-write */
async function acquireLock(store) {
  const now = Date.now();
  try {
    const cur = await store.get(BLOB_LOCK, { type: "json" });
    if (cur) {
      const age = now - Number(cur.at || 0);
      if (age >= 0 && age < LOCK_TTL_MS) return false;
      try { await store.delete(BLOB_LOCK); } catch (_) { /* 过期锁删不掉也继续抢 */ }
    }
    const res = await store.setJSON(BLOB_LOCK, { at: now }, { onlyIfNew: true });
    return !(res && res.modified === false);
  } catch (_) {
    return false;
  }
}

async function releaseLock(store) {
  try { await store.delete(BLOB_LOCK); } catch (_) { /* 到期会自动被接管 */ }
}

/** 构建期生成：public/fcircle/links.json（友链数量、标题、头像） */
async function loadLinks() {
  const data = await fetchJson(SITE + "/fcircle/links.json?ts=" + Date.now(), 6000);
  const items = Array.isArray(data && data.items) ? data.items : [];
  const seen = new Set();
  const out = [];
  for (const it of items) {
    if (!it || !it.title || !/^https?:\/\//i.test(it.link || "")) continue;
    const key = String(it.link).trim();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      title: String(it.title).trim(),
      link: key,
      avatar: String(it.avatar || "").trim(),
    });
  }
  return out;
}

/** 该站点现在该不该探测：每站最小间隔 + 连续失败退避 */
function isDue(st, now) {
  if (!st || !st.checkedAt) return true;
  const fails = Number(st.fails || 0);
  const gap = fails > 0 ? Math.min(SITE_GAP_MS * Math.pow(2, Math.min(fails, 5)), MAX_BACKOFF_MS) : SITE_GAP_MS;
  return now - Number(st.checkedAt) >= gap - 1500; // 1.5 秒容差，避免 cron 抖动把频率打对折
}

/**
 * 这个站点本轮允许试几个候选路径。
 *
 * 线上第一次跑（2026-11-13）一轮吃满 20 秒，原因就是 27 个死站各盲试 4 条路径、
 * 每条都等到 4 秒超时：39 个站的预算全被它们吃掉。规则改成——
 *   有缓存地址      → 不限制（正常第一个请求就 304，失败才有额外成本）
 *   首次探测        → 4 条（尽量别漏掉任何常见路径）
 *   失败 1–2 次     → 2 条（只试最常见的 atom.xml / rss.xml）
 *   失败 3 次以上   → 1 条（多半是关站或被墙，别再花预算）
 */
function candidateBudget(st) {
  if (st && st.feed) return 4;
  const fails = Number((st && st.fails) || 0);
  if (fails >= 3) return 1;
  if (fails >= 1) return 2;
  return 4;
}

export default async function handler(req, context) {
  const t0 = Date.now();
  const store = getStore({ name: STORE_NAME, consistency: "strong" });
  const state = await readJson(store, BLOB_STATE, { v: 1, links: {} });
  if (!state.links || typeof state.links !== "object") state.links = {};

  // 1. 间隔闸门：不足 8 秒就到期时照跑（cron 抖动误差），差得远才空转
  const lastRun = Number(state.lastRun || 0);
  if (lastRun && Date.now() - lastRun < INTERVAL_MS - 8000) {
    return json({ ok: true, skipped: "interval", waitMs: INTERVAL_MS - (Date.now() - lastRun) });
  }

  // 2. 抢锁
  if (!(await acquireLock(store))) {
    return json({ ok: true, skipped: "locked" });
  }

  const report = { ok: true, at: nowText(t0), due: 0, ok304: 0, okNew: 0, failed: 0, added: 0, total: 0, ms: 0 };

  try {
    const links = await loadLinks();
    if (!links.length) throw new Error("友链清单为空，等下一次部署后再试");
    report.total = links.length;

    // 3. 读实时层；没有就用静态基线播种（首次部署后的第一分钟走这里）
    let prev = await readJson(store, BLOB_MOMENTS, null);
    if (!prev) {
      try {
        prev = await fetchJson(SITE + "/fcircle/moments.json?ts=" + Date.now(), 8000);
      } catch (_) {
        prev = null;
      }
    }
    const prevRows = prev && Array.isArray(prev.article_data) ? prev.article_data : [];
    const prevStats = (prev && prev.statistical_data) || {};

    // 4. 挑出本轮该探测的站点
    const due = links.filter((l) => isDue(state.links[l.link], Date.now())).slice(0, MAX_PER_TICK);
    report.due = due.length;

    const deadline = t0 + BUDGET_MS;
    const fresh = [];
    let okCount = 0;
    let failCount = 0;
    let budgetSkipped = 0;

    if (due.length) {
      await mapLimit(due, CONCURRENCY, async (link) => {
        const st = state.links[link.link] || (state.links[link.link] = {});
        if (Date.now() > deadline - 800) {
          // 预算用完：不计失败、不动 checkedAt，下一轮自然还会到期
          budgetSkipped += 1;
          return;
        }
        const hit = await probeFeed(link, st.feed || "", {
          timeoutMs: TIMEOUT_MS,
          deadline,
          maxCandidates: candidateBudget(st),
          conditional: { etag: st.etag, lastModified: st.lastModified },
        });
        if (hit && hit.budget) {
          budgetSkipped += 1; // 同样不算失败
          return;
        }
        if (!hit) {
          st.checkedAt = Date.now();
          st.fails = Number(st.fails || 0) + 1;
          st.lastError = "no-feed";
          failCount += 1;
          return;
        }
        st.checkedAt = Date.now();
        st.fails = 0;
        st.lastError = "";
        st.feed = hit.url;
        if (hit.notModified) {
          okCount += 1;
          report.ok304 += 1;
          return;
        }
        st.etag = hit.etag || "";
        st.lastModified = hit.lastModified || "";
        const rows = parseFeed(hit.xml, link, PER_LINK);
        okCount += 1;
        report.okNew += 1;
        for (const r of rows) fresh.push(r);
      });
    }

    // 5. 合并
    const merged = fresh.length ? mergeArticles(prevRows, fresh) : prevRows;
    const addedBefore = new Set(prevRows.map((r) => String(r.link || "").toLowerCase()));
    const added = merged.filter((r) => !addedBefore.has(String(r.link || "").toLowerCase())).length;
    report.added = added;
    report.failed = failCount;
    report.budgetSkipped = budgetSkipped;

    const active = countActive(links, state);
    const lastUpdated = added > 0 ? nowText() : prevStats.last_updated_time || "";

    // 6. 只有「有新文章」或「实时层还不存在」时才写文章 blob。
    //    空转的一分钟只写 6KB 左右的状态文件，不重写 60KB 的文章体：
    //    Blobs 按操作与流量计费，每分钟重写一份全量 JSON 是纯浪费。
    //    「检查于 / 活跃数」这类每轮都变的字段由 /api/fcircle 读状态时合并进来。
    if (added > 0 || !prev) {
      const payload = momentsPayload({
        links,
        rows: merged,
        active,
        lastUpdated: lastUpdated || nowText(),
        lastChecked: nowText(),
      });
      await store.setJSON(BLOB_MOMENTS, payload);
      report.written = true;
      report.article_num = payload.article_data.length;
    }

    // 7. 状态（每轮都写，体积很小）
    const now = Date.now();
    state.v = 1;
    state.lastRun = now;
    state.nextDue = now + INTERVAL_MS;
    state.lastRunMs = now - t0;
    state.lastCheckedAt = now;
    state.lastUpdatedAt = added > 0 ? now : Number(state.lastUpdatedAt || 0);
    state.sweep = { active, total: links.length, due: due.length, articles: merged.length };
    state.counters = {
      ticks: Number((state.counters && state.counters.ticks) || 0) + 1,
      added: Number((state.counters && state.counters.added) || 0) + added,
    };
    await store.setJSON(BLOB_STATE, state);

    report.okCount = okCount;
    report.ms = Date.now() - t0;
    console.log("[fcircle-tick] " + JSON.stringify(report));
    return json(report);
  } catch (e) {
    const msg = String((e && e.message) || e);
    console.error("[fcircle-tick] 失败：" + msg);
    // 失败也要记 lastRun，避免每分钟反复撞同一个错误把限流/配额打满
    state.lastRun = Date.now();
    state.lastError = msg;
    try { await store.setJSON(BLOB_STATE, state); } catch (_) { /* ignore */ }
    return json({ ok: false, error: msg, ms: Date.now() - t0 }, 500);
  } finally {
    await releaseLock(store);
  }
}
