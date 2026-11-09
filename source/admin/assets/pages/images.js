/* pages/images.js — 图库：上传 / 网格浏览 / 复制链接 / 删除（source/images/uploads） */

import {
  ic, esc, el, toast, loading, confirmDialog, lightbox, copyText, fmtSize,
} from "../app.js";

const DIR = "source/images/uploads";
const IMG_RE = /\.(png|jpe?g|gif|webp|svg|avif|bmp|ico)$/i;

export default async function images(view, ctx, params, handleErr) {
  let items = [];

  view.innerHTML = "";

  const dropzone = el(`<div class="dropzone" id="dz">
      ${ic("upload")}
      <b>拖拽图片到这里，或点击选择上传</b>
      <span>多文件支持 · 上传到 ${esc(DIR)} · 完成后直接复制 Markdown</span>
      <input type="file" id="img-file" accept="image/*" multiple hidden />
    </div>`);
  view.appendChild(dropzone);

  const toolbar = el(`<div class="toolbar">
      <span class="chip" id="img-count"><span class="dot"></span>加载中…</span>
      <div class="search-box" style="max-width:260px">${ic("search")}
        <input class="input" id="img-search" type="search" placeholder="搜索文件名…" />
      </div>
      <div class="spacer"></div>
      <button class="btn" id="img-refresh">${ic("refresh")}刷新</button>
    </div>`);
  view.appendChild(toolbar);

  const gridEl = el(`<div class="img-grid" id="img-grid"></div>`);
  view.appendChild(gridEl);

  const fileInput = dropzone.querySelector("#img-file");
  dropzone.addEventListener("click", () => fileInput.click());
  dropzone.addEventListener("dragover", (e) => { e.preventDefault(); dropzone.classList.add("dragover"); });
  dropzone.addEventListener("dragleave", () => dropzone.classList.remove("dragover"));
  dropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropzone.classList.remove("dragover");
    const files = Array.from((e.dataTransfer && e.dataTransfer.files) || []).filter((f) => f.type.startsWith("image/"));
    if (files.length) uploadFiles(files);
  });
  fileInput.addEventListener("change", () => {
    const files = Array.from(fileInput.files || []);
    fileInput.value = "";
    if (files.length) uploadFiles(files);
  });

  async function uploadFiles(files) {
    loading.show(`上传图片 0/${files.length}…`);
    let ok = 0;
    let i = 0;
    for (const f of files) {
      loading.show(`上传图片 ${i + 1}/${files.length}：${f.name}`);
      try {
        let name = safeName(f.name);
        if (items.some((it) => it.name === name)) name = Date.now() + "-" + name;
        const path = DIR + "/" + name;
        await ctx.api.uploadFile(path, f, `Upload Image ${name} by Qexo`);
        items.unshift({ name, path, size: f.size, blobUrl: URL.createObjectURL(f) });
        ok++;
      } catch (e) {
        toast("上传失败：" + (e.message || f.name), "error");
      }
      i++;
    }
    loading.hide();
    if (ok) {
      toast(`已上传 ${ok} 张图片，Netlify 构建已触发`, "success");
      render();
    }
  }

  function safeName(name) {
    return String(name || "image.png").replace(/[^\w\u4e00-\u9fa5.-]+/g, "-");
  }

  function previewSrc(item) {
    if (item.blobUrl) return item.blobUrl;
    return ctx.api.mediaUrl(item.path);
  }

  function render() {
    const q = (toolbar.querySelector("#img-search").value || "").trim().toLowerCase();
    const rows = q ? items.filter((i) => i.name.toLowerCase().includes(q)) : items;
    toolbar.querySelector("#img-count").innerHTML =
      `<span class="dot"></span>共 ${items.length} 张图片` + (q ? ` · 匹配 ${rows.length}` : "");
    if (!rows.length) {
      gridEl.innerHTML = `<div class="empty" style="grid-column:1/-1">${ic("image")}<p>${q ? "没有匹配的图片" : "图库还是空的，拖几张图上来试试"}</p></div>`;
      return;
    }
    gridEl.innerHTML = "";
    for (const item of rows) {
      const src = previewSrc(item);
      const card = el(`<div class="img-card">
          <div class="img-thumb"></div>
          <div class="img-meta">
            <div class="name" title="${esc(item.path)}">${esc(item.name)}</div>
            <div class="row">
              <span class="size">${fmtSize(item.size)}</span>
              <span class="ops">
                <button class="icon-btn" title="复制 Markdown">${ic("post")}</button>
                <button class="icon-btn" title="复制链接">${ic("copy")}</button>
                <button class="icon-btn" title="预览">${ic("eye")}</button>
                <button class="icon-btn danger" title="删除">${ic("trash")}</button>
              </span>
            </div>
          </div>
        </div>`);
      const thumb = card.querySelector(".img-thumb");
      thumb.style.backgroundImage = `url("${src}")`;
      thumb.addEventListener("click", () => lightbox(src));
      const [mdBtn, urlBtn, eyeBtn, delBtn] = card.querySelectorAll(".ops .icon-btn");
      mdBtn.addEventListener("click", () => copyText(`![${item.name}](${publicUrl(item)})`));
      urlBtn.addEventListener("click", () => copyMenu(item));
      eyeBtn.addEventListener("click", () => lightbox(src));
      delBtn.addEventListener("click", async () => {
        const ok = await confirmDialog({
          title: "删除图片",
          text: `确定删除 ${item.name}？如有文章引用该图会失效。`,
          okLabel: "删除",
          danger: true,
        });
        if (!ok) return;
        loading.show("正在删除…");
        try {
          await ctx.api.deleteFile(item.path, `Delete Image ${item.name} by Qexo`);
          items = items.filter((x) => x !== item);
          render();
          toast("图片已删除", "success");
        } catch (e) { handleErr(e); }
        loading.hide();
      });
      gridEl.appendChild(card);
    }
  }

  function publicUrl(item) {
    return (ctx.settings.siteUrl || "").replace(/\/$/, "") + "/images/uploads/" + encodeURIComponent(item.name);
  }

  function copyMenu(item) {
    const rel = "/images/uploads/" + item.name;
    const abs = publicUrl(item);
    modal({
      title: "复制图片链接",
      body: `<div class="fm-list">
          <div class="fm-row"><label>相对路径（博客内推荐）</label>
            <div class="flex"><input class="input input-mono" readonly value="${esc(rel)}" /><button class="btn btn-sm" data-copy="${esc(rel)}">${ic("copy")}复制</button></div></div>
          <div class="fm-row"><label>完整 URL</label>
            <div class="flex"><input class="input input-mono" readonly value="${esc(abs)}" /><button class="btn btn-sm" data-copy="${esc(abs)}">${ic("copy")}复制</button></div></div>
          <div class="fm-row"><label>Markdown</label>
            <div class="flex"><input class="input input-mono" readonly value="${esc(`![${item.name}](${rel})`)}" /><button class="btn btn-sm" data-copy="${esc(`![${item.name}](${rel})`)}">${ic("copy")}复制</button></div></div>
        </div>`,
      actions: [{ label: "关闭" }],
    }).querySelectorAll("[data-copy]").forEach((b) => {
      b.addEventListener("click", () => copyText(b.dataset.copy));
    });
  }

  toolbar.querySelector("#img-refresh").addEventListener("click", async () => {
    loading.show("正在刷新…");
    await load();
    loading.hide();
  });
  toolbar.querySelector("#img-search").addEventListener("input", render);

  async function load() {
    try {
      const list = await ctx.api.listDir(DIR);
      items = list
        .filter((it) => it.type === "file" && IMG_RE.test(it.name))
        .map((it) => ({ name: it.name, path: it.path, size: it.size }))
        .sort((a, b) => b.name.localeCompare(a.name));
    } catch (e) {
      if (e.status === 404) items = [];
      else handleErr(e);
    }
    render();
  }

  await load();
}
