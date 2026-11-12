/* editor-shared.js — Vditor 资源加载器（编辑器 / 说说页共用）
   智能选路：本站源 vs Gitee 镜像竞速（结果缓存 12h），加载失败自动切换。 */

import { VERSION } from "../app.js?v=4.1.5";

export const VDITOR_BASE = "/admin/vendor/vditor";
const VDITOR_GITEE =
  "https://gitee.com/xiaohao3/xiaohao8.github.io/raw/main/source/admin/vendor/vditor";

let libPromise = null;
let currentBase = null; // 竞速结果；未测定时用本站

function getVendorSetting() {
  try {
    const s = JSON.parse(localStorage.getItem("qexo4_settings") || "{}");
    return s.vendorSource || "auto";
  } catch (_) {
    return "auto";
  }
}

function lsGetJSON(key, ttlMs) {
  try {
    const v = JSON.parse(localStorage.getItem(key) || "null");
    if (v && Date.now() - v.ts < ttlMs) return v.base;
  } catch (_) { /* ignore */ }
  return null;
}

async function pickBase() {
  const pref = getVendorSetting();
  if (pref === "site") return VDITOR_BASE;
  if (pref === "gitee") return VDITOR_GITEE;
  const cached = lsGetJSON("qexo4_vendor_base", 12 * 3600 * 1000);
  if (cached) return cached;
  // 竞速：拉一个小文件（index.css）比耗时
  const probe = async (base) => {
    const t0 = performance.now();
    const res = await fetch(base + "/dist/index.css", {
      cache: "no-store",
      signal: AbortSignal.timeout ? AbortSignal.timeout(2500) : undefined,
    });
    if (!res.ok) throw new Error(res.status);
    return { base, ms: performance.now() - t0 };
  };
  const results = await Promise.allSettled([VDITOR_BASE, VDITOR_GITEE].map((b) => probe(b)));
  const ok = results.filter((r) => r.status === "fulfilled").map((r) => r.value);
  const best = ok.length ? ok.sort((a, b) => a.ms - b.ms)[0].base : VDITOR_BASE;
  try { localStorage.setItem("qexo4_vendor_base", JSON.stringify({ base: best, ts: Date.now() })); } catch (_) {}
  return best;
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error("脚本加载失败：" + src));
    document.head.appendChild(s);
  });
}

/** 确保 Vditor 库可用（竞速选源 + 失败自动切换） */
export async function ensureVditorLib() {
  if (!currentBase) currentBase = await pickBase();

  const tryLoad = async (base) => {
    if (!document.querySelector("link[data-vditor-css]")) {
      const l = document.createElement("link");
      l.rel = "stylesheet";
      l.dataset.vditorCss = "1";
      l.href = base + "/dist/index.css?v=" + VERSION;
      document.head.appendChild(l);
    }
    if (!window.Vditor) await loadScript(base + "/dist/index.min.js?v=" + VERSION);
    if (!window.Vditor) throw new Error("Vditor 加载失败");
  };

  if (!libPromise) {
    libPromise = (async () => {
      try {
        await tryLoad(currentBase);
      } catch (e) {
        // 主选源失败 → 自动切另一个
        const alt = currentBase === VDITOR_BASE ? VDITOR_GITEE : VDITOR_BASE;
        currentBase = alt;
        try { localStorage.setItem("qexo4_vendor_base", JSON.stringify({ base: alt, ts: Date.now() })); } catch (_) {}
        await tryLoad(alt);
      }
    })();
  }
  await libPromise;
  if (!window.Vditor) throw new Error("Vditor 加载失败");
}

/** 当前选定的 Vditor 资源基址（Vditor cdn 选项用，懒加载模块同源加载） */
export function getVditorBase() {
  return currentBase || VDITOR_BASE;
}
