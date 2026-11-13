/* 统计 v6 端到端回归探针（离线，不联网、不写真实 Blobs）
 *
 *   NODE_OPTIONS= node tools/analytics-probe.mjs
 *
 * 用内存 mock 替代 Netlify Blobs，把 collect.mjs / stats.mjs 的源码里的
 * getStore 替换成 mock 后动态 import，直接跑真实 handler。覆盖：
 *   日期序列方向、空数据可信度、PV 幂等、停留心跳、旧格式兼容、会话重建、
 *   来源/关键词/UTM、环比周期、缓存与强制重算、非法请求。
 * 改统计口径后必须跑一次；任何 FAIL 都不要上线。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const libUrl = pathToFileURL(path.join(ROOT, "netlify/lib/analytics.mjs")).href;
// machine-filter.mjs 是纯 JS（只依赖 analytics.mjs），可以直接用真实模块跑断言
const filterUrl = pathToFileURL(path.join(ROOT, "netlify/lib/machine-filter.mjs")).href;

/* geoip.mjs 依赖 11MB 二进制库，探针里换成固定结果的 mock；
   格式化函数 formatGeoParts 仍用真实模块单独断言。 */
const mockGeoUrl = "data:text/javascript;base64," + Buffer.from(`
export function resolveGeo(ip) {
  const isp = String(ip || "").indexOf("113.") === 0 ? "联通" : "电信";
  return { country: "中国", province: "湖北", city: "孝感", isp,
           display: "湖北 孝感 " + isp, source: "ip2region" };
}
export function geoDiagnostics() {
  return { available: true, database: "ip2region_v4.xdb",
           source: "ip2region（离线 IPv4 库）", error: "", storesRawIp: false };
}
`).toString("base64");

function moduleUrl(file) {
  let src = fs.readFileSync(path.join(ROOT, file), "utf8");
  src = src.replace('import { getStore } from "@netlify/blobs";', "const getStore = () => globalThis.__STORE__;");
  src = src.replace('from "../lib/analytics.mjs";', `from ${JSON.stringify(libUrl)};`);
  src = src.replace('from "../lib/geoip.mjs";', `from ${JSON.stringify(mockGeoUrl)};`);
  src = src.replace('from "../lib/machine-filter.mjs";', `from ${JSON.stringify(filterUrl)};`);
  if (src.includes("@netlify/blobs") || src.includes("../lib/analytics.mjs") ||
      src.includes("../lib/geoip.mjs") || src.includes("../lib/machine-filter.mjs")) {
    throw new Error("import rewrite failed for " + file);
  }
  return "data:text/javascript;base64," + Buffer.from(src).toString("base64");
}

const memory = new Map();
globalThis.__STORE__ = {
  async get(key) { return memory.has(key) ? JSON.parse(JSON.stringify(memory.get(key))) : null; },
  async setJSON(key, value, opts = {}) {
    if (opts.onlyIfNew && memory.has(key)) return { modified: false };
    memory.set(key, JSON.parse(JSON.stringify(value)));
    return { modified: true, etag: "mock" };
  },
  async list({ prefix = "" } = {}) {
    return { blobs: [...memory.keys()].filter((k) => k.startsWith(prefix)).map((k) => ({ key: k, etag: "mock" })) };
  },
};

const collect = (await import(moduleUrl("netlify/functions/collect.mjs"))).default;
const stats = (await import(moduleUrl("netlify/functions/stats.mjs"))).default;
const lib = await import(libUrl);

const req = (url, body, headers = {}) => new Request(url, {
  method: body ? "POST" : "GET",
  headers: {
    "Content-Type": "application/json", Origin: "https://202271.xyz",
    "X-Nf-Client-Connection-Ip": "113.57.20.1", ...headers,
  },
  body: body ? JSON.stringify(body) : undefined,
});

