/* pages/posts.js — 文章管理：列表 / 搜索 / 新建 / 删除 */

import { ic, esc, el, toast, fmtSize, fmtTime, confirmDialog, modal, loading } from "../app.js?v=4.1.8";
import { splitFrontMatter, nowLocal } from "../yaml.js?v=4.1.8";

const CACHE_KEY = "qexo4_cache_posts";
const CACHE_TTL = 5 * 60 * 1000;

/** 缓存按仓库+分支隔离，换仓库后不会串数据 */
function cacheScope(ctx) {
  return ctx.demo ? "demo" : ctx.settings.owner + "/" + ctx.settings.repo + "#" + ctx.settings.branch;
}

export function invalidatePostsCache() {
  try { localStorage.removeItem(CACHE_KEY); } catch (_) { /* ignore */ }
}

const OVERRIDE_KEY = "qexo4_post_overrides";

/** 编辑/删除后的本地覆盖：索引（构建产物）未更新前保持列表真实 */
export function setPostOverride(path, entry) {
  try {
    const o = JSON.parse(localStorage.getItem(OVERRIDE_KEY) || "{}");
    if (entry) o[path] = entry;
    else delete o[path];
    localStorage.setItem(OVERRIDE_KEY, JSON.stringify(o));
  } catch (_) { /* ignore */ }
}

function getOverrides() {
  try { return JSON.parse(localStorage.getItem(OVERRIDE_KEY) || "{}"); } catch (_) { return {}; }
}

function applyOverrides(data, overrides) {
  let list = data.map((p) => (overrides[p.path] ? overrides[p.path] : p)).filter(Boolean);
  for (const [path, entry] of Object.entries(overrides)) {
    if (entry && !list.some((p) => p.path === path)) list.push(entry);
  }
  list.sort((a, b) => dateValue(b.date || b.updated) - dateValue(a.date || a.updated) || a.name.localeCompare(b.name));
  return list;
}

/** 从构建索引读取列表（1 个静态请求，替代逐篇 52 次 GitHub API） */
async function loadFromIndex(ctx) {
  if (ctx.demo) return null;
  // 后台是 hash 路由（/admin/#/posts），页面基线是 /admin/；相对路径会解析成
  // /admin/admin/posts-index.json（404）并静默回退到 52 次 API，必须用站点根绝对路径。
  const res = await fetch("/admin/posts-index.json", { cache: "no-cache" });
  if (!res.ok) throw new Error("HTTP " + res.status + " /admin/posts-index.json");
  const index = await res.json();
  return index.map((p) => ({
    name: p.name, path: p.path, size: p.size || null,
    title: String(p.title || p.name.replace(/\.md$/, "")),
    date: String(p.date || ""), updated: String(p.updated || ""),
    sticky: p.sticky == null ? null : Number(p.sticky) || 0,
    tags: Array.isArray(p.tags) ? p.tags.map(String) : [],
    categories: Array.isArray(p.categories) ? p.categories.map(String) : [],
    password: Boolean(p.password),
    permalink: String(p.permalink || ""), abbrlink: String(p.abbrlink || ""),
  }));
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

/** 读取全部文章列表：索引优先（1 请求）→ 覆盖合并 → GitHub 全量兜底 */
export async function loadAllPosts(ctx, { force = false } = {}) {
  if (!force) {
    try {
      const cache = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
      if (cache && Date.now() - cache.ts < CACHE_TTL && cache.scope === cacheScope(ctx)) return cache.data;
    } catch (_) { /* ignore */ }
  }
  const api = ctx.api;
  const finish = (data) => {
    data.sort((a, b) => dateValue(b.date || b.updated) - dateValue(a.date || a.updated) || a.name.localeCompare(b.name));
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), scope: cacheScope(ctx), data }));
    } catch (_) { /* ignore */ }
    return data;
  };

  // 1) 构建索引（1 个静态请求）+ 本地覆盖合并
  if (!force) {
    try {
      const indexed = await loadFromIndex(ctx);
      if (indexed && indexed.length) {
        const data = finish(applyOverrides(indexed, getOverrides()));
        return data;
      }
    } catch (e) {
      // 静默兜底曾让「索引脚本未入库 / 线上 404」长期不被发现，这里留一条可诊断线索
      console.warn("[qexo] 文章索引不可用，回退 GitHub 全量读取：", e && e.message);
    }
  }

  // 2) GitHub 全量逐篇读取（兜底 / 强制刷新）
  if (force) {
    try { localStorage.removeItem(OVERRIDE_KEY); } catch (_) { /* ignore */ }
  }
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
  return finish(data);
}

export default async function posts(view, ctx, params, handleErr) {
  view.innerHTML = "";

  const toolbar = el(`<div class="toolbar">
      <div class="search-box">${ic("search")}
        <input class="input" id="post-search" type="search" placeholder="搜索标题 / 标签 / 分类 / 文件名…" />
      </div>
      <div class="spacer"></div>
      <button class="btn" id="post-refresh" title="绕过缓存与索引，从 GitHub 全量刷新">${ic("refresh")}强制刷新</button>
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
          setPostOverride(p.path, null);
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

  toolbar.querySelector("#post-refresh").addEventListener("click", async () => {
    const btn = toolbar.querySelector("#post-refresh");
    btn.disabled = true;
    loading.show("正在从 GitHub 全量刷新…");
    try {
      all = await loadAllPosts(ctx, { force: true });
      render();
      toast("已从 GitHub 全量刷新", "success");
    } catch (e) { handleErr(e); }
    loading.hide();
    btn.disabled = false;
  });


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
              setPostOverride(path, { name, path, size: text.length, title: fm.title, date: fm.date, updated: fm.updated, sticky: null, tags: [], categories: [], password: false, permalink: "", abbrlink: "" });
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
