"use strict";

/**
 * 首访提速 + 慢网体积优化（跨境带宽实测只有 2–8 KB/s）
 * 1) CSS 外链 + 内容 hash：不再把 83KB 未压缩 CSS 逐页内联，改为带 ?v=<hash>
 *    的外链，可跨页复用 immutable 缓存，且吃到 Hexo 压缩后的体积。
 *    早期版本是全量内联，虽然省 1 个 RTT，但每个页面都要重新下载同一份 CSS，
 *    在慢网下「多翻两页」反而比外链慢数倍。
 * 2) Banner 不再内联 base64：改为原图 URL + <link rel=preload>，
 *    图片走 /images/* 的 7 天缓存，首页 HTML 直接少 74KB。
 * 3) 头部脚本 utils/color-schema 内联（color-schema 必须先于绘制执行）
 * 4) 尾部 6 个主题 JS 合并为 /js/fluid-bundle.js 单请求（generator 输出）
 * 仅作用于前台页面；/admin/ 页面不引用这些资源，天然不受影响。
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

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

/* ---------- 1. CSS 外链 + 内容 hash ---------- */
async function readRoute(p) {
  const route = hexo.route.get(p);
  if (!route) return null;
  const chunks = [];
  for await (const c of route) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(String(c)));
  return Buffer.concat(chunks).toString("utf8");
}

const CSS_FILES = ["css/main.css", "css/fonts.css", "css/custom.css"];
let cssVersionsPromise = null;

/** 用 Hexo 实际输出的（已压缩）内容算 hash：内容不变 URL 不变，改了立即换 URL。
 *  route 还没就绪时退回源码，保证同一构建内所有页面拿到同一个版本号。
 *  必须缓存「Promise」而不是结果对象：after_render:html 是并发渲染多个页面的，
 *  若在 await 之前先赋一个空对象，其它页面会立刻拿到空对象，全部退化成 v=1。 */
async function buildCssVersions() {
  if (!cssVersionsPromise) cssVersionsPromise = (async () => {
    const versions = {};
    for (const rel of CSS_FILES) {
      let content = null;
      try { content = await readRoute(rel); } catch (_) { /* 退回源码 */ }
      if (content == null) content = readFileCached("/" + rel);
      versions[rel] = crypto.createHash("sha1")
        .update(content == null ? rel : content).digest("hex").slice(0, 10);
    }
    return versions;
  })();
  return cssVersionsPromise;
}

async function versionCss(html) {
  const versions = await buildCssVersions();
  return html.replace(
    /<link rel="stylesheet" href="(\/css\/(?:main|fonts|custom)\.css)"(?:\?[^"]*)?>/g,
    (m, href) => `<link rel="stylesheet" href="${href}?v=${versions[href.slice(1)] || "1"}">`
  );
}

/* ---------- 2. Banner 改为原图 + preload（不再内联 base64） ----------
   内联 base64 让每页 HTML 多 74KB 且完全无法缓存；原图只在第一次下载，
   /images/* 已有 7 天缓存，preload 保证 LCP 不比内联晚。 */
const BANNER_RE = /url\((["']?)(\/images\/uploads\/[^"')]+?\.(?:webp|png|jpe?g))\1\)/g;
function bannerPreload(html) {
  const urls = new Set();
  let m;
  BANNER_RE.lastIndex = 0;
  while ((m = BANNER_RE.exec(html))) urls.add(m[2]);
  if (!urls.size || html.indexOf("</head>") < 0) return html;
  const tags = [...urls].slice(0, 2)
    .map((u) => `<link rel="preload" as="image" href="${u}">`).join("");
  return html.replace("</head>", tags + "</head>");
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

let bundleVer = null;
/**
 * 用合包内容生成版本号：内容不变则 URL 不变（继续吃 `/js/*` 的 1 小时缓存），
 * 内容一变就换 URL。否则修了 bundle 但 URL 没变，浏览器会一直拿着旧文件不放。
 */
function bundleVersion() {
  if (bundleVer) return bundleVer;
  const h = crypto.createHash("sha1");
  for (const f of BUNDLE_ORDER) h.update(f).update(readFileCached(f) || "");
  bundleVer = h.digest("hex").slice(0, 10);
  return bundleVer;
}

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
  html = html.replace(found[0].tag, '<script src="/js/fluid-bundle.js?v=' + bundleVersion() + '"></script>');
  for (let i = 1; i < found.length; i++) html = html.replace(found[i].tag, "");
  return html;
}

hexo.extend.filter.register("after_render:html", async function (html) {
  if (!html || html.length < 500) return html;
  let out = html;
  out = await versionCss(out);
  out = inlineHeadScripts(out);
  out = bundleTailScripts(out);
  // custom_head 里的 preload 必须与 script 用同一个带版本 URL，
  // 否则会重复下载，甚至 preload 到旧版本。
  if (out.includes('href="/js/fluid-bundle.js"')) {
    out = out.replace(
      /(<link rel="preload" href="\/js\/fluid-bundle\.js)(\?[^"]*)?(" as="script">)/g,
      "$1?v=" + bundleVersion() + "$3"
    );
  }
  out = bannerPreload(out);
  out = giteeImages(out);
  return out;
});

/* ---------- 5. Gitee 镜像加速：站内图片改走国内 raw 源 ----------
   src 改为 Gitee raw（国内快），onerror 回退源站。
   Gitee 镜像由 GitHub 同步，同步延迟期间 fallback 保底。 */
const GITEE_IMG_BASE = "https://gitee.com/xiaohao3/xiaohao8.github.io/raw/main";
const IMG_UPLOADS_RE = /src="(\/images\/uploads\/[^"]+\.(?:png|jpe?g|webp|svg|gif|avif))"/g;
function giteeImages(html) {
  return html.replace(IMG_UPLOADS_RE, function (m, path) {
    const gitee = GITEE_IMG_BASE + path;
    const fallback = "this.onerror=null;this.src='" + path + "'";
    return 'src="' + gitee + '" onerror="' + fallback + '"';
  });
}
