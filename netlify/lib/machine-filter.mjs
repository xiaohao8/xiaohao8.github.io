/* ============================================================
   Netlify 机器 / 部署预览流量过滤（统计 v6.2）

   背景：`isBot()` 只按 UA 过滤，且只在 PV 分支调用。两个缺口：
     1. Netlify 部署预览站点（*.netlify.app）用正常浏览器 UA 访问时，
        会被当成真实访客写进统计，产生 `United States · Ohio` 之类的噪声；
     2. dwell / leave 心跳完全没过过滤。
   这里按「来源域名 + UA 特征」统一拦截所有事件类型，静默返回 204，
   不写 Blobs、不计数、不影响正常访客。

   设计原则：宁可少拦也不误杀。只按 Netlify 域名与明确的机器 UA 判断，
   不按 IP 段 / 云厂商 ISP 猜（真实访客可能用代理或云 VPN）。
   ============================================================ */

import { safeStr } from "./analytics.mjs";

/* 匹配 netlify.app / xxx.netlify.app / netlify.com / app.netlify.com，
   但不会误伤 notnetlify.app 之类域名 */
const NETLIFY_HOST = /(^|\.)netlify\.(app|com)$/i;

/* 与 analytics.mjs 的 BOT_RE 有意重叠：这里对所有事件类型生效，
   并补上 BOT_RE 没有覆盖的 netlify / deploy-preview / 健康检查类 UA */
const MACHINE_UA = /netlify|deploy[-_ ]?preview|headlesschrome|headless|lighthouse|pagespeed|gtmetrix|uptimerobot|pingdom|statuscake|site24x7|betteruptime|freshping|healthcheck|go-http-client|curl\/|wget\/|python-requests|python-urllib|httpx|node-fetch|postmanruntime|insomnia|okhttp\/|axios\/|playwright|puppeteer|selenium|phantomjs|slurp|spider|crawl|\bbot\b/i;

/** 给健康条与文档用的规则清单（纯展示，不含正则） */
export const MACHINE_FILTER_RULES = [
  "*.netlify.app / netlify.com 来源：部署预览、分支预览、Netlify 后台跳转",
  "UA 含 Netlify / deploy-preview：构建、部署、预览服务与内部抓取",
  "健康检查、监控、无头浏览器与脚本客户端（curl / Go-http-client / UptimeRobot 等）",
];

function hostname(raw) {
  if (!raw) return "";
  try { return new URL(String(raw)).hostname.toLowerCase(); }
  catch (_) { return ""; }
}

/**
 * @returns {{blocked: boolean, rule: string, detail: string}}
 */
export function netlifyMachine({ ua = "", url = "", referrer = "", origin = "" } = {}) {
  // 1) 页面 URL / 来源 / Origin 任一落在 Netlify 域名 → 视为预览或后台流量
  for (const [field, raw] of [["url", url], ["referrer", referrer], ["origin", origin]]) {
    const host = hostname(raw);
    if (host && NETLIFY_HOST.test(host)) {
      return { blocked: true, rule: "netlify-host", detail: field + ":" + host };
    }
  }

  // 2) referrer 不是合法绝对 URL（相对路径等）时再用字符串兜底
  const ref = safeStr(referrer, 500);
  if (ref && /netlify\.(app|com)/i.test(ref)) {
    return { blocked: true, rule: "netlify-referrer", detail: "" };
  }

  // 3) 明确的机器 UA；空 UA 不在这里拦（心跳可能省略），交给 isBot 处理 PV
  const u = safeStr(ua, 400);
  if (u && MACHINE_UA.test(u)) {
    return { blocked: true, rule: "machine-ua", detail: "" };
  }

  return { blocked: false, rule: "", detail: "" };
}
