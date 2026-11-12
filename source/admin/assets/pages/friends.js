/* pages/friends.js — 友链管理：表格 CRUD（写 fluid_config.yml 的 links.items） */

import {
  ic, esc, el, toast, loading, confirmDialog, modal, safeHttpUrl, safeImgUrl,
} from "../app.js?v=4.1.9";
import { loadYaml, dumpYaml } from "../yaml.js?v=4.1.9";

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
  /* ---------- 友链申请审批（GitHub Issue 自助提交） ---------- */

  const applyCard = el(`<div class="card" id="apply-card">
      <div class="card-header">${ic("post")}<h2>友链申请</h2><div class="sub">来自友链页表单的 GitHub Issue</div><div class="spacer"></div>
        <button class="icon-btn" id="apply-refresh" title="刷新">${ic("refresh")}</button></div>
      <div id="apply-list"><span class="inline-loading"><span class="ring"></span>加载中…</span></div>
    </div>`);
  view.appendChild(applyCard);

  function parseApplyBody(body) {
    if (!body) return null;
    const m = body.match(/```yaml[\s\S]*?```/);
    if (m) {
      try {
        const d = window.jsyaml ? window.jsyaml.load(m[0].replace(/```(yaml)?/g, "")) : null;
        if (d && (d.title || d.link)) {
          return { title: String(d.title || ""), link: String(d.link || ""), avatar: String(d.avatar || ""), intro: String(d.intro || "") };
        }
      } catch (_) { /* 落到正则兜底 */ }
    }
    const get = (k) => { const mm = body.match(new RegExp(k + "[:：]\\s*(\\S+)")); return mm ? mm[1] : ""; };
    const t = get("title"), l = get("link");
    return t && l ? { title: t, link: l, avatar: get("avatar"), intro: get("intro") } : null;
  }

  async function closeIssue(it, comment) {
    try {
      if (comment) await ctx.api.createIssueComment(it.number, comment);
      await ctx.api.updateIssue(it.number, { state: "closed" });
      return true;
    } catch (e) {
      toast("Issue 关闭失败（Token 缺少 Issues 权限？）请手动关闭：#" + it.number, "info", 6000);
      return false;
    }
  }

  async function adoptIssue(it, info) {
    if (!safeHttpUrl(info.link)) { toast("申请中的链接无效，请手动处理", "error"); return; }
    const item = { title: info.title, link: info.link, intro: info.intro || "", avatar: info.avatar || "" };
    loading.show("正在采纳…");
    try {
      await save("Add Friend by Qexo (from issue #" + it.number + ")", items.concat([item]));
      render();
      loading.hide();
      const ok = await closeIssue(it, "友链已采纳并展示，感谢交换！");
      if (ok) toast("已采纳并关闭申请", "success");
      renderApplications();
    } catch (e) { loading.hide(); handleErr(e); }
  }

  async function rejectIssue(it) {
    const ok = await confirmDialog({ title: "忽略申请", text: "将关闭该 Issue 且不添加友链，确定？", okLabel: "关闭申请", danger: true });
    if (!ok) return;
    loading.show("正在处理…");
    const done = await closeIssue(it, "该申请未通过审核。");
    loading.hide();
    if (done) { toast("已关闭", "success"); renderApplications(); }
  }

  async function renderApplications() {
    const listEl = applyCard.querySelector("#apply-list");
    if (ctx.demo) {
      listEl.innerHTML = `<div class="empty" style="padding:1rem">${ic("info")}<p>演示模式：申请来自 GitHub Issue，需真实登录查看</p></div>`;
      return;
    }
    try {
      const issues = await ctx.api.listOpenIssues(30);
      const apps = (issues || []).filter((it) => !it.pull_request && String(it.title || "").startsWith("【友链申请】"));
      if (!apps.length) {
        listEl.innerHTML = `<div class="empty" style="padding:1rem">${ic("check")}<p>暂无待处理的申请</p></div>`;
        return;
      }
      listEl.innerHTML = "";
      for (const it of apps) {
        const info = parseApplyBody(it.body) || { title: it.title.replace("【友链申请】", "").trim(), link: "", avatar: "", intro: "" };
        const row = el(`<div class="zui-apply-item">
            <div class="meta"><b>${esc(info.title || "（未解析）")}</b>
              <span class="sub">${esc(info.link)}${info.intro ? " · " + esc(info.intro) : ""} · #${it.number}</span></div>
            <button class="btn btn-sm" data-act="view">查看</button>
            <button class="btn btn-sm btn-primary" data-act="adopt">采纳</button>
            <button class="btn btn-sm btn-ghost" data-act="reject">忽略</button>
          </div>`);
        row.querySelector('[data-act="view"]').addEventListener("click", () => window.open(it.html_url, "_blank", "noopener"));
        row.querySelector('[data-act="adopt"]').addEventListener("click", () => adoptIssue(it, info));
        row.querySelector('[data-act="reject"]').addEventListener("click", () => rejectIssue(it));
        listEl.appendChild(row);
      }
    } catch (e) {
      if (/Issues has been disabled/.test(e.message)) {
        listEl.innerHTML = `<div class="empty" style="padding:1rem">${ic("info")}<p>仓库未启用 Issues：GitHub 仓库 Settings → Features 勾选 Issues 后即可收到自助申请。</p></div>`;
      } else {
        listEl.innerHTML = `<div class="empty" style="padding:1rem">${ic("alert")}<p>申请列表加载失败：${esc(e.message)}</p></div>`;
      }
    }
  }

  applyCard.querySelector("#apply-refresh").addEventListener("click", renderApplications);
  renderApplications();

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
        im.loading = "lazy";
        im.style.cssText = "width:100%;height:100%;object-fit:cover;border-radius:50%;display:block";
        // 头像挂了（外链被墙/失效）就换成 globe 占位图标
        im.addEventListener("error", () => {
          im.remove();
          const holder = tr.querySelector(".friend-avatar");
          if (holder && !holder.firstChild) holder.innerHTML = ic("globe");
        }, { once: true });
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
      fresh = loadYaml(await ctx.api.readFile(CONFIG_PATH, { fresh: true })) || {};
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
