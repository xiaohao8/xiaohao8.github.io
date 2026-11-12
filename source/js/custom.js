/* ============================================================
   醉里博客 · 前台交互层 v2（2026 refresh）
   依赖 Fluid 已加载的 DOM；全部原生 JS，无第三方库。
   ============================================================ */
(function () {
  "use strict";

  var root = document.documentElement;
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* 标记 JS 可用：入场动画只在 .zui-js 下生效，脚本失效时内容照常显示 */
  root.classList.add("zui-js");
  if (reduceMotion) root.classList.add("zui-no-motion");

  /* ---------- 0. 默认封面按文章轮换（打破同图单调） ----------
     无自设封面的文章由 Fluid 填 default-cover；这里按文章链接哈希
     从 5 色品牌封面中稳定选一张，同一篇文章每次都是同一张。 */
  function setupCoverVariants() {
    var variants = [
      "/images/uploads/covers/cover-ocean.svg",
      "/images/uploads/covers/cover-emerald.svg",
      "/images/uploads/covers/cover-sunset.svg",
      "/images/uploads/covers/cover-midnight.svg",
      "/images/uploads/covers/cover-rose.svg",
    ];
    var hash = function (s) {
      var h = 0;
      for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
      return h;
    };
    document.querySelectorAll(".index-card .index-img img").forEach(function (img) {
      if (!/default-cover/.test(img.getAttribute("src") || "")) return;
      var a = img.closest("a");
      var key = a ? a.getAttribute("href") : img.alt || Math.random();
      img.src = variants[hash(String(key)) % variants.length];
    });
  }
  /* ---------- 1. 滚动入场动画（IntersectionObserver） ---------- */
  var revealSel = ".index-card, #board, .widget, .pagination";
  function setupReveal() {
    var targets = Array.prototype.slice.call(document.querySelectorAll(revealSel));
    if (!targets.length || !("IntersectionObserver" in window) || reduceMotion) {
      targets.forEach(function (t) { t.classList.add("zui-in"); });
      return;
    }
    targets.forEach(function (t) {
      if (t.dataset.zuiReveal) return;
      t.dataset.zuiReveal = "1";
      t.classList.add("zui-reveal");
    });
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        var el = en.target;
        // 同级卡片按序错峰
        var siblings = el.parentElement
          ? Array.prototype.filter.call(el.parentElement.children, function (c) {
              return c.matches && c.matches(revealSel);
            })
          : [el];
        var idx = siblings.indexOf(el);
        el.style.transitionDelay = Math.min(idx, 6) * 60 + "ms";
        el.classList.add("zui-in");
        io.unobserve(el);
      });
    }, { rootMargin: "0px 0px 14% 0px", threshold: 0.02 });
    targets.forEach(function (t) { io.observe(t); });
  }

  /* ---------- 2. 顶部导航：滚动态 ---------- */
  var navbar = document.querySelector(".navbar");
  function onNavScroll() {
    if (!navbar) return;
    navbar.classList.toggle("zui-scrolled", window.scrollY > 24);
    var banner = document.getElementById("banner");
    if (!banner) return;
    navbar.classList.toggle("zui-on-banner", banner.getBoundingClientRect().bottom > 64);
  }

  /* ---------- 3. 回到顶部：环形阅读进度 ---------- */
  var topBtn = document.getElementById("scroll-top-button");
  var ring = null;
  function setupRing() {
    if (!topBtn || topBtn.querySelector(".zui-ring")) return;
    var NS = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(NS, "svg");
    svg.setAttribute("class", "zui-ring");
    svg.setAttribute("viewBox", "0 0 48 48");
    svg.setAttribute("aria-hidden", "true");
    var c1 = document.createElementNS(NS, "circle");
    c1.setAttribute("cx", "24"); c1.setAttribute("cy", "24"); c1.setAttribute("r", "21");
    c1.setAttribute("class", "zui-ring-track");
    var c2 = document.createElementNS(NS, "circle");
    c2.setAttribute("cx", "24"); c2.setAttribute("cy", "24"); c2.setAttribute("r", "21");
    c2.setAttribute("class", "zui-ring-bar");
    svg.appendChild(c1); svg.appendChild(c2);
    topBtn.appendChild(svg);
    ring = c2;
    topBtn.classList.add("zui-has-ring");
  }
  function onScrollRing() {
    var doc = document.documentElement;
    var max = doc.scrollHeight - window.innerHeight;
    var p = max > 0 ? Math.min(window.scrollY / max, 1) : 0;
    if (ring) {
      var len = 2 * Math.PI * 21;
      ring.style.strokeDashoffset = String(len * (1 - p));
    }
    if (topBtn) topBtn.classList.toggle("zui-show", window.scrollY > 320);
  }

  /* ---------- 4. 卡片指针跟随光晕 ---------- */
  function setupCardGlow() {
    if (reduceMotion) return;
    document.addEventListener("mousemove", function (e) {
      var card = e.target && e.target.closest ? e.target.closest(".index-card") : null;
      if (!card) return;
      var r = card.getBoundingClientRect();
      card.style.setProperty("--zui-mx", (e.clientX - r.left) + "px");
      card.style.setProperty("--zui-my", (e.clientY - r.top) + "px");
    }, { passive: true });
  }

  /* ---------- 5. 明暗切换：View Transitions 平滑过渡 ----------
     拦截 Fluid 的切换点击，包进 document.startViewTransition，
     再派发一个带标记的事件让 Fluid 自己的逻辑在过渡回调里执行。 */
  function setupThemeTransition() {
    if (!document.startViewTransition) return;
    var sels = ["#color-toggle-btn", "#mobile-color-toggle-btn"];
    document.addEventListener("click", function (e) {
      if (e.__zuiPass || !e.target.closest) return;
      var btn = e.target.closest(sels.join(","));
      if (!btn) return;
      e.stopImmediatePropagation();
      e.preventDefault();
      document.startViewTransition(function () {
        var ev = new MouseEvent("click", { bubbles: true, cancelable: true, view: window });
        ev.__zuiPass = true;
        btn.dispatchEvent(ev);
      });
    }, true);
  }

  /* ---------- 6. Banner 底部波浪分隔 ---------- */
  function setupWave() {
    var banner = document.querySelector(".banner");
    if (!banner || banner.querySelector(".zui-wave")) return;
    var wave = document.createElement("div");
    wave.className = "zui-wave";
    wave.setAttribute("aria-hidden", "true");
    wave.innerHTML =
      '<svg viewBox="0 0 1440 90" preserveAspectRatio="none">' +
      '<path d="M0,64 C240,96 480,16 720,32 C960,48 1200,88 1440,56 L1440,90 L0,90 Z"></path></svg>';
    banner.appendChild(wave);
  }

  /* ---------- 0.5 Service Worker：回访秒开 + 断网可读 ---------- */
  function setupSW() {
    if (!("serviceWorker" in navigator)) return;
    if (location.protocol !== "https:" && location.hostname !== "localhost") return;
    if (location.pathname.startsWith("/admin")) return; // 后台不走缓存
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("/sw.js").catch(function () {});
    });
  }

  /* ---------- 0.6 站内图片挂掉自动切 Gitee 镜像 ---------- */
  function setupImageMirror() {
    window.addEventListener("error", function (e) {
      var t = e.target;
      if (!(t instanceof HTMLImageElement) || t.dataset.zuiMirror) return;
      var src = t.getAttribute("src") || "";
      if (src.indexOf("/images/uploads/") !== 0) return;
      t.dataset.zuiMirror = "1";
      t.src = "https://gitee.com/xiaohao3/xiaohao8.github.io/raw/main/source" + src;
    }, true);
  }