const now = Date.now();
const z = lib.zoned(now);
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";
let failures = 0;
function check(name, cond, extra) {
  console.log((cond ? "PASS " : "FAIL ") + name + (extra === undefined ? "" : "  -> " + JSON.stringify(extra)));
  if (!cond) failures++;
}

/* 0a. 地区标签：中国|湖北省|孝感市|联通 → 湖北 孝感 联通 */
const g1 = lib.formatGeoParts({ country: "中国", province: "湖北省", city: "孝感市", isp: "中国联通", source: "ip2region" });
check("geo: 省 市 运营商格式", g1.display === "湖北 孝感 联通", g1);
const g2 = lib.formatGeoParts({ country: "中国", province: "北京市", city: "北京市", isp: "中国联通" });
check("geo: 直辖市不重复", g2.display === "北京 联通", g2);
const g3 = lib.formatGeoParts({ country: "中国", province: "新疆维吾尔自治区", city: "乌鲁木齐市", isp: "中国电信" });
check("geo: 自治区清洗", g3.display === "新疆 乌鲁木齐 电信", g3);

/* 0. 日期序列必须是过去 N 天（升序、末项=今天）——曾因写成 +i 天而全盘错位 */
const k30 = lib.dateKeys(30, now);
check("dateKeys: 30 天升序、末项=今天", k30.length === 30 && k30[0] < k30[29] && k30[29] === z.date, [k30[0], k30[29]]);
const k60 = lib.dateKeys(60, now);
check("dateKeys: 60 天上一周期不含今天", k60.slice(0, 30).indexOf(z.date) === -1, k60.slice(0, 30).slice(-1));

/* 1. 空数据态 */
let r = await stats(req("https://202271.xyz/api/stats?days=30"));
let d = await r.json();
check("empty: HTTP 200", r.status === 200, r.status);
check("empty: lastEventAt = null", d.meta.lastEventAt === null, d.meta.lastEventAt);
check("empty: health.status = no_data", d.health.status === "no_data", d.health.status);
check("empty: daily 30 / hourly 24", d.daily.length === 30 && d.hourly.length === 24, [d.daily.length, d.hourly.length]);
check("empty: definitions 下发", Object.keys(d.meta.definitions || {}).length >= 8, Object.keys(d.meta.definitions || {}).length);

/* 2. 采集 PV */
function pv(vid, eid, p, extra = {}) {
  return {
    v: vid, eid, e: "pv", p, t: "测试页", u: "https://202271.xyz" + p,
    r: "", ua: UA, screen: "1920x1080", lang: "zh-CN", dt: z.date, ...extra,
  };
}
const v1 = "visitor-aaaa", v2 = "visitor-bbbb";
const e1 = "event-0001", e2 = "event-0002", e3 = "event-0003";
r = await collect(req("https://202271.xyz/api/collect", pv(v1, e1, "/", {
  r: "https://www.baidu.com/s?wd=hexo%20%E7%BB%9F%E8%AE%A1",
})), {});
let c = await r.json();
check("collect pv: 200 + 服务端日期", r.status === 200 && /^\d{4}-\d{2}-\d{2}$/.test(c.date), c);

await collect(req("https://202271.xyz/api/collect", pv(v1, e2, "/posts/hello/", {
  u: "https://202271.xyz/posts/hello/?utm_source=weibo&utm_medium=social&utm_campaign=launch",
})), {});
await collect(req("https://202271.xyz/api/collect", pv(v2, e3, "/about/")), {});

r = await collect(req("https://202271.xyz/api/collect", pv(v1, e1, "/")), {});
check("collect pv: 重复 eid 返回 204", r.status === 204, r.status);

/* 隐私：事件里只能有标签，绝不能有原始 IP */
const storedEvent = memory.get(`ev/${z.date}/${e1}`) || {};
check("privacy: 事件 geo 带省市运营商", storedEvent.geo && storedEvent.geo.display === "湖北 孝感 联通", storedEvent.geo);
check("privacy: 事件不含原始 IP", !("ip" in storedEvent) && JSON.stringify(storedEvent).indexOf("113.57.20.1") < 0, Object.keys(storedEvent));

