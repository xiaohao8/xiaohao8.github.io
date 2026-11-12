"use strict";

/**
 * 首访提速：减少对源站的串行请求（跨境 RTT 是最大瓶颈）
 * 1) 渲染期 CSS 内联：main.css / fonts.css / custom.css → <style>
 * 2) Banner 本地图内联为 data URI（LCP 零往返；配置换成外链则自动跳过）
 * 3) 头部脚本 utils/color-schema 内联（color-schema 必须先于绘制执行）
 * 4) 尾部 6 个主题 JS 合并为 /js/fluid-bundle.js 单请求（generator 输出）
 * 仅作用于前台页面；/admin/ 页面不引用这些资源，天然不受影响。
 */

const fs = require("fs");
const path = require("path");

const SRC = path.join(__dirname, "..", "source");
// 主题自带脚本（events / plugins / img-lazyload / local-search / boot）在 themes/fluid/source/，
// 不在项目 source/ 下。合包必须能读到它们，否则 script 标签被删掉、代码却没进 bundle，
// img-lazyload.js 不执行会让 img[lazyload] 永远停在 /img/loading.gif 转圈。
const THEME_SRC = path.join(__dirname, "..", "themes", "fluid", "source");
const cache = {}; // path -> { mtime, content }

/** 项目 source 优先，找不到再取主题 source；都不存在返回 null */
function resolveAsset(rel) {
  const clean = String(rel).replace(/^\/+/, "");
  for (const base of [SRC, THEME_SRC]) {
    const abs = path.join(base, clean);
    try { if (fs.statSync(abs).isFile()) return abs; } catch (_) { /* 换下一个根目录 */ }
  }
  return null;
}

function readFileCached(rel) {
  const abs = resolveAsset(rel);
  if (!abs) return null;
  let mtime = 0;
  try { mtime = fs.statSync(abs).mtimeMs; } catch (_) { return null; }
  const c = cache[abs];
  if (c && c.mtime === mtime) return c.content;
  const content = fs.readFileSync(abs, "utf8");
  cache[abs] = { mtime, content };
  return content;
}

function readBinCached(rel) {
  const abs = resolveAsset(rel);
  if (!abs) return null;
  let mtime = 0;
  try { mtime = fs.statSync(abs).mtimeMs; } catch (_) { return null; }
  const c = cache[abs];
  if (c && c.mtime === mtime) return c.content;
  const content = fs.readFileSync(abs);
  cache[abs] = { mtime, content };
  return content;
}

/* ---------- 1. CSS 内联 ---------- */
let mainCssCache = null;
async function readRoute(p) {
  const route = hexo.route.get(p);
  if (!route) return null;
  const chunks = [];
  for await (const c of route) chunks.push(c);
  return Buffer.concat(chunks).toString("utf8");
}
async function inlineCss(html) {
  if (!mainCssCache) {
    try { mainCssCache = await readRoute("css/main.css"); } catch (_) { mainCssCache = null; }
  }
  return html.replace(
    /<link rel="stylesheet" href="(\/css\/(?:main|fonts|custom)\.css)"(?:\?[^"]*)?>/g,
    (m, href) => {
      const css = href.indexOf("main") > -1 ? mainCssCache : readFileCached(href);
      return css ? "<style>" + css + "</style>" : m;
    }
  );
}

/* ---------- 2. Banner 内联（≤120KB 的本地图） ---------- */
const MAX_INLINE = 120 * 1024;
function inlineBanner(html) {
  return html.replace(/url\((["']?)(\/images\/uploads\/[^"')]+?\.(?:webp|png|jpe?g))\1\)/g, (m, q, p) => {
    const bin = readBinCached(p);
    if (!bin || bin.length > MAX_INLINE) return m;
    const mime = p.endsWith(".webp") ? "image/webp" : p.endsWith(".png") ? "image/png" : "image/jpeg";
    return "url(" + q + "data:" + mime + ";base64," + bin.toString("base64") + q + ")";
  });
}

/* ---------- 3. 头部脚本内联 ---------- */
function inlineHeadScripts(html) {
  return html.replace(
    /<script src="(\/js\/(?:utils|color-schema)\.js)"><\/script>/g,
    (m, src) => {
      const js = readFileCached(src);
      return js ? "<script>" + js + "</script>" : m;
    }
  );
}

/* ---------- 4. 尾部主题脚本合并 ---------- */
const BUNDLE_ORDER = [
  "/js/events.js",
  "/js/plugins.js",
  "/js/img-lazyload.js",
  "/js/local-search.js",
  "/js/custom.js",
  "/js/boot.js",
];

hexo.extend.generator.register("fluid-bundle", function () {
  let out = "/* fluid bundle @ " + new Date().toISOString() + " */\n";
  for (const f of BUNDLE_ORDER) {
    const c = readFileCached(f);
    if (c) out += "/* " + f + " */\n" + c + "\n";
    else console.warn("[optimize-speed] 合包缺少脚本：" + f + "（将保留原始 script 标签）");
  }
  return { path: "js/fluid-bundle.js", data: out };
});

function bundleTailScripts(html) {
  const tagRe = /<script src="(\/js\/[a-z-]+\.js)"([^>]*)><\/script>/g;
  const found = [];
  let m;
  while ((m = tagRe.exec(html))) {
    if (BUNDLE_ORDER.includes(m[1])) found.push({ tag: m[0], src: m[1] });
  }
  if (found.length < 2) return html;
  // 只有每个待合并脚本都读到了源码，才允许替换标签；否则整段保留。
  // 这道保险防止「标签被删、bundle 里却没有对应代码」让整站 JS 静默失效。
  if (found.some((x) => !readFileCached(x.src))) return html;
  // 校验这些标签是否恰好按 bundle 顺序出现（防误伤其它页面结构）
  const srcs = found.map((x) => x.src);
  const expect = BUNDLE_ORDER.filter((f) => srcs.includes(f));
  if (JSON.stringify(srcs) !== JSON.stringify(expect)) return html;
  html = html.replace(found[0].tag, '<script src="/js/fluid-bundle.js" defer></script>');
  for (let i = 1; i < found.length; i++) html = html.replace(found[i].tag, "");
  return html;
}

hexo.extend.filter.register("after_render:html", async function (html) {
  if (!html || html.length < 500) return html;
  let out = html;
  out = await inlineCss(out);
  out = inlineHeadScripts(out);
  out = bundleTailScripts(out);
  out = inlineBanner(out);
  return out;
});
