/* pages/editor-shared.js — Vditor 资源加载器（编辑器 / 说说页共用） */

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

/** 确保 Vditor 库可用（自动注入 css/js），返回 Promise */
export function ensureVditorLibFor() {
  if (!document.querySelector('link[href*="vditor/dist/index.css"]')) {
    const l = document.createElement("link");
    l.rel = "stylesheet";
    l.href = "/admin/vendor/vditor/dist/index.css?v=4.0.0";
    document.head.appendChild(l);
  }
  if (window.Vditor) return Promise.resolve();
  if (!libPromise) {
    libPromise = loadScript("/admin/vendor/vditor/dist/index.min.js?v=4.0.0");
  }
  return libPromise.then(() => {
    if (!window.Vditor) throw new Error("Vditor 加载失败");
  });
}

/** 图片文件名净化 */
export function safeImageName(name) {
  const ext = (name.match(/\.[a-z0-9]+$/i) || [""])[0];
  const base = name.slice(0, name.length - ext.length)
    .replace(/[^\w\u4e00-\u9fa5-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "image";
  return base + ext.toLowerCase();
}
