/* ============================================================
   醉里博客 · 朋友圈（本地数据版）

   唯一数据源：本站静态文件 /fcircle/moments.json
   （source/fcircle/moments.json 入库，来自本站友情链接的朋友圈数据）。

   数据怎么来：GitHub Actions 每 5 分钟跑一次 .github/scripts/fcircle-refresh.mjs，
   抓友链 Atom/RSS，有新文章才提交回仓库；提交触发 Netlify 部署，页面读到新的 JSON。
   5 分钟是 Actions cron 的硬下限，也是这台站能接受的最短周期——
   更短就得在 Netlify 侧跑定时函数，1440 次/天的调用纯属浪费，v4.4.4 已移除。

   运行时不请求任何第三方接口，也没有反代 / CORS 问题。
   排序、分页、随机文章全部在本地完成。

   字段（hexo-circle-of-friends /all 原始格式）：
     statistical_data: friends_num / active_num / error_num / article_num
                       last_updated_time（有新文章才变）/ last_checked_time（最近一次探测）
     article_data[]:   floor / title / link / author / avatar / created / updated

   全部原生 JS、ES5 语法（js_minifier 开启且 mangle），
   动态内容一律 textContent / createElement，URL 白名单校验。
   ============================================================ */
(function () {
  "use strict";

  var CFG = {
    dataUrl: "/fcircle/moments.json",
    pageSize: 24,
    defaultAvatar: "data:image/svg+xml;charset=utf-8," + encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="32" fill="#8899aa"/><text x="32" y="42" font-size="28" text-anchor="middle" fill="#fff" font-family="sans-serif">友</text></svg>'
    )
  };

  var state = {
    all: [],
    shown: CFG.pageSize,
    stats: null,
    sort: "created",
    loaded: false
  };

  /* ---------- 基础工具 ---------- */

  function byId(id) { return document.getElementById(id); }

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function safeUrl(u) {
    var s = String(u || "").trim();
    return /^https?:\/\//i.test(s) ? s : "";
  }

  function hostOf(u) {
    var m = String(u || "").match(/^https?:\/\/([^\/?#]+)/i);
    return m ? m[1] : "";
  }

  /** 本地数据里 created/updated 多为 YYYY-MM-DD，直接回传避免时区偏移 */
  function fmtDate(value) {
    var s = String(value || "").trim();
    if (!s) return "未知";
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    var d = new Date(s);
    if (isNaN(d.getTime())) return s.slice(0, 10);
    try {
      var parts = new Intl.DateTimeFormat("zh-CN", {
        timeZone: "Asia/Shanghai",
        year: "numeric", month: "2-digit", day: "2-digit"
      }).formatToParts(d);
      var y = "", m = "", day = "";
      for (var i = 0; i < parts.length; i++) {
        if (parts[i].type === "year") y = parts[i].value;
        else if (parts[i].type === "month") m = parts[i].value;
        else if (parts[i].type === "day") day = parts[i].value;
      }
      return y + "-" + m + "-" + day;
    } catch (e) {
      return s.slice(0, 10);
    }
  }

  function clip(s, n) {
    var t = String(s || "").replace(/\s+/g, " ").trim();
    return t.length > n ? t.slice(0, n) + "…" : t;
  }

  function load() {
    return fetch(CFG.dataUrl).then(function (res) {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    }).then(function (payload) {
      if (!payload || !Array.isArray(payload.article_data)) {
        throw new Error("数据结构不符合预期");
      }
      return payload;
    });
  }

  /* ---------- 骨架 ---------- */

  function buildSkeleton() {
    var root = byId("fcircleApp");
    if (!root) return false;
    root.innerHTML =
      '<div class="fc-hero">' +
        '<h1 class="fc-hero-title">朋友圈</h1>' +
        '<p class="fc-hero-desc">本站友情链接博主的最新文章。数据保存在本站，' +
          '不依赖任何第三方接口。</p>' +
      '</div>' +
      '<section class="fc-panel">' +
        '<div class="fc-panel-head"><h2>🎣 钓鱼</h2>' +
          '<button type="button" class="fc-btn" id="fcFishBtn">换一篇</button></div>' +
        '<div class="fc-fish-body" id="fcFishBody">钓鱼中...</div>' +
      '</section>' +
      '<section class="fc-panel">' +
        '<div class="fc-panel-head"><h2>🐟 朋友圈</h2>' +
          '<button type="button" class="fc-btn" id="fcSortBtn">按发布时间</button></div>' +
        '<div class="fc-grid" id="fcGrid"></div>' +
        '<div class="fc-more-wrap"><button type="button" class="fc-more" id="fcMoreBtn">加载更多</button></div>' +
        '<div class="fc-foot" id="fcFoot"></div>' +
        '<div class="fc-source" id="fcSource"></div>' +
      '</section>';
    return true;
  }

  /* ---------- 渲染 ---------- */

  function makeCard(item) {
    var url = safeUrl(item.link);
    var card = document.createElement(url ? "a" : "article");
    card.className = "fc-card";
    if (url) {
      card.href = url;
      card.target = "_blank";
      card.rel = "noopener noreferrer nofollow";
    }

    var head = el("div", "fc-card-head");
    var img = document.createElement("img");
    img.className = "fc-avatar";
    img.alt = "";
    img.loading = "lazy";
    img.src = safeUrl(item.avatar) || CFG.defaultAvatar;
    var avatarFailed = false;
    img.onerror = function () {
      if (!avatarFailed) { avatarFailed = true; img.src = CFG.defaultAvatar; }
    };
    head.appendChild(img);

    var meta = el("div", "fc-card-meta");
    meta.appendChild(el("span", "fc-name", item.author || "未知站点"));
    meta.appendChild(el("time", "fc-date", fmtDate(item.created)));
    head.appendChild(meta);
    card.appendChild(head);

    card.appendChild(el("h3", "fc-card-title", clip(item.title, 60) || "未命名文章"));
    var host = hostOf(url);
    card.appendChild(el("p", "fc-card-summary", host ? "发布于 " + host : "本站友情链接"));
    card.appendChild(el("div", "fc-card-foot", url ? "阅读全文 →" : "链接不可用"));
    return card;
  }

  function renderFoot() {
    var foot = byId("fcFoot");
    if (!foot) return;
    foot.innerHTML = "";
    var s = state.stats || {};
    var items = [
      ["订阅", s.friends_num],
      ["活跃", s.active_num],
      ["日志", s.article_num]
    ];
    for (var i = 0; i < items.length; i++) {
      var box = el("div", "fc-info");
      box.appendChild(el("span", "fc-info-label", items[i][0]));
      box.appendChild(el("span", "fc-info-value", items[i][1] === undefined ? "-" : items[i][1]));
      foot.appendChild(box);
    }
    foot.appendChild(el("span", "fc-update",
      "更新于：" + (s.last_updated_time || "-") +
      (s.last_checked_time ? "　检查于：" + s.last_checked_time : "")));
  }

  function updateMore() {
    var btn = byId("fcMoreBtn");
    if (!btn) return;
    var hasMore = state.shown < state.all.length;
    btn.disabled = !hasMore;
    btn.textContent = hasMore
      ? "加载更多（已显示 " + Math.min(state.shown, state.all.length) + " / " + state.all.length + "）"
      : "------- 没有更多了喔 -------";
  }

  function render() {
    var grid = byId("fcGrid");
    if (!grid) return;
    grid.innerHTML = "";
    var rows = state.all.slice(0, state.shown);
    if (!rows.length) {
      grid.appendChild(el("div", "fc-empty", "暂无朋友圈内容"));
    } else {
      for (var i = 0; i < rows.length; i++) grid.appendChild(makeCard(rows[i]));
    }
    renderFoot();
    updateMore();
    var s = state.stats || {};
    setSource("本地数据 · 每 5 分钟自动采集 · 共 " + state.all.length + " 篇 · 更新于 " +
      (s.last_updated_time || "-"));
  }

  function setSource(text) {
    var node = byId("fcSource");
    if (node) node.textContent = text;
  }

  function showError(text) {
    var grid = byId("fcGrid");
    if (grid) {
      grid.innerHTML = "";
      grid.appendChild(el("div", "fc-empty", text));
    }
    setSource("本地数据读取失败");
  }

  /* ---------- 本地排序 / 分页 / 随机 ---------- */

  function sortRows() {
    var key = state.sort;
    state.all.sort(function (a, b) {
      var x = String(a[key] || ""), y = String(b[key] || "");
      return x < y ? 1 : x > y ? -1 : 0;
    });
  }

  function fish() {
    var body = byId("fcFishBody");
    if (!body) return;
    if (!state.all.length) {
      body.textContent = "暂无可钓的文章";
      return;
    }
    var item = state.all[Math.floor(Math.random() * state.all.length)];
    var link = safeUrl(item.link);
    body.innerHTML = "";
    body.appendChild(document.createTextNode("来自友链 "));
    body.appendChild(el("b", "", item.author || "某位朋友"));
    body.appendChild(document.createTextNode(" 的文章："));
    if (link) {
      var a = el("a", "fc-fish-link", item.title || "未命名文章");
      a.href = link;
      a.target = "_blank";
      a.rel = "noopener noreferrer nofollow";
      body.appendChild(a);
    } else {
      body.appendChild(el("span", "", item.title || "未命名文章"));
    }
  }

  function bindEvents() {
    var sortBtn = byId("fcSortBtn");
    if (sortBtn) sortBtn.addEventListener("click", function () {
      state.sort = state.sort === "created" ? "updated" : "created";
      sortBtn.textContent = state.sort === "created" ? "按发布时间" : "按更新时间";
      state.shown = CFG.pageSize;
      sortRows();
      render();
    });

    var moreBtn = byId("fcMoreBtn");
    if (moreBtn) moreBtn.addEventListener("click", function () {
      state.shown += CFG.pageSize;
      render();
    });

    var fishBtn = byId("fcFishBtn");
    if (fishBtn) fishBtn.addEventListener("click", fish);
  }

  function start() {
    bindEvents();
    render();
    load().then(function (payload) {
      state.all = payload.article_data.slice();
      state.stats = payload.statistical_data || {};
      state.shown = CFG.pageSize;
      state.loaded = true;
      sortRows();
      render();
      fish();
    }).catch(function (err) {
      showError("朋友圈数据读取失败，请稍后再试（" + (err && err.message) + "）");
    });
  }

  function boot() {
    var root = byId("fcircleApp");
    if (!root || root.getAttribute("data-fc-ready")) return;
    root.setAttribute("data-fc-ready", "1");
    if (buildSkeleton()) start();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
