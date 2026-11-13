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

  /* ---------- 启动 ---------- */
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

  /* ---------- 站点统计 v5.5（自托管：Netlify Blobs 实时聚合） ---------- */
  (function () {
    function vid() {
      try {
        var k = "zui_vid", v = localStorage.getItem(k);
        if (!v) {
          v = (crypto.randomUUID ? crypto.randomUUID() : Date.now() + "-" + Math.random().toString(36).slice(2));
          localStorage.setItem(k, v);
        }
        return v;
      } catch (_) { return ""; }
    }
    function sid() {
      try {
        var k = "zui_sid", v = sessionStorage.getItem(k);
        if (!v) {
          v = Date.now() + "-" + Math.random().toString(36).slice(2, 8);
          sessionStorage.setItem(k, v);
        }
        return v;
      } catch (_) { return ""; }
    }
    /* 后台「设置 → 访问统计」写入 source/analytics/config.json，
       Hexo 原样复制到 /analytics/config.json，采集与展示都按它执行。 */
    var cfgPromise = fetch("/analytics/config.json", { cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : {}; })
      .catch(function () { return {}; });
    var DEFAULT_EXCLUDES = ["/admin", "/stats"];

    function excluded(path, cfg) {
      var list = Array.isArray(cfg.excludePaths) ? cfg.excludePaths : DEFAULT_EXCLUDES;
      for (var i = 0; i < list.length; i++) {
        if (list[i] && path.indexOf(String(list[i])) === 0) return true;
      }
      return false;
    }

    function beacon() {
      if (location.protocol.indexOf("http") !== 0) return;
      if (/bot|spider|crawl|slurp|headless/i.test(navigator.userAgent)) return;
      cfgPromise.then(function (cfg) {
        if (cfg.enabled === false) return;
        if (excluded(location.pathname, cfg)) return;
        var body = JSON.stringify({
          v: vid(), s: sid(), p: location.pathname,
          r: document.referrer ? new URL(document.referrer).hostname : "",
          w: window.innerWidth, h: window.innerHeight,
          ua: navigator.userAgent,
        });
        fetch("/api/collect", { method: "POST", body, keepalive: true,
          headers: { "Content-Type": "application/json" } }).catch(function () {});
      });
    }
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", beacon);
    else beacon();

    function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

    function pad2(n) { return n < 10 ? "0" + n : String(n); }
    function thousands(n) {
      return String(n || 0).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    }
    function attr(s) {
      return esc(s).replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    }
    function fmtDuration(sec) {
      var s = Math.max(0, Math.round(sec || 0));
      return Math.floor(s / 60) + ":" + pad2(s % 60);
    }
    /* 接口只返回「有数据的那天/那一小时」，直接渲染就会只剩两根细条。
       这里按 UTC 补齐到完整 N 天 + 24 小时，没数据的位置画灰色基线。 */
    function padDaily(data, days) {
      var map = {};
      (data.daily || []).forEach(function (d) { if (d && d.date) map[d.date] = d; });
      var now = new Date();
      var end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
      var out = [];
      for (var i = days - 1; i >= 0; i--) {
        var date = new Date(end - i * 86400000).toISOString().slice(0, 10);
        var hit = map[date] || {};
        out.push({ date: date, pv: hit.pv || 0, uv: hit.uv || 0 });
      }
      return out;
    }
    function padHourly(data) {
      var map = {};
      (data.hourly || []).forEach(function (h) { if (h) map[h.hour] = h; });
      var out = [];
      for (var i = 0; i < 24; i++) {
        var hit = map[i] || {};
        out.push({ hour: i, pv: hit.pv || 0, uv: hit.uv || 0 });
      }
      return out;
    }
    function chartHtml(rows, opt) {
      var max = 1;
      rows.forEach(function (r) { if (r.pv > max) max = r.pv; });
      /* 标签抽样：30 天/24 小时全打出来会挤成竖排，每 ~8 格标一个 */
      var step = Math.max(1, Math.ceil(rows.length / 8));
      return rows.map(function (r, i) {
        var empty = !r.pv;
        var h = empty ? 4 : Math.max(6, Math.round((r.pv / max) * 100));
        var show = i % step === 0 || i === rows.length - 1;
        return '<div class="' + opt.cls + (empty ? " is-empty" : "") +
          '" title="' + attr(opt.title(r)) + '">' +
          '<span style="height:' + h + '%"></span>' +
          (show ? "<i>" + esc(opt.label(r)) + "</i>" : "") + "</div>";
      }).join("");
    }
    function rowsHtml(list, key, link) {
      if (!list || !list.length) return '<p class="muted">暂无数据</p>';
      return list.map(function (x) {
        var name = String((x && x[key]) || "-");
        var left = link && name.charAt(0) === "/"
          ? '<a href="' + attr(name) + '" title="' + attr(name) + '">' + esc(name) + "</a>"
          : '<span title="' + attr(name) + '">' + esc(name) + "</span>";
        return '<div class="zui-stat-row">' + left + "<b>" + thousands(x && x.count) + "</b></div>";
      }).join("");
    }
    function panel(title, body, wide) {
      return '<section class="zui-stat-panel' + (wide ? " zui-stat-panel--wide" : "") + '">' +
        "<h3>" + esc(title) + "</h3>" + body + "</section>";
    }
    function statCard(value, label) {
      return '<div class="zui-stat-card"><b>' + value + "</b><span>" + esc(label) + "</span></div>";
    }
    function renderStats(data, days) {
      var root = document.getElementById("stats-root");
      if (!root) return;
      days = days || 30;
      var t = data.totals || {};
      var rt = data.realtime || {};
      var online = rt.online != null ? rt.online : (t.online || 0);
      var dailyChart = chartHtml(padDaily(data, days), {
        cls: "zui-bar",
        label: function (r) { return r.date.slice(5); },
        title: function (r) { return r.date + "：" + r.pv + " PV / " + r.uv + " UV"; },
      });
      var hourChart = chartHtml(padHourly(data), {
        cls: "zui-hbar",
        label: function (r) { return pad2(r.hour); },
        title: function (r) { return pad2(r.hour) + ":00 — " + r.pv + " PV / " + r.uv + " UV"; },
      });
      root.innerHTML =
        '<div class="zui-stats-grid">' +
        statCard(thousands(t.pv), "总浏览量") +
        statCard(thousands(t.uv), "独立访客") +
        statCard(fmtDuration(t.avgDuration), "平均停留") +
        statCard((t.bounceRate || 0) + "%", "跳出率") +
        statCard(thousands(t.sessions), "会话数") +
        statCard(thousands(online), "当前在线") +
        "</div>" +
        (t.pv ? "" : '<p class="muted">还没有访问记录，产生首次访问后这里会自动出现图表。</p>') +
        "<h3>近 " + days + " 天</h3>" +
        '<div class="zui-bars">' + dailyChart + "</div>" +
        "<h3>24 小时分布</h3>" +
        '<div class="zui-bars zui-bars-sm">' + hourChart + "</div>" +
        '<div class="zui-stat-panels">' +
        panel("热门页面", rowsHtml((data.pages || []).slice(0, 10), "path", true)) +
        panel("访问来源", rowsHtml((data.referrers || []).slice(0, 10), "source")) +
        panel("浏览器", rowsHtml((data.browsers || []).slice(0, 10), "name")) +
        panel("操作系统", rowsHtml((data.os || []).slice(0, 10), "name")) +
        panel("设备类型", rowsHtml((data.devices || []).slice(0, 10), "name")) +
        panel("实时动态", rowsHtml([
          { name: "当前在线访客", count: online },
          { name: "近 30 分钟浏览量", count: rt.last30m || 0 },
          { name: "统计区间（天）", count: days },
        ], "name"), true) +
        "</div>" +
        '<p class="zui-stat-foot">统计更新于 ' +
        esc((data.updated || "").slice(0, 16).replace("T", " ")) +
        " UTC · 自托管实时统计（无 Cookie / 不记录 IP / 不存原始 UA）</p>";
    }
    function initStats() {
      var root = document.getElementById("stats-root");
      if (!root) return;
      cfgPromise.then(function (cfg) {
        var days = parseInt(cfg.days, 10);
        if (!(days >= 1 && days <= 365)) days = 30;
        fetch("/api/stats?days=" + days, { cache: "no-store" })
          .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error("HTTP " + r.status)); })
          .then(function (d) { renderStats(d, days); })
          .catch(function () {
            root.innerHTML = '<div class="zui-stat-panels"><section class="zui-stat-panel zui-stat-panel--wide">' +
              "<h3>统计接口暂不可用</h3>" +
              '<p class="muted">数据由站点函数实时聚合，可能正在部署或尚无访问记录。稍后刷新本页即可重试。</p>' +
              '<button type="button" id="stats-retry">重新加载</button></section></div>';
            var btn = document.getElementById("stats-retry");
            if (btn) btn.addEventListener("click", function () { location.reload(); });
          });
      });
    }
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initStats);
    else initStats();
  })();