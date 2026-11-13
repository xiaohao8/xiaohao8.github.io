/* ============================================================
   醉里博客统计 v6 — 聚合端点 GET /api/stats?days=30

   可信度设计（针对 v5.5 的问题）：
   1. updated 不再是「请求时刻」。分开给 lastEventAt（最后一条原始事件的
      北京时间）、computedAt（本次聚合执行时间）、requestAt、cache.hit/ageSeconds。
      没有数据时 lastEventAt = null，界面显示「尚无采集数据」而不是「刚刚更新」。
   2. 所有日期/小时统一按 Asia/Shanghai (UTC+8) 切分，旧 UTC 数据会重算。
   3. 会话按 vid + 30 分钟空闲在服务端重建，不再信任前端 sessionStorage。
   4. 平均停留只累计「有心跳数据」的会话，并公开 dwellCoverage 覆盖率，
      避免单页会话被算成 0 秒把均值拉成 0:02。
   5. 事件来自 append-only 的 ev/<date>/<eid>；同时兼容旧 raw/*.ndjson，
      上线不会让历史数据「消失」；超出扫描上限或读取失败会明确标记。
   ============================================================ */

import { getStore } from "@netlify/blobs";
import {
  SCHEMA, TZ_NAME, TZ_OFFSET_MIN, SESSION_IDLE_MS, ONLINE_WINDOW_MS,
  CACHE_TTL_MS, MAX_EVENTS, CORS_READ, DEFINITIONS, CATEGORY_LABELS,
  zoned, beijingISO, beijingDisplay, dateKeys,
  dwellKey, legacyKey, cacheKey, mapLimit, shortHash, safeStr, shortProvince,
} from "../lib/analytics.mjs";
import { geoDiagnostics } from "../lib/geoip.mjs";
import { MACHINE_FILTER_RULES } from "../lib/machine-filter.mjs";

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { "Content-Type": "application/json", ...CORS_READ },
});

const EMPTY_UTM = () => ({ source: "", medium: "", campaign: "", term: "", content: "" });

function legacyCategory(ref) {
  const s = safeStr(ref, 60);
  if (!s) return "direct";
  if (s.indexOf("搜索:") === 0 || s.indexOf("搜索 ·") === 0) return "search";
  if (s.indexOf("社交:") === 0 || s.indexOf("社交 ·") === 0) return "social";
  return "external";
}

function normalizeLegacy(line) {
  try {
    const o = JSON.parse(line);
    if (!o || !o.p) return null;
    const t = Number(o.t) * 1000;
    if (!Number.isFinite(t) || t <= 0) return null;
    const z = zoned(t);
    return {
      schema: "5.5", e: "pv",
      eid: "legacy-" + shortHash(String(o.t) + "|" + String(o.v) + "|" + String(o.p)),
      t, v: safeStr(o.v, 64), p: safeStr(o.p, 250), title: "",
      r: safeStr(o.refRaw, 200),
      refCategory: legacyCategory(o.ref),
      refName: safeStr(o.ref, 80) || "直接访问",
      refDomain: "", keyword: "", utm: EMPTY_UTM(),
      br: safeStr(o.br, 40) || "未知", os: safeStr(o.os, 40) || "未知",
      dv: safeStr(o.dv, 40) || "未知",
      geo: { country: "", region: "", city: "", province: "", isp: "", display: "", source: "legacy" },
      screen: o.w && o.h ? o.w + "x" + o.h : "", lang: "",
      date: z.date, hour: z.hour, legacy: true,
    };
  } catch (_) { return null; }
}

