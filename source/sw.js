/* ============================================================
   醉里博客 Service Worker —— 国内访问加速 + 稳定性
   策略：
   - 页面(HTML)：网络优先，失败回退缓存（断网/源站故障仍可读）
   - 本站静态资源与可信 CDN：缓存优先 + 后台更新（回访秒开）
   - /admin/、访问统计脚本一律直连，不缓存
   版本号改动 = 全量换缓存
   ============================================================ */
const VERSION = "v1.0.0";
const PAGE_CACHE = "zui-pages-" + VERSION;
const ASSET_CACHE = "zui-assets-" + VERSION;
const ALL_CACHES = [PAGE_CACHE, ASSET_CACHE];

const SKIP = [/\/admin\//, /busuanzi\.ibruce\.info/, /open-kounter\.mintimate\.cn/, /sw\.js$/];
const STATIC_RE = /\.(css|js|mjs|png|jpe?g|webp|svg|gif|ico|avif|woff2?|ttf|eot|otf)(\?|$)/i;

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => !ALL_CACHES.includes(k)).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  const refresh = fetch(req).then((res) => {
    if (res && (res.ok || res.type === "opaque")) cache.put(req, res.clone());
    return res;
  }).catch(() => undefined);
  return hit || refresh.then((r) => r || Response.error());
}

async function networkFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(req);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch (_) {
    const hit = await cache.match(req, { ignoreSearch: false });
    if (hit) return hit;
    // 页面彻底离线且无缓存：回退到缓存的首页
    const home = await cache.match("/");
    return home || Response.error();
  }
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (SKIP.some((rx) => rx.test(url.href))) return;

  const accept = req.headers.get("accept") || "";
  const isPage = req.mode === "navigate" || accept.includes("text/html");

  if (url.origin === self.location.origin) {
    if (isPage) {
      event.respondWith(networkFirst(req, PAGE_CACHE));
    } else {
      event.respondWith(staleWhileRevalidate(req, ASSET_CACHE));
    }
    return;
  }

  /* 第三方：只缓存稳定资源（CDN 的 css/js/字体/图片），放行统计与 API */
  if (STATIC_RE.test(url.pathname)) {
    event.respondWith(staleWhileRevalidate(req, ASSET_CACHE));
  }
});
