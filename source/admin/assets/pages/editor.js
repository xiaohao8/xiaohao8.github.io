/* pages/editor.js — 文章/页面编辑器：Vditor + front-matter 侧栏（Qexo 同款布局） */

import {
  ic, esc, el, toast, loading, confirmDialog,
} from "../app.js?v=4.1.3";
import {
  splitFrontMatter, buildFrontMatter, toInputDate, fromInputDate,
  nowLocal, extractExcerpt,
} from "../yaml.js?v=4.1.3";
import { ensureVditorLib, VDITOR_BASE } from "./editor-shared.js?v=4.1.3";
import { uploadImage, runUploadQueue } from "../upload.js?v=4.1.3";
import { invalidatePostsCache } from "./posts.js?v=4.1.3";

export default async function editor(view, ctx, params, handleErr) {
  const isPage = location.hash.startsWith("#/editpage");
  const file = params.get("file") || "";
  const isNew = params.get("new") === "1" || params.get("newpage") === "1";

  if (!isNew && !file) {
    view.appendChild(el(`<div class="card"><div class="empty">${ic("alert")}<p>缺少文件参数（?file=…）</p></div></div>`));
    return;
  }

  view.innerHTML = "";
  view.appendChild(el(`<div class="inline-loading"><span class="ring"></span>正在加载编辑器…</div>`));

  let fm = {};
  let body = "";
  let origPath = file;
  try {
    if (!isNew) {
      const text = await ctx.api.readFile(file, { fresh: true });
      const split = splitFrontMatter(text);
      fm = split.data;
      body = split.body;
    } else {
      fm = {
        title: isPage ? "" : params.get("title") || "",
        date: nowLocal(),
        updated: nowLocal(),
        comments: true,
      };
      if (isPage) fm.layout = "page";
      body = "";
    }
  } catch (e) {
    handleErr(e);
    view.innerHTML = "";
    view.appendChild(el(`<div class="card"><div class="empty">${ic("alert")}<p>${esc(e.message)}</p></div></div>`));
    return;
  }

  await ensureVditorLib();

  view.innerHTML = "";

  const grid = el(`<div class="grid-editor">
      <div class="card editor-card" style="margin-bottom:0">
        <div id="vditor"></div>
        <div class="editor-footer">
          <button class="btn btn-ghost" id="ed-back">${ic("chevron-r")}返回列表</button>
          <span class="save-state" id="ed-state">${ic("check")}已保存（与远端一致）</span>
          <div class="spacer"></div>
          <button class="btn" id="ed-excerpt">${ic("info")}自动摘要</button>
          <button class="btn btn-primary" id="ed-save">${ic("save")}保存并发布</button>
        </div>
      </div>
      <div>
        <div class="card fm-card" style="position:sticky;top:5.2rem">
          <div class="card-header">${ic("edit")}<h2>${isPage ? "页面属性" : "文章属性"}</h2></div>
          <div class="fm-list" id="fm-list"></div>
        </div>
      </div>
    </div>`);
  view.appendChild(grid);

  const stateEl = grid.querySelector("#ed-state");
  const fmList = grid.querySelector("#fm-list");

  /* ---------- front-matter 表单 ---------- */

  const fields = [];
  function addField({ key, label, type = "text", hint = "", required = false, value }) {
    fields.push({ key, label, type, hint, required, value: value !== undefined ? value : fm[key] });
  }
  function addPills(key, label) {
    fields.push({ key, label, type: "pills", value: Array.isArray(fm[key]) ? fm[key].map(String) : (fm[key] ? [String(fm[key])] : []) });
  }

  if (isPage) {
    addField({ key: "title", label: "标题", required: true });
    addField({ key: "subtitle", label: "副标题" });
    addField({ key: "banner_img", label: "顶部图", hint: "图片 URL，留空使用主题默认" });
    addField({ key: "comments", label: "开启评论", type: "switch", value: fm.comments !== false });
  } else {
    addField({ key: "title", label: "标题", required: true });
    addField({ key: "date", label: "发布日期", type: "datetime" });
    addField({ key: "updated", label: "更新日期", type: "datetime" });
    addPills("tags", "标签");
    addPills("categories", "分类");
    addField({ key: "sticky", label: "置顶权重", hint: "数字越大越靠前，留空表示不置顶" });
    addField({ key: "excerpt", label: "摘要", type: "textarea", hint: "留空时保存会自动按正文截取" });
    addField({ key: "banner_img", label: "顶部图", hint: "图片 URL，留空使用主题默认" });
    addField({ key: "index_img", label: "文章封面", hint: "首页/列表封面图 URL" });
    addField({ key: "keywords", label: "SEO 关键词", hint: "逗号分隔" });
    addField({ key: "password", label: "访问密码", hint: "留空为公开文章" });
    addField({ key: "comments", label: "开启评论", type: "switch", value: fm.comments !== false });
    addField({ key: "permalink", label: "永久链接", hint: "留空按 abbrlink 规则生成" });
  }

  const abbrlink = fm.abbrlink;

  function renderFm() {
    fmList.innerHTML = "";
    for (const f of fields) {
      const row = el(`<div class="fm-row">
          <label>${esc(f.label)}${f.required ? '<span class="req">*</span>' : ""}</label>
        </div>`);
      if (f.type === "textarea") {
        row.appendChild(el(`<textarea class="input" rows="3" data-key="${f.key}">${esc(f.value || "")}</textarea>`));
      } else if (f.type === "datetime") {
        const inp = el(`<input class="input" type="datetime-local" step="1" data-key="${f.key}" />`);
        inp.value = toInputDate(f.value);
        row.appendChild(inp);
      } else if (f.type === "switch") {
        const sw = el(`<label class="switch">
            <input type="checkbox" data-key="${f.key}" ${f.value ? "checked" : ""} />
            <span class="track"></span><span class="lbl small muted">启用</span>
          </label>`);
        row.appendChild(sw);
      } else if (f.type === "pills") {
        const pills = el(`<div class="pills" data-key="${f.key}"></div>`);
        const renderPills = () => {
          pills.innerHTML = "";
          for (const v of f.value) {
            const p = el(`<span class="pill">${esc(v)}<span class="x">${ic("close")}</span></span>`);
            p.querySelector(".x").addEventListener("click", () => {
              f.value = f.value.filter((x) => x !== v);
              markDirty();
              renderPills();
            });
            pills.appendChild(p);
          }
          const addBtn = el(`<span class="pill-add">${ic("plus")}添加</span>`);
          addBtn.addEventListener("click", () => {
            const input = el(`<input class="pill-input" placeholder="回车确认" />`);
            pills.replaceChild(input, addBtn);
            input.focus();
            const commit = () => {
              const v = input.value.trim();
              if (v && !f.value.includes(v)) { f.value.push(v); markDirty(); }
              renderPills();
            };
            input.addEventListener("keydown", (e) => {
              if (e.key === "Enter") { e.preventDefault(); commit(); }
              if (e.key === "Escape") renderPills();
            });
            input.addEventListener("blur", commit);
          });
          pills.appendChild(addBtn);
        };
        renderPills();
        row.appendChild(pills);
      } else {
        row.appendChild(el(`<input class="input" type="text" data-key="${f.key}" value="${esc(f.value == null ? "" : f.value)}" />`));
      }
      if (f.hint) row.appendChild(el(`<div class="hint">${esc(f.hint)}</div>`));
      fmList.appendChild(row);
    }
    if (!isPage && abbrlink) {
      fmList.appendChild(el(`<div class="fm-row">
          <label>abbrlink（只读）</label>
          <div class="fm-readonly" title="${esc(abbrlink)}">${esc(abbrlink)}</div>
        </div>`));
    }
  }
  renderFm();

  function collectFm() {
    for (const f of fields) {
      if (f.type === "pills") {
        fm[f.key] = f.value.length ? [...f.value] : undefined;
        continue;
      }
      const node = fmList.querySelector(`[data-key="${f.key}"]`);
      if (!node) continue;
      if (f.type === "switch") {
        fm[f.key] = node.checked;
        continue;
      }
      if (f.type === "datetime") {
        const v = node.value ? fromInputDate(node.value) : "";
        fm[f.key] = v || undefined;
        continue;
      }
      const v = String(node.value || "").trim();
      fm[f.key] = v || undefined;
      if (f.key === "keywords" && v) {
        fm.keywords = v.split(/[,，]/).map((s) => s.trim()).filter(Boolean);
      }
    }
    // 数值字段
    if (fm.sticky != null) fm.sticky = Number(fm.sticky) || undefined;
    // 清掉 undefined（buildFrontMatter 也会过滤）
    for (const k of Object.keys(fm)) if (fm[k] === undefined) delete fm[k];
    return fm;
  }

  /* ---------- Vditor ---------- */

  let vditor;
  let fallbackTa = null;
  const editorEl = grid.querySelector("#vditor");
  const getContent = () => vditor ? vditor.getValue() : (fallbackTa ? fallbackTa.value : body);

  const toolbarConfig = [
    "headings", "bold", "italic", "strike", "|",
    "list", "ordered-list", "check", "quote", "|",
    "link", "table", "code", "inline-code", "|",
    "upload", "line", "|",
    "undo", "redo", "|",
    "fullscreen", "edit-mode", {
      name: "more",
      toolbar: ["insert-after", "|", "both", "code-theme", "content-theme", "export", "outline", "preview", "info", "help"],
    },
  ];

  try {
    vditor = new window.Vditor(editorEl, {
      cdn: VDITOR_BASE,
      lang: "zh_CN",
      icon: "ant",
      mode: "ir",
      height: Math.max(480, Math.min(720, window.innerHeight - 340)),
      cache: false,
      value: body,
      placeholder: "开始写点什么吧…（支持 Markdown / 粘贴 / 拖拽图片）",
      preview: { theme: { path: VDITOR_BASE + "/dist/css/content-theme" } },
      toolbar: toolbarConfig,
      counter: { enable: true },
      upload: {
        accept: "image/*",
        multiple: true,
        async handler(files) {
          await uploadFiles(files);
          return null;
        },
      },
      input: () => markDirty(),
    });
  } catch (e) {
    handleErr(e);
    fallbackTa = el(`<textarea class="input" rows="18" style="width:100%"></textarea>`);
    fallbackTa.value = body;
    fallbackTa.addEventListener("input", markDirty);
    editorEl.innerHTML = "";
    editorEl.appendChild(fallbackTa);
  }

  /* ---------- 图片上传 ---------- */

  async function uploadFiles(fileList) {
    const { ok } = await runUploadQueue(fileList, (f) => uploadImage(ctx, f));
    if (ok.length && vditor) {
      const md = ok.map((r) => `![${r.publicPath.split("/").pop().replace(/^\d+-/, "")}](${r.publicPath})`).join("\n\n");
      if (vditor.getSelection && vditor.getSelection()) vditor.insertValue(md);
      else vditor.insertValue("\n" + md + "\n");
      markDirty();
      toast(`已上传 ${ok.length} 张图片`, "success");
    }
  }

  /* ---------- 状态 / 保存 ---------- */

  function markDirty() {
    ctx.setDirty(true);
    stateEl.classList.add("dirty");
    stateEl.innerHTML = `${ic("info")}有未保存的修改`;
  }
  function markClean() {
    ctx.setDirty(false);
    stateEl.classList.remove("dirty");
    stateEl.innerHTML = `${ic("check")}已保存（与远端一致）`;
  }

  // fm 表单变更也标记脏
  fmList.addEventListener("change", markDirty);
  fmList.addEventListener("click", (e) => {
    if (e.target.closest(".pill .x") || e.target.closest(".pill-add")) markDirty();
  });

  /** 新建文章/页面时按标题生成路径；同名已存在则加时间戳，避免覆盖 */
  async function makeNewPath() {
    const title = String(fm.title || "").trim();
    const base = title.replace(/[^\w\u4e00-\u9fa5-]+/g, "-")
      .replace(/-+/g, "-").replace(/^-|-$/g, "") || (isPage ? "page" : "post");
    const path = isPage ? "source/" + base + "/index.md" : "source/_posts/" + base + ".md";
    try {
      await ctx.api.readFile(path, { fresh: true });
      return isPage
        ? "source/" + base + "-" + Date.now() + "/index.md"
        : "source/_posts/" + base + "-" + Date.now() + ".md";
    } catch (e) {
      if (e.status === 404 || ctx.demo) return path;
      throw e;
    }
  }

  async function doSave() {
    collectFm();
    const title = String(fm.title || "").trim();
    if (!title) {
      toast("请填写标题", "error");
      return;
    }
    // 自动摘要
    if (!isPage && !fm.excerpt) {
      const ex = extractExcerpt(getContent());
      if (ex) fm.excerpt = ex;
    }
    if (!isPage && !fm.updated) fm.updated = nowLocal();

    const content = buildFrontMatter(fm, getContent());
    const msg = isPage
      ? `Update Page ${title} by Qexo`
      : `Save Post ${title} by Qexo`;
    loading.show("正在保存到 GitHub…");
    try {
      if (!origPath) origPath = await makeNewPath();
      await ctx.api.writeFile(origPath, content, msg);
      markClean();
      loading.hide();
      toast(isPage ? "页面已保存，Netlify 构建已触发" : "文章已保存，Netlify 构建已触发", "success");
      invalidatePostsCache();
      // 更新浏览器地址（新文件 → 指向真实 file）
      if (isNew) {
        history.replaceState(null, "", (isPage ? "#/editpage?file=" : "#/edit?file=") + encodeURIComponent(origPath));
      }
    } catch (e) {
      loading.hide();
      handleErr(e);
    }
  }

  grid.querySelector("#ed-save").addEventListener("click", doSave);

  const onSaveKey = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      doSave();
    }
  };
  document.addEventListener("keydown", onSaveKey);
  ctx._onLeave = () => {
    document.removeEventListener("keydown", onSaveKey);
    if (vditor && vditor.destroy) vditor.destroy();
  };

  grid.querySelector("#ed-excerpt").addEventListener("click", () => {
    const ex = extractExcerpt(getContent());
    if (!ex) { toast("正文为空，无法生成摘要", "error"); return; }
    const f = fields.find((x) => x.key === "excerpt");
    if (f) {
      const node = fmList.querySelector('[data-key="excerpt"]');
      if (node) node.value = ex;
      markDirty();
      toast("已生成摘要", "success");
    } else toast("页面编辑器不支持摘要", "info");
  });

  grid.querySelector("#ed-back").addEventListener("click", async () => {
    if (ctx.dirty) {
      const ok = await confirmDialog({
        title: "未保存的修改",
        text: "有未保存的修改，确定离开？",
        okLabel: "离开",
        danger: true,
      });
      if (!ok) return;
      ctx.setDirty(false);
    }
    location.hash = isPage ? "#/pages" : "#/posts";
  });
}
