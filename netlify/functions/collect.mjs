/* ============================================================
   醉里博客统计 v5.5 — 采集端点
   存储：Netlify Blobs（原生，免 Token / 免 API / 实时）
   效果对标 Umami：会话跟踪 / 爬虫过滤 / 来源识别 / 设备解析
   ============================================================ */

import { getStore } from "@netlify/blobs";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });

const SITE_URL = (process.env.SITE_URL || "https://202271.xyz").replace(/\/$/, "");

/* ---------- 爬虫过滤 ---------- */
const BOT_RE = /bot|crawl|spider|slurp|bingpreview|facebookexternalhit| monitoring|preview|headless|phantom|wget|curl|python-requests|httpx|Go-http|java\/|okhttp|axios\/|scraping|semrush|ahrefs|majestic|dotbot|petalbot|bytespider|pinterest|discord|slack|telegram|whatsapp|embedly|quora|linkpreview/i;

function isBot(ua) {
  return !ua || BOT_RE.test(ua) || ua.length < 10;
}

/* ---------- 来源识别 ---------- */
const SEARCH_ENGINES = [
  [/google\./, "Google"], [/bing\.com/, "Bing"], [/baidu\.com/, "百度"],
  [/sogou\.com/, "搜狗"], [/so\.com/, "360搜索"], [/sm\.cn/, "神马"],
  [/duckduckgo\./, "DuckDuckGo"], [/yandex\./, "Yandex"], [/search\.brave/, "Brave"],
];
const SOCIAL = [
  [/twitter\.com|x\.com/, "Twitter/X"], [/facebook\.com/, "Facebook"],
  [/weibo\.com|weibo\.cn/, "微博"], [/zhihu\.com/, "知乎"],
  [/bilibili\.com/, "Bilibili"], [/douban\.com/, "豆瓣"],
  [/reddit\.com/, "Reddit"], [/v2ex\.com/, "V2EX"],
  [/juejin\.cn/, "掘金"], [/csdn\.net/, "CSDN"],
  [/github\.com/, "GitHub"], [/t\.cn/, "微博短链"],
];
const referrerSource = (r) => {
  if (!r) return "";
  try {
    const host = new URL(r.startsWith("http") ? r : "https://" + r).hostname.replace(/^www\./, "");
    for (const [re, name] of SEARCH_ENGINES) if (re.test(host)) return "搜索: " + name;
    for (const [re, name] of SOCIAL) if (re.test(host)) return "社交: " + name;
    return host;
  } catch (_) { return ""; }
};

/* ---------- 浏览器/设备解析 ---------- */
function parseUA(ua) {
  if (!ua) return { browser: "未知", os: "未知", device: "桌面" };
  let browser = "其他";
  if (/Edg\//.test(ua)) browser = "Edge";
  else if (/OPR\/|Opera/.test(ua)) browser = "Opera";
  else if (/Firefox\//.test(ua)) browser = "Firefox";
  else if (/Chrome\//.test(ua) && !/Edg/.test(ua)) browser = "Chrome";
  else if (/Safari\//.test(ua) && !/Chrome/.test(ua)) browser = "Safari";
  else if (/MSIE|Trident/.test(ua)) browser = "IE";

  let os = "其他";
  if (/Windows/.test(ua)) os = "Windows";
  else if (/Mac OS X/.test(ua)) os = "macOS";
  else if (/Android/.test(ua)) os = "Android";
  else if (/iPhone|iPad|iPod/.test(ua)) os = "iOS";
  else if (/Linux/.test(ua) && !/Android/.test(ua)) os = "Linux";

  const device = /Mobile|Android.*Mobile|iPhone|iPod/.test(ua) ? "移动端"
    : /iPad|Tablet/.test(ua) ? "平板" : "桌面";

  return { browser, os, device };
}

/* ---------- 会话 ID ---------- */
function sessionID(vid, body) {
  // 30 分钟窗口会话：同一 vid + 30 分钟内 = 同会话
  return (body.s || "").slice(0, 40) || vid + ":" + Math.floor(Date.now() / 1800000);
}

/* ============================================================
   POST /api/collect — 采集匿名浏览事件
   ============================================================ */
export const config = { path: "/api/collect" };

export default async function handler(req) {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "method" }, 405, CORS);

  const site = SITE_URL;
  const origin = req.headers.get("origin") || "";
  if (origin && !origin.startsWith(site)) return json({ ok: false, error: "forbidden" }, 403, CORS);

  let body;
  try { body = await req.json(); } catch (_) { return json({ ok: false }, 400, CORS); }

  // 路径校验
  const p = String(body.p || "/").slice(0, 300);
  if (!p.startsWith("/") || /^\/(admin|api|\.netlify|analytics)\b/.test(p)) return new Response(null, { status: 204, headers: CORS });

  // 爬虫过滤
  const ua = String(body.ua || "").slice(0, 300);
  if (isBot(ua)) return new Response(null, { status: 204, headers: CORS });

  // 匿名访客 ID
  const vid = String(body.v || "").replace(/[^a-zA-Z0-9-]/g, "").slice(0, 64);
  if (!vid) return new Response(null, { status: 204, headers: CORS });

  // 来源解析
  const rawRef = String(body.r || "").slice(0, 500);
  const ref = referrerSource(rawRef);

  // 设备解析
  const dev = parseUA(ua);

  // 会话
  const s = sessionID(vid, body);

  const now = Date.now();
  const day = new Date(now).toISOString().slice(0, 10);
  const hour = new Date(now).getUTCHours();

  const event = {
    t: Math.floor(now / 1000),
    v: vid,
    s,
    p: p.slice(0, 200),
    ref: ref || "",
    refRaw: rawRef ? rawRef.slice(0, 200) : "",
    br: dev.browser,
    os: dev.os,
    dv: dev.device,
    w: parseInt(body.w, 10) || 0,
    h: parseInt(body.h, 10) || 0,
    ct: String(body.ct || "").slice(0, 10), // country 留空，可后续接 GeoIP
    hr: hour,
  };

  // 写入 Netlify Blobs
  try {
    const store = getStore({ name: "zui-analytics", consistency: "strong" });
    const monthKey = `raw/${day.slice(0, 7)}.ndjson`;

    // 追加：先读现有内容再整体写入（Netlify Blobs 无原生 append，数据量小可接受）
    let existing = "";
    try {
      existing = (await store.get(monthKey)) || "";
    } catch (_) { /* key 不存在 */ }
    const content = existing ? existing.replace(/\n$/, "") + "\n" + JSON.stringify(event) + "\n" : JSON.stringify(event) + "\n";
    await store.set(monthKey, content);

    // 实时在线标记（30 分钟窗口）
    await store.setJSON(`online/${Math.floor(now / 60000)}`, { t: now, v: vid }, { metadata: null });

    return new Response(null, { status: 204, headers: CORS });
  } catch (e) {
    console.error("[collect] blob write error:", e.message);
    return json({ ok: false, error: "storage" }, 500, CORS);
  }
}
