/* ============================================================
   访客地区解析（统计 v6.1）

   目标：把「中国 / 湖北省 / 孝感市 / 联通」变成「湖北 孝感 联通」。
   - 数据源：随仓库入库的 ip2region IPv4 xdb（Apache-2.0 / MIT），
     字段顺序 国家|省份|城市|ISP|国家码，完全离线查询，不请求任何第三方接口。
   - 隐私：客户端 IP 只在本次函数内用于查库，**绝不写入事件、Blobs、日志或响应**；
     落库的只有解析后的省市运营商标签。
   - 兜底：xdb 缺失、IP 非 IPv4、查询失败时回退到 Netlify 边缘 geo
     （有国家/省/市，无运营商），并在 geo.source 里标明来源。
   ============================================================ */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { IP2Region } from "ip2region/node";
import { formatGeoParts, safeStr } from "./analytics.mjs";

const XDB_NAME = "ip2region_v4.xdb";
const FIELDS = ["country_name", "region_name", "city_name", "isp", "country_code"];
const IPV4 = /^(\d{1,3}\.){3}\d{1,3}$/;

let query = null;
let loadTried = false;
let loadError = "";

function xdbPath() {
  const candidates = [
    path.join(process.cwd(), "netlify", "data", XDB_NAME),
    path.join(process.cwd(), "data", XDB_NAME),
    fileURLToPath(new URL("../data/" + XDB_NAME, import.meta.url)),
    fileURLToPath(new URL("./" + XDB_NAME, import.meta.url)),
    path.join(process.cwd(), "node_modules", "ip2region", "data", XDB_NAME),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p) && fs.statSync(p).size > 1000000) return p;
    } catch (_) { /* 换下一个候选 */ }
  }
  return "";
}

/* 单例懒加载：11MB 只读一次，后续请求都是内存二分查找 */
function getQuery() {
  if (loadTried) return query;
  loadTried = true;
  const p = xdbPath();
  if (!p) { loadError = "未找到 ip2region_v4.xdb"; return null; }
  try {
    // 注意：自定义 database 与 bundled families 互斥，不能同时传 families:[4]
    query = new IP2Region({
      database: { format: "xdb", path: p, fields: FIELDS },
    });
  } catch (e) {
    loadError = String(e && e.message || e);
    query = null;
  }
  return query;
}

function fromNetlifyGeo(geo) {
  const g = geo || {};
  return formatGeoParts({
    country: (g.country && (g.country.name || g.country.code)) || "",
    province: (g.subdivision && (g.subdivision.name || g.subdivision.code)) || "",
    city: g.city || "",
    isp: "",
    source: "netlify-geo",
  });
}

/** 传入客户端 IP 与 Netlify 边缘 geo，返回可安全落库的地区标签 */
export function resolveGeo(ip, netlifyGeo) {
  const addr = safeStr(ip || "", 64).split(",")[0].trim().replace(/^::ffff:/, "");
  if (!IPV4.test(addr)) return fromNetlifyGeo(netlifyGeo); // IPv6 / 内网 / 缺失

  const q = getQuery();
  if (!q) return fromNetlifyGeo(netlifyGeo);
  try {
    const r = q.lookup(addr);
    if (!r) return fromNetlifyGeo(netlifyGeo);
    return formatGeoParts({
      country: (r.country && r.country.name) || "",
      province: (r.subdivisions && r.subdivisions[0] && r.subdivisions[0].name) || "",
      city: (r.city && r.city.name) || "",
      isp: r.isp || "",
      source: "ip2region",
    });
  } catch (_) {
    return fromNetlifyGeo(netlifyGeo);
  }
}

/** 给 /api/stats 的健康条：只检查库文件是否随函数部署，不触发 11MB 加载，
    否则聚合端点每次冷启动都要白读一次数据库。 */
export function geoDiagnostics() {
  const available = !!xdbPath();
  return {
    available,
    database: available ? XDB_NAME : "",
    source: available ? "ip2region（离线 IPv4 库）" : "netlify-geo（降级，无运营商）",
    error: available ? "" : (loadError || "未找到 ip2region_v4.xdb"),
    storesRawIp: false,
  };
}
