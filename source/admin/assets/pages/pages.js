/* pages/pages.js — 页面管理：关于 / 友链页 / 说说页 / 朋友圈 / 计划清单 */

import { ic, esc, el, toast, loading, fmtSize } from "../app.js";
import { splitFrontMatter, nowLocal } from "../yaml.js";

const PAGE_FILES = [
  { file: "source/about/index.md", label: "关于页", icon: "user", desc: "个人介绍" },
  { file: "source/friends.md", label: "友链页", icon: "friend", desc: "layout: links，渲染友链卡片" },
  { file: "source/talks.md", label: "说说页", icon: "talk", desc: "说说时间线容器" },
  { file: "source/pyq/index.md", label: "朋友圈页", icon: "globe", desc: "朋友圈样式页面" },
  { file: "source/todolist.md", label: "计划清单", icon: "check", desc: "个人计划 / 清单" },
];

export default async function pagesList(view, ctx, params, handleErr) {
  view.innerHTML = "";

  const card = el(`<div class="card">
      <div class="card-header">${ic("page")}<h2>页面列表</h2><div class="sub">点击进入编辑器，保存即发布</div></div>
      <div class="table-wrap"><table class="tbl">
        <thead><tr><th>页面</th><th>文件</th><th>标题</th><th>大小</th><th style="text-align:right">操作</th></tr></thead>
        <tbody id="page-tbody"><tr><td colspan="5"><span class="inline-loading"><span class="ring"></span>加载中…</span></td></tr></tbody>
      </table></div>
    </div>`);
  view.appendChild(card);

  const tbody = card.querySelector("#page-tbody");
  const rows = [];
  loading.show("正在读取页面…");
  for (const p of PAGE_FILES) {
    try {
      const text = await ctx.api.readFile(p.file);
      const { data } = splitFrontMatter(text);
      rows.push({ ...p, title: String(data.title || p.label), size: text.length });
    } catch (e) {
      rows.push({ ...p, title: "（不存在，保存时创建）", size: null });
    }
  }
  loading.hide();

  tbody.innerHTML = rows.map((p) => `
      <tr>
        <td><div class="flex">
          <span class="icon-shape primary" style="width:34px;height:34px;border-radius:.6rem">${ic(p.icon)}</span>
          <div class="grow"><b class="small" style="color:var(--text-dark)">${esc(p.label)}</b><br><span class="small muted">${esc(p.desc)}</span></div>
        </div></td>
        <td class="cell-muted">${esc(p.file)}</td>
        <td class="cell-muted">${esc(p.title)}</td>
        <td class="cell-muted">${p.size == null ? "-" : fmtSize(p.size)}</td>
        <td class="cell-actions">
          <a class="btn btn-sm btn-primary" href="#/editpage?file=${encodeURIComponent(p.file)}">${ic("edit")}编辑</a>
        </td>
      </tr>`).join("");
}
