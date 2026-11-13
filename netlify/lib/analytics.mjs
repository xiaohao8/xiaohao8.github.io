/* ============================================================
   醉里博客统计 v6 — 共用基础库
   collect.mjs 与 stats.mjs 共享：时区、UA、来源、UTM、路径、常量
   只放纯函数，不触碰 Blobs，方便单独验证。
   ============================================================ */

export const SCHEMA = "6.0";
export const TZ_NAME = "Asia/Shanghai";
export const TZ_OFFSET_MIN = 480; // UTC+8，全站统一，不跟随服务器时区
export const SESSION_IDLE_MS = 30 * 60 * 1000; // 51.la / Umami / Plausible 通用 30 分钟
export const ONLINE_WINDOW_MS = 5 * 60 * 1000; // 「当前在线」窗口
export const CACHE_TTL_MS = 60 * 1000; // 聚合结果缓存
export const MAX_EVENTS = 30000; // 单次聚合扫描上限，超出会明确标记 truncated

export const CORS_COLLECT = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};
export const CORS_READ = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "public, max-age=0, must-revalidate",
};

/* ---------- 时间：全部按北京时间切分 ----------
   把 UTC 毫秒加上 8 小时再取 toISOString()，得到的字段就是北京时间的
   年月日 / 时分秒。避免服务器 UTC 与访客本地时间各说各话。 */
export function zoned(ms) {
  const shifted = new Date(ms + TZ_OFFSET_MIN * 60000);
  const iso = shifted.toISOString();
  return {
    date: iso.slice(0, 10),
    hour: Number(iso.slice(11, 13)),
    minute: Number(iso.slice(14, 16)),
    second: Number(iso.slice(17, 19)),
    time: iso.slice(11, 19),
    weekday: shifted.getUTCDay(),
    display: iso.slice(0, 10) + " " + iso.slice(11, 19),
  };
}

export function beijingISO(ms) {
  if (!ms) return null;
  return new Date(ms + TZ_OFFSET_MIN * 60000).toISOString().replace("Z", "+08:00");
}

export function beijingDisplay(ms) {
  return ms ? zoned(ms).display : null;
}

/** 返回最近 days 天的北京时间日期数组（含今天），升序 */
export function dateKeys(days, nowMs = Date.now()) {
  const out = [];
  const base = zoned(nowMs).date;
  const anchor = Date.parse(base + "T00:00:00Z") - TZ_OFFSET_MIN * 60000;
  for (let i = days - 1; i >= 0; i--) out.push(zoned(anchor - i * 86400000).date);
  return out;
}

/* ---------- 通用清洗 ---------- */
export function safeStr(v, max = 300) {
  return String(v == null ? "" : v).replace(/[\u0000-\u001f]/g, "").slice(0, max);
}

export function safePath(p) {
  let s = safeStr(p, 300).trim();
  if (!s.startsWith("/")) return "";
  // 去掉 query 里的敏感参数，只保留统计需要的部分
  return s.slice(0, 250);
}

export function validVid(v) {
  return /^[a-zA-Z0-9_-]{6,64}$/.test(String(v || ""));
}

export function validEid(v) {
  return /^[a-zA-Z0-9_-]{6,80}$/.test(String(v || ""));
}

/* ---------- 爬虫 / 预取过滤 ---------- */
const BOT_RE = /bot|crawl|spider|slurp|bingpreview|facebookexternalhit|monitoring|preview|headless|phantom|wget|curl|python-requests|python-urllib|httpx|Go-http|java\/|okhttp|axios\/|scraping|semrush|ahrefs|majestic|dotbot|petalbot|bytespider|pinterest|discord|slack|telegram|whatsapp|embedly|quora|linkpreview|lighthouse|pagespeed|gtmetrix|uptimerobot|pingdom|node-fetch|postmanruntime|insomnia/i;

export function isBot(ua) {
  return !ua || ua.length < 10 || BOT_RE.test(ua);
}