/* ---------- 读取全部原始事件 ---------- */
async function loadEvents(store, keys) {
  const warnings = [];
  const events = [];
  let legacyCount = 0;
  let truncated = false;

  // 1) 新格式：一次 list 拿到所有 ev/ 键，按 key 里的日期过滤
  try {
    const { blobs } = await store.list({ prefix: "ev/" });
    const wanted = blobs.filter((b) => keys.has(b.key.split("/")[1]));
    const picked = wanted.slice(-MAX_EVENTS);
    if (wanted.length > picked.length) {
      truncated = true;
      warnings.push(`事件数 ${wanted.length} 超过单次扫描上限 ${MAX_EVENTS}，本次只统计最近 ${picked.length} 条`);
    }
    const rows = await mapLimit(picked, 32, (b) => store.get(b.key, { type: "json" }));
    for (const row of rows) {
      if (row && row.e === "pv" && Number.isFinite(Number(row.t))) events.push(row);
    }
  } catch (e) {
    warnings.push("读取新格式事件失败：" + e.message);
  }

  // 2) 兼容旧格式 raw/YYYY-MM.ndjson
  const months = [...new Set([...keys].map((d) => d.slice(0, 7)))];
  for (const ym of months) {
    try {
      const raw = await store.get(legacyKey(ym));
      if (!raw) continue;
      for (const line of String(raw).split("\n")) {
        if (!line.trim()) continue;
        const ev = normalizeLegacy(line);
        if (ev && keys.has(ev.date)) { events.push(ev); legacyCount += 1; }
      }
    } catch (e) { warnings.push(`旧存档 ${ym} 读取失败：` + e.message); }
  }

  // 3) 去重（新旧格式可能重叠）
  const seen = new Set();
  const deduped = [];
  for (const e of events) {
    const sig = String(e.v) + "|" + Math.round(Number(e.t) / 1000) + "|" + String(e.p);
    if (seen.has(sig)) continue;
    seen.add(sig);
    deduped.push(e);
  }
  deduped.sort((a, b) => Number(a.t) - Number(b.t));
  return { events: deduped, legacyCount, truncated, warnings };
}

/* ---------- 停留数据 ---------- */
async function loadDwell(store, events) {
  const map = new Map();
  const targets = [...new Set(events.map((e) => e.date + "|" + e.eid))];
  const rows = await mapLimit(targets, 32, async (combo) => {
    const [date, eid] = combo.split("|");
    try { return await store.get(dwellKey(date, eid), { type: "json" }); }
    catch (_) { return null; }
  });
  rows.forEach((r) => {
    if (!r || !r.eid) return;
    const prev = map.get(r.eid);
    if (!prev || Number(r.t) > Number(prev.t)) map.set(r.eid, r);
  });
  return map;
}

/* ---------- 访客首次出现日期（key 自身编码日期，无需逐条 get） ---------- */
async function loadFirstSeen(store) {
  const map = new Map();
  try {
    const { blobs } = await store.list({ prefix: "visitors/" });
    for (const b of blobs) {
      const parts = b.key.split("/");
      if (parts.length < 3) continue;
      const date = parts[1], hash = parts[2];
      if (!map.has(hash) || date < map.get(hash)) map.set(hash, date);
    }
  } catch (_) { /* 缺失时按「无法判定」处理 */ }
  return map;
}

/* ---------- 会话重建 ---------- */
function rebuildSessions(events, dwellMap) {
  const byVid = new Map();
  for (const e of events) {
    if (!e.v) continue;
    if (!byVid.has(e.v)) byVid.set(e.v, []);
    byVid.get(e.v).push(e);
  }
  const sessions = [];
  for (const [vid, list] of byVid) {
    list.sort((a, b) => Number(a.t) - Number(b.t));
    let cur = null;
    for (const e of list) {
      if (!cur || Number(e.t) - cur.lastT > SESSION_IDLE_MS) {
        cur = {
          vid, start: Number(e.t), end: Number(e.t), lastT: Number(e.t),
          events: [], dwellSec: 0, hasDwell: false,
        };
        sessions.push(cur);
      }
      cur.events.push(e);
      cur.lastT = Number(e.t);
      cur.end = Number(e.t);
      const d = dwellMap.get(e.eid);
      if (d && Number(d.d) > 0) {
        cur.dwellSec += Math.min(86400, Number(d.d));
        cur.hasDwell = true;
      }
    }
  }
  return sessions;
}

/* ---------- 汇总工具 ---------- */
function bump(map, key, n = 1) { map.set(key, (map.get(key) || 0) + n); }
function topN(map, n, nameKey = "name") {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k, v]) => ({ [nameKey]: k, count: v }));
}
function pct(cur, prev) {
  if (!prev) return cur ? null : 0;
  return Math.round(((cur - prev) / prev) * 1000) / 10;
}

