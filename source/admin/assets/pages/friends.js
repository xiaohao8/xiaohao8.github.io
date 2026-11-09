/* pages/friends.js — 友链管理：表格 CRUD（写 fluid_config.yml 的 links.items） */

import {
  ic, esc, el, toast, loading, confirmDialog, modal, copyText,
} from "../app.js";
import { loadYaml, dumpYaml } from "../yaml.js";

const CONFIG_PATH = "source/_data/fluid_config.yml";

export default async function friends(view, ctx, params, handleErr) {
  let config = null;
  let items = [];

  view.innerHTML = "";
  const toolbar = el(`<div class="toolbar">
      <span class="chip" id="friend-count"><span class="dot"></span>加载中…</span>
      <div class="spacer"></div>
      <button class="btn" id="friend-open-file">${ic("external")}查看站点友链页</button>
      <button class="btn btn-primary" id="friend-add">${ic("plus")}新增友链</button>
    </div>`);
  view.appendChild(toolbar);

  const card = el(`<div class="card">
      <div class="card-header">${ic("friend")}<h2>友链列表</h2><div class="sub">保存到 source/_data/fluid_config.yml 的 links.items</div></div>
      <div class="table-wrap"><table class="tbl">
        <thead><tr><th>站点</th><th>链接</th><th>简介</th><th style="text-align:right">操作</th></tr></thead>
        <tbody id="friend-tbody"></tbody>
      </table></div>
    </div>`);
  view.appendChild(card);

  const tbody = card.querySelector("#friend-tbody");

  function render() {
    toolbar.querySelector("#friend-count").innerHTML =
      `<span class="dot"></span>共 ${items.length} 个友链`;
    if (!items.length) {
      tbody.innerHTML = `<tr class="tbl-row-empty"><td colspan="4">还没有友链，点右上角添加</td></tr>`;
      return;
    }
    tbody.innerHTML = items.map((f, idx) => `
      <tr data-idx="${idx}">
        <td><div class="flex">
          <span class="friend-avatar" style="background-image:url('${esc(f.avatar || "")}')">${f.avatar ? "" : ic("globe")}</span>
          <div class="grow"><b class="small" style="color:var(--text-dark)">${esc(f.title || "未命名")}</b></div>
        </div></td>
        <td class="cell-muted"><a href="${esc(f.link || "#")}" target="_blank" rel="noopener">${esc(f.link || "-")} ${ic("external")}</a></td>
        <td class="cell-muted" style="max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(f.intro || "-")}</td>
        <td class="cell-actions">
          <button class="icon-btn act-edit" title="编辑">${ic("edit")}</button>
          <button class="icon-btn danger act-del" title="删除">${ic("trash")}</button>
        </td>
      </tr>`).join("");

    tbody.querySelectorAll(".act-edit").forEach((b) => b.addEventListener("click", () => {
      editDialog(items[Number(b.closest("tr").dataset.idx)], false);
    }));
    tbody.querySelectorAll(".act-del").forEach((b) => b.addEventListener("click", async () => {
      const f = items[Number(b.closest("tr").dataset.idx)];
      const ok = await confirmDialog({
        title: "删除友链",
        text: `确定删除「${f.title}」？`,
        okLabel: "删除",
        danger: true,
      });
      if (!ok) return;
      loading.show("正在保存…");
      try {
        items = items.filter((x) => x !== f);
        await save("Delete Friend by Qexo");
        render();
        toast("友链已删除", "success");
      } catch (e) { handleErr(e); }
      loading.hide();
    }));
  }

  async function save(message) {
    config.links = { ...(config.links || {}), items };
    await ctx.api.writeFile(CONFIG_PATH, dumpYaml(config), message);
    toast("已保存，Netlify 构建已触发", "success");
  }

  function editDialog(item, isNew) {
    const data = item || { title: "", link: "", intro: "", avatar: "" };
    const body = el(`<div>
        <div class="field"><label>站点名称 <span class="req" style="color:var(--danger)">*</span></label>
          <input class="input" id="f-title" value="${esc(data.title || "")}" placeholder="例如：某某的博客" /></div>
        <div class="field"><label>站点地址 <span class="req" style="color:var(--danger)">*</span></label>
          <input class="input" id="f-link" value="${esc(data.link || "")}" placeholder="https://example.com" /></div>
        <div class="field"><label>站点简介</label>
          <input class="input" id="f-intro" value="${esc(data.intro || "")}" placeholder="一句话介绍" /></div>
        <div class="field"><label>站点头像</label>
          <input class="input" id="f-avatar" value="${esc(data.avatar || "")}" placeholder="头像图片 URL（可留空）" /></div>
      </div>`);
    modal({
      title: isNew ? "新增友链" : "编辑友链",
      body,
      actions: [
        { label: "取消" },
        {
          label: "保存",
          cls: "btn-primary",
          async onClick(ov) {
            const title = body.querySelector("#f-title").value.trim();
            const link = body.querySelector("#f-link").value.trim();
            if (!title || !link) { toast("名称和链接必填", "error"); return true; }
            const next = {
              ...data,
              title,
              link,
              intro: body.querySelector("#f-intro").value.trim(),
              avatar: body.querySelector("#f-avatar").value.trim(),
            };
            if (isNew) items.push(next);
            else Object.assign(data, next);
            loading.show("正在保存…");
            try {
              await save(isNew ? "Add Friend by Qexo" : "Edit Friend by Qexo");
              loading.hide();
              render();
            } catch (e) {
              loading.hide();
              handleErr(e);
              return true;
            }
          },
        },
      ],
    });
  }

  toolbar.querySelector("#friend-add").addEventListener("click", () => editDialog(null, true));
  toolbar.querySelector("#friend-open-file").addEventListener("click", () => {
    window.open(ctx.settings.siteUrl + "/links/", "_blank", "noopener");
  });

  loading.show("正在加载友链配置…");
  try {
    const raw = await ctx.api.readFile(CONFIG_PATH);
    config = loadYaml(raw) || {};
    items = Array.isArray((config.links || {}).items) ? config.links.items.slice() : [];
  } catch (e) {
    handleErr(e);
    config = { links: {} };
  }
  loading.hide();
  render();
}
