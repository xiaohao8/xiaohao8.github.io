/* app.js — Qexo 风格后台入口：会话 / 路由 / 骨架 / 通用 UI */

import { GitHubAPI, setMediaConfig, mediaFallbackUrls } from "./github.js?v=4.4.2";
import { NetlifyAPI } from "./netlify.js?v=4.4.2";
import { DemoAPI } from "./demo.js?v=4.4.2";

export const VERSION = "4.4.2";
export const ADMIN_TITLE = "醉里博客";

const LS_SESSION = "qexo4_session";
const LS_SETTINGS = "qexo4_settings";
const DEFAULT_SETTINGS = {
  owner: "xiaohao8",
  repo: "xiaohao8.github.io",
  branch: "main",
  siteUrl: "https://202271.xyz",
  netlify: { siteId: "", token: "", buildHook: "" },
  apiBase: "auto",
  vendorSource: "auto",
  imageSource: {
    type: "gitee",
    giteeOwner: "xiaohao3",
    giteeRepo: "xiaohao8.github.io",
    giteeBranch: "main",
    customPrefix: "",
  },
};

/* ============ 存取 ============ */

export const store = {
  getSettings() {
    try {
      const raw = localStorage.getItem(LS_SETTINGS);
      const s = raw ? JSON.parse(raw) : {};
      return {
        ...DEFAULT_SETTINGS,
        ...s,
        netlify: { ...DEFAULT_SETTINGS.netlify, ...(s.netlify || {}) },
        imageSource: { ...DEFAULT_SETTINGS.imageSource, ...(s.imageSource || {}) },
        apiBase: s.apiBase || "auto",
        vendorSource: s.vendorSource || "auto",
      };
    } catch (_) {
      return { ...DEFAULT_SETTINGS };
    }
  },
  saveSettings(s) {
    localStorage.setItem(LS_SETTINGS, JSON.stringify(s));
  },
  getSession() {
    try {
      return (
        JSON.parse(sessionStorage.getItem(LS_SESSION) || "") ||
        JSON.parse(localStorage.getItem(LS_SESSION) || "") ||
        null
      );
    } catch (_) {
      try { return JSON.parse(localStorage.getItem(LS_SESSION) || "") || null; } catch (_) { return null; }
    }
  },
  saveSession(sess, remember) {
    if (remember) localStorage.setItem(LS_SESSION, JSON.stringify(sess));
    else sessionStorage.setItem(LS_SESSION, JSON.stringify(sess));
  },
  clearSession() {
    localStorage.removeItem(LS_SESSION);
    sessionStorage.removeItem(LS_SESSION);
  },
};

/* ============ 通用 UI ============ */

