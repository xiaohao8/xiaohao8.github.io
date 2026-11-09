/* pages/talks.js — 说说：快发框 + 时间线（写 source/_data/talks.yml） */

import {
  ic, esc, el, toast, loading, fmtTime, confirmDialog, lightbox,
} from "../app.js";
import { loadYaml, dumpYaml, splitFrontMatter } from "../yaml.js";
import { ensureVditorLibFor } from "./editor-shared.js";

const TALKS_PATH = "source/_data/talks.yml";

function renderInlineMd(md) {
  // 极简内联渲染：段落 / 图片 / 加粗 / 行内代码 / 引用 —— 仅供后台预览
  const lines = String(md || "").split(/\n+/);
  let html = "";
  for (let line of lines) {
    line = line.trim();
    if (!line) continue;
    if (line.startsWith("> ")) line = `<blockquote>${esc(line.slice(2))}</blockquote>`;
    else line = `<p>${inline(line)}</p>`;
    html += line;
  }
  return html || "<p class='muted'>（空说说）</p>";

  function inline(s) {
    s = esc(s);
    s = s.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (m, alt, src) => `<img src="${src}" alt="${alt}" loading="lazy" />`);
    s = s.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
    s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
    return s;
  }
}

export default async function talks(view, ctx, params, handleErr) {
  view.innerHTML = "";

  const composerCard = el(`<div class="card talk-composer" id="talk-composer">
      <div class="card-header">${ic("talk")}<h2>发布说说</h2><div class="sub">内容为 Markdown，配图会上传到图库</div></div>
      <div id="talk-editor"></div>
      <div class="talk-meta">
        <label class="small muted" style="font-weight:600">发布时间</label>
        <input class="input" type="datetime-local" step="1" id="talk-time" />
        <div class="spacer"></div>
        <span class="small muted" id="talk-img-count">未添加配图</span>
      </div>
      <div class="talk-images" id="talk-images"></div>
      <div style="display:flex;gap:.6rem;justify-content:flex-end">
        <input type="file" id="talk-file" accept="image/*" multiple hidden />
        <button class="btn" id="talk-add-img">${ic("image")}添加配图</button>
        <button class="btn btn-primary" id="talk-publish">${ic("deploy")}发布说说</button>
      </div>
    </div>`);
  view.appendChild(composerCard);

  const listCard = el(`<div class="card">
      <div class="card-header">${ic("clock")}<h2>说说时间线</h2><div class="spacer"></div>
        <span class="small muted" id="talk-total"></span></div>
      <div class="timeline" id="talk-list"><span class="inline-loading"><span class="ring"></span>加载中…</span></div>
    </div>`);
  view.appendChild(listCard);

  const timeInput = composerCard.querySelector("#talk-time");
  const imagesHolder = composerCard.querySelector("#talk-images");
  const imgCount = composerCard.querySelector("#talk-img-count");
  let images = []; // { name, path, publicPath, url }
  let items = [];
  let vditor = null;

  const now = new Date();
  const p2 = (n) => (n < 10 ? "0" + n : "" + n);
  timeInput.value = `${now.getFullYear()}-${p2(now.getMonth() + 1)}-${p2(now.getDate())}T${p2(now.getHours())}:${p2(now.getMinutes())}:${p2(now.getSeconds())}`;

  function renderImages() {
    imagesHolder.innerHTML = "";
    for (const img of images) {
      const chip = el(`<div class="talk-image-chip" style="background-image:url('${img.preview}')" title="${esc(img.name)}">
          <span class="x">${ic("close")}</span>
        </div>`);
      chip.querySelector(".x").addEventListener("click", () => {
        images = images.filter((x) => x !== img);
        renderImages();
      });
      chip.addEventListener("click", (e) => { if (e.target === chip) lightbox(img.preview); });
      imagesHolder.appendChild(chip);
    }
    imgCount.textContent = images.length ? `已添加 ${images.length} 张配图` : "未添加配图";
  }

  composerCard.querySelector("#talk-add-img").addEventListener("click", () => composerCard.querySelector("#talk-file").click());
  composerCard.querySelector("#talk-file").addEventListener("change", async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (!files.length) return;
    await uploadImages(files);
  });

  // 拖拽到说说编辑器上传
  const composerEl = composerCard;
  composerEl.addEventListener("dragover", (e) => e.preventDefault());
  composerEl.addEventListener("drop", async (e) => {
    e.preventDefault();
    const files = Array.from((e.dataTransfer && e.dataTransfer.files) || []).filter((f) => f.type.startsWith("image/"));
    if (files.length) await uploadImages(files);
  });

  async function uploadImages(files) {
    loading.show(`上传图片 0/${files.length}…`);
    let i = 0;
    for (const f of files) {
      loading.show(`上传图片 ${i + 1}/${files.length}：${f.name}`);
      try {
        const r = await ctx.pagesUpload(f);
        images.push(r);
      } catch (err) {
        toast("图片上传失败：" + (err.message || f.name), "error");
      }
      i++;
    }
    loading.hide();
    renderImages();
    toast("配图已上传", "success");
  }

  async function loadTalks() {
    const listEl = listCard.querySelector("#talk-list");
    try {
      const raw = await ctx.api.readFile(TALKS_PATH);
      const data = loadYaml(raw) || {};
      items = Array.isArray(data.items) ? data.items.slice() : [];
    } catch (e) {
      handleErr(e);
      items = [];
    }
    items.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
    listCard.querySelector("#talk-total").textContent = `共 ${items.length} 条`;
    if (!items.length) {
      listEl.innerHTML = `<div class="empty">${ic("talk")}<p>还没有说说，在上面发布第一条吧</p></div>`;
      return;
    }
    listEl.innerHTML = "";
    for (const item of items) {
      const imgs = Array.isArray(item.images)
        ? item.images.map((x) => (typeof x === "string" ? x : x && x.image)).filter(Boolean)
        : [];
      const node = el(`<div class="timeline-item">
          <div class="card" style="margin-bottom:0">
            <div class="flex" style="margin-bottom:.4rem">
              <span class="badge badge-primary">${ic("clock")}${esc(fmtTime(item.date))}</span>
              <div class="spacer"></div>
              <button class="icon-btn act-edit" title="编辑">${ic("edit")}</button>
              <button class="icon-btn danger act-del" title="删除">${ic("trash")}</button>
            </div>
            <div class="talk-content">${renderInlineMd(item.content)}</div>
            ${imgs.length ? `<div class="talk-images" style="margin-top:.6rem">${imgs.map((s) => `<img src="${esc(s)}" style="max-width:150px;border-radius:.6rem;cursor:zoom-in" loading="lazy" />`).join("")}</div>` : ""}
          </div>
        </div>`);
      node.querySelectorAll(".talk-content img, .talk-images img").forEach((img) => {
        img.addEventListener("click", () => lightbox(img.src));
      });
      node.querySelector(".act-del").addEventListener("click", async () => {
        const ok = await confirmDialog({
          title: "删除说说",
          text: "确定删除这条说说？（提交到仓库后 Netlify 会重新构建）",
          okLabel: "删除",
          danger: true,
        });
        if (!ok) return;
        loading.show("正在删除…");
        try {
          items = items.filter((x) => x !== item);
          await saveItems(`Delete Talk by Qexo`);
          toast("说说已删除", "success");
          await loadTalks();
        } catch (err) { handleErr(err); }
        loading.hide();
      });
      node.querySelector(".act-edit").addEventListener("click", () => {
        // 载入到快发框（编辑模式）
        editing = item;
        if (vditor) vditor.setValue(String(item.content || ""));
        timeInput.value = String(item.date || "").replace(" ", "T");
        images = imgs.map((s) => ({ name: s.split("/").pop(), preview: s, publicPath: s }));
        renderImages();
        composerCard.querySelector("#talk-publish").innerHTML = `${ic("save")}保存修改`;
        composerCard.scrollIntoView({ behavior: "smooth" });
        toast("已载入编辑模式，修改后点「保存修改」", "info");
      });
      listEl.appendChild(node);
    }
  }

  let editing = null;

  async function saveItems(message) {
    const data = { items };
    // 保留 talks.yml 中 items 之外的原有键
    try {
      const raw = await ctx.api.readFile(TALKS_PATH);
      const parsed = loadYaml(raw) || {};
      const rest = { ...parsed };
      delete rest.items;
      const merged = { ...rest, ...data };
      await ctx.api.writeFile(TALKS_PATH, dumpYaml(merged), message);
    } catch (e) {
      if (e.status === 404) await ctx.api.writeFile(TALKS_PATH, dumpYaml(data), message);
      else throw e;
    }
  }

  composerCard.querySelector("#talk-publish").addEventListener("click", async () => {
    const content = vditor ? vditor.getValue() : "";
    if (!String(content).trim()) {
      toast("先写点什么吧", "error");
      return;
    }
    const time = timeInput.value ? timeInput.value.replace("T", " ") : "";
    loading.show(editing ? "正在保存…" : "正在发布…");
    try {
      const itemData = {
        date: time || undefined,
        content: String(content),
        images: images.map((x) => x.publicPath),
      };
      if (editing) {
        const idx = items.indexOf(editing);
        if (idx >= 0) items[idx] = { ...items[idx], ...itemData };
      } else {
        items.push(itemData);
      }
      await saveItems(editing ? "Edit Talk by Qexo" : "New Talk by Qexo");
      loading.hide();
      toast(editing ? "说说已更新" : "说说已发布，Netlify 构建已触发", "success");
      editing = null;
      vditor.setValue("");
      images = [];
      renderImages();
      composerCard.querySelector("#talk-publish").innerHTML = `${ic("deploy")}发布说说`;
      await loadTalks();
    } catch (e) {
      loading.hide();
      handleErr(e);
    }
  });

  /* ---------- 初始化编辑器 ---------- */

  try {
    await ensureVditorLibFor();
    vditor = new window.Vditor(composerCard.querySelector("#talk-editor"), {
      cdn: "/admin/vendor/vditor",
      lang: "zh_CN",
      icon: "ant",
      mode: "ir",
      height: 200,
      cache: false,
      toolbar: ["headings", "bold", "italic", "|", "emoji", "link", "|", "undo", "redo", "|", "fullscreen"],
      placeholder: "此刻的想法…",
      value: "",
      input: () => {},
    });
  } catch (e) {
    composerCard.querySelector("#talk-editor").innerHTML =
      `<textarea class="input" rows="4" id="talk-fallback"></textarea>`;
  }

  // 统一的图片上传入口（页面拖拽 / 编辑器内部共用）
  ctx.pagesUpload = async (fileObj) => {
    const name = (fileObj.name || "image.png").replace(/[^\w\u4e00-\u9fa5.-]+/g, "-");
    const finalName = Date.now() + "-" + name;
    const path = "source/images/uploads/" + finalName;
    await ctx.api.uploadFile(path, fileObj, `Upload Image ${finalName} by Qexo`);
    const preview = ctx.api.mode === "demo" && /\.svg$/.test(name)
      ? ctx.api.mediaUrl(path)
      : "/images/uploads/" + finalName;
    return { name, path, publicPath: "/images/uploads/" + finalName, preview };
  };

  await loadTalks();
}
