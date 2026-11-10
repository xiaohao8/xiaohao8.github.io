/* pages/posts.js — 文章管理：列表 / 搜索 / 新建 / 删除 */

import { ic, esc, el, toast, fmtSize, fmtTime, confirmDialog, modal, loading } from "../app.js";
import { splitFrontMatter, nowLocal } from "../yaml.js";

const CACHE_KEY = "qexo4_cache_posts";
const CACHE_TTL = 5 * 60 * 1000;

/** 缓存按仓库+分支隔离，换仓库后不会串数据 */
function cacheScope(ctx) {
  return ctx.demo ? "demo" : ctx.settings.owner + "/" + ctx.settings.repo + "#" + ctx.settings.branch;
}

export function invalidatePostsCache() {
  try { localStorage.removeItem(CACHE_KEY); } catch (_) { /* ignore */ }
}

/** 日期字符串 → 排序用毫秒数；兼容补零/不补零/ISO 三种写法，无效返回 0 */
export function dateValue(s) {
  if (!s) return 0;
  const m = String(s).match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
  if (!m) return 0;
  const p = (n) => (n.length < 2 ? "0" + n : n);
  return Date.parse(
    m[1] + "-" + p(m[2]) + "-" + p(m[3]) + "T" + p(m[4] || "00") + ":" + p(m[5] || "00") + ":" + p(m[6] || "00") + "Z"
  ) || 0;
}

/** 文章的站内地址：permalink / abbrlink 优先（_config.yml permalink 为 post/:abbrlink/） */
export function postLink(p, siteUrl) {
  const base = String(siteUrl || "").replace(/\/$/, "");
  if (p.permalink) {
    const pl = String(p.permalink).replace(/^\//, "");
    return /^https?:\/\//i.test(pl) ? pl : base + "/" + pl;
  }
  if (p.abbrlink != null && p.abbrlink !== "") return base + "/post/" + p.abbrlink + "/";
  return base + "/";
}

/** 读取全部文章 front-matter（带 localStorage 缓存，跨标签页复用 5 分钟） */
export async function loadAllPosts(ctx, { force = false } = {}) {
  if (!force) {
    try {
      const cache = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
      if (cache && Date.now() - cache.ts < CACHE_TTL && cache.scope === cacheScope(ctx)) return cache.data;
    } catch (_) { /* ignore */ }
  }
  const api = ctx.api;
  const files = await api.listPosts();
  const data = [];
  const CONCURRENCY = 6;
  const queue = [...files];
  async function worker() {
    while (queue.length) {
      const f = queue.pop();
      try {
        const text = await api.readFile(f.path);
        const { data: fm } = splitFrontMatter(text);
        data.push({
          name: f.name, path: f.path, size: f.size,
          title: String(fm.title || f.name.replace(/\.md$/, "")),
          date: String(fm.date || ""),
          updated: String(fm.updated || ""),
          sticky: fm.sticky == null ? null : Number(fm.sticky) || 0,
          tags: Array.isArray(fm.tags) ? fm.tags.map(String) : [],
          categories: Array.isArray(fm.categories) ? fm.categories.map(String) : [],
          password: fm.password ? Boolean(String(fm.password)) : false,
          permalink: fm.permalink == null ? "" : String(fm.permalink),
          abbrlink: fm.abbrlink == null ? "" : String(fm.abbrlink),
        });
      } catch (_) {
        data.push({ name: f.name, path: f.path, size: f.size, title: f.name, date: "", updated: "", sticky: null, tags: [], categories: [], password: false, permalink: "", abbrlink: "" });
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  data.sort((a, b) => dateValue(b.date || b.updated) - dateValue(a.date || a.updated) || a.name.localeCompare(b.name));
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), scope: cacheScope(ctx), data }));
  } catch (_) { /* ignore */ }
  return data;
}