/* ---------- UA：浏览器 / 系统 / 设备（含国产浏览器） ---------- */
export function parseUA(ua) {
  const s = safeStr(ua, 400);
  if (!s) return { browser: "未知", os: "未知", device: "未知" };

  let browser = "其他";
  const rules = [
    [/MicroMessenger/i, "微信内置"],
    [/QQBrowser/i, "QQ 浏览器"],
    [/UCBrowser|UBrowser/i, "UC 浏览器"],
    [/Quark/i, "夸克"],
    [/HuaweiBrowser/i, "华为浏览器"],
    [/MiuiBrowser/i, "小米浏览器"],
    [/SogouExplorer|SE 2\.X MetaSr/i, "搜狗浏览器"],
    [/QIHU|360SE|360EE/i, "360 浏览器"],
    [/BaiduBrowser|baiduboxapp/i, "百度浏览器"],
    [/Edg\//i, "Edge"],
    [/OPR\/|Opera/i, "Opera"],
    [/Firefox\/|FxiOS/i, "Firefox"],
    [/Chrome\/|CriOS/i, "Chrome"],
    [/Safari\/|Version\/.*Mobile/i, "Safari"],
    [/MSIE|Trident/i, "IE"],
  ];
  for (const [re, name] of rules) {
    if (re.test(s)) { browser = name; break; }
  }

  let os = "其他";
  if (/HarmonyOS|HuaweiBrowser/i.test(s)) os = "HarmonyOS";
  else if (/Windows NT 10|Windows 11/i.test(s)) os = "Windows";
  else if (/Windows/i.test(s)) os = "Windows";
  else if (/Android/i.test(s)) os = "Android";
  else if (/iPhone|iPad|iPod|CPU OS/i.test(s)) os = "iOS";
  else if (/Mac OS X|Macintosh/i.test(s)) os = "macOS";
  else if (/Linux/i.test(s)) os = "Linux";

  let device = "桌面";
  if (/iPad|Tablet|PlayBook|Silk/i.test(s) || (/Macintosh/i.test(s) && /Mobile/i.test(s))) device = "平板";
  else if (/Mobile|Android.*Mobile|iPhone|iPod|Windows Phone/i.test(s)) device = "移动端";

  return { browser, os, device };
}

/* ---------- 来源分类 ---------- */
const SEARCH_ENGINES = [
  [/baidu\.com/i, "百度", ["wd", "word", "kw"]],
  [/google\./i, "Google", ["q"]],
  [/bing\.com/i, "Bing", ["q"]],
  [/sogou\.com/i, "搜狗", ["query", "keyword"]],
  [/so\.com|360\.cn/i, "360搜索", ["q"]],
  [/sm\.cn|quark\.cn/i, "神马/夸克", ["q"]],
  [/duckduckgo\./i, "DuckDuckGo", ["q"]],
  [/yandex\./i, "Yandex", ["text"]],
  [/search\.brave/i, "Brave", ["q"]],
  [/toutiao\.com/i, "头条搜索", ["keyword"]],
];
const SOCIAL = [
  [/weibo\.com|weibo\.cn|t\.cn/i, "微博"],
  [/zhihu\.com/i, "知乎"],
  [/bilibili\.com|b23\.tv/i, "Bilibili"],
  [/douban\.com/i, "豆瓣"],
  [/xiaohongshu\.com|xhslink/i, "小红书"],
  [/twitter\.com|x\.com/i, "Twitter/X"],
  [/facebook\.com|fb\.com/i, "Facebook"],
  [/reddit\.com/i, "Reddit"],
  [/v2ex\.com/i, "V2EX"],
  [/juejin\.cn/i, "掘金"],
  [/csdn\.net/i, "CSDN"],
  [/github\.com/i, "GitHub"],
  [/qq\.com|weixin\.qq\.com/i, "微信/QQ"],
  [/telegram|t\.me/i, "Telegram"],
];

/** @returns {{category, source, domain, keyword}} */
export function classifyReferrer(raw, siteHost = "202271.xyz") {
  const r = safeStr(raw, 500);
  if (!r) return { category: "direct", source: "直接访问", domain: "", keyword: "" };
  let url;
  try { url = new URL(r.startsWith("http") ? r : "https://" + r); }
  catch (_) { return { category: "direct", source: "直接访问", domain: "", keyword: "" }; }
  const host = url.hostname.replace(/^www\./, "").toLowerCase();
  if (host === siteHost || host.endsWith("." + siteHost)) {
    return { category: "internal", source: "站内跳转", domain: host, keyword: "" };
  }
  for (const [re, name, keys] of SEARCH_ENGINES) {
    if (re.test(host)) {
      let keyword = "";
      for (const k of keys) {
        const v = url.searchParams.get(k);
        if (v) { keyword = safeStr(v, 60); break; }
      }
      return { category: "search", source: "搜索 · " + name, domain: host, keyword };
    }
  }
  for (const [re, name] of SOCIAL) {
    if (re.test(host)) return { category: "social", source: "社交 · " + name, domain: host, keyword: "" };
  }
  return { category: "external", source: host, domain: host, keyword: "" };
}

export const CATEGORY_LABELS = {
  direct: "直接访问",
  search: "搜索引擎",
  social: "社交媒体",
  external: "外部链接",
  internal: "站内跳转",
};

/* ---------- UTM / 活动参数 ---------- */
export function parseCampaign(urlStr) {
  const out = { source: "", medium: "", campaign: "", term: "", content: "" };
  try {
    const u = new URL(urlStr, "https://202271.xyz");
    out.source = safeStr(u.searchParams.get("utm_source") || u.searchParams.get("ref") || u.searchParams.get("from") || "", 60);
    out.medium = safeStr(u.searchParams.get("utm_medium") || "", 60);
    out.campaign = safeStr(u.searchParams.get("utm_campaign") || "", 80);
    out.term = safeStr(u.searchParams.get("utm_term") || "", 60);
    out.content = safeStr(u.searchParams.get("utm_content") || "", 60);
  } catch (_) { /* 忽略畸形 URL */ }
  return out;
}

/* ---------- 存储键 ---------- */
export const eventKey = (date, eid) => `ev/${date}/${eid}`;
export const eventPrefix = (date) => `ev/${date}/`;
export const dwellKey = (date, eid) => `dwell/${date}/${eid}`;
export const validDateKey = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || ""));
export const legacyKey = (ym) => `raw/${ym}.ndjson`;
export const cacheKey = (days) => `cache/stats-${days}.json`;

