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

  /* ---------- 启动 ---------- */
  function boot() {
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
