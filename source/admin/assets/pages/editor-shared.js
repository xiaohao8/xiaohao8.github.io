/* editor-shared.js — Vditor 资源加载器（编辑器 / 说说页共用） */

import { VERSION } from "../app.js";

export const VDITOR_BASE = "/admin/vendor/vditor";

let libPromise = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error("脚本加载失败：" + src));
    document.head.appendChild(s);
  });
}

/** 确保 Vditor 库可用（自动注入 css/js） */
export function ensureVditorLib() {
  if (!document.querySelector("link[data-vditor-css]")) {
    const l = document.createElement("link");
    l.rel = "stylesheet";
    l.dataset.vditorCss = "1";
    l.href = VDITOR_BASE + "/dist/index.css?v=" + VERSION;
    document.head.appendChild(l);
  }
  if (window.Vditor) return Promise.resolve();
  if (!libPromise) {
    libPromise = loadScript(VDITOR_BASE + "/dist/index.min.js?v=" + VERSION);
  }
  return libPromise.then(() => {
    if (!window.Vditor) throw new Error("Vditor 加载失败");
  });
}