/* ---------- 主聚合 ---------- */
function aggregate(events, dwellMap, firstSeen, days, now, metaBase) {
  const keys = dateKeys(days, now);
  const keySet = new Set(keys);
  const curStart = keys[0];
  const prevKeys = dateKeys(days * 2, now).slice(0, days);
  const prevSet = new Set(prevKeys);

  const inRange = events.filter((e) => keySet.has(e.date));
  const inPrev = events.filter((e) => prevSet.has(e.date));

  const sessions = rebuildSessions(inRange, dwellMap);
  const prevSessions = rebuildSessions(inPrev, dwellMap);

  /* 概览 */
  const uvSet = new Set(inRange.map((e) => e.v).filter(Boolean));
  const prevUvSet = new Set(inPrev.map((e) => e.v).filter(Boolean));
  const withDwell = sessions.filter((s) => s.hasDwell);
  const bounced = sessions.filter((s) => s.events.length === 1);
  const totalDwell = withDwell.reduce((a, s) => a + s.dwellSec, 0);

  let newVisitors = 0, returningVisitors = 0, unknownVisitors = 0;
  for (const vid of uvSet) {
    const first = firstSeen.get(shortHash(vid));
    if (!first) { unknownVisitors += 1; continue; }
    if (first >= curStart) newVisitors += 1;
    else returningVisitors += 1;
  }

  const totals = {
    pv: inRange.length,
    uv: uvSet.size,
    avgDailyUv: 0,
    sessions: sessions.length,
    bounceRate: sessions.length ? Math.round((bounced.length / sessions.length) * 100) : 0,
    avgDuration: withDwell.length ? Math.round(totalDwell / withDwell.length) : 0,
    pagesPerSession: sessions.length ? Math.round((inRange.length / sessions.length) * 100) / 100 : 0,
    newVisitors,
    returningVisitors,
    unknownVisitors,
    online: 0,
    dwellCoverage: sessions.length ? Math.round((withDwell.length / sessions.length) * 100) : 0,
  };

  /* 每日序列：服务端就补齐到完整 N 天，前端不必再猜 */
  const dailyMap = new Map();
  for (const k of keys) dailyMap.set(k, { date: k, pv: 0, sessions: 0, visitors: new Set() });
  for (const e of inRange) {
    const d = dailyMap.get(e.date);
    d.pv += 1;
    if (e.v) d.visitors.add(e.v);
  }
  for (const s of sessions) {
    const d = dailyMap.get(zoned(s.start).date);
    if (d) d.sessions += 1;
  }
  const daily = keys.map((k) => {
    const d = dailyMap.get(k);
    return { date: k, pv: d.pv, uv: d.visitors.size, sessions: d.sessions };
  });
  totals.avgDailyUv = Math.round((daily.reduce((a, d) => a + d.uv, 0) / days) * 10) / 10;

  /* 24 小时（北京时间） */
  const hourly = Array.from({ length: 24 }, (_, h) => ({ hour: h, pv: 0, uv: 0 }));
  const hourlyVisitors = Array.from({ length: 24 }, () => new Set());
  for (const e of inRange) {
    const h = Number.isInteger(e.hour) ? e.hour : zoned(Number(e.t)).hour;
    if (h < 0 || h > 23) continue;
    hourly[h].pv += 1;
    if (e.v) hourlyVisitors[h].add(e.v);
  }
  hourly.forEach((row, h) => { row.uv = hourlyVisitors[h].size; });

  /* 页面 / 入口 / 出口 */
  const pageMap = new Map();
  for (const e of inRange) {
    let row = pageMap.get(e.p);
    if (!row) { row = { path: e.p, pv: 0, visitors: new Set(), entry: 0, exit: 0, dwellSec: 0 }; pageMap.set(e.p, row); }
    row.pv += 1;
    if (e.v) row.visitors.add(e.v);
    const d = dwellMap.get(e.eid);
    if (d) row.dwellSec += Math.min(86400, Number(d.d) || 0);
  }
  for (const s of sessions) {
    if (!s.events.length) continue;
    const first = pageMap.get(s.events[0].p);
    const last = pageMap.get(s.events[s.events.length - 1].p);
    if (first) first.entry += 1;
    if (last) last.exit += 1;
  }
  const pageRows = [...pageMap.values()].map((r) => ({
    path: r.path, count: r.pv, uv: r.visitors.size, entry: r.entry, exit: r.exit,
    avgDwell: r.pv ? Math.round(r.dwellSec / r.pv) : 0,
  }));
  const pages = pageRows.sort((a, b) => b.count - a.count).slice(0, 20);
  const entryPages = pageRows.filter((r) => r.entry).sort((a, b) => b.entry - a.entry).slice(0, 10)
    .map((r) => ({ path: r.path, count: r.entry }));
  const exitPages = pageRows.filter((r) => r.exit).sort((a, b) => b.exit - a.exit).slice(0, 10)
    .map((r) => ({ path: r.path, count: r.exit }));

  /* 来源 */
  const catMap = new Map(), refMap = new Map(), domainMap = new Map(), keywordMap = new Map();
  for (const e of inRange) {
    bump(catMap, e.refCategory || "direct");
    if (e.refName) bump(refMap, e.refName);
    if (e.refDomain) bump(domainMap, e.refDomain);
    if (e.keyword) bump(keywordMap, e.keyword);
  }
  const referrers = {
    categories: Object.keys(CATEGORY_LABELS).map((k) => ({
      key: k, name: CATEGORY_LABELS[k], count: catMap.get(k) || 0,
    })).filter((x) => x.count > 0).sort((a, b) => b.count - a.count),
    details: topN(refMap, 15, "name"),
    domains: topN(domainMap, 15, "name"),
    keywords: topN(keywordMap, 15, "name"),
  };

  /* UTM */
  const utmSources = new Map(), utmMediums = new Map(), utmCampaigns = new Map();
  for (const e of inRange) {
    const u = e.utm || EMPTY_UTM();
    if (u.source) bump(utmSources, u.source);
    if (u.medium) bump(utmMediums, u.medium);
    if (u.campaign) bump(utmCampaigns, u.campaign);
  }

  /* 设备维度 */
  const dim = (field) => {
    const m = new Map();
    for (const e of inRange) bump(m, safeStr(e[field], 40) || "未知");
    return topN(m, 12, "name");
  };
  const regionMap = new Map(), provinceMap = new Map(), ispMap = new Map();
  for (const e of inRange) {
    const g = e.geo || {};
    // v6.1 起事件带 display（省 市 运营商）；旧事件仍按 country/region/city 拼
    const label = g.display || [g.country, g.region, g.city].filter(Boolean).join(" · ");
    if (label) bump(regionMap, label);
    const province = g.province || shortProvince(g.region);
    if (province) bump(provinceMap, province);
    if (g.isp) bump(ispMap, g.isp);
  }

  /* 实时在线：pv 或 dwell 最近 5 分钟内有活动 */
  const lastSeen = new Map();
  const lastInfo = new Map();
  for (const e of inRange) {
    if (!e.v) continue;
    const d = dwellMap.get(e.eid);
    const t = Math.max(Number(e.t), d ? Number(d.t) : 0);
    if (!lastSeen.has(e.v) || t > lastSeen.get(e.v)) {
      lastSeen.set(e.v, t);
      lastInfo.set(e.v, {
        id: shortHash(e.v), path: e.p,
        source: e.refName || CATEGORY_LABELS[e.refCategory || "direct"] || "直接访问",
        device: e.dv || "未知", browser: e.br || "未知",
        region: (e.geo && (e.geo.display || e.geo.city || e.geo.region || e.geo.country)) || "",
        dwell: d ? Number(d.d) || 0 : 0,
        at: beijingISO(t),
      });
    }
  }
  const onlineVids = [...lastSeen.entries()].filter(([, t]) => now - t <= ONLINE_WINDOW_MS);
  totals.online = onlineVids.length;
  const onlineVisitors = onlineVids
    .sort((a, b) => b[1] - a[1]).slice(0, 20)
    .map(([v]) => lastInfo.get(v)).filter(Boolean);

  const lastEventAt = events.length ? Number(events[events.length - 1].t) : null;
  const firstEventAt = events.length ? Number(events[0].t) : null;
  const daysWithData = new Set(inRange.map((e) => e.date)).size;

  const compare = {
    previous: { from: prevKeys[0], to: prevKeys[prevKeys.length - 1] },
    pv: { current: inRange.length, previous: inPrev.length, changePct: pct(inRange.length, inPrev.length) },
    uv: { current: uvSet.size, previous: prevUvSet.size, changePct: pct(uvSet.size, prevUvSet.size) },
    sessions: { current: sessions.length, previous: prevSessions.length, changePct: pct(sessions.length, prevSessions.length) },
  };

  return {
    schema: SCHEMA,
    totals,
    compare,
    daily,
    hourly,
    pages,
    entryPages,
    exitPages,
    referrers,
    utm: {
      sources: topN(utmSources, 12, "name"),
      mediums: topN(utmMediums, 12, "name"),
      campaigns: topN(utmCampaigns, 12, "name"),
    },
    browsers: dim("br"),
    os: dim("os"),
    devices: dim("dv"),
    screens: dim("screen"),
    languages: dim("lang"),
    regions: topN(regionMap, 15, "name"),
    provinces: topN(provinceMap, 12, "name"),
    isps: topN(ispMap, 12, "name"),
    realtime: {
      online: onlineVids.length,
      windowMinutes: ONLINE_WINDOW_MS / 60000,
      last5m: inRange.filter((e) => now - Number(e.t) <= ONLINE_WINDOW_MS).length,
      visitors: onlineVisitors,
    },
    _healthExtra: {
      lastEventAt, firstEventAt, daysWithData, daysRequested: days,
      eventsScanned: events.length, legacyEvents: metaBase.legacyCount,
      truncated: metaBase.truncated, warnings: metaBase.warnings,
    },
  };
}

