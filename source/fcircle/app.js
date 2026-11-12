/* ============================================================
   醉里博客 · 朋友圈（数据源对齐 blog.anheyu.com/fcircle）

   目标页用 Next.js 客户端调用 /api/pro/moments 拿数据，但该接口
   不带 CORS 响应头、OPTIONS 预检 403，浏览器不能跨域直连。这里走：
     1) /fcircle/moments.json  构建期同源快照 —— 首屏立即出内容；
     2) /fcircle/api/moments   同源反代实时接口 —— 成功后覆盖快照。
   全部原生 JS、ES5 语法（js_minifier 开启，避免 uglify 破坏），
   动态内容一律用 textContent / createElement，URL 白名单校验。
   ============================================================ */
(function () {
  "use strict";

  var CFG = {
    live: "/fcircle/api/moments",
    snapshot: "/fcircle/moments.json",
    random: "/fcircle/api/randompost",
    pageSize: 24,
    defaultAvatar: "data:image/svg+xml;charset=utf-8," + encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="32" fill="#8899aa"/><text x="32" y="42" font-size="28" text-anchor="middle" fill="#fff" font-family="sans-serif">友</text></svg>'
    )
  };

  var state = {
    list: [],
    total: 0,
    page: 1,
    stats: null,
    sort: "published_at",
    live: false,
    renderedLive: false,
    loading: false,
    source: ""
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

  function pad(n) { return n < 10 ? "0" + n : String(n); }

  /** 和目标站一致：按 Asia/Shanghai 输出 YYYY-MM-DD */
  function fmtDate(value) {
    if (!value) return "未知";
    var d = new Date(value);
    if (isNaN(d.getTime())) return String(value).slice(0, 10);
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
      return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
    }
  }

  function clip(s, n) {
    var t = String(s || "").replace(/\s+/g, " ").trim();
    return t.length > n ? t.slice(0, n) + "…" : t;
  }

  function load(url, noStore) {
    var opts = {};
    if (noStore) opts.cache = "no-store";
    return fetch(url, opts).then(function (res) {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    }).then(function (payload) {
      if (!payload || payload.code !== 200 || !payload.data) {
        throw new Error("响应结构不符合预期");
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
        '<p class="fc-hero-desc">汇聚友链博客的最新文章。数据获取方式对齐 ' +
          '<a href="https://blog.anheyu.com/fcircle" target="_blank" rel="noopener noreferrer nofollow">安和鱼 · 朋友圈</a>。' +
        '</p>' +
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
    var url = safeUrl(item.post_url);
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
    img.src = safeUrl(item.link_logo) || CFG.defaultAvatar;
    var avatarFailed = false;
    img.onerror = function () {
      if (!avatarFailed) { avatarFailed = true; img.src = CFG.defaultAvatar; }
    };
    head.appendChild(img);

    var meta = el("div", "fc-card-meta");
    meta.appendChild(el("span", "fc-name", item.link_name || "未知站点"));
    meta.appendChild(el("time", "fc-date", fmtDate(item.published_at)));
    head.appendChild(meta);
    card.appendChild(head);

    card.appendChild(el("h3", "fc-card-title", clip(item.post_title, 60) || "未命名文章"));
    var summary = clip(item.post_summary, 110);
    card.appendChild(el("p", "fc-card-summary", summary || "这篇文章没有摘要，点进去看看吧。"));
    card.appendChild(el("div", "fc-card-foot", url ? "阅读全文 →" : "链接不可用"));
    return card;
  }

  function renderFoot() {
    var foot = byId("fcFoot");
    if (!foot) return;
    foot.innerHTML = "";
    var s = state.stats || {};
    var items = [
      ["订阅", s.total_links],
      ["活跃", s.active_links],
      ["日志", s.total_moments]
    ];
    for (var i = 0; i < items.length; i++) {
      var box = el("div", "fc-info");
      box.appendChild(el("span", "fc-info-label", items[i][0]));
      box.appendChild(el("span", "fc-info-value", items[i][1] === undefined ? "-" : items[i][1]));
      foot.appendChild(box);
    }
    var upd = el("span", "fc-update", "更新于：" + (s.last_updated_time || "-"));
    foot.appendChild(upd);
  }

  function updateMore() {
    var btn = byId("fcMoreBtn");
    if (!btn) return;
    var hasMore = state.total > state.list.length;
    btn.disabled = state.loading || !hasMore;
    btn.textContent = state.loading ? "加载中..." : (hasMore ? "加载更多" : "------- 没有更多了喔 -------");
  }

  function setSource(text) {
    var node = byId("fcSource");
    if (node) node.textContent = text;
  }

  function render() {
    var grid = byId("fcGrid");
    if (!grid) return;
    grid.innerHTML = "";
    if (!state.list.length) {
      grid.appendChild(el("div", "fc-empty", "暂无朋友圈内容"));
    } else {
      for (var i = 0; i < state.list.length; i++) grid.appendChild(makeCard(state.list[i]));
    }
    renderFoot();
    updateMore();
    setSource(state.source === "live"
      ? "实时数据 · 已同步"
      : "构建期快照 · 正在连接实时数据");
  }

  /* ---------- 数据 ---------- */

  function applyPayload(payload, source, page) {
    var d = payload.data || {};
    var rows = Array.isArray(d.list) ? d.list : [];
    if (page === 1) {
      state.list = rows.slice();
    } else {
      state.list = state.list.concat(rows);
    }
    state.total = Number(d.total) || state.list.length;
    state.stats = d.statistics || state.stats;
    state.page = page;
    state.source = source;
  }

  function reload(page) {
    state.loading = true;
    updateMore();
    var q = "?page=" + page + "&page_size=" + CFG.pageSize +
      "&sort_type=" + encodeURIComponent(state.sort);
    return load(CFG.live + q, true).then(function (payload) {
      state.live = true;
      state.renderedLive = true;
      applyPayload(payload, "live", page);
      render();
    }).catch(function () {
      if (page > 1) {
        setSource("实时接口暂时不可用，无法加载更多，已保留当前内容");
      } else if (state.list.length) {
        state.live = false;
        setSource("实时接口暂时不可用，现显示构建期快照（每次站点部署时更新）");
      } else {
        gridError("朋友圈数据源暂时不可用，请稍后再试");
      }
    }).then(function () {
      state.loading = false;
      updateMore();
    });
  }

  function gridError(text) {
    var grid = byId("fcGrid");
    if (!grid) return;
    grid.innerHTML = "";
    grid.appendChild(el("div", "fc-empty", text));
    setSource("数据源异常");
  }

  function clientSort() {
    var key = state.sort === "published_at" ? "published_at" : "created_at";
    state.list.sort(function (a, b) {
      var x = String(a[key] || ""), y = String(b[key] || "");
      return x < y ? 1 : x > y ? -1 : 0;
    });
    render();
  }

  function fish() {
    var body = byId("fcFishBody");
    if (!body) return;
    body.textContent = "钓鱼中...";
    load(CFG.random, true).then(function (payload) {
      var d = payload.data || {};
      var link = safeUrl(d.link);
      if (!link) throw new Error("无效的文章链接");
      body.innerHTML = "";
      body.appendChild(document.createTextNode("来自友链 "));
      body.appendChild(el("b", "", d.author || "某位朋友"));
      body.appendChild(document.createTextNode(" 的文章："));
      var a = el("a", "fc-fish-link", d.title || "未命名文章");
      a.href = link;
      a.target = "_blank";
      a.rel = "noopener noreferrer nofollow";
      body.appendChild(a);
    }).catch(function () {
      body.textContent = "这次没钓到鱼，点「换一篇」再试试～";
    });
  }

  function bindEvents() {
    var sortBtn = byId("fcSortBtn");
    if (sortBtn) sortBtn.addEventListener("click", function () {
      state.sort = state.sort === "published_at" ? "fetched_at" : "published_at";
      sortBtn.textContent = state.sort === "published_at" ? "按发布时间" : "按抓取时间";
      clientSort();
      reload(1);
    });

    var moreBtn = byId("fcMoreBtn");
    if (moreBtn) moreBtn.addEventListener("click", function () {
      if (!state.loading) reload(state.page + 1);
    });

    var fishBtn = byId("fcFishBtn");
    if (fishBtn) fishBtn.addEventListener("click", fish);
  }

  function start() {
    bindEvents();
    render();

    /* 快照先出首屏；实时数据后到时覆盖，实时先到则忽略慢到的快照 */
    load(CFG.snapshot).then(function (payload) {
      if (state.renderedLive) return;
      applyPayload(payload, "snapshot", 1);
      render();
    }).catch(function () {
      if (!state.list.length && !state.renderedLive) {
        setSource("构建期快照不可用，正在连接实时数据");
      }
    });

    reload(1);
    fish();
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
