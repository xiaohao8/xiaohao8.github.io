/* ============================================================
   醉里博客统计 v5.5 — 实时聚合端点
   GET /api/stats → 读取 Blobs 原始事件 → 内存聚合 → 返回完整统计
   效果对标 Umami：实时数据 / 会话 / 跳出率 / 浏览器 / 设备 / 实时在线
   ============================================================ */

import { getStore } from "@netlify/blobs";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });

const BOUNCE_THRESHOLD = 30 * 1000; // 30 秒内无第二次页面浏览 = 跳出

export default async function handler(req) {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "GET") return json({ error: "method" }, 405, CORS);

  const url = new URL(req.url);
  const days = Math.min(parseInt(url.searchParams.get("days"), 10) || 30, 365);
  const store = getStore({ name: "zui-analytics", consistency: "strong" });

  try {
    // 收集最近 N 天的月度 blob key
    const now = new Date();
    const monthKeys = [];
    for (let i = 0; i < Math.ceil(days / 30) + 1; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `raw/${d.toISOString().slice(0, 7)}.ndjson`;
      monthKeys.push(key);
    }

    // 读取全部 NDJSON
    let raw = "";
    for (const key of monthKeys) {
      try {
        const chunk = await store.get(key);
        if (chunk) raw += chunk + "\n";
      } catch (_) { /* key 不存在 */ }
    }

    // 解析事件
    const events = [];
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try { events.push(JSON.parse(line)); } catch (_) { continue; }
    }
    if (!events.length) return json(emptyStats());

    const cutoff = now.getTime() - days * 86400000;
    const visible = events.filter((e) => e.t * 1000 >= cutoff);
    if (!visible.length) return json(emptyStats());

    /* ---------- 基础聚合 ---------- */
    const dailyMap = new Map();
    const hourlyMap = new Array(24).fill(null).map(() => ({ pv: 0, uvs: new Set() }));
    const pagesMap = new Map();
    const refMap = new Map();
    const browserMap = new Map();
    const osMap = new Map();
    const deviceMap = new Map();
    const sessionsMap = new Map(); // sid -> { start, end, pages, vid }
    const visitors = new Set();
    let totalPV = 0;

    for (const e of visible) {
      const day = new Date(e.t * 1000).toISOString().slice(0, 10);
      const d = dailyMap.get(day) || { pv: 0, uvs: new Set() };
      d.pv += 1;
      if (e.v) d.uvs.add(e.v);
      dailyMap.set(day, d);

      const hr = e.hr != null ? e.hr : new Date(e.t * 1000).getUTCHours();
      hourlyMap[hr].pv += 1;
      if (e.v) hourlyMap[hr].uvs.add(e.v);

      pagesMap.set(e.p, (pagesMap.get(e.p) || 0) + 1);
      if (e.ref) refMap.set(e.ref, (refMap.get(e.ref) || 0) + 1);
      if (e.br) browserMap.set(e.br, (browserMap.get(e.br) || 0) + 1);
      if (e.os) osMap.set(e.os, (osMap.get(e.os) || 0) + 1);
      if (e.dv) deviceMap.set(e.dv, (deviceMap.get(e.dv) || 0) + 1);
      if (e.v) visitors.add(e.v);
      if (e.s) {
        const s = sessionsMap.get(e.s) || { start: e.t, end: e.t, pages: 0 };
        s.end = Math.max(s.end, e.t);
        s.pages += 1;
        sessionsMap.set(e.s, s);
      }
      totalPV += 1;
    }

    /* ---------- 会话统计（Umami 同款） ---------- */
    const sessionList = [...sessionsMap.values()];
    const bounces = sessionList.filter((s) => s.pages <= 1 && (s.end - s.start) < BOUNCE_THRESHOLD / 1000).length;
    const totalDuration = sessionList.reduce((sum, s) => sum + (s.end - s.start), 0);
    const avgDuration = sessionList.length ? Math.round(totalDuration / sessionList.length) : 0;
    const bounceRate = sessionList.length ? Math.round((bounces / sessionList.length) * 100) : 0;

    /* ---------- 实时在线（30 分钟窗口） ---------- */
    const realtime = visible.filter((e) => e.t * 1000 > now.getTime() - 30 * 60000);
    const onlineVisitors = new Set(realtime.map((e) => e.v)).size;

    /* ---------- 每日序列 ---------- */
    const daily = [...dailyMap.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, d]) => ({ date, pv: d.pv, uv: d.uvs.size }));

    const top = (map, n, labelKey) =>
      [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n)
        .map(([k, v]) => ({ [labelKey]: k, count: v }));

    const hourlyOut = hourlyMap.map((h, i) => ({
      hour: i, pv: h.pv, uv: h.uvs.size,
    }));

    return json({
      version: "5.5",
      updated: now.toISOString(),
      range: { days, since: new Date(cutoff).toISOString().slice(0, 10) },
      totals: {
        pv: totalPV,
        uv: visitors.size,
        sessions: sessionList.length,
        bounceRate,
        avgDuration,
        online: onlineVisitors,
      },
      daily,
      hourly: hourlyOut,
      pages: top(pagesMap, 20, "path"),
      referrers: top(refMap, 15, "source"),
      browsers: top(browserMap, 10, "name"),
      os: top(osMap, 10, "name"),
      devices: top(deviceMap, 10, "name"),
      realtime: {
        online: onlineVisitors,
        last30m: realtime.length,
      },
    });
  } catch (e) {
    console.error("[stats] error:", e.message);
    return json({ error: "internal" }, 500, CORS);
  }
}

function emptyStats() {
  return {
    version: "5.5", updated: new Date().toISOString(),
    range: { days: 30 }, totals: { pv: 0, uv: 0, sessions: 0, bounceRate: 0, avgDuration: 0, online: 0 },
    daily: [], hourly: [], pages: [], referrers: [], browsers: [], os: [], devices: [],
    realtime: { online: 0, last30m: 0 },
  };
}