/* ---------- 空数据：绝不伪装成「刚更新」 ---------- */
function emptyPayload(days, now, metaBase) {
  const keys = dateKeys(days, now);
  const prevKeys = dateKeys(days * 2, now).slice(0, days);
  return {
    schema: SCHEMA,
    totals: {
      pv: 0, uv: 0, avgDailyUv: 0, sessions: 0, bounceRate: 0, avgDuration: 0,
      pagesPerSession: 0, newVisitors: 0, returningVisitors: 0, unknownVisitors: 0,
      online: 0, dwellCoverage: 0,
    },
    compare: {
      previous: { from: prevKeys[0], to: prevKeys[prevKeys.length - 1] },
      pv: { current: 0, previous: 0, changePct: 0 },
      uv: { current: 0, previous: 0, changePct: 0 },
      sessions: { current: 0, previous: 0, changePct: 0 },
    },
    daily: keys.map((date) => ({ date, pv: 0, uv: 0, sessions: 0 })),
    hourly: Array.from({ length: 24 }, (_, hour) => ({ hour, pv: 0, uv: 0 })),
    pages: [], entryPages: [], exitPages: [],
    referrers: { categories: [], details: [], domains: [], keywords: [] },
    utm: { sources: [], mediums: [], campaigns: [] },
    browsers: [], os: [], devices: [], screens: [], languages: [], regions: [], provinces: [], isps: [],
    realtime: { online: 0, windowMinutes: 5, last5m: 0, visitors: [] },
    _healthExtra: {
      lastEventAt: null, firstEventAt: null, daysWithData: 0, daysRequested: days,
      eventsScanned: 0, legacyEvents: metaBase.legacyCount,
      truncated: metaBase.truncated, warnings: metaBase.warnings,
    },
  };
}