/* 3. 停留心跳 + 离开 */
await collect(req("https://202271.xyz/api/collect", { v: v1, eid: e1, e: "dwell", d: 42, dt: z.date, ua: UA }), {});
await collect(req("https://202271.xyz/api/collect", { v: v1, eid: e1, e: "leave", d: 75, dt: z.date, ua: UA }), {});
check("dwell key 覆盖为最新值", memory.get(`dwell/${z.date}/${e1}`).d === 75, memory.get(`dwell/${z.date}/${e1}`));

/* 4. 旧格式兼容：一条 40 天前的 v5.5 秒级 NDJSON（落在上一对比周期） */
const legacyMs = now - 40 * 86400000;
const lz = lib.zoned(legacyMs);
const ym = lz.date.slice(0, 7);
memory.set(`raw/${ym}.ndjson`,
  JSON.stringify({
    t: Math.floor(legacyMs / 1000), v: "legacy-user", p: "/legacy/",
    ref: "搜索:百度", refRaw: "https://www.baidu.com/s?wd=old", ua: UA,
    br: "Chrome", os: "Windows", dv: "desktop", w: 1920, h: 1080, s: "ignored",
  }) + "\n");

/* 5. 聚合 */
r = await stats(req("https://202271.xyz/api/stats?days=30&fresh=1"));
d = await r.json();
check("aggregate: HTTP 200", r.status === 200, r.status);
check("aggregate: PV = 3 新事件", d.totals.pv === 3, d.totals.pv);
check("aggregate: UV = 2", d.totals.uv === 2, d.totals.uv);
check("aggregate: sessions = 2", d.totals.sessions === 2, d.totals.sessions);
check("aggregate: 停留覆盖 > 0", d.totals.dwellCoverage > 0, d.totals.dwellCoverage);
check("aggregate: avgDuration > 0", d.totals.avgDuration > 0, d.totals.avgDuration);
check("aggregate: lastEventAt 非空", !!d.meta.lastEventAt, d.meta.lastEventAt);
check("aggregate: computedAt / requestAt 存在", !!d.meta.computedAt && !!d.meta.requestAt);
check("aggregate: cache.hit = false (fresh=1)", d.meta.cache.hit === false, d.meta.cache.hit);
check("aggregate: health.status", ["ok", "degraded"].includes(d.health.status), d.health.status);
check("aggregate: daily 30 完整且末项=今天", d.daily.length === 30 && d.daily[29].date === z.date, [d.daily[0].date, d.daily[29].date]);
check("aggregate: range.from < range.to", d.meta.range.from < d.meta.range.to, d.meta.range);
check("aggregate: 新访客判定（本期首次出现）", d.totals.newVisitors === 2, d.totals.newVisitors);
check("aggregate: referrers 有分类", Array.isArray(d.referrers.categories) && d.referrers.categories.length > 0, d.referrers.categories);
check("aggregate: 搜索关键词提取", Array.isArray(d.referrers.keywords) && d.referrers.keywords.length > 0, d.referrers.keywords);
check("aggregate: UTM 提取", Array.isArray(d.utm.sources) && d.utm.sources.length > 0, d.utm.sources);
check("aggregate: 热门页面", Array.isArray(d.pages) && d.pages.length > 0, d.pages.slice(0, 2));
check("aggregate: 旧格式事件计入 warnings", d.health.legacyEvents >= 1 || (d.health.warnings || []).some((w) => w.includes("旧格式")), [d.health.legacyEvents, d.health.warnings]);
check("aggregate: realtime 结构", d.realtime && Array.isArray(d.realtime.visitors), d.realtime && d.realtime.online);
check("aggregate: 访客地区带运营商", (d.regions || []).some((x) => x.name.indexOf("联通") >= 0), d.regions);
check("aggregate: 省份分布", (d.provinces || []).length > 0, d.provinces);
check("aggregate: 运营商分布", (d.isps || []).length > 0, d.isps);
check("aggregate: 实时访客地区是完整串", (d.realtime.visitors || []).every((v) => !v.region || v.region.indexOf("湖北") >= 0), d.realtime.visitors.length);
check("health: IP 库诊断且不存原始 IP", d.health.geoip && d.health.geoip.available === true && d.health.geoip.storesRawIp === false, d.health.geoip);
check("aggregate: 上一周期有数据（环比基准）", d.compare.pv.previous >= 1, d.compare.pv);

