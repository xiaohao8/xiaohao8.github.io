/* ============================================================
   醉里博客统计 v6 — 采集端点 POST /api/collect

   与 v5.5 的根本区别（可信度修复）：
   - 旧版「读整月 NDJSON → 拼一行 → 覆盖写回」是 last-write-wins 反模式，
     并发访问会静默丢事件，数据变大后还会超时丢整批。Netlify 官方明确不建议。
   - v6 改为 **每条浏览事件一个独立 blob key + onlyIfNew 原子写**，
     append-only、幂等、无 read-modify-write，任何并发都不会覆盖别人的数据。
   - 停留心跳写 dwell/<date>/<eid>，同一次浏览反复覆盖同一个 key 是期望语义
     （取最新累计停留秒数），不产生 key 膨胀。
   - 会话不再信任前端 sessionStorage，由 stats.mjs 按 vid + 30 分钟空闲重建。
   ============================================================ */

import { getStore } from "@netlify/blobs";
import {
  SCHEMA, TZ_NAME, CORS_COLLECT, safeStr, safePath, validVid, validEid,
  validDateKey, isBot, parseUA, classifyReferrer, parseCampaign, zoned,
  eventKey, dwellKey, shortHash,
} from "../lib/analytics.mjs";
import { resolveGeo } from "../lib/geoip.mjs";

const SITE_URL = (process.env.SITE_URL || "https://202271.xyz").replace(/\/$/, "");
const SITE_HOST = (() => { try { return new URL(SITE_URL).hostname.replace(/^www\./, ""); } catch (_) { return "202271.xyz"; } })();

const json = (data, status, headers = CORS_COLLECT) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers },
  });

const noContent = () => new Response(null, {
  status: 204,
  headers: { ...CORS_COLLECT, "Cache-Control": "no-store" },
});

function allowedOrigin(origin) {
  if (!origin) return true; // 同源 sendBeacon / 隐私模式下可能不带
  try {
    const u = new URL(origin);
    const host = u.hostname.replace(/^www\./, "");
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;
    return host === SITE_HOST || host.endsWith(".netlify.app");
  } catch (_) { return false; }
}

/* 客户端 IP 只在本次请求内用于查本地归属库，绝不写入事件 / Blobs / 日志。
   context.ip 由 Netlify 提供、不可被请求头伪造，优先使用。 */
function clientIp(req, context) {
  const candidates = [
    context && context.ip,
    req.headers.get("x-nf-client-connection-ip"),
    req.headers.get("x-forwarded-for"),
  ];
  for (const c of candidates) {
    if (!c) continue;
    const first = String(c).split(",")[0].trim().replace(/^::ffff:/, "");
    if (first) return first;
  }
  return "";
}

export const config = { path: "/api/collect" };

export default async function handler(req, context) {
  if (req.method === "OPTIONS") return noContent();
  if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);
  if (!allowedOrigin(req.headers.get("origin"))) return json({ ok: false, error: "forbidden" }, 403);

  let body;
  try { body = await req.json(); }
  catch (_) { return json({ ok: false, error: "bad json" }, 400); }

  const kind = safeStr(body.e || "pv", 12);
  const vid = safeStr(body.v || "", 64);
  const eid = safeStr(body.eid || "", 80);
  if (!validVid(vid) || !validEid(eid)) return noContent();

  const store = getStore({ name: "zui-analytics", consistency: "strong" });
  const now = Date.now();
  const z = zoned(now);

  /* ---------- 停留心跳 / 离开：只更新该次浏览的 dwell 记录 ---------- */
  if (kind === "dwell" || kind === "leave") {
    const date = safeStr(body.dt || z.date, 10);
    if (!validDateKey(date)) return noContent();
    const dwell = Math.max(0, Math.min(86400, Math.round(Number(body.d) || 0)));
    try {
      await store.setJSON(dwellKey(date, eid), {
        eid, v: shortHash(vid), d: dwell, t: now, final: kind === "leave",
      });
      return noContent();
    } catch (e) {
      console.error("[collect] dwell write error:", e.message);
      return json({ ok: false, error: "storage" }, 500);
    }
  }

  if (kind !== "pv") return noContent();

  /* ---------- 页面浏览 ---------- */
  const p = safePath(body.p || "/");
  if (!p || /^\/(admin|api|\.netlify|analytics|fcircle)(\/|$)/i.test(p)) return noContent();

  const ua = safeStr(body.ua || "", 400);
  if (isBot(ua)) return noContent();

  const dev = parseUA(ua);
  const rawRef = safeStr(body.r || "", 500);
  const ref = classifyReferrer(rawRef, SITE_HOST);
  const fullUrl = safeStr(body.u || "", 500);
  const utm = parseCampaign(fullUrl || p);
  const screen = safeStr(body.screen || (Number(body.w) + "x" + Number(body.h)), 24);

  const event = {
    schema: SCHEMA,
    e: "pv",
    eid,
    t: now,                    // 毫秒，旧格式是秒，stats 会做兼容
    v: vid,
    p,
    title: safeStr(body.t || "", 120),
    r: rawRef ? rawRef.slice(0, 200) : "",
    refCategory: ref.category,
    refName: ref.source,
    refDomain: ref.domain,
    keyword: ref.keyword,
    utm,
    br: dev.browser,
    os: dev.os,
    dv: dev.device,
    geo: resolveGeo(clientIp(req, context), context && context.geo),
    screen,
    lang: safeStr(body.lang || "", 24),
    date: z.date,              // 北京时间
    hour: z.hour,              // 北京时间小时
    tz: TZ_NAME,
  };

  try {
    // onlyIfNew：同一个 eid 重复上报不会覆盖，也不会重复计数
    const res = await store.setJSON(eventKey(event.date, eid), event, { onlyIfNew: true });
    if (res && res.modified === false) return noContent(); // 幂等重复

    // 访客首次出现日期编码在 key 里：stats 用一次 list 即可判定新老访客，
    // 不需要逐条 get，也不会存原始 vid 之外的任何身份信息。
    try {
      await store.setJSON(`visitors/${event.date}/${shortHash(vid)}`, { first: event.date }, { onlyIfNew: true });
    } catch (_) { /* 首次访问标记失败不影响本次浏览统计 */ }

    // 回传服务端认定的北京时间日期，前端心跳据此写 dwell 键，避免跨午夜错配
    return json({ ok: true, date: event.date, eid: eid }, 200);
  } catch (e) {
    console.error("[collect] event write error:", e.message);
    return json({ ok: false, error: "storage" }, 500);
  }
}