export const config = { path: "/api/stats" };

export default async function handler(req) {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_READ });
  if (req.method !== "GET") return json({ error: "method" }, 405);

  const url = new URL(req.url);
  const days = Math.max(1, Math.min(90, parseInt(url.searchParams.get("days"), 10) || 30));
  const fresh = url.searchParams.get("fresh") === "1";
  const now = Date.now();
  const store = getStore({ name: "zui-analytics", consistency: "strong" });

  /* 结果缓存：派生数据覆盖写是安全的，且会在 meta 里诚实标注命中与年龄 */
  if (!fresh) {
    try {
      const cached = await store.get(cacheKey(days), { type: "json" });
      if (cached && cached.meta && Number(cached.meta.computedAtMs) &&
          now - Number(cached.meta.computedAtMs) < CACHE_TTL_MS) {
        const m = {
          ...cached.meta,
          requestAt: beijingISO(now),
          cache: { hit: true, ageSeconds: Math.round((now - Number(cached.meta.computedAtMs)) / 1000) },
        };
        return json({ ...cached, meta: m });
      }
    } catch (_) { /* 缓存不可用时照常实时聚合 */ }
  }

  const keys = new Set([...dateKeys(days, now), ...dateKeys(days * 2, now)]);
  const loaded = await loadEvents(store, keys);
  const dwellMap = await loadDwell(store, loaded.events);
  const firstSeen = await loadFirstSeen(store);

  const metaBase = {
    legacyCount: loaded.legacyCount,
    truncated: loaded.truncated,
    warnings: loaded.warnings,
  };

  const payload = loaded.events.length
    ? aggregate(loaded.events, dwellMap, firstSeen, days, now, metaBase)
    : emptyPayload(days, now, metaBase);

  const h = payload._healthExtra;
  delete payload._healthExtra;

  const warnings = [...h.warnings];
  // 旧格式事件可能只落在「上一对比周期」，h.legacyEvents 只统计本期，
  // 这里按本次实际扫描到的事件数披露，避免读到了却不告诉用户。
  const legacyScanned = loaded.events.filter((e) => e.legacy).length;
  if (legacyScanned) warnings.push(`本次扫描包含 ${legacyScanned} 条旧格式事件（已重算为北京时间，无停留数据）`);
  if (!loaded.events.length) warnings.push("尚无任何采集数据，页面显示的是空状态而不是估算值");
  if (h.truncated) warnings.push("数据被截断，概览数字低于真实值，请缩小统计天数");

  payload.meta = {
    schema: SCHEMA,
    engine: "zuili-analytics",
    timezone: TZ_NAME,
    tzOffsetMinutes: TZ_OFFSET_MIN,
    range: {
      days,
      from: dateKeys(days, now)[0],
      to: dateKeys(days, now)[days - 1],
    },
    lastEventAt: beijingISO(h.lastEventAt),
    lastEventDisplay: beijingDisplay(h.lastEventAt),
    firstEventAt: beijingISO(h.firstEventAt),
    computedAt: beijingISO(now),
    computedAtMs: now,
    requestAt: beijingISO(now),
    cache: { hit: false, ageSeconds: 0, ttlSeconds: CACHE_TTL_MS / 1000 },
    definitions: DEFINITIONS,
  };

  payload.health = {
    status: h.truncated || warnings.some((w) => w.indexOf("失败") >= 0) ? "degraded"
      : !loaded.events.length ? "no_data" : "ok",
    lastEventAt: beijingISO(h.lastEventAt),
    lastEventAgeSeconds: h.lastEventAt ? Math.round((now - h.lastEventAt) / 1000) : null,
    daysWithData: h.daysWithData,
    daysRequested: h.daysRequested,
    coverage: Math.round((h.daysWithData / h.daysRequested) * 100),
    eventsScanned: h.eventsScanned,
    legacyEvents: legacyScanned,
    dwellCoverage: payload.totals.dwellCoverage,
    truncated: h.truncated,
    geoip: geoDiagnostics(),
    machineFilter: {
      enabled: true,
      rules: MACHINE_FILTER_RULES.length,
      labels: MACHINE_FILTER_RULES,
    },
    warnings,
  };

  // 强制重算也要回写派生缓存：否则用户点「强制重算」看到真实数字后，
  // 60 秒内的普通请求会命中旧缓存又退回旧数字。缓存是可重算的派生结果，覆盖安全。
  try { await store.setJSON(cacheKey(days), payload); }
  catch (_) { /* 缓存写入失败不影响本次响应 */ }

  return json(payload);
}
