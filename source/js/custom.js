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

  /* ---------- 站点统计 v6（自托管 · Netlify Blobs append-only 事件） ----------
     采集：pv + 可见心跳 + 离开；聚合：GET /api/stats（北京时间、真实数据时间）
     本文件走 Hexo 的 js_minifier，保持 ES5 语法。 */
  (function () {
    var API = "/api/collect";
    var HEARTBEAT_MS = 60000;
    var DEFAULT_EXCLUDES = ["/admin", "/stats"];

    function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
    function attr(s) { return esc(s).replace(/"/g, "&quot;").replace(/'/g, "&#39;"); }
    function pad2(n) { return n < 10 ? "0" + n : String(n); }
    function thousands(n) { return String(n || 0).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
    function fmtDuration(sec) {
      var s = Math.max(0, Math.round(sec || 0));
      if (s >= 3600) return Math.floor(s / 3600) + "h " + pad2(Math.floor((s % 3600) / 60)) + "m";
      return Math.floor(s / 60) + ":" + pad2(s % 60);
    }
    function bjDate() { return new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10); }
    function genId() { return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10); }

    function vid() {
      try {
        var k = "zui_vid", v = localStorage.getItem(k);
        if (!v || !/^[a-zA-Z0-9_-]{6,64}$/.test(v)) {
          v = (window.crypto && crypto.randomUUID)
            ? crypto.randomUUID()
            : genId();
          localStorage.setItem(k, v);
        }
        return v;
      } catch (_) { return ""; }
    }

    /* 后台「设置 → 访问统计」写入 source/analytics/config.json，
       构建后为 /analytics/config.json；采集与展示共用这一份配置。 */
    var cfgPromise = fetch("/analytics/config.json", { cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : {}; })
      .catch(function () { return {}; });

    function excluded(path, cfg) {
      var list = (cfg && Array.isArray(cfg.excludePaths)) ? cfg.excludePaths : DEFAULT_EXCLUDES;
      for (var i = 0; i < list.length; i++) {
        if (list[i] && path.indexOf(String(list[i])) === 0) return true;
      }
      return false;
    }
    function allowed(cfg) {
      if (!cfg || cfg.enabled === false) return false;
      if (location.protocol.indexOf("http") !== 0) return false;
      if (navigator.doNotTrack === "1" || window.doNotTrack === "1") return false;
      if (/bot|spider|crawl|slurp|headless/i.test(navigator.userAgent)) return false;
      if (excluded(location.pathname, cfg)) return false;
      return true;
    }

    var st = {
      cfg: null, vid: "", eid: "", date: "", path: "", dwell: 0,
      visibleSince: 0, lastPv: 0, leftSent: false, timer: null,
    };

    function baseBody() {
      var sw = window.screen ? window.screen.width : window.innerWidth;
      var sh = window.screen ? window.screen.height : window.innerHeight;
      return {
        v: st.vid, eid: st.eid,
        p: location.pathname,
        t: document.title,
        r: document.referrer || "",
        u: location.href,
        ua: navigator.userAgent,
        w: sw, h: sh, screen: sw + "x" + sh,
        lang: navigator.language || "",
        dt: st.date,
      };
    }
    function post(body, useBeacon) {
      var payload = JSON.stringify(body);
      if (useBeacon && navigator.sendBeacon) {
        try {
          if (navigator.sendBeacon(API, new Blob([payload], { type: "application/json" }))) return;
        } catch (_) { /* 落到 fetch */ }
      }
      try {
        fetch(API, { method: "POST", body: payload, keepalive: true,
          headers: { "Content-Type": "application/json" } }).catch(function () {});
      } catch (_) { /* 采集失败不影响页面 */ }
    }
    function sendPageview() {
      var b = baseBody(); b.e = "pv";
      var payload = JSON.stringify(b);
      try {
        fetch(API, { method: "POST", body: payload, keepalive: true,
          headers: { "Content-Type": "application/json" } })
          .then(function (r) { return r.ok ? r.json() : null; })
          .then(function (j) { if (j && j.date) st.date = j.date; })
          .catch(function () {});
      } catch (_) { post(b, false); }
    }
    function startPage() {
      if (!allowed(st.cfg)) return;
      var now = Date.now();
      if (now - st.lastPv < 5000 && st.path === location.pathname) return;
      st.lastPv = now;
      st.path = location.pathname;
      st.eid = genId();
      st.date = bjDate();
      st.dwell = 0;
      st.leftSent = false;
      st.visibleSince = document.visibilityState === "visible" ? now : 0;
      sendPageview();
      if (!st.timer) st.timer = setInterval(heartbeat, HEARTBEAT_MS);
    }
    function heartbeat() {
      if (!st.eid || !allowed(st.cfg) || document.visibilityState !== "visible") return;
      var now = Date.now();
      if (st.visibleSince) {
        st.dwell += Math.min(HEARTBEAT_MS / 1000 + 10, (now - st.visibleSince) / 1000);
        st.visibleSince = now;
      }
      var b = baseBody(); b.e = "dwell"; b.d = Math.round(st.dwell);
      post(b, false);
    }
    function sendLeave() {
      if (!st.eid || st.leftSent || !st.cfg) return;
      st.leftSent = true;
      var extra = st.visibleSince ? (Date.now() - st.visibleSince) / 1000 : 0;
      var b = baseBody(); b.e = "leave"; b.d = Math.round(st.dwell + extra);
      post(b, true);
    }
    function setupTracker() {
      document.addEventListener("visibilitychange", function () {
        var now = Date.now();
        if (document.visibilityState === "visible") {
          st.visibleSince = now;
          st.leftSent = false;
        } else {
          if (st.visibleSince) {
            st.dwell += (now - st.visibleSince) / 1000;
            st.visibleSince = 0;
          }
          sendLeave();
        }
      });
      window.addEventListener("pagehide", sendLeave);
      window.addEventListener("beforeunload", sendLeave);
      window.addEventListener("popstate", function () {
        if (st.path !== location.pathname) startPage();
      });
    }

    cfgPromise.then(function (cfg) {
      st.cfg = cfg || {};
      var beat = parseInt(st.cfg.heartbeatSeconds, 10);
      HEARTBEAT_MS = (beat >= 15 && beat <= 300) ? beat * 1000 : 60000;
      st.vid = vid();
      if (!st.vid || !allowed(st.cfg)) return;
      setupTracker();
      startPage();
    });

    /* ---------- 看板渲染 ---------- */
    function shortTime(s) {
      if (!s) return "—";
      return String(s).slice(0, 16).replace("T", " ");
    }
    function delta(cmp) {
      if (!cmp || cmp.changePct == null) return { cls: "", text: "环比 —" };
      var v = cmp.changePct;
      if (v > 0) return { cls: "zui-stat-up", text: "环比 ↑ +" + v + "%" };
      if (v < 0) return { cls: "zui-stat-down", text: "环比 ↓ " + v + "%" };
      return { cls: "", text: "环比 持平" };
    }
    function statCard(value, label, tip, sub) {
      return '<div class="zui-stat-card" title="' + attr(tip || "") + '"><b>' + value +
        "</b><span>" + esc(label) + "</span>" +
        (sub ? '<em class="zui-stat-kpi-sub ' + sub.cls + '">' + esc(sub.text) + "</em>" : "") +
        "</div>";
    }
    function chartHtml(rows, opt) {
      var max = 1;
      rows.forEach(function (r) { if (r.pv > max) max = r.pv; });
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
    function rowsHtml(list, key, link, extra) {
      if (!list || !list.length) return '<p class="muted">暂无数据</p>';
      return list.map(function (x) {
        var name = String((x && x[key]) || "-");
        var left = link && name.charAt(0) === "/"
          ? '<a href="' + attr(name) + '" title="' + attr(name) + '">' + esc(name) + "</a>"
          : '<span title="' + attr(name) + '">' + esc(name) + "</span>";
        return '<div class="zui-stat-row">' + left +
          (extra ? '<small class="zui-stat-row-extra">' + esc(extra(x)) + "</small>" : "") +
          "<b>" + thousands(x && x.count) + "</b></div>";
      }).join("");
    }
    function panel(title, body, wide, note) {
      return '<section class="zui-stat-panel' + (wide ? " zui-stat-panel--wide" : "") + '">' +
        "<h3>" + esc(title) + (note ? ' <small class="zui-stat-panel-note">' + esc(note) + "</small>" : "") +
        "</h3>" + body + "</section>";
    }
    function categoryHtml(list) {
      if (!list || !list.length) return '<p class="muted">暂无数据</p>';
      var total = 0;
      list.forEach(function (x) { total += x.count; });
      return list.map(function (x) {
        var p = total ? Math.round((x.count / total) * 100) : 0;
        return '<div class="zui-stat-bar-row"><span>' + esc(x.name) + "</span>" +
          '<div class="zui-stat-track"><i style="width:' + p + '%"></i></div>' +
          "<b>" + thousands(x.count) + ' <small>' + p + "%</small></b></div>";
      }).join("");
    }
    function pageTableHtml(pages) {
      if (!pages || !pages.length) return '<p class="muted">暂无数据</p>';
      var rows = pages.slice(0, 12).map(function (p) {
        return "<tr><td><a href=\"" + attr(p.path) + "\" title=\"" + attr(p.path) + "\">" + esc(p.path) + "</a></td>" +
          "<td>" + thousands(p.count) + "</td><td>" + thousands(p.uv) + "</td>" +
          "<td>" + thousands(p.entry) + "</td><td>" + thousands(p.exit) + "</td>" +
          "<td>" + (p.avgDwell ? fmtDuration(p.avgDwell) : "—") + "</td></tr>";
      }).join("");
      return '<div class="zui-stat-table-wrap"><table class="zui-stat-table"><thead><tr>' +
        "<th>页面</th><th>PV</th><th>UV</th><th>入口</th><th>出口</th><th>平均停留</th>" +
        "</tr></thead><tbody>" + rows + "</tbody></table></div>";
    }
    function realtimeHtml(rt) {
      if (!rt || !rt.visitors || !rt.visitors.length) {
        return '<p class="muted">最近 ' + ((rt && rt.windowMinutes) || 5) + " 分钟没有在线访客（在线 = 有浏览或心跳活动的匿名访客）</p>";
      }
      var rows = rt.visitors.map(function (v) {
        return "<tr><td><code>" + esc(v.id) + "</code></td><td>" + esc(v.path) + "</td>" +
          "<td>" + esc(v.source) + "</td><td>" + esc(v.device) + " / " + esc(v.browser) + "</td>" +
          "<td>" + esc(v.region || "—") + "</td><td>" + (v.dwell ? fmtDuration(v.dwell) : "—") + "</td>" +
          "<td>" + esc(shortTime(v.at)) + "</td></tr>";
      }).join("");
      return '<div class="zui-stat-table-wrap"><table class="zui-stat-table"><thead><tr>' +
        "<th>访客</th><th>当前页面</th><th>来源</th><th>设备 / 浏览器</th><th>地区</th><th>停留</th><th>最后活跃</th>" +
        "</tr></thead><tbody>" + rows + "</tbody></table></div>";
    }
    function healthHtml(d) {
      var m = d.meta || {}, h = d.health || {};
      var status = h.status || "no_data";
      var cls = status === "ok" ? "ok" : (status === "degraded" ? "warn" : "empty");
      var label = status === "ok" ? "采集正常" : (status === "degraded" ? "数据可能不完整" : "尚无采集数据");
      var items = [
        ["数据截至", m.lastEventDisplay || "无数据"],
        ["本次计算", shortTime(m.computedAt)],
        ["缓存", m.cache && m.cache.hit ? ("命中 · " + m.cache.ageSeconds + " 秒前") : "实时聚合"],
        ["时区", (m.timezone || "Asia/Shanghai") + " (UTC+8)"],
        ["数据覆盖", (h.daysWithData || 0) + " / " + (h.daysRequested || 0) + " 天"],
        ["扫描事件", thousands(h.eventsScanned)],
        ["停留覆盖", (h.dwellCoverage || 0) + "%"],
        ["IP 归属库", h.geoip && h.geoip.available ? "本地库可用" : "降级兜底"],
        ["机器流量", h.machineFilter && h.machineFilter.enabled ? "已过滤 " + (h.machineFilter.rules || 0) + " 类" : "未启用"],
        ["引擎", "v" + esc(m.schema || "6.0")],
      ];
      var grid = items.map(function (it) {
        return '<div class="zui-stat-health-item"><span>' + esc(it[0]) + "</span><b>" + esc(it[1]) + "</b></div>";
      }).join("");
      var warns = (h.warnings || []).length
        ? '<div class="zui-stat-health-warn">' + (h.warnings || []).map(function (w) {
            return "<div>· " + esc(w) + "</div>";
          }).join("") + "</div>"
        : "";
      return '<div class="zui-stat-health ' + cls + '">' +
        '<div class="zui-stat-health-head"><span class="zui-stat-dot"></span><b>' + esc(label) + "</b>" +
        '<span class="zui-stat-health-hint">数据截至是最后一条采集事件的北京时间，不是页面打开时间</span></div>' +
        '<div class="zui-stat-health-grid">' + grid + "</div>" + warns + "</div>";
    }
    function definitionsHtml(defs) {
      if (!defs) return "";
      var keys = Object.keys(defs);
      if (!keys.length) return "";
      return '<details class="zui-stat-defs"><summary>指标口径与数据可信度说明（' + keys.length + " 项）</summary><dl>" +
        keys.map(function (k) {
          return "<dt>" + esc(k) + "</dt><dd>" + esc(defs[k]) + "</dd>";
        }).join("") + "</dl></details>";
    }

    function renderStats(d) {
      var root = document.getElementById("stats-root");
      if (!root) return;
      var t = d.totals || {}, c = d.compare || {}, m = d.meta || {}, defs = m.definitions || {};
      var rt = d.realtime || {}, refs = d.referrers || {}, utm = d.utm || {};
      var days = (m.range && m.range.days) || 30;

      var cards = "";
      cards += statCard(thousands(t.pv), "浏览量 PV", defs.pv, delta(c.pv));
      cards += statCard(thousands(t.uv), "独立访客 UV", defs.uv, delta(c.uv));
      cards += statCard(thousands(t.avgDailyUv), "日均独立访客", defs.avgDailyUv);
      cards += statCard(thousands(t.sessions), "会话 / 访问", defs.sessions, delta(c.sessions));
      cards += statCard((t.bounceRate || 0) + "%", "跳出率", defs.bounceRate);
      cards += statCard(fmtDuration(t.avgDuration), "平均停留", defs.avgDuration);
      cards += statCard(String(t.pagesPerSession || 0), "访问深度", defs.pagesPerSession);
      cards += statCard(thousands(t.online), "当前在线", defs.online);
      cards += statCard(thousands(t.newVisitors), "新访客", defs.newVisitors);
      cards += statCard(thousands(t.returningVisitors), "老访客", defs.returningVisitors);

      var dailyChart = chartHtml(d.daily || [], {
        cls: "zui-bar",
        label: function (r) { return r.date.slice(5); },
        title: function (r) { return r.date + "：" + r.pv + " PV / " + r.uv + " UV / " + r.sessions + " 会话"; },
      });
      var hourChart = chartHtml(padHourly(d), {
        cls: "zui-hbar",
        label: function (r) { return pad2(r.hour); },
        title: function (r) { return pad2(r.hour) + ":00 — " + r.pv + " PV / " + r.uv + " UV"; },
      });

      var panels = "";
      panels += panel("流量来源分类", categoryHtml(refs.categories), false, "按来源渠道占比");
      panels += panel("来源明细", rowsHtml(refs.details, "name"), false, "含搜索引擎 / 社交 / 外链");
      panels += panel("热门页面", pageTableHtml(d.pages), true, "含入口 / 出口 / 停留");
      panels += panel("入口页面", rowsHtml(d.entryPages, "path", true));
      panels += panel("退出页面", rowsHtml(d.exitPages, "path", true));
      panels += panel("浏览器", rowsHtml(d.browsers, "name"));
      panels += panel("操作系统", rowsHtml(d.os, "name"));
      panels += panel("设备类型", rowsHtml(d.devices, "name"));
      panels += panel("屏幕分辨率", rowsHtml(d.screens, "name"));
      panels += panel("语言", rowsHtml(d.languages, "name"));
      panels += panel("访客地区", rowsHtml(d.regions, "name"), false, "省 市 运营商，如 湖北 孝感 联通");
      panels += panel("省份分布", rowsHtml(d.provinces, "name"));
      panels += panel("运营商分布", rowsHtml(d.isps, "name"));
      panels += panel("搜索关键词", rowsHtml(refs.keywords, "name"));
      panels += panel("外部链接域名", rowsHtml(refs.domains, "name"));
      panels += panel("活动参数 UTM",
        rowsHtml(utm.sources, "name") + rowsHtml(utm.mediums, "name") + rowsHtml(utm.campaigns, "name"),
        false, "来源 / 媒介 / 活动");
      panels += panel("实时访客", realtimeHtml(rt), true, "匿名，仅展示当前会话概况");

      root.innerHTML =
        healthHtml(d) +
        '<div class="zui-stats-grid">' + cards + "</div>" +
        (t.pv ? "" : '<p class="zui-stat-empty">尚无访问记录。产生首次访问后，这里会按北京时间逐日补齐序列，不会出现估算值。</p>') +
        "<h3>近 " + days + " 天趋势（北京时间）</h3>" +
        '<div class="zui-bars">' + dailyChart + "</div>" +
        "<h3>24 小时分布（北京时间）</h3>" +
        '<div class="zui-bars zui-bars-sm">' + hourChart + "</div>" +
        '<div class="zui-stat-panels">' + panels + "</div>" +
        definitionsHtml(defs) +
        '<p class="zui-stat-foot">自托管统计 · 每条浏览事件独立写入、原子去重，不覆盖并发请求；' +
        "无 Cookie 追踪、不记录 IP、不存原始 UA。" +
        "数据截至 " + esc(m.lastEventDisplay || "无") + " · 本次计算 " + esc(shortTime(m.computedAt)) +
        (m.cache && m.cache.hit ? " · 命中 " + m.cache.ageSeconds + " 秒前的聚合缓存" : " · 实时聚合") + "</p>";
    }

    function initStats() {
      var root = document.getElementById("stats-root");
      if (!root) return;
      cfgPromise.then(function (cfg) {
        var days = parseInt(cfg && cfg.days, 10);
        if (!(days >= 7 && days <= 90)) days = 30;
        fetch("/api/stats?days=" + days, { cache: "no-store" })
          .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error("HTTP " + r.status)); })
          .then(renderStats)
          .catch(function () {
            root.innerHTML = '<div class="zui-stat-panels"><section class="zui-stat-panel zui-stat-panel--wide">' +
              "<h3>统计接口暂不可用</h3>" +
              '<p class="muted">数据由站点函数实时聚合，可能正在部署或 Functions 尚未就绪。稍后刷新本页即可重试。</p>' +
              '<button type="button" id="stats-retry">重新加载</button></section></div>';
            var btn = document.getElementById("stats-retry");
            if (btn) btn.addEventListener("click", function () { location.reload(); });
          });
      });
    }
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initStats);
    else initStats();
  })();
