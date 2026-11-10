/* pages/friends.js — 友链管理：表格 CRUD（写 fluid_config.yml 的 links.items） */

import {
  ic, esc, el, toast, loading, confirmDialog, modal, safeHttpUrl, safeImgUrl,
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
          <span class="friend-avatar">${safeImgUrl(f.avatar) ? "" : ic("globe")}</span>
          <div class="grow"><b class="small" style="color:var(--text-dark)">${esc(f.title || "未命名")}</b></div>
        </div></td>
        <td class="cell-muted"><a class="friend-link" target="_blank" rel="noopener">${esc(f.link || "-")} ${ic("external")}</a></td>
        <td class="cell-muted" style="max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(f.intro || "-")}</td>
        <td class="cell-actions">
          <button class="icon-btn act-edit" title="编辑">${ic("edit")}</button>
          <button class="icon-btn danger act-del" title="删除">${ic("trash")}</button>
        </td>
      </tr>`).join("");

    // URL 一律走 DOM 属性赋值 + 协议白名单，避免拼进 HTML/CSS 造成注入
    tbody.querySelectorAll("tr[data-idx]").forEach((tr) => {
      const f = items[Number(tr.dataset.idx)];
      const avatarSrc = safeImgUrl(f.avatar);
      if (avatarSrc) {
        const im = document.createElement("img");
        im.src = avatarSrc;
        im.alt = "";
        im.referrerPolicy = "no-referrer";
        im.style.cssText = "width:100%;height:100%;object-fit:cover;border-radius:50%;display:block";
        tr.querySelector(".friend-avatar").appendChild(im);
      }
      const a = tr.querySelector(".friend-link");
      const href = safeHttpUrl(f.link);
      if (href) a.href = href;
      else a.title = "链接无效（仅支持 http/https）";
    });

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
        await save("Delete Friend by Qexo", items.filter((x) => x !== f));
        render();
        toast("友链已删除", "success");
      } catch (e) { handleErr(e); }
      loading.hide();
    }));
  }

  async function save(message, nextItems) {
    // 写前重读远端配置，只替换 links.items，避免用过期本地数据覆盖其他键
    let fresh;
    try {
      fresh = loadYaml(await ctx.api.readFile(CONFIG_PATH)) || {};
    } catch (e) {
      if (e.status === 404 || ctx.demo) fresh = {};
      else throw e;
    }
    fresh.links = { ...(fresh.links || {}), items: nextItems };
    await ctx.api.writeFile(CONFIG_PATH, dumpYaml(fresh), message);
    config = fresh;
    items = nextItems;
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
            if (!safeHttpUrl(link)) { toast("站点地址需以 http:// 或 https:// 开头", "error"); return true; }
            const avatar = body.querySelector("#f-avatar").value.trim();
            if (avatar && !safeImgUrl(avatar)) { toast("头像需为 http(s) 图片地址或站内 / 路径", "error"); return true; }
            const next = {
              ...data,
              title,
              link,
              intro: body.querySelector("#f-intro").value.trim(),
              avatar,
            };
            const nextItems = isNew ? [...items, next] : items.map((x) => (x === data ? next : x));
            loading.show("正在保存…");
            try {
              await save(isNew ? "Add Friend by Qexo" : "Edit Friend by Qexo", nextItems);
              loading.hide();
              render();
              toast("已保存，Netlify 构建已触发", "success");
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
    loading.hide();
    // 加载失败时禁用编辑，避免把空配置整体覆写到仓库
    toolbar.querySelector("#friend-add").disabled = true;
    toolbar.querySelector("#friend-count").innerHTML = `<span class="dot"></span>加载失败`;
    tbody.innerHTML = `<tr class="tbl-row-empty"><td colspan="4">配置加载失败：${esc(e.message)}。为避免覆盖仓库配置，已禁用编辑，请刷新重试。</td></tr>`;
    return;
  }
  loading.hide();
  render();
}
