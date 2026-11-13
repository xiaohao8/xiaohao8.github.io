/* pages/stats.js — 访问统计 v6（只读概览 + 数据可信度排障）
   与前台 /stats/ 读同一个 GET /api/stats，但额外提供「强制重算」绕过聚合缓存。
   采集开关 / 排除路径 / 统计天数在「设置 → 访问统计」写入仓库。 */

import { ic, esc, el, toast } from "../app.js?v=4.3.0";

const DAYS = 30;
const API = "/api/stats?days=" + DAYS;

function n(v) { return String(v || 0).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
function pad(v) { return v < 10 ? "0" + v : String(v); }
function dur(sec) {
  const s = Math.max(0, Math.round(sec || 0));
  return Math.floor(s / 60) + ":" + pad(s % 60);
}
function shortTime(s) { return s ? String(s).slice(0, 16).replace("T", " ") : "—"; }
function delta(c) {
  if (!c || c.changePct == null) return '<span class="muted small">环比 —</span>';
  const v = c.changePct;
  const color = v > 0 ? "#16a34a" : (v < 0 ? "#d97706" : "inherit");
  const text = v > 0 ? `环比 ↑ +${v}%` : (v < 0 ? `环比 ↓ ${v}%` : "环比 持平");
  return `<span class="small" style="color:${color}">${esc(text)}</span>`;
}
function metricCard(value, label, tip, sub) {
  return `<div class="card" style="margin:0;text-align:center;padding:.9rem .5rem" title="${esc(tip || "")}">
      <b style="display:block;font-size:1.4rem;color:var(--primary,#5e72e4)">${value}</b>
      <span class="muted small">${esc(label)}</span>
      <div style="margin-top:.25rem">${sub || ""}</div>
    </div>`;
}
function listCard(title, rows, key, link, note) {
  const list = Array.isArray(rows) ? rows : [];
  const body = list.length
    ? list.slice(0, 10).map((x) => {
        const name = String((x && x[key]) || "-");
        const left = link && name.charAt(0) === "/"
          ? `<a href="${esc(name)}" target="_blank" rel="noopener" title="${esc(name)}" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(name)}</a>`
          : `<span title="${esc(name)}" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(name)}</span>`;
        return `<div style="display:flex;justify-content:space-between;align-items:center;gap:.8rem;padding:.4rem 0;border-bottom:1px dashed var(--line,rgba(0,0,0,.08))">
            ${left}<b style="flex-shrink:0;color:var(--primary,#5e72e4)">${n(x && x.count)}</b></div>`;
      }).join("")
    : `<p class="muted small">暂无数据</p>`;
  return `<div class="card" style="margin:0">
      <div class="card-header">${ic("eye")}<h2>${esc(title)}</h2>${note ? `<div class="sub">${esc(note)}</div>` : ""}</div>
      ${body}</div>`;
}
function miniBars(daily) {
  const rows = Array.isArray(daily) ? daily : [];
  const max = Math.max(1, ...rows.map((r) => r.pv || 0));
  const bars = rows.map((r) => {
    const h = r.pv ? Math.max(5, Math.round((r.pv / max) * 100)) : 3;
    const bg = r.pv ? "var(--primary,#5e72e4)" : "rgba(141,123,224,.22)";
    return `<div style="flex:1 1 0;min-width:0;height:100%;display:flex;align-items:flex-end"
        title="${esc(r.date)}：${r.pv} PV / ${r.uv} UV / ${r.sessions} 会话">
        <span style="display:block;width:100%;border-radius:3px 3px 0 0;background:${bg};height:${h}%;opacity:.88"></span>
      </div>`;
  }).join("");
  return `<div style="display:flex;align-items:flex-end;gap:2px;height:110px;padding:0 0 1.4rem;border-bottom:1px solid var(--line,rgba(0,0,0,.08))">${bars}</div>`;
}
function hourlyBars(hourly) {
  const map = {};
  (hourly || []).forEach((h) => { if (h) map[h.hour] = h; });
  const rows = [];
  for (let i = 0; i < 24; i++) rows.push({ hour: i, pv: (map[i] || {}).pv || 0, uv: (map[i] || {}).uv || 0 });
  const max = Math.max(1, ...rows.map((r) => r.pv));
  return `<div style="display:flex;align-items:flex-end;gap:2px;height:80px;padding:0 0 1.3rem;border-bottom:1px solid var(--line,rgba(0,0,0,.08))">` +
    rows.map((r) => {
      const h = r.pv ? Math.max(5, Math.round((r.pv / max) * 100)) : 3;
      return `<div style="flex:1 1 0;min-width:0;height:100%;display:flex;align-items:flex-end" title="${pad(r.hour)}:00 ${r.pv} PV / ${r.uv} UV">
        <span style="display:block;width:100%;border-radius:3px 3px 0 0;background:${r.pv ? "var(--primary,#5e72e4)" : "rgba(141,123,224,.22)"};height:${h}%"></span></div>`;
    }).join("") + "</div>";
}
function categoryHtml(list) {
  if (!list || !list.length) return '<p class="muted small">暂无数据</p>';
  const total = list.reduce((a, x) => a + x.count, 0);
  return list.map((x) => {
    const p = total ? Math.round((x.count / total) * 100) : 0;
    return `<div style="display:grid;grid-template-columns:minmax(70px,110px) 1fr auto;align-items:center;gap:.7rem;padding:.35rem 0;font-size:.9em">
      <span>${esc(x.name)}</span>
      <div style="height:8px;border-radius:6px;background:rgba(141,123,224,.14);overflow:hidden"><i style="display:block;height:100%;width:${p}%;background:var(--primary,#5e72e4);border-radius:6px"></i></div>
      <b style="color:var(--primary,#5e72e4)">${n(x.count)} <small class="muted">${p}%</small></b></div>`;
  }).join("");
}
function tableHtml(rows, cols) {
  if (!rows || !rows.length) return '<p class="muted small">暂无数据</p>';
  const head = cols.map((c) => `<th style="text-align:left;padding:.4rem .6rem;color:var(--muted,#888);font-weight:500">${esc(c[0])}</th>`).join("");
  const body = rows.map((r) => "<tr>" + cols.map((c) =>
    `<td style="padding:.4rem .6rem;border-top:1px dashed var(--line,rgba(0,0,0,.08));white-space:nowrap">${c[1](r)}</td>`
  ).join("") + "</tr>").join("");
  return `<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:.86em;min-width:520px">
    <thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}
function healthHtml(d) {
  const m = d.meta || {}, h = d.health || {};
  const status = h.status || "no_data";
  const color = status === "ok" ? "#16a34a" : (status === "degraded" ? "#d97706" : "#888");
  const label = status === "ok" ? "采集正常" : (status === "degraded" ? "数据可能不完整" : "尚无采集数据");
  const items = [
    ["数据截至", m.lastEventDisplay || "无数据"],
    ["本次计算", shortTime(m.computedAt)],
    ["缓存", m.cache && m.cache.hit ? `命中 · ${m.cache.ageSeconds} 秒前` : "实时聚合"],
    ["时区", (m.timezone || "Asia/Shanghai") + " (UTC+8)"],
    ["数据覆盖", `${h.daysWithData || 0} / ${h.daysRequested || 0} 天`],
    ["扫描事件", n(h.eventsScanned)],
    ["停留覆盖", `${h.dwellCoverage || 0}%`],
    ["引擎", "v" + esc(m.schema || "6.0")],
  ];
  const warns = (h.warnings || []).length
    ? `<div style="margin-top:.7rem;padding-top:.6rem;border-top:1px dashed var(--line,rgba(0,0,0,.08));color:#b7791f;font-size:.84em;line-height:1.7">` +
      h.warnings.map((w) => `<div>· ${esc(w)}</div>`).join("") + "</div>"
    : "";
  return `<div style="border:1px solid ${color}55;background:${color}0d;border-radius:12px;padding:.8rem 1rem;margin-bottom:1rem">
      <div style="display:flex;align-items:center;gap:.5rem;flex-wrap:wrap;margin-bottom:.7rem">
        <span style="width:9px;height:9px;border-radius:50%;background:${color}"></span>
        <b>${esc(label)}</b>
        <span class="muted small" style="margin-left:auto">数据截至是最后一条采集事件的北京时间，不是页面打开时间</span>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:.5rem 1rem;font-size:.86em">
        ${items.map((it) => `<div style="min-width:0"><div class="muted small">${esc(it[0])}</div><b style="word-break:break-all">${esc(it[1])}</b></div>`).join("")}
      </div>${warns}</div>`;
}
function definitionsHtml(defs) {
  if (!defs) return "";
  const keys = Object.keys(defs);
  if (!keys.length) return "";
  return `<details style="margin:1rem 0;border:1px solid var(--line,rgba(0,0,0,.1));border-radius:10px;padding:.7rem 1rem">
    <summary style="cursor:pointer;font-weight:600">指标口径与数据可信度说明（${keys.length} 项）</summary>
    <dl style="display:grid;grid-template-columns:minmax(100px,150px) 1fr;gap:.35rem .9rem;font-size:.86em;margin:.8rem 0 0">
      ${keys.map((k) => `<dt style="color:var(--primary,#5e72e4);font-weight:600">${esc(k)}</dt><dd style="margin:0;line-height:1.6" class="muted">${esc(defs[k])}</dd>`).join("")}
    </dl></details>`;
}

export default async function stats(view, ctx, params, handleErr) {
  view.innerHTML = "";

  const card = el(`<div class="card settings-section">
      <div class="card-header">${ic("eye")}<h2>访问统计</h2>
        <div class="sub">自托管统计 v6 · 近 ${DAYS} 天 · 北京时间 (UTC+8)</div></div>
      <div class="hint" style="margin-bottom:.9rem">
        采集由 <code>/api/collect</code> 上报，<code>/api/stats</code> 实时聚合（Netlify Blobs）。
        每条浏览事件独立写入并原子去重，不会因并发覆盖而丢数据；会话按访客 + 30 分钟空闲在服务端重建。
        采集开关、排除路径与统计天数在 <a href="#/settings">设置 → 访问统计</a> 配置，
        写入仓库后需等 Netlify 部署完成才生效。后台与统计页本身默认不计入访问量。
      </div>
      <div class="settings-actions" style="margin-bottom:1rem">
        <button class="btn" id="st-refresh">${ic("refresh")}刷新数据</button>
        <button class="btn" id="st-force">${ic("deploy")}强制重算</button>
        <a class="btn" href="/stats/" target="_blank" rel="noopener">${ic("external")}打开前台统计页 ↗</a>
        <a class="btn" href="#/settings">${ic("settings")}统计设置</a>
      </div>
      <div id="st-body"><div class="inline-loading"><span class="ring"></span>正在读取统计…</div></div>
    </div>`);
  view.appendChild(card);

  const body = card.querySelector("#st-body");

  function render(d) {
    const t = d.totals || {}, c = d.compare || {}, m = d.meta || {}, defs = m.definitions || {};
    const refs = d.referrers || {}, utm = d.utm || {}, rt = d.realtime || {};

    const cards = [
      metricCard(n(t.pv), "浏览量 PV", defs.pv, delta(c.pv)),
      metricCard(n(t.uv), "独立访客 UV", defs.uv, delta(c.uv)),
      metricCard(n(t.avgDailyUv), "日均独立访客", defs.avgDailyUv),
      metricCard(n(t.sessions), "会话 / 访问", defs.sessions, delta(c.sessions)),
      metricCard((t.bounceRate || 0) + "%", "跳出率", defs.bounceRate),
      metricCard(dur(t.avgDuration), "平均停留", defs.avgDuration),
      metricCard(String(t.pagesPerSession || 0), "访问深度", defs.pagesPerSession),
      metricCard(n(t.online), "当前在线", defs.online),
      metricCard(n(t.newVisitors), "新访客", defs.newVisitors),
      metricCard(n(t.returningVisitors), "老访客", defs.returningVisitors),
    ].join("");

    const pageRows = (d.pages || []).slice(0, 12);
    const realtimeCols = [
      ["访客", (r) => `<code>${esc(r.id)}</code>`],
      ["页面", (r) => esc(r.path)],
      ["来源", (r) => esc(r.source)],
      ["设备", (r) => esc(String(r.device || "") + " / " + String(r.browser || ""))],
      ["地区", (r) => esc(r.region || "—")],
      ["停留", (r) => (r.dwell ? dur(r.dwell) : "—")],
      ["最后活跃", (r) => esc(shortTime(r.at))],
    ];

    body.innerHTML =
      healthHtml(d) +
      `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:.7rem">${cards}</div>` +
      `<h3 style="margin:1.3rem 0 .6rem">近 ${DAYS} 天趋势（北京时间）</h3>${miniBars(d.daily)}` +
      `<h3 style="margin:1.3rem 0 .6rem">24 小时分布（北京时间）</h3>${hourlyBars(d.hourly)}` +
      `<div class="card" style="margin:1rem 0"><div class="card-header">${ic("globe")}<h2>流量来源分类</h2><div class="sub">按渠道占比</div></div>${categoryHtml(refs.categories)}</div>` +
      `<div class="grid-2" style="gap:1rem">
        ${listCard("来源明细", refs.details, "name")}
        ${listCard("外部链接域名", refs.domains, "name")}
        ${listCard("搜索关键词", refs.keywords, "name")}
        ${listCard("入口页面", d.entryPages, "path", true)}
        ${listCard("退出页面", d.exitPages, "path", true)}
        ${listCard("浏览器", d.browsers, "name")}
        ${listCard("操作系统", d.os, "name")}
        ${listCard("设备类型", d.devices, "name")}
        ${listCard("屏幕分辨率", d.screens, "name")}
        ${listCard("访客地区", d.regions, "name", false, "边缘节点推断，不记录 IP")}
        ${listCard("UTM 来源", utm.sources, "name")}
        ${listCard("UTM 活动", utm.campaigns, "name")}
      </div>` +
      `<div class="card" style="margin:1rem 0"><div class="card-header">${ic("post")}<h2>热门页面</h2><div class="sub">含入口 / 出口 / 平均停留</div></div>
        ${tableHtml(pageRows, [
          ["页面", (r) => `<a href="${esc(r.path)}" target="_blank" rel="noopener">${esc(r.path)}</a>`],
          ["PV", (r) => n(r.count)],
          ["UV", (r) => n(r.uv)],
          ["入口", (r) => n(r.entry)],
          ["出口", (r) => n(r.exit)],
          ["平均停留", (r) => (r.avgDwell ? dur(r.avgDwell) : "—")],
        ])}</div>` +
      `<div class="card" style="margin:1rem 0"><div class="card-header">${ic("user")}<h2>实时访客</h2><div class="sub">最近 ${rt.windowMinutes || 5} 分钟 · 匿名</div></div>
        ${tableHtml(rt.visitors, realtimeCols)}</div>` +
      definitionsHtml(defs) +
      `<p class="muted small" style="margin-top:1rem;line-height:1.7">
        数据截至 ${esc(m.lastEventDisplay || "无")} · 本次计算 ${esc(shortTime(m.computedAt))}` +
      `${m.cache && m.cache.hit ? " · 命中 " + m.cache.ageSeconds + " 秒前的聚合缓存（点「强制重算」可绕过）" : " · 实时聚合"}<br>
        无 Cookie 追踪、不记录 IP、不存原始 UA；事件按北京时间切分，旧 UTC 数据已在聚合时重算。
      </p>`;
  }

  async function load(force, quiet) {
    if (!quiet) body.innerHTML = `<div class="inline-loading"><span class="ring"></span>正在读取统计…</div>`;
    try {
      const res = await fetch(API + (force ? "&fresh=1" : ""), { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      render(await res.json());
      if (quiet) toast(force ? "已绕过缓存重新聚合" : "统计已刷新", "success", 2400);
    } catch (e) {
      body.innerHTML = `<div class="empty">${ic("alert")}
          <p>统计接口暂不可用：${esc(e.message || "读取失败")}</p>
          <p class="muted small">本地预览、Netlify Functions 正在部署，或站点尚未产生采集事件时会出现此提示；
          部署完成并产生首次访问后会自动填充。</p></div>`;
      if (quiet) toast("读取统计失败：" + (e.message || ""), "error", 4200);
    }
  }

  card.querySelector("#st-refresh").addEventListener("click", () => load(false, true));
  card.querySelector("#st-force").addEventListener("click", () => load(true, true));
  load(false, false);
}
