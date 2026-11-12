/* editor-shared.js — Vditor 资源加载器（编辑器 / 说说页共用）
   资源固定走本站：Gitee raw 返回 Content-Type: text/plain，浏览器会拒绝执行
   <script>（nosniff/MIME 检查），图片能 302 跟进但脚本不行，因此不再做脚本竞速。
   加载带超时与重试，失败抛出可读错误，由页面降级为纯文本编辑，绝不静默空白。 */

import { VERSION } from "../app.js?v=4.1.7";

export const VDITOR_BASE = "/admin/vendor/vditor";

const LIB_TIMEOUT = 20000;
const LUTE_TIMEOUT = 30000;

// 与 Vditor 内部 addScript 使用的 id 保持一致：命中后它会直接复用，不会重复下载
const LUTE_ID = "vditorLuteScript";

let libPromise = null;

/** Vditor 资源基址：固定本站，外部镜像不能作为脚本源 */
export function getVditorBase() {
  return VDITOR_BASE;
}

/**
 * 注入脚本。带 id 时会先去重：Vditor 内部 addScript 同样按 id 判断，
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

async function retry(label, fn, times = 2) {
  let last = null;
  for (let i = 0; i < times; i++) {
    try { return await fn(); } catch (e) { last = e; }
  }
  throw new Error(label + "失败：" + ((last && last.message) || "未知错误"));
}

/**
 * 确保 Vditor 主程序可用。失败抛错（调用方负责降级），失败后允许重试。
 * 只保证「主程序 + 样式」就绪；Markdown 引擎由 Vditor 自己懒加载，
 * 是否真正渲染由页面侧的 watchdog 用 DOM 结果判断，不赌内部状态。
 */
export async function ensureVditorLib() {
  if (!libPromise) {
    libPromise = (async () => {
      if (!document.querySelector("link[data-vditor-css]")) {
        const l = document.createElement("link");
        l.rel = "stylesheet";
        l.dataset.vditorCss = "1";
        l.href = VDITOR_BASE + "/dist/index.css?v=" + VERSION;
        document.head.appendChild(l);
      }
      await retry("编辑器主程序加载", () =>
        loadScript(VDITOR_BASE + "/dist/index.min.js?v=" + VERSION, { timeout: LIB_TIMEOUT })
      );
      if (!window.Vditor) throw new Error("主程序未正确初始化");

      // Markdown 引擎（≈3.8MB）是正文渲染的前提。Vditor 自己会懒加载它，
      // 但失败时静默中断、界面留白；这里提前加载，失败就能明确报错并降级。
      // 不重试：避免超时等待翻倍，失败直接让调用方切纯文本。
      await loadScript(VDITOR_BASE + "/dist/js/lute/lute.min.js", {
        id: LUTE_ID,
        timeout: LUTE_TIMEOUT,
      });
      // 脚本 onload 只代表下载并执行完，执行出错时 window.Lute 仍可能缺失。
      // 这时移掉 script 让下次重试能重新拉取，并把错误交给页面降级。
      if (!window.Lute) {
        const bad = document.getElementById(LUTE_ID);
        if (bad) bad.remove();
        throw new Error("Markdown 引擎未就绪");
      }
    })().catch((e) => {
      libPromise = null; // 失败不永久缓存，下次可重试
      throw e;
    });
  }
  return libPromise;
}