export default async function posts(view, ctx, params, handleErr) {
  view.innerHTML = "";

  const toolbar = el(`<div class="toolbar">
      <div class="search-box">${ic("search")}
        <input class="input" id="post-search" type="search" placeholder="搜索标题 / 标签 / 分类 / 文件名…" />
      </div>
      <div class="spacer"></div>
      <button class="btn btn-primary" id="post-new">${ic("plus")}新建文章</button>
    </div>`);
  view.appendChild(toolbar);

  const card = el(`<div class="card">
      <div class="table-wrap"><table class="tbl">
        <thead><tr>
          <th>文章</th><th>日期</th><th>分类 / 标签</th><th>状态</th><th>大小</th><th style="text-align:right">操作</th>
        </tr></thead>
        <tbody id="post-tbody"><tr><td colspan="6"><span class="inline-loading"><span class="ring"></span>正在加载文章列表…</span></td></tr></tbody>
      </table></div>
    </div>`);
  view.appendChild(card);

  const tbody = card.querySelector("#post-tbody");
  const search = toolbar.querySelector("#post-search");
  let all = [];

  function render() {
    const q = (search.value || "").trim().toLowerCase();
    const rows = q
      ? all.filter((p) =>
          p.title.toLowerCase().includes(q) ||
          p.name.toLowerCase().includes(q) ||
          p.tags.some((t) => t.toLowerCase().includes(q)) ||
          p.categories.some((c) => c.toLowerCase().includes(q)))
      : all;
    if (!rows.length) {
      tbody.innerHTML = `<tr class="tbl-row-empty"><td colspan="6">${q ? "没有匹配「" + esc(q) + "」的文章" : "还没有文章，点右上角新建第一篇"}</td></tr>`;
      return;
    }
    tbody.innerHTML = rows.map((p) => `
      <tr data-path="${esc(p.path)}">
        <td class="cell-title">${esc(p.title)}<small>${esc(p.name)}</small></td>
        <td class="cell-muted">${esc(fmtTime(p.date || p.updated))}</td>
        <td class="cell-muted">${
          (p.categories.length ? `<span class="badge badge-info">${esc(p.categories.join(" / "))}</span> ` : "") +
          p.tags.slice(0, 3).map((t) => `<span class="badge badge-primary">${esc(t)}</span>`).join(" ")
        }</td>
        <td>${p.sticky ? `<span class="badge badge-warning">${ic("star")}置顶 ${esc(p.sticky)}</span>` : ""}${p.password ? `<span class="badge badge-neutral">${ic("lock")}加密</span>` : `<span class="badge badge-success">已发布</span>`}</td>
        <td class="cell-muted">${fmtSize(p.size)}</td>
        <td class="cell-actions">
          <a class="icon-btn" title="编辑" href="#/edit?file=${encodeURIComponent(p.path)}">${ic("edit")}</a>
          <a class="icon-btn" title="在博客查看${p.abbrlink ? "（/post/" + esc(p.abbrlink) + "/）" : ""}" href="${esc(postLink(p, ctx.settings.siteUrl))}" target="_blank" rel="noopener">${ic("external")}</a>
          <button class="icon-btn danger act-del" title="删除">${ic("trash")}</button>
        </td>
      </tr>`).join("");
    tbody.querySelectorAll(".act-del").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const tr = btn.closest("tr");
        const p = all.find((x) => x.path === tr.dataset.path);
        if (!p) return;
        const ok = await confirmDialog({
          title: "删除文章",
          text: `确定删除《${p.title}》（${p.name}）？删除会提交到仓库并触发重新部署。`,
          okLabel: "删除",
          danger: true,
        });
        if (!ok) return;
        loading.show("正在删除…");
        try {
          await ctx.api.deleteFile(p.path, `Delete Post ${p.name} by Qexo`);
          invalidatePostsCache();
          all = all.filter((x) => x.path !== p.path);
          render();
          toast("已删除《" + p.title + "》", "success");
        } catch (e) { handleErr(e); }
        loading.hide();
      });
    });
  }

  search.addEventListener("input", render);

  toolbar.querySelector("#post-new").addEventListener("click", () => {
    const body = el(`<div>
        <div class="field">
          <label>文件名</label>
          <input class="input input-mono" id="np-name" placeholder="例如：my-new-post.md" />
          <div class="hint">将创建到 <b>source/_posts/</b> 目录，标题和内容在编辑器里继续填写</div>
        </div>
      </div>`);
    const nameInput = body.querySelector("#np-name");
    modal({
      title: "新建文章",
      body,
      actions: [
        { label: "取消" },
        {
          label: "创建并打开编辑器",
          cls: "btn-primary",
          async onClick() {
            let name = nameInput.value.trim();
            if (!name) { toast("请输入文件名", "error"); return true; }
            if (!/\.(md|markdown)$/i.test(name)) name += ".md";
            if (all.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
              toast("已存在同名文章", "error");
              return true;
            }
            const fm = {
              title: name.replace(/\.(md|markdown)$/i, "").replace(/[-_]/g, " "),
              date: nowLocal(),
              updated: nowLocal(),
              comments: true,
            };
            const text = `---\n` + Object.entries(fm).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join("\n") + `\n---\n\n`;
            loading.show("正在创建…");
            try {
              const path = "source/_posts/" + name;
              await ctx.api.writeFile(path, text, `New Post ${name} by Qexo`);
              invalidatePostsCache();
              loading.hide();
              toast("文章已创建", "success");
              location.hash = "#/edit?file=" + encodeURIComponent(path);
            } catch (e) {
              loading.hide();
              handleErr(e);
              return true;
            }
          },
        },
      ],
    });
    setTimeout(() => nameInput.focus(), 60);
  });

  try {
    all = await loadAllPosts(ctx);
  } catch (e) {
    handleErr(e);
    tbody.innerHTML = `<tr class="tbl-row-empty"><td colspan="6">加载失败：${esc(e.message)}</td></tr>`;
    return;
  }
  render();
}
