/* pages/editor.js — 文章/页面编辑器：Vditor + front-matter 侧栏（Qexo 同款布局） */

import {
  ic, esc, el, toast, loading, confirmDialog,
} from "../app.js?v=4.4.0";
import {
  splitFrontMatter, buildFrontMatter, toInputDate, fromInputDate,
  nowLocal, extractExcerpt,
} from "../yaml.js?v=4.4.0";
import { ensureVditorLib, getVditorBase } from "./editor-shared.js?v=4.4.0";
import { uploadImage, runUploadQueue } from "../upload.js?v=4.4.0";
import { invalidatePostsCache, setPostOverride } from "./posts.js?v=4.4.0";

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

  view.innerHTML = "";

  const grid = el(`<div class="grid-editor">
      <div class="card editor-card" style="margin-bottom:0">
        <div class="editor-boot" id="ed-boot">正在加载编辑器组件（首次约几秒，之后走缓存）…</div>
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

  let vditor = null;
  let fallbackTa = null;
  let watchdog = null;
  const editorEl = grid.querySelector("#vditor");
  const bootEl = grid.querySelector("#ed-boot");
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

  function clearWatchdog() {
    if (watchdog) { clearTimeout(watchdog); watchdog = null; }
  }
  function dropBoot() {
    if (bootEl && bootEl.parentNode) bootEl.remove();
  }

  const PLAIN_HINT = "已切换为纯文本模式，Markdown 内容仍可正常编辑与保存。";

  /**
   * 纯文本编辑区。它不只是「失败兜底」：页面一进来就先渲染它，
   * 保证任何时候都能立刻写，引擎就绪后再升级成富文本（见 upgrade）。
   */
  function mountPlain(reason, opts = {}) {
    clearWatchdog();
    dropBoot();
    const current = getContent();
    try { if (vditor && vditor.destroy) vditor.destroy(); } catch (_) { /* ignore */ }
    vditor = null;
    fallbackTa = null;
    editorEl.innerHTML = "";

    const box = el(`<div class="editor-fallback"></div>`);
    if (reason) {
      box.appendChild(el(
        `<div class="hint${opts.tone === "info" ? " is-info" : ""}">${esc(reason)}</div>`
      ));
    }
    if (opts.retry !== false) {
      const actions = el(`<div class="editor-fallback-actions"></div>`);
      const retryBtn = el(`<button class="btn btn-ghost" type="button">重新加载编辑器</button>`);
      retryBtn.addEventListener("click", () => { box.remove(); upgrade(); });
      actions.appendChild(retryBtn);
      box.appendChild(actions);
    }

    const ta = el(`<textarea class="input" rows="18" style="width:100%;margin-top:.6rem"></textarea>`);
    ta.value = current;
    ta.addEventListener("input", () => markDirty());
    box.appendChild(ta);

    editorEl.appendChild(box);
    fallbackTa = ta;
    if (!opts.silent) {
      toast(reason, opts.tone === "info" ? "info" : "error", 6000);
    }
  }

  let upgrading = false;

  /** 后台加载引擎；成功就把纯文本里的内容搬进 Vditor，失败则留在纯文本模式 */
  async function upgrade() {
    if (upgrading) return;
    upgrading = true;
    try {
      await ensureVditorLib();
      if (!view.isConnected) return; // 页面已切走，别再初始化
      const initial = getContent();
      try { if (vditor && vditor.destroy) vditor.destroy(); } catch (_) { /* ignore */ }
      vditor = null;
      fallbackTa = null;
      editorEl.innerHTML = "";

      try {
        vditor = new window.Vditor(editorEl, {
          cdn: getVditorBase(),
          lang: "zh_CN",
          icon: "ant",
          mode: "ir",
          height: Math.max(480, Math.min(720, window.innerHeight - 340)),
          cache: false,
          value: initial,
          placeholder: "开始写点什么吧…（支持 Markdown / 粘贴 / 拖拽图片）",
          preview: { theme: { path: getVditorBase() + "/dist/css/content-theme" } },
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
          after: () => { clearWatchdog(); dropBoot(); },
        });
      } catch (e) {
        mountPlain("编辑器初始化失败：" + ((e && e.message) || e) + "。" + PLAIN_HINT, { tone: "error" });
        return;
      }

      // 结果检测：Vditor 的正文渲染挂在异步链上（要等 Markdown 引擎），
      // 主程序不报错也可能一直空着；15 秒还没生成 .vditor 就退回纯文本。
      clearWatchdog();
      watchdog = setTimeout(() => {
        if (!editorEl.querySelector(".vditor")) {
          mountPlain("编辑器组件在 15 秒内未完成渲染。" + PLAIN_HINT, { tone: "error" });
        }
      }, 15000);
    } catch (e) {
      if (!view.isConnected) return;
      mountPlain("编辑器组件加载失败：" + ((e && e.message) || e) + "。" + PLAIN_HINT, { tone: "error" });
    } finally {
      upgrading = false;
    }
  }

  // 先给能立刻输入的纯文本，引擎在后台加载；就绪后自动升级成富文本
  mountPlain("正在加载富文本编辑器（首次约 1–2 秒）…网络较慢时可直接在下方用 Markdown 写作，不影响保存；就绪后自动切换。", {
    tone: "info",
    silent: true,
    retry: false,
  });
  upgrade();

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
      const entryFields = { name: origPath.split("/").pop(), path: origPath, size: content.length, title: String(fm.title || ""), date: String(fm.date || ""), updated: String(fm.updated || ""), sticky: fm.sticky == null ? null : Number(fm.sticky) || 0, tags: Array.isArray(fm.tags) ? fm.tags.map(String) : [], categories: Array.isArray(fm.categories) ? fm.categories.map(String) : [], password: Boolean(String(fm.password || "")), permalink: String(fm.permalink || ""), abbrlink: String(fm.abbrlink || "") };
      setPostOverride(origPath, entryFields);
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
