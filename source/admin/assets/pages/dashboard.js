/* pages/dashboard.js — 工作台：统计卡 / 快捷操作 / 最近文章 / Netlify 部署状态 */

import {
  ic, esc, el, fmtTime, fmtAgo, lightbox, imgWithFallback, previewSrcsFor,
} from "../app.js?v=4.1.5";
import { loadYaml } from "../yaml.js?v=4.1.5";
import { deployState } from "../netlify.js?v=4.1.5";
import { loadAllPosts, postLink } from "./posts.js?v=4.1.5";

export default async function dashboard(view, ctx, params, handleErr) {
  const settings = ctx.settings;

  view.innerHTML = "";
  const hero = el(`<div class="hero-strip">
      <h1>欢迎回来${ctx.session && ctx.session.user ? "，" + esc(ctx.session.user.name || "") : ""} 👋</h1>
      <p id="dash-sub">正在拉取仓库数据…</p>
      <div class="hero-actions">
        <a class="btn solid" href="#/edit?new=1">${ic("plus")}新建文章</a>
        <a class="btn" href="#/talks">${ic("talk")}发说说</a>
        <a class="btn" href="#/images">${ic("upload")}传图片</a>
        <a class="btn" href="#/settings">${ic("settings")}设置</a>
      </div>
    </div>`);
  view.appendChild(hero);

  const statGrid = el(`<div class="stat-grid" id="stat-grid"></div>`);
  view.appendChild(statGrid);

  const grid = el(`<div class="grid-2"></div>`);
  view.appendChild(grid);

  // 左：最近文章 + 快捷入口
  const left = el(`<div></div>`);
  const recentCard = el(`<div class="card">
      <div class="card-header">${ic("clock")}<h2>最近文章</h2><div class="spacer"></div>
        <a class="small" href="#/posts">全部文章 →</a></div>
      <div class="table-wrap"><table class="tbl"><tbody><tr><td><span class="inline-loading"><span class="ring"></span>加载中…</span></td></tr></tbody></table></div>
    </div>`);
  left.appendChild(recentCard);

  const deployCard = el(`<div class="card" id="deploy-card">
      <div class="card-header">${ic("deploy")}<h2>Netlify 部署</h2><div class="spacer"></div>
        <button class="icon-btn" id="deploy-refresh" title="刷新">${ic("refresh")}</button></div>
      <div id="deploy-body"></div>
    </div>`);
  left.appendChild(deployCard);
  grid.appendChild(left);

  // 右：站点信息
  const right = el(`<div></div>`);
  const siteCard = el(`<div class="card">
      <div class="card-header">${ic("globe")}<h2>站点信息</h2></div>
      <div id="site-info" class="small muted">加载中…</div>
    </div>`);
  right.appendChild(siteCard);
  const quickCard = el(`<div class="card">
      <div class="card-header">${ic("star")}<h2>快捷入口</h2></div>
      <div class="table-wrap"><table class="tbl"><tbody>
        <tr><td><div class="flex">${ic("plus")}<div class="grow"><b class="small" style="color:var(--text-dark)">新建文章</b><br><span class="small muted">写一篇新的博客文章</span></div><a class="icon-btn" href="#/edit?new=1">${ic("chevron-r")}</a></div></td></tr>
        <tr><td><div class="flex">${ic("talk")}<div class="grow"><b class="small" style="color:var(--text-dark)">发一条说说</b><br><span class="small muted">记录此刻的想法</span></div><a class="icon-btn" href="#/talks">${ic("chevron-r")}</a></div></td></tr>
        <tr><td><div class="flex">${ic("friend")}<div class="grow"><b class="small" style="color:var(--text-dark)">添加友链</b><br><span class="small muted">交换一个新的朋友站点</span></div><a class="icon-btn" href="#/friends">${ic("chevron-r")}</a></div></td></tr>
        <tr><td><div class="flex">${ic("upload")}<div class="grow"><b class="small" style="color:var(--text-dark)">上传图片</b><br><span class="small muted">图片会存到仓库 uploads 目录</span></div><a class="icon-btn" href="#/images">${ic("chevron-r")}</a></div></td></tr>
      </tbody></table></div>
    </div>`);
  right.appendChild(quickCard);
  grid.appendChild(right);

  /* ---------- 数据加载 ---------- */

  async function loadStats() {
    const api = ctx.api;
    let postsFailed = false;
    const [posts, talksYaml, fluidYaml, metaYaml, images] = await Promise.all([
      loadAllPosts(ctx).catch(() => { postsFailed = true; return []; }),
      api.readFile("source/_data/talks.yml").catch(() => "items: []"),
      api.readFile("source/_data/fluid_config.yml").catch(() => "links: {}"),
      api.readFile("source/_data/site_meta.yml").catch(() => ""),
      api.listDir("source/images/uploads").catch(() => []),
    ]);
    if (postsFailed) {
      statGrid.appendChild(el(`<div class="card" style="grid-column:1/-1;margin:0;display:flex;align-items:center;gap:.6rem;color:var(--warning)">
        ${ic("alert")}<span>部分数据拉取失败（网络或限流），统计可能不准；<a href="#/">点击重试</a></span></div>`));
    }
    let talks = [], links = [], meta = {};
    try { talks = (loadYaml(talksYaml).items || []); } catch (_) {}
    try { links = ((loadYaml(fluidYaml).links || {}).items || []); } catch (_) {}
    try { meta = loadYaml(metaYaml) || {}; } catch (_) {}

    const stats = [
      { icon: "post", cls: "primary", num: posts.length, lbl: "文章" },
      { icon: "talk", cls: "info", num: talks.length, lbl: "说说" },
      { icon: "friend", cls: "success", num: links.length, lbl: "友链" },
      { icon: "image", cls: "warning", num: images.length, lbl: "图库图片" },
    ];
    statGrid.innerHTML = stats.map((s) => `
      <div class="stat-card">
        <div class="icon-shape ${s.cls}">${ic(s.icon)}</div>
        <div class="meta"><div class="num">${s.num}</div><div class="lbl">${s.lbl}</div></div>
      </div>`).join("");

    const heroSub = ctx.demo
      ? "演示模式 · 以下是模拟数据"
      : `${esc(meta.author || "")} · ${esc(settings.owner)}/${esc(settings.repo)} · 分支 ${esc(settings.branch)}`;
    hero.querySelector("#dash-sub").innerHTML = heroSub;

    siteCard.querySelector("#site-info").innerHTML = `
      <table class="tbl"><tbody>
        <tr><td class="cell-muted">站点标题</td><td style="font-weight:600;color:var(--text-dark)">${esc(meta.title || "-")}</td></tr>
        <tr><td class="cell-muted">副标题</td><td>${esc(meta.subtitle || "-")}</td></tr>
        <tr><td class="cell-muted">作者</td><td>${esc(meta.author || "-")}</td></tr>
        <tr><td class="cell-muted">仓库</td><td>${ctx.demo ? "演示模式" : `<a href="https://github.com/${esc(settings.owner)}/${esc(settings.repo)}" target="_blank" rel="noopener">${esc(settings.owner)}/${esc(settings.repo)}</a>`}</td></tr>
        <tr><td class="cell-muted">线上地址</td><td><a href="${esc(settings.siteUrl)}" target="_blank" rel="noopener">${esc(settings.siteUrl)} ${ic("external")}</a></td></tr>
      </tbody></table>`;

    // 最近文章（复用文章列表的 front-matter 缓存，已按日期排序）
    const rows = posts.slice(0, 8).map((p) => ({
      title: p.title,
      date: p.date || p.updated || "",
      path: p.path,
      name: p.name,
      sticky: p.sticky,
      tags: p.tags || [],
      link: postLink(p, settings.siteUrl),
      hasLink: Boolean(p.permalink || p.abbrlink),
    }));
    const tb = recentCard.querySelector("tbody");
    if (!rows.length) {
      tb.innerHTML = `<tr><td><div class="empty">${ic("post")}<p>还没有文章</p></div></td></tr>`;
    } else {
      tb.innerHTML = rows.map((r) => `
        <tr>
          <td style="width:34px">${ic("post")}</td>
          <td class="cell-title">${esc(r.title)}<small>${esc(r.name)}${r.sticky ? " · 置顶" + esc(r.sticky) : ""}</small></td>
          <td class="cell-muted">${esc(fmtTime(r.date))}</td>
          <td>${(r.tags || []).slice(0, 2).map((t) => `<span class="badge badge-primary">${esc(t)}</span>`).join(" ")}</td>
          <td class="cell-actions">
            ${r.hasLink ? `<a class="icon-btn" href="${esc(r.link)}" target="_blank" rel="noopener" title="在博客查看">${ic("eye")}</a>` : ""}
            <a class="icon-btn" href="#/edit?file=${encodeURIComponent(r.path)}" title="编辑">${ic("edit")}</a>
          </td>
        </tr>`).join("");
    }

    // 最近图片
    const recentImgs = images.filter((i) => /\.(png|jpe?g|gif|webp|svg|avif)$/i.test(i.name)).slice(-6).reverse();
    if (recentImgs.length) {
      const imgCard = el(`<div class="card">
          <div class="card-header">${ic("image")}<h2>最新图片</h2><div class="spacer"></div>
            <a class="small" href="#/images">图库 →</a></div>
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:.7rem" id="dash-imgs"></div>
        </div>`);
      const holder = imgCard.querySelector("#dash-imgs");
      for (const img of recentImgs) {
        const cell = el(`<div style="height:86px;border-radius:.6rem;background:#f2f4f9;overflow:hidden;cursor:zoom-in"></div>`);
        const im = imgWithFallback(previewSrcsFor(ctx, img.path), { alt: img.name });
        im.style.cssText = "width:100%;height:100%;object-fit:cover;display:block";
        cell.appendChild(im);
        cell.addEventListener("click", () => lightbox(im.currentSrc || im.src));
        holder.appendChild(cell);
      }
      right.insertBefore(imgCard, quickCard);
    }
  }

  /* ---------- Netlify 部署 ---------- */

  let pollTimer = null;
  ctx._onLeave = () => { if (pollTimer) clearTimeout(pollTimer); };

  async function loadDeploys() {
    if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
    if (!document.body.contains(deployCard)) return;
    const body = deployCard.querySelector("#deploy-body");
    if (ctx.demo) {
      renderDeploys(ctx.api.deployFixtures());
      return;
    }
    if (!ctx.nl.canReadDeploys) {
      body.innerHTML = `<div class="empty">${ic("info")}
        <p>未配置 Netlify Token / Site ID，无法查看部署状态。<br>
        保存文章会自动触发部署；如需查看状态请到 <a href="#/settings">设置</a> 页配置。</p></div>`;
      return;
    }
    body.innerHTML = `<div class="inline-loading"><span class="ring"></span>获取部署记录…</div>`;
    try {
      const list = await ctx.nl.deploys(6);
      renderDeploys(list);
    } catch (e) {
      body.innerHTML = `<div class="empty">${ic("alert")}<p>${esc(e.message)}</p></div>`;
    }
  }

  function renderDeploys(list) {
    const body = deployCard.querySelector("#deploy-body");
    if (!list || !list.length) {
      body.innerHTML = `<div class="empty">${ic("info")}<p>暂无部署记录</p></div>`;
      return;
    }
    body.innerHTML = list.map((d) => {
      const st = deployState(d.state);
      return `<div class="deploy-item">
          <span class="badge ${st.cls}">${st.label}</span>
          <div class="title"><b>${esc(d.commitMsg || d.title || "部署")}</b>
          <span>${esc(d.context || "")} · ${esc(fmtAgo(d.createdAt))}</span></div>
          ${d.url && d.url !== "#" ? `<a class="icon-btn" href="${esc(d.url)}" target="_blank" rel="noopener" title="在 Netlify 打开">${ic("external")}</a>` : ""}
        </div>`;
    }).join("");
    const first = list[0];
    if (first && (first.state === "building" || first.state === "enqueued" || first.state === "processing")) {
      pollTimer = setTimeout(loadDeploys, 15000);
    }
  }

  deployCard.querySelector("#deploy-refresh").addEventListener("click", loadDeploys);

  try {
    await loadStats();
  } catch (e) {
    handleErr(e);
  }
  loadDeploys();
}
