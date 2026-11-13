/* editor-shared.js — Vditor 资源加载器（编辑器 / 说说页共用）

   为什么要多源：Vditor 的 Markdown 引擎 lute 压缩后约 700KB，从 Netlify
   （Cloudflare 边缘）到国内实测只有 3~8 KB/s，要两百多秒，等于拉不动。
   npmmirror（阿里 npm 镜像）同版本文件 0.6 秒左右，且 MIME 正确、缓存一年，
   所以按「npmmirror → 本站」顺序加载，成功哪个就记住哪个。

   为什么不能用 Gitee：Gitee raw 返回 Content-Type: text/plain，浏览器会拒绝
   执行 <script>（图片能跟随 302，脚本不行）。

   失败会抛出可读错误，由页面降级为纯文本编辑，绝不静默空白。 */

import { VERSION } from "../app.js?v=4.4.1";

export const VDITOR_BASE = "/admin/vendor/vditor";

// 必须与 vendor 目录里的 Vditor 版本一致，升级 vendor 时同步改这里
const VDITOR_VERSION = "3.11.1";

const SOURCES = [
  {
    key: "npmmirror",
    base: "https://registry.npmmirror.com/vditor/" + VDITOR_VERSION + "/files",
  },
  { key: "site", base: VDITOR_BASE },
];

const LIB_TIMEOUT = 12000;
const LUTE_TIMEOUT = 30000;
const ICON_TIMEOUT = 12000;
const LUTE_ID = "vditorLuteScript";
const ICON_ID = "vditorIconScript";
const BASE_CACHE_KEY = "qexo4_vditor_base";

let libPromise = null;
let currentBase = null;

function readCachedBase() {
  try {
    const v = localStorage.getItem(BASE_CACHE_KEY);
    if (v && SOURCES.some((s) => s.base === v)) return v;
  } catch (_) { /* ignore */ }
  return null;
}

function cacheBase(base) {
  try { localStorage.setItem(BASE_CACHE_KEY, base); } catch (_) { /* ignore */ }
}

/** 当前已就绪的资源基址（Vditor 的 cdn 参数用，子资源同源加载） */
export function getVditorBase() {
  return currentBase || readCachedBase() || SOURCES[0].base;
}

/**
 * 注入脚本。带 id 时先去重：Vditor 内部 addScript 同样按 id 判断，
 * 因此重复调用不会重复下载/执行。
 */
function loadScript(src, opts = {}) {
  const { id, timeout = LIB_TIMEOUT } = opts;
  return new Promise((resolve, reject) => {
    if (id && document.getElementById(id)) { resolve(); return; }
    const s = document.createElement("script");
    if (id) s.id = id;
    s.src = src;
    s.async = true;
    let settled = false;
    const done = (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (!err) { resolve(); return; }
      try { s.remove(); } catch (_) { /* ignore */ }
      reject(err);
    };
    const timer = setTimeout(
      () => done(new Error("超时 " + Math.round(timeout / 1000) + "s")),
      timeout
    );
    s.onload = () => done(null);
    s.onerror = () => done(new Error("网络错误"));
    document.head.appendChild(s);
  });
}

/** 样式表跟随资源源；失败只影响外观，不阻断编辑器 */
function ensureCss(base) {
  let l = document.querySelector("link[data-vditor-css]");
  if (!l) {
    l = document.createElement("link");
    l.rel = "stylesheet";
    l.dataset.vditorCss = "1";
    document.head.appendChild(l);
  }
  if (l.dataset.vditorBase !== base) {
    l.dataset.vditorBase = base;
    l.href = base + "/dist/index.css";
  }
}

async function retry(label, fn, times = 2) {
  let last = null;
  for (let i = 0; i < times; i++) {
    try { return await fn(); } catch (e) { last = e; }
  }
  throw new Error(label + "失败：" + ((last && last.message) || "未知错误"));
}

/** 在某个源上把「主程序 + Markdown 引擎」加载齐，任一步失败就抛错换源 */
async function loadFrom(base) {
  ensureCss(base);

  await retry("编辑器主程序加载", () =>
    loadScript(base + "/dist/index.min.js?v=" + VERSION, { timeout: LIB_TIMEOUT })
  );
  if (!window.Vditor) throw new Error("主程序未正确初始化");

  // Markdown 引擎是正文渲染的前提；提前加载，失败就能明确报错并降级。
  // 不重试：避免超时等待翻倍，直接换下一个源。
  await loadScript(base + "/dist/js/lute/lute.min.js", {
    id: LUTE_ID,
    timeout: LUTE_TIMEOUT,
  });
  // onload 只代表下载并执行完，执行出错时 window.Lute 仍可能缺失；
  // 这时移掉 script 让下一个源能重新拉取。
  if (!window.Lute) {
    const bad = document.getElementById(LUTE_ID);
    if (bad) bad.remove();
    throw new Error("Markdown 引擎未就绪");
  }

  // 图标脚本：Vditor 内部有一条「同步 XHR 取源码再内联执行」的路径，
  // 跨域访问镜像时没有 CORS 会失败。这里先用 <script> 异步加载并占住它的 id，
  // Vditor 检测到已存在就直接复用。失败不阻断（只是按钮没图标）。
  await loadScript(base + "/dist/js/icons/ant.js", {
    id: ICON_ID,
    timeout: ICON_TIMEOUT,
  }).catch(() => {});
}

/**
 * 确保 Vditor 可用：按「上次成功的源 → 其余源」依次尝试。
 * 失败抛错（调用方负责降级），失败后允许重试。
 */
export async function ensureVditorLib() {
  if (!libPromise) {
    libPromise = (async () => {
      const cached = readCachedBase();
      const order = cached
        ? [cached].concat(SOURCES.map((s) => s.base).filter((b) => b !== cached))
        : SOURCES.map((s) => s.base);

      let lastErr = null;
      for (const base of order) {
        try {
          await loadFrom(base);
          currentBase = base;
          cacheBase(base);
          return;
        } catch (e) {
          lastErr = e;
        }
      }
      throw lastErr || new Error("编辑器资源源均不可用");
    })().catch((e) => {
      libPromise = null; // 失败不永久缓存，下次可重试
      throw e;
    });
  }
  return libPromise;
}