export function ic(name, cls = "") {
  return `<svg class="ic ${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
}

export function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** 仅允许 http(s) 链接，拦截 javascript: 等协议；非法返回 "" */
export function safeHttpUrl(u) {
  const s = String(u == null ? "" : u).trim();
  return /^https?:\/\//i.test(s) ? s : "";
}

/** 图片地址：http(s) / 站内绝对路径 / data:image，其余返回 "" */
export function safeImgUrl(u) {
  const s = String(u == null ? "" : u).trim();
  if (/^https?:\/\//i.test(s) || /^\/[^/]/.test(s) || /^data:image\//i.test(s)) return s;
  return "";
}

export function el(html) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export function fmtSize(n) {
  if (n == null) return "-";
  if (n < 1024) return n + " B";
  if (n < 1048576) return (n / 1024).toFixed(1) + " KB";
  return (n / 1048576).toFixed(2) + " MB";
}

export function fmtTime(s) {
  if (!s) return "-";
  const d = typeof s === "number" ? new Date(s * 1000) : new Date(String(s).replace(" ", "T"));
  if (isNaN(d.getTime())) return String(s);
  const p = (n) => (n < 10 ? "0" + n : "" + n);
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function fmtAgo(s) {
  if (!s) return "";
  const d = typeof s === "number" ? new Date(s * 1000) : new Date(String(s).replace(" ", "T"));
  const diff = (Date.now() - d.getTime()) / 1000;
  if (isNaN(diff)) return "";
  if (diff < 60) return "刚刚";
  if (diff < 3600) return Math.floor(diff / 60) + " 分钟前";
  if (diff < 86400) return Math.floor(diff / 3600) + " 小时前";
  if (diff < 86400 * 30) return Math.floor(diff / 86400) + " 天前";
  return fmtTime(s).slice(0, 10);
}

/* ---------- Toast ---------- */

let toastBox = null;
export function toast(msg, type = "info", ms = 3200) {
  if (!toastBox) {
    toastBox = el(`<div class="toast-box" role="status" aria-live="polite"></div>`);
    document.body.appendChild(toastBox);
  }
  const iconName = type === "success" ? "check" : type === "error" ? "alert" : "info";
  const t = el(`<div class="toast ${type}">${ic(iconName)}<span>${esc(msg)}</span></div>`);
  toastBox.appendChild(t);
  setTimeout(() => {
    t.style.transition = "opacity .25s, transform .25s";
    t.style.opacity = "0";
    t.style.transform = "translateY(6px)";
    setTimeout(() => t.remove(), 260);
  }, ms);
}

/* ---------- 加载遮罩 ---------- */

let loadingEl = null;
export const loading = {
  show(text = "正在处理…") {
    if (!loadingEl) {
      loadingEl = el(`<div class="loading-overlay"><div class="boot-spinner"><span></span></div><p></p></div>`);
      document.body.appendChild(loadingEl);
    }
    loadingEl.querySelector("p").textContent = text;
    loadingEl.style.display = "flex";
  },
  hide() {
    if (loadingEl) loadingEl.style.display = "none";
  },
};

/* ---------- 弹窗 ---------- */

export function modal({ title, body, actions = [], wide = false, onClose }) {
  const ov = el(`<div class="modal-overlay">
      <div class="modal ${wide ? "wide" : ""}">
        <div class="modal-head"><h3>${esc(title)}</h3><button class="icon-btn" data-close>${ic("close")}</button></div>
        <div class="modal-body"></div>
        <div class="modal-foot"></div>
      </div>
    </div>`);
  const bodyEl = ov.querySelector(".modal-body");
  if (typeof body === "string") bodyEl.innerHTML = body;
  else bodyEl.appendChild(body);
  const foot = ov.querySelector(".modal-foot");
  for (const a of actions) {
    const b = el(`<button class="btn ${a.cls || "btn-neutral"}">${a.icon ? ic(a.icon) : ""}${esc(a.label)}</button>`);
    b.addEventListener("click", async () => {
      if (a.onClick) {
        const keep = await a.onClick(ov);
        if (!keep) ov.remove();
      } else ov.remove();
    });
    foot.appendChild(b);
  }
  if (!actions.length) foot.style.display = "none";
  ov.querySelector("[data-close]").addEventListener("click", () => ov.remove());
  ov.addEventListener("click", (e) => { if (e.target === ov) ov.remove(); });
  document.body.appendChild(ov);
  return ov;
}

export function confirmDialog({ title = "确认操作", text, okLabel = "确认", danger = false }) {
  return new Promise((resolve) => {
    const ov = modal({
      title,
      body: `<p style="margin:0;color:var(--text)">${esc(text)}</p>`,
      actions: [
        { label: "取消", onClick: () => resolve(false) },
        { label: okLabel, cls: danger ? "btn-danger" : "btn-primary", onClick: () => resolve(true) },
      ],
    });
    new MutationObserver((_, obs) => {
      if (!document.body.contains(ov)) { obs.disconnect(); resolve(false); }
    }).observe(document.body, { childList: true });
  });
}

/**
 * 按上下文取预览候选链：演示模式用本地 data URI；
 * 真实模式按当前预览源 → Gitee → 本站相对 → 本站绝对 → 自定义前缀依次兜底。
 */
export function previewSrcsFor(ctx, path) {
  if (ctx && ctx.api && ctx.api.mode === "demo") return [ctx.api.mediaUrl(path)];
  return mediaFallbackUrls(path);
}

/* ---------- 图片兜底加载 ---------- */

/**
 * 创建带候选源兜底的 <img>：依次尝试 srcs，全部失败时标记 data-failed 并触发 onFail。
 * Gitee 主力预览场景：Gitee 没同步上时自动切回本站。
 */
export function imgWithFallback(srcs, { cls = "", alt = "", onFail } = {}) {
  const img = document.createElement("img");
  img.loading = "lazy";
  img.referrerPolicy = "no-referrer";
  img.alt = alt;
  if (cls) img.className = cls;
  const list = (srcs || []).filter(Boolean);
  let i = 0;
  const fail = () => {
    img.onerror = null;
    img.dataset.failed = "1";
    if (onFail) onFail(img);
  };
  img.onerror = () => {
    i += 1;
    if (i < list.length) img.src = list[i];
    else fail();
  };
  if (list.length) img.src = list[0];
  else fail();
  return img;
}

/* ---------- 图标弹层 ---------- */

export function lightbox(src) {
  const box = el(`<div class="lightbox"><img alt="preview" /></div>`);
  box.querySelector("img").src = safeImgUrl(src);
  box.addEventListener("click", () => box.remove());
  document.body.appendChild(box);
}

/* ---------- 复制 ---------- */

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast("已复制到剪贴板", "success", 1800);
  } catch (_) {
    const ta = el(`<textarea readonly style="position:fixed;left:-9999px">${esc(text)}</textarea>`);
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
    toast("已复制到剪贴板", "success", 1800);
  }
}

/* ============ 应用 ============ */

let ctx = null;

function createApi(session, settings) {
  if (session && session.mode === "demo") return new DemoAPI(settings);
  return new GitHubAPI(session.token, settings);
}

function buildContext(session) {
  const settings = store.getSettings();
  // 图片预览源（Gitee 主力）注入
  setMediaConfig({ ...settings.imageSource, siteUrl: settings.siteUrl });
  const api = createApi(session, settings);
  const nl = new NetlifyAPI(settings);
  return {
    session,
    settings,
    api,
    nl,
    demo: session && session.mode === "demo",
    dirty: false,
    setDirty(v) { this.dirty = v; },
  };
}

function handleErr(e) {
  if (e && e.rateLimited) {
    const wait = e.retryAfter ? `，请 ${e.retryAfter} 秒后再试` : "，请稍后再试";
    toast("GitHub API 请求已限流" + wait, "error", 6000);
    return;
  }
  if (e && (e.status === 401 || e.status === 403)) {
    toast("登录状态已失效（" + (e.message || "") + "），请重新登录", "error", 5000);
    store.clearSession();
    endSession();
    renderLogin();
    return;
  }
  toast((e && e.message) || "操作失败", "error", 4200);
}

/** 结束当前会话：触发页面清理钩子，停止路由 */
function endSession() {
  runLeave(ctx);
  ctx = null;
}

function runLeave(c) {
  if (c && typeof c._onLeave === "function") {
    try { c._onLeave(); } catch (_) { /* ignore */ }
  }
  if (c) c._onLeave = null;
  // 关闭遗留的悬浮模态（模态挂 body 全局层，不在页面容器内）
  document.querySelectorAll("body > .modal-overlay").forEach((ov) => ov.remove());
}

/* ---------- 登录页 ---------- */

function renderLogin(prefillError) {
  document.title = ADMIN_TITLE + " · 登录";
  const params = new URLSearchParams(location.search);
  const demoHint = params.get("demo") === "1";
  const settings = store.getSettings();
  const remembered = store.getSession();

  const page = el(`<div class="login-page">
      <div class="login-card">
        <div class="login-brand">
          <div class="boot-logo">醉</div>
          <h1>${esc(ADMIN_TITLE)} · 内容后台</h1>
          <p>Qexo 风格工作台 · GitHub 直连 · Netlify 自动部署</p>
        </div>
        <div class="login-error" id="login-err">${ic("alert")}<span></span></div>
        <form id="login-form" novalidate>
          <div class="field">
            <label>GitHub 用户名</label>
            <div class="input-icon">${ic("user")}
              <input class="input" id="login-user" type="text" autocomplete="username"
                spellcheck="false" placeholder="xiaohao8" value="${esc(settings.owner)}" />
            </div>
          </div>
          <div class="field">
            <label>GitHub Token</label>
            <div class="input-icon">${ic("lock")}
              <input class="input input-mono" id="login-token" type="password"
                autocomplete="current-password" spellcheck="false" placeholder="github_pat_ / ghp_ 开头的令牌" />
            </div>
            <div class="hint">Fine-grained Token，仅授权 <b>${esc(settings.owner)}/${esc(settings.repo)}</b> 的 Contents 读写权限。生成步骤见 <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">GitHub Token 设置</a>。</div>
          </div>
          <label class="switch" style="margin-bottom:1.1rem">
            <input type="checkbox" id="login-remember" checked />
            <span class="track"></span>
            <span class="lbl">记住登录状态</span>
          </label>
          <button class="btn btn-primary btn-lg btn-block" id="login-submit" type="submit">${ic("github")} 登录工作台</button>
        </form>
        <div class="login-demo-row">
          <a href="#" id="login-demo">先看看演示模式（不连 GitHub）</a>
        </div>
        <p class="login-note">
          登录后所有操作都在你的浏览器与 GitHub 之间完成，Token 只保存在本机浏览器里。
          保存内容即提交到 ${esc(settings.branch)} 分支，Netlify 会自动构建发布。
        </p>
      </div>
    </div>`);

  const errBox = page.querySelector("#login-err");
  const errSpan = errBox.querySelector("span");
  if (prefillError) {
    errSpan.textContent = prefillError;
    errBox.classList.add("show");
  }
  if (remembered && remembered.mode !== "demo") {
    const note = el(`<p class="login-note" style="margin-top:0.6rem"><b>${esc(remembered.user ? remembered.user.name : "上次会话")}</b> 的登录状态已保存，本页仅供切换账号使用。</p>`);
    page.querySelector(".login-card").appendChild(note);
  }

  const form = page.querySelector("#login-form");
  const userInput = page.querySelector("#login-user");
  const tokenInput = page.querySelector("#login-token");
  const rememberInput = page.querySelector("#login-remember");
  const submitBtn = page.querySelector("#login-submit");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const owner = userInput.value.trim();
    const token = tokenInput.value.trim();
    if (!owner) return showErr("请输入 GitHub 用户名");
    if (!token) return showErr("请输入 GitHub Token");
    submitBtn.disabled = true;
    submitBtn.innerHTML = `正在校验…`;
    try {
      const s = { ...store.getSettings(), owner };
      const gh = new GitHubAPI(token, s);
      const user = await gh.validate();
      const sess = { mode: "github", token, user, at: Date.now() };
      store.saveSession(sess, rememberInput.checked);
      bootApp(sess, { justLoggedIn: true });
    } catch (err) {
      showErr(err.message || "登录失败，请检查网络与 Token");
      submitBtn.disabled = false;
      submitBtn.innerHTML = `${ic("github")} 登录工作台`;
    }
  });

  page.querySelector("#login-demo").addEventListener("click", (e) => {
    e.preventDefault();
    const sess = { mode: "demo", user: { login: "demo", name: "演示用户", avatar: "" }, at: Date.now() };
    store.saveSession(sess, false);
    bootApp(sess, { justLoggedIn: true });
  });

  function showErr(msg) {
    errSpan.textContent = msg;
    errBox.classList.add("show");
  }

  const app = document.getElementById("app");
  app.innerHTML = "";
  app.appendChild(page);
}

/* ---------- 骨架 ---------- */

const NAV = [
  { route: "/", icon: "home", label: "工作台" },
  { route: "/posts", icon: "post", label: "文章管理", group: "内容" },
  { route: "/pages", icon: "page", label: "页面管理", group: "内容" },
  { route: "/talks", icon: "talk", label: "说说", group: "内容" },
  { route: "/friends", icon: "friend", label: "友链", group: "内容" },
  { route: "/images", icon: "image", label: "图库", group: "站点" },
  { route: "/stats", icon: "eye", label: "访问统计", group: "站点" },
  { route: "/settings", icon: "settings", label: "设置", group: "站点" },
];

const ROUTE_TITLES = {
  "/": ["工作台", "站点概览与快捷操作"],
  "/posts": ["文章管理", "source/_posts"],
  "/edit": ["编辑文章", ""],
  "/pages": ["页面管理", "关于 / 友链 / 说说 / 朋友圈"],
  "/editpage": ["编辑页面", ""],
  "/talks": ["说说", "短内容时间线"],
  "/friends": ["友链管理", "fluid_config.yml"],
  "/images": ["图库", "source/images/uploads"],
  "/stats": ["访问统计", "自托管实时统计 / 近 30 天"],
  "/settings": ["设置", "仓库 / Netlify / 站点资料"],
};

function renderShell(c) {
  document.title = ADMIN_TITLE + " · 内容后台";
  const app = document.getElementById("app");
  app.innerHTML = "";
  const shell = el(`<div class="admin-shell">
      <aside class="sidenav" id="sidenav">
        <div class="sidenav-header">
          <div class="sidenav-logo">醉</div>
          <div class="sidenav-brand"><b>${esc(ADMIN_TITLE)}</b><span>Qexo 工作台 v${VERSION}</span></div>
        </div>
        <nav class="sidenav-body"><ul style="margin:0;padding:0"></ul></nav>
        <div class="sidenav-footer">
          <div class="sidenav-user">
            <div class="avatar" id="side-avatar"></div>
            <div class="meta"><b id="side-name"></b><span id="side-sub"></span></div>
            <button class="icon-btn" id="side-logout" title="退出登录">${ic("logout")}</button>
          </div>
        </div>
      </aside>
      <div class="sidenav-backdrop" id="sidenav-backdrop"></div>
      <main class="admin-main">
        <div class="topbar">
          <button class="icon-btn burger" id="top-burger">${ic("menu")}</button>
          <div class="topbar-title" id="top-title"></div>
          <div class="topbar-spacer"></div>
          <div class="topbar-actions" id="top-actions"></div>
        </div>
        <div id="view"></div>
      </main>
    </div>`);
  app.appendChild(shell);

  // 侧栏导航
  const navUl = shell.querySelector(".sidenav-body ul");
  let lastGroup = "";
  for (const item of NAV) {
    if (item.group && item.group !== lastGroup) {
      navUl.appendChild(el(`<li class="sidenav-label">${item.group}</li>`));
      lastGroup = item.group;
    }
    const li = el(`<li class="nav-item"><a class="nav-link2" href="#${item.route}">
        <span class="icon-shape">${ic(item.icon)}</span><span>${item.label}</span></a></li>`);
    li.dataset.route = item.route;
    navUl.appendChild(li);
  }

  // 用户信息
  const user = (c.session && c.session.user) || {};
  const avatar = shell.querySelector("#side-avatar");
  if (user.avatar) {
    const im = document.createElement("img");
    im.src = user.avatar;
    im.alt = "";
    im.referrerPolicy = "no-referrer";
    avatar.appendChild(im);
  } else avatar.textContent = (user.name || "U").slice(0, 1).toUpperCase();
  shell.querySelector("#side-name").textContent = user.name || "用户";
  shell.querySelector("#side-sub").textContent =
    c.demo ? "演示模式 · 数据为本地模拟" : "@" + (user.login || "");

  shell.querySelector("#side-logout").addEventListener("click", async () => {
    if (await confirmDialog({ title: "退出登录", text: "将清除本机保存的登录状态，确定退出？", okLabel: "退出", danger: true })) {
      store.clearSession();
      endSession();
      location.hash = "";
      renderLogin();
    }
  });

  // 移动端侧栏
  const sidenav = shell.querySelector("#sidenav");
  const backdrop = shell.querySelector("#sidenav-backdrop");
  const toggleSide = (open) => {
    sidenav.classList.toggle("open", open);
    backdrop.classList.toggle("show", open);
  };
  shell.querySelector("#top-burger").addEventListener("click", () => toggleSide(!sidenav.classList.contains("open")));
  backdrop.addEventListener("click", () => toggleSide(false));
  navUl.addEventListener("click", () => toggleSide(false));

  // 顶栏动作
  const actions = shell.querySelector("#top-actions");
  if (c.demo) {
    actions.appendChild(el(`<span class="chip"><span class="dot"></span>演示模式</span>`));
  }
  const deployBtn = el(`<button class="btn btn-primary btn-sm" id="top-deploy">${ic("deploy")}一键部署</button>`);
  deployBtn.addEventListener("click", async () => {
    if (!c.nl.buildHook) {
      toast("尚未配置 Netlify Build Hook，请到「设置」页填写", "info", 4200);
      location.hash = "#/settings";
      return;
    }
    deployBtn.disabled = true;
    try {
      await c.nl.triggerBuild();
      toast("已触发 Netlify 构建，稍后可在工作台查看部署状态", "success");
    } catch (e) {
      handleErr(e);
    }
    deployBtn.disabled = false;
  });
  actions.appendChild(deployBtn);

  c._shell = shell;
  c._view = shell.querySelector("#view");
}

/* ---------- 路由 ---------- */

const ROUTES = {
  "/": () => import("./pages/dashboard.js?v=" + VERSION),
  "/posts": () => import("./pages/posts.js?v=" + VERSION),
  "/edit": () => import("./pages/editor.js?v=" + VERSION),
  "/pages": () => import("./pages/pages.js?v=" + VERSION),
  "/editpage": () => import("./pages/editor.js?v=" + VERSION),
  "/talks": () => import("./pages/talks.js?v=" + VERSION),
  "/friends": () => import("./pages/friends.js?v=" + VERSION),
  "/images": () => import("./pages/images.js?v=" + VERSION),
  "/stats": () => import("./pages/stats.js?v=" + VERSION),
  "/settings": () => import("./pages/settings.js?v=" + VERSION),
};

let navToken = 0;

async function route(c) {
  const hash = location.hash.replace(/^#/, "") || "/";
  const [pathPart, queryPart] = hash.split("?");
  const params = new URLSearchParams(queryPart || "");
  const loader = ROUTES[pathPart] || null;
  const view = c._view;
  const navTokenMine = ++navToken;

  // 侧栏高亮
  const shell = c._shell;
  const activeRoute = pathPart.startsWith("/edit") ? "/posts" : pathPart;
  shell.querySelectorAll(".nav-link2").forEach((a) => {
    a.classList.toggle("active", a.closest(".nav-item").dataset.route === activeRoute);
  });

  // 顶栏标题
  const title = ROUTE_TITLES[pathPart] || ["页面", ""];
  shell.querySelector("#top-title").innerHTML =
    esc(title[0]) + (title[1] ? `<small>${esc(title[1])}</small>` : "");

  if (c.dirty) {
    const ok = await confirmDialog({
      title: "未保存的修改",
      text: "当前页面有未保存的修改，离开将丢失。确定离开？",
      okLabel: "离开",
      danger: true,
    });
    if (!ok) {
      // 回退 hash
      history.replaceState(null, "", c._lastHash || "#/");
      return;
    }
    c.dirty = false;
  }
  c._lastHash = location.hash;
  runLeave(c);

  if (!loader) {
    view.innerHTML = "";
    view.appendChild(el(`<div class="card"><div class="empty">${ic("info")}<p>页面不存在：${esc(pathPart)}</p></div></div>`));
    return;
  }

  // 每次导航用独立容器：旧页面的异步回调只会写入已脱离 DOM 的旧容器，不会清掉新页面
  const pageView = document.createElement("div");
  view.replaceChildren(pageView);
  pageView.appendChild(el(`<div class="inline-loading"><span class="ring"></span>加载中…</div>`));
  try {
    const mod = await loader();
    if (navTokenMine !== navToken) return;
    pageView.innerHTML = "";
    await mod.default(pageView, c, params, handleErr);
  } catch (e) {
    if (navTokenMine !== navToken) return;
    pageView.innerHTML = "";
    pageView.appendChild(el(`<div class="card"><div class="empty">${ic("alert")}<p>${esc(e.message || "页面加载失败")}</p></div></div>`));
  }
}

/* ---------- 启动 ---------- */

function bootApp(session, opts = {}) {
  ctx = buildContext(session);
  renderShell(ctx);
  if (opts.justLoggedIn) {
    toast(`欢迎回来，${session.user ? session.user.name : "管理员"}`, "success", 2600);
    if (session.mode !== "demo" && !ctx.nl.canReadDeploys && !ctx.nl.buildHook) {
      setTimeout(() => {
        toast("提示：到「设置 → Netlify 集成」粘贴一个 Access Token，即可在工作台看到部署状态", "info", 6500);
      }, 1600);
    }
  }
  // replaceState 不触发 hashchange，避免首屏路由执行两次
  if (!location.hash) history.replaceState(null, "", "#/");
  route(ctx);
}

function init() {
  // 全局只注册一次，退出再登录不会叠加监听
  window.addEventListener("hashchange", () => { if (ctx) route(ctx); });
  window.addEventListener("beforeunload", (e) => {
    if (ctx && ctx.dirty) {
      e.preventDefault();
      e.returnValue = "";
    }
  });

  const params = new URLSearchParams(location.search);
  let session = store.getSession();
  if (params.get("logout") === "1") {
    store.clearSession();
    session = null;
  }
  if (session && session.mode === "github") {
    // 先渲染骨架，再后台校验 Token
    bootApp(session);
    const settings = store.getSettings();
    const ghBoot = new GitHubAPI(session.token, settings);
    ghBoot.ensureFastest().catch(function () {});
    ghBoot
      .validate()
      .then((user) => {
        if (!ctx || ctx.session !== session) return;
        session.user = { ...session.user, ...user };
        if (session.user.name) {
          const nameEl = document.querySelector("#side-name");
          const subEl = document.querySelector("#side-sub");
          if (nameEl) nameEl.textContent = session.user.name;
          if (subEl) subEl.textContent = "@" + session.user.login;
        }
      })
      .catch((e) => {
        if (!ctx || ctx.session !== session) return;
        if (e.rateLimited) {
          toast("GitHub API 限流，稍后自动恢复；本次跳过 Token 校验", "info", 5000);
        } else if (e.status === 401 || e.status === 403) {
          store.clearSession();
          endSession();
          renderLogin("登录状态已失效，请重新输入 Token");
        } else {
          toast("GitHub 连接异常：" + e.message, "error", 5000);
        }
      });
  } else if (session && session.mode === "demo") {
    bootApp(session);
  } else {
    renderLogin();
  }
}

init();