0  /* ---------- 启动 ---------- */
  function boot() {
    setupSW();
    setupImageMirror();
    setupCoverVariants();
    // 首页的 #board 只是卡片容器：去掉面板底，让卡片直接浮在页面渐变上
    var board = document.getElementById("board");
    if (board && board.querySelector(".index-card")) board.classList.add("zui-board-flat");
    setupReveal();
    setupRing();
    setupCardGlow();
    setupThemeTransition();
    setupWave();
    onNavScroll();
    onScrollRing();
    var ticking = false;
    window.addEventListener("scroll", function () {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function () {
        onNavScroll();
        onScrollRing();
        ticking = false;
      });
    }, { passive: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();

/* ---------- 友链自助申请（/friends/ 页表单 → GitHub Issue） ---------- */
(function () {
  function init() {
    var box = document.getElementById("friend-apply");
    if (!box) return;
    var btn = document.getElementById("fa-submit");
    var REPO = "xiaohao8/xiaohao8.github.io";
    btn.addEventListener("click", function () {
      var v = function (id) { return (document.getElementById(id).value || "").trim(); };
      var title = v("fa-title"), link = v("fa-link"), avatar = v("fa-avatar"), intro = v("fa-intro");
      if (!title) return alert("请填写站点名称");
      if (!/^https?:\/\/.+/i.test(link)) return alert("站点链接需以 http(s):// 开头");
      if (avatar && !/^https?:\/\/.+/i.test(avatar)) return alert("头像链接需以 http(s):// 开头（或留空）");
      var body =
        "```yaml\n" +
        "title: " + title + "\n" +
        "link: " + link + "\n" +
        "avatar: " + (avatar || "") + "\n" +
        "intro: " + (intro || "") + "\n" +
        "```\n\n> 本 Issue 由友链页申请表单自动生成，博主在后台审核采纳。\n";
      var url = "https://github.com/" + REPO + "/issues/new" +
        "?title=" + encodeURIComponent("【友链申请】" + title) +
        "&body=" + encodeURIComponent(body);
      btn.disabled = true;
      btn.textContent = "正在打开 GitHub…";
      window.open(url, "_blank", "noopener");
      setTimeout(function () {
        btn.disabled = false;
        btn.textContent = "提交申请";
      }, 1200);
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