/* ---------- 地区标签清洗：中国|湖北省|孝感市|联通 → 湖北 孝感 联通 ---------- */
const PROVINCE_ALIAS = {
  "内蒙古自治区": "内蒙古", "广西壮族自治区": "广西", "新疆维吾尔自治区": "新疆",
  "宁夏回族自治区": "宁夏", "西藏自治区": "西藏", "香港特别行政区": "香港",
  "澳门特别行政区": "澳门", "台湾省": "台湾",
};

export function shortProvince(s) {
  const v = safeStr(s, 40).trim();
  if (!v || v === "0") return "";
  if (PROVINCE_ALIAS[v]) return PROVINCE_ALIAS[v];
  return v.replace(/(省|市)$/u, "");
}

export function shortCity(s) {
  const v = safeStr(s, 40).trim();
  if (!v || v === "0") return "";
  return v.replace(/市$/u, "");
}

export function shortIsp(s) {
  const v = safeStr(s, 60).trim();
  if (!v || v === "0") return "";
  const alias = {
    "中国联通": "联通", "中国网通": "联通", "中国电信": "电信",
    "中国移动": "移动", "中国铁通": "铁通", "中国科技网": "科技网",
    "中国教育和科研计算机网": "教育网", "阿里": "阿里云", "腾讯": "腾讯云",
  };
  if (alias[v]) return alias[v];
  return v.replace(/^中国/, "").replace(/(股份有限公司|有限责任公司|有限公司)$/u, "").slice(0, 12);
}

/** 只产出可安全落库的标签对象；调用方负责不要传原始 IP 进来。 */
export function formatGeoParts(raw = {}) {
  const country = safeStr(raw.country, 40).trim();
  const province = shortProvince(raw.province);
  let city = shortCity(raw.city);
  if (city && city === province) city = ""; // 直辖市不重复写「北京 北京」
  const isp = shortIsp(raw.isp);
  const parts = [];
  if (country && country !== "中国") parts.push(country); // 国内省略「中国」，直接「湖北 孝感 联通」
  if (province) parts.push(province);
  if (city) parts.push(city);
  if (isp) parts.push(isp);
  return {
    country, province, city, isp,
    display: parts.join(" "),
    source: safeStr(raw.source, 20) || "",
  };
}

/* ---------- 指标口径（直接下发给 UI，避免前后台说法不一） ---------- */
export const DEFINITIONS = {
  pv: "页面浏览量：一次有效页面浏览记 1 次，5 秒内同一访客重复上报同一页面会去重。",
  uv: "独立访客：统计区间内出现过的唯一匿名访客数（按浏览器本地标识，清除缓存后会重新计数）。",
  avgDailyUv: "日均独立访客：每天独立访客数的平均值；51.la 口径的 UV 即单日独立访客。",
  sessions: "会话/访问：同一访客连续两次浏览间隔超过 30 分钟即切分为新会话（服务端重建，不依赖前端 sessionStorage）。",
  bounceRate: "跳出率：只浏览了 1 个页面就结束的会话 ÷ 总会话数（51.la / Umami / Plausible 通用口径）。",
  avgDuration: "平均停留：按页面可见心跳统计，只累计「有停留数据」的会话；没有心跳的历史数据不参与平均，避免被 0 秒拉低。",
  pagesPerSession: "访问深度：总浏览量 ÷ 会话数。",
  online: "当前在线：最近 5 分钟内有浏览或心跳的唯一访客数。",
  newVisitors: "新访客：统计区间内首次出现的访客（以历史全量数据的首次出现日期为准）。",
  returningVisitors: "老访客：此前已经访问过的访客。",
  lastEventAt: "数据截至：最后一条原始采集事件的北京时间，不是接口请求时间。",
  computedAt: "本次计算：本次聚合实际执行的时间；命中缓存时会同时标注缓存年龄。",
  regions: "访客地区：用客户端 IP 查本地离线归属库，格式化为「省 市 运营商」（如 湖北 孝感 联通）。仅在服务端查询，事件里只保存标签，不记录原始 IP。",
  provinces: "省份分布：按 IP 归属库的省份聚合；未解析出省份的访问不计入。",
  isps: "运营商分布：按 IP 归属库的 ISP 聚合（联通 / 电信 / 移动 / 阿里云等）；IPv6 或查询失败的事件没有运营商。",
};

/* ---------- 小工具 ---------- */
export function shortHash(s) {
  // 仅用于匿名展示，不用于身份识别，也不存原始数据
  let h = 2166136261;
  const str = String(s || "");
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36).slice(0, 8);
}

export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      try { out[i] = await fn(items[i], i); } catch (_) { out[i] = null; }
    }
  });
  await Promise.all(workers);
  return out;
}
