/* ============================================================
   朋友圈实时数据端点 GET /api/fcircle

   与静态 /fcircle/moments.json 的关系：
   - 实时层（Blobs fcircle/moments.json）由 fcircle-tick 每分钟增量更新；
   - 实时层还没建立（首次部署后的十几秒）→ 302 回落到静态基线，页面永远有数据；
   - 两层结构完全一致，前端拿到哪一层都能直接渲染。

   「更新于」只在新文章入库时变，「检查于」是最近一次真正跑完探测的时间；
   这两个字段在这里从状态里合并进来，所以空转的分钟不需要重写文章 blob。

   缓存：max-age=30 + SWR。每分钟才可能变一次的数据，30 秒已经足够新鲜，
   又不会让每次打开页面都回源到 Blobs。

   调试：GET /api/fcircle?debug=1 返回最近一轮的探测摘要（只含数量与时间，无链接明细）。
   ============================================================ */

import { getStore } from "@netlify/blobs";
import { STORE_NAME, BLOB_MOMENTS, BLOB_STATE, nowText } from "../lib/fcircle.mjs";

export const config = { path: "/api/fcircle" };

const STATIC_FALLBACK = "/fcircle/moments.json";
const CACHE = "public, max-age=30, stale-while-revalidate=120";

async function readJson(store, key) {
  try {
    const v = await store.get(key, { type: "json" });
    return v && typeof v === "object" ? v : null;
  } catch (_) {
    return null;
  }
}

export default async function handler(req) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return new Response(JSON.stringify({ error: "method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json", Allow: "GET, HEAD" },
    });
  }

  const url = new URL(req.url);
  const store = getStore({ name: STORE_NAME, consistency: "strong" });

  const [moments, state] = await Promise.all([
    readJson(store, BLOB_MOMENTS),
    readJson(store, BLOB_STATE),
  ]);

  if (url.searchParams.get("debug") === "1") {
    const s = state || {};
    const fails = s.links ? Object.values(s.links).filter((l) => l && l.fails > 0).length : 0;
    return new Response(
      JSON.stringify({
        ok: true,
        live: Boolean(moments),
        articles: moments && Array.isArray(moments.article_data) ? moments.article_data.length : 0,
        lastRun: s.lastRun ? nowText(s.lastRun) : "",
        lastChecked: s.lastCheckedAt ? nowText(s.lastCheckedAt) : "",
        lastRunMs: s.lastRunMs || 0,
        sweep: s.sweep || null,
        counters: s.counters || null,
        failingSites: fails,
        lastError: s.lastError || "",
      }),
      { status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } }
    );
  }

  if (!moments) {
    // 实时层还没建立：交给静态基线，同时让 CDN 少缓存一会儿，十几秒后自然会切到实时层
    return new Response(null, {
      status: 302,
      headers: { Location: STATIC_FALLBACK, "Cache-Control": "no-cache", "X-FCircle-Source": "static" },
    });
  }

  const rows = Array.isArray(moments.article_data) ? moments.article_data : [];
  const st = (moments.statistical_data || {}).last_updated_time || "";
  const sweep = (state && state.sweep) || null;
  const stat = {
    ...(moments.statistical_data || {}),
    article_num: rows.length,
    last_updated_time: st,
    last_checked_time: (state && state.lastCheckedAt) ? nowText(state.lastCheckedAt) : "",
    last_updated_ts: (state && state.lastUpdatedAt) || 0,
    source: "netlify-scheduled",
  };
  if (sweep) {
    stat.friends_num = sweep.total;
    stat.active_num = sweep.active;
    stat.error_num = Math.max(0, Number(sweep.total || 0) - Number(sweep.active || 0));
  }

  // ETag 只跟随「文章集」变化，不跟 minutes 走，这样 304 才真的省得下来
  const etag = 'W/"' + rows.length + "-" + String(st).replace(/[^0-9]/g, "") + '"';
  if (req.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag, "Cache-Control": CACHE } });
  }

  return new Response(JSON.stringify({ statistical_data: stat, article_data: rows }), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": CACHE,
      ETag: etag,
      "X-FCircle-Source": "blobs",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
