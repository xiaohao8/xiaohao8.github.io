/* pages/stats.js — 访问统计：自托管实时数据概览（Netlify Blobs）
   数据源与前台 /stats/ 完全一致：GET /api/stats?days=30
   本页只读；采集开关 / 排除路径 / 统计天数在「设置 → 访问统计」写入仓库。 */

import { ic, esc, el, toast } from "../app.js?v=4.2.0";

const DAYS = 30;

function n(v) {
  return String(v || 0).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
function pad(v) { return v < 10 ? "0" + v : String(v); }
function dur(sec) {
  const s = Math.max(0, Math.round(sec || 0));
  return Math.floor(s / 60) + ":" + pad(s % 60);
}

function metricCard(value, label) {
  return `<div class="card" style="margin:0;text-align:center;padding:1rem .6rem">
      <b style="display:block;font-size:1.5rem;color:var(--primary,#5e72e4)">${value}</b>
      <span class="muted small">${esc(label)}</span>
    </div>`;
}

function listCard(title, rows, key, link) {
  const list = Array.isArray(rows) ? rows : [];
  const body = list.length
    ? list.slice(0, 10).map((x) => {
        const name = String((x && x[key]) || "-");
        const left = link && name.charAt(0) === "/"
          ? `<a href="${esc(name)}" target="_blank" rel="noopener" title="${esc(name)}" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(name)}</a>`
          : `<span title="${esc(name)}" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(name)}</span>`;
        return `<div style="display:flex;justify-content:space-between;align-items:center;gap:.8rem;padding:.42rem 0;border-bottom:1px dashed var(--line,rgba(0,0,0,.08))">
            ${left}<b style="flex-shrink:0;color:var(--primary,#5e72e4)">${n(x && x.count)}</b></div>`;
      }).join("")
    : `<p class="muted small">暂无数据</p>`;
  return `<div class="card" style="margin:0">
      <div class="card-header">${ic("eye")}<h2>${esc(title)}</h2></div>${body}</div>`;
}

/* 接口只返回有数据的日期，补齐到完整 30 天，避免只剩两三根柱子 */
function miniBars(daily) {
  const map = {};
  (daily || []).forEach((d) => { if (d && d.date) map[d.date] = d; });
  const now = new Date();
  const endUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const rows = [];
  for (let i = DAYS - 1; i >= 0; i--) {
    const date = new Date(endUtc - i * 86400000).toISOString().slice(0, 10);
    const hit = map[date] || {};
    rows.push({ date, pv: hit.pv || 0, uv: hit.uv || 0 });
  }
  const max = Math.max(1, ...rows.map((r) => r.pv));
  const bars = rows.map((r) => {
    const h = r.pv ? Math.max(5, Math.round((r.pv / max) * 100)) : 3;
    const bg = r.pv ? "var(--primary,#5e72e4)" : "rgba(141,123,224,.22)";
    return `<div style="flex:1 1 0;min-width:0;height:100%;display:flex;align-items:flex-end"
        title="${esc(r.date)}：${r.pv} PV / ${r.uv} UV">
        <span style="display:block;width:100%;border-radius:3px 3px 0 0;background:${bg};height:${h}%;opacity:.88"></span>
      </div>`;
  }).join("");
  return `<div style="display:flex;align-items:flex-end;gap:2px;height:110px;padding:0 0 1.4rem;border-bottom:1px solid var(--line,rgba(0,0,0,.08))">${bars}</div>`;
}

export default async function stats(view, ctx, params, handleErr) {
  view.innerHTML = "";

  const card = el(`<div class="card settings-section">
      <div class="card-header">${ic("eye")}<h2>访问统计</h2>
        <div class="sub">自托管实时统计 · 近 ${DAYS} 天（Netlify Blobs）</div></div>
      <div class="hint" style="margin-bottom:.9rem">
        采集由 <code>/api/collect</code> 上报，<code>/api/stats</code> 实时聚合，不依赖任何第三方统计服务，
        也不写 Cookie、不记录 IP、不存原始 UA。采集开关、排除路径与统计天数在
        <a href="#/settings">设置 → 访问统计</a> 配置；配置写入仓库后需等 Netlify 部署完成才生效。
        后台与前台统计页本身默认不计入访问量。
      </div>
      <div class="settings-actions" style="margin-bottom:1rem">
        <button class="btn" id="st-refresh">${ic("refresh")}刷新数据</button>
        <a class="btn" href="/stats/" target="_blank" rel="noopener">${ic("external")}打开前台统计页 ↗</a>
        <a class="btn" href="#/settings">${ic("settings")}统计设置</a>
      </div>
      <div id="st-body"><div class="inline-loading"><span class="ring"></span>正在读取统计…</div></div>
    </div>`);
  view.appendChild(card);

  const body = card.querySelector("#st-body");

  function render(d) {
    const t = d.totals || {};
    const rt = d.realtime || {};
    const online = rt.online != null ? rt.online : (t.online || 0);
    body.innerHTML =
      `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:.8rem;margin-bottom:1.2rem">
        ${metricCard(n(t.pv), "总浏览量")}
        ${metricCard(n(t.uv), "独立访客")}
        ${metricCard(dur(t.avgDuration), "平均停留")}
        ${metricCard((t.bounceRate || 0) + "%", "跳出率")}
        ${metricCard(n(t.sessions), "会话数")}
        ${metricCard(n(online), "当前在线")}
      </div>
      <h3 style="margin:1.2rem 0 .6rem">近 ${DAYS} 天浏览量</h3>
      ${miniBars(d.daily)}
      <div class="grid-2" style="gap:1rem;margin-top:1.2rem">
        ${listCard("热门页面", d.pages, "path", true)}
        ${listCard("访问来源", d.referrers, "source")}
        ${listCard("浏览器", d.browsers, "name")}
        ${listCard("操作系统", d.os, "name")}
        ${listCard("设备类型", d.devices, "name")}
        ${listCard("实时动态", [
          { name: "当前在线访客", count: online },
          { name: "近 30 分钟浏览量", count: rt.last30m || 0 },
          { name: "统计区间（天）", count: DAYS },
        ], "name")}
      </div>
      <p class="muted small" style="margin-top:1rem">
        统计更新于 ${esc((d.updated || "").slice(0, 16).replace("T", " "))} UTC ·
        引擎版本 ${esc(d.version || "-")} ·
        尚无访问记录时所有面板为空属正常现象。
      </p>`;
  }

  async function load(quiet) {
    if (!quiet) body.innerHTML = `<div class="inline-loading"><span class="ring"></span>正在读取统计…</div>`;
    try {
      const res = await fetch("/api/stats?days=" + DAYS, { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      render(await res.json());
      if (quiet) toast("统计已刷新", "success", 2000);
    } catch (e) {
      body.innerHTML = `<div class="empty">${ic("alert")}
          <p>统计接口暂不可用：${esc(e.message || "读取失败")}</p>
          <p class="muted small">本地预览、Netlify Functions 正在部署，或站点还没有已归档的访问事件时会出现此提示；
          部署完成并产生首次访问后会自动填充。</p></div>`;
      if (quiet) toast("读取统计失败：" + (e.message || ""), "error", 4200);
    }
  }

  card.querySelector("#st-refresh").addEventListener("click", () => load(true));
  load(false);
}