/* 6. 缓存命中，且强制重算的结果已回写 */
r = await stats(req("https://202271.xyz/api/stats?days=30"));
d = await r.json();
check("cache: 第二次命中且标注年龄", d.meta.cache.hit === true && typeof d.meta.cache.ageSeconds === "number", d.meta.cache);
check("cache: 强制重算后缓存已更新（不会退回旧数字）", d.totals.pv === 3, d.totals.pv);

/* 7. 非法请求 */
r = await collect(req("https://202271.xyz/api/collect", { e: "pv", v: "x", eid: "bad id!" }), {});
check("collect: 非法 eid 被拒", r.status === 204, r.status);
r = await collect(req("https://202271.xyz/api/collect", { e: "pv", v: v1, eid: "event-admin", p: "/admin/", ua: UA }), {});
check("collect: /admin 路径被排除", r.status === 204, r.status);
r = await stats(req("https://202271.xyz/api/stats", null, { Origin: "https://evil.example" }));
check("stats: GET 不受 Origin 限制", r.status === 200, r.status);

/* 8. Netlify 机器流量过滤：拦得准，也别误杀正常访客 */
const C = "https://202271.xyz/api/collect";
r = await collect(req(C, pv("machine-visitor-a", "event-machine-01", "/", {
  u: "https://deploy-preview-12--zuili.netlify.app/",
})), {});
check("filter: netlify.app 部署预览被排除", r.status === 204, r.status);

r = await collect(req(C, pv("machine-visitor-b", "event-machine-02", "/"), {
  Origin: "https://preview--zuili.netlify.app",
}), {});
check("filter: Origin 落在 netlify.app 被排除", r.status === 204, r.status);

r = await collect(req(C, pv("machine-visitor-c", "event-machine-03", "/", {
  r: "https://zuili.netlify.app/",
})), {});
check("filter: 来自 Netlify 域名的跳转被排除", r.status === 204, r.status);

r = await collect(req(C, pv("machine-visitor-d", "event-machine-04", "/", {
  ua: "Netlify Build Bot/1.0",
})), {});
check("filter: UA 含 Netlify 被排除", r.status === 204, r.status);

r = await collect(req(C, { v: v1, eid: e1, e: "dwell", d: 10, dt: z.date,
  ua: "Go-http-client/1.1", u: "https://202271.xyz/" }), {});
check("filter: 健康检查 UA 的 dwell 心跳也被排除", r.status === 204, r.status);

r = await collect(req(C, pv("real-visitor-z", "event-real-099", "/about/", { ua: UA })), {});
check("filter: 正常访客不被误杀", r.status === 200, r.status);
const evKeys = [...memory.keys()].filter((k) => k.startsWith("ev/"));
check("filter: 被拦截请求没有写入任何事件", evKeys.length === 4, evKeys.length);
check("health: 机器流量过滤状态可见", d.health.machineFilter &&
  d.health.machineFilter.enabled === true && d.health.machineFilter.rules === 3, d.health.machineFilter);

console.log("\nTOTALS " + JSON.stringify(d.totals));
console.log("FAILURES=" + failures);
process.exit(failures ? 1 : 0);
