(function () {
  if (!window.CMS || !window.h || !window.createClass) {
    return;
  }

  var h = window.h;
  var createClass = window.createClass;
  var overviewRoute = "#/collections/overview/entries/dashboard";

  function syncDashboardRoute() {
    document.body.classList.toggle(
      "qexo-dashboard-route",
      window.location.hash.indexOf(overviewRoute) === 0
    );
  }

  window.addEventListener("hashchange", syncDashboardRoute);
  syncDashboardRoute();

  if (window.netlifyIdentity) {
    window.netlifyIdentity.on("login", function () {
      window.location.replace("/admin/" + overviewRoute);
    });
    window.netlifyIdentity.on("logout", function () {
      window.location.replace("/admin/");
    });
  }

  function formatDate(value) {
    if (!value) {
      return "";
    }
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return String(value).slice(0, 10);
    }
    return date.toLocaleDateString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    });
  }

  function formatDateTime(value) {
    if (!value) {
      return "尚未生成";
    }
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return String(value);
    }
    return date.toLocaleString("zh-CN", {
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  function greeting() {
    var hour = new Date().getHours();
    if (hour < 6) {
      return "夜深了";
    }
    if (hour < 11) {
      return "早上好";
    }
    if (hour < 14) {
      return "中午好";
    }
    if (hour < 18) {
      return "下午好";
    }
    return "晚上好";
  }

  function absoluteUrl(base, path) {
    if (!path) {
      return base || "/";
    }
    if (/^https?:\/\//i.test(path)) {
      return path;
    }
    return String(base || "").replace(/\/+$/, "") + "/" + String(path).replace(/^\/+/, "");
  }

  function action(href, title, description, primary) {
    return h(
      "a",
      {
        className: "qexo-action" + (primary ? " qexo-action-primary" : ""),
        href: href
      },
      h("strong", null, title),
      h("span", null, description)
    );
  }

  function stat(label, value, hint) {
    return h(
      "div",
      { className: "qexo-stat" },
      h("span", { className: "qexo-stat-label" }, label),
      h("strong", { className: "qexo-stat-value" }, value == null ? "—" : String(value)),
      h("span", { className: "qexo-stat-hint" }, hint || "")
    );
  }

  var Dashboard = createClass({
    displayName: "QexoDashboard",

    getInitialState: function () {
      return {
        loading: true,
        error: "",
        manifest: null
      };
    },

    componentDidMount: function () {
      this.mounted = true;
      this.enhanceShell();
      this.loadManifest();
    },

    componentWillUnmount: function () {
      this.mounted = false;
      this.releaseShell();
    },

    enhanceShell: function () {
      var node = document.querySelector(".qexo-dashboard");
      while (node && node !== document.body) {
        if (String(node.className || "").indexOf("ControlPaneContainer") !== -1) {
          node.classList.add("qexo-dashboard-shell");
          this.shell = node;
          return;
        }
        node = node.parentElement;
      }
    },

    releaseShell: function () {
      if (this.shell) {
        this.shell.classList.remove("qexo-dashboard-shell");
        this.shell = null;
      }
    },

    loadManifest: function () {
      var self = this;
      if (this.mounted) {
        this.setState({ loading: true, error: "" });
      }

      window
        .fetch("/admin/manifest.json?t=" + Date.now(), { cache: "no-store" })
        .then(function (response) {
          if (!response.ok) {
            throw new Error("HTTP " + response.status);
          }
          return response.json();
        })
        .then(function (manifest) {
          if (self.mounted) {
            self.setState({ loading: false, manifest: manifest, error: "" });
          }
        })
        .catch(function (error) {
          if (self.mounted) {
            self.setState({
              loading: false,
              manifest: null,
              error: "工作台数据读取失败：" + error.message
            });
          }
        });
    },

    render: function () {
      var state = this.state;
      var manifest = state.manifest || {};
      var counts = manifest.counts || {};
      var latestPosts = manifest.latestPosts || [];
      var site = manifest.site || {};
      var user =
        window.netlifyIdentity && window.netlifyIdentity.currentUser
          ? window.netlifyIdentity.currentUser()
          : null;
      var userName = user && user.user_metadata && user.user_metadata.full_name
        ? user.user_metadata.full_name
        : "博主";

      if (state.loading) {
        return h(
          "div",
          { className: "qexo-dashboard" },
          h("div", { className: "qexo-skeleton" }),
          h("div", { className: "qexo-skeleton", style: { marginTop: 18 } })
        );
      }

      if (state.error) {
        return h(
          "div",
          { className: "qexo-dashboard" },
          h(
            "div",
            { className: "qexo-error" },
            state.error,
            h(
              "button",
              {
                type: "button",
                onClick: this.loadManifest
              },
              "重新读取"
            )
          )
        );
      }

      return h(
        "div",
        { className: "qexo-dashboard" },
        h(
          "section",
          { className: "qexo-hero" },
          h(
            "div",
            { className: "qexo-hero-copy" },
            h("p", { className: "qexo-eyebrow" }, "CONTENT STUDIO · " + (site.title || "醉里博客")),
            h("h1", null, greeting() + "，" + userName),
            h(
              "p",
              null,
              "这里是你的 Hexo 内容工作台。文章、页面、友链、导航、说说和图片都走同一套 Git Gateway 发布流程。"
            )
          ),
          h(
            "div",
            { className: "qexo-hero-actions" },
            h("a", { className: "qexo-btn qexo-btn-primary", href: "#/collections/posts/new" }, "写一篇新文章"),
            h(
              "a",
              {
                className: "qexo-btn",
                href: absoluteUrl(site.url, site.path || "/"),
                target: "_blank",
                rel: "noopener noreferrer"
              },
              "查看站点"
            )
          )
        ),
        h(
          "section",
          { className: "qexo-stats" },
          stat("文章", counts.posts, "已发布的 Hexo 文章"),
          stat("页面", counts.pages, "关于、友链、说说等"),
          stat("友链", counts.friends, "首页友链数据"),
          stat("说说", counts.talks, "短内容时间线"),
          stat("标签", counts.tags, "内容分类维度")
        ),
        h(
          "div",
          { className: "qexo-columns" },
          h(
            "section",
            { className: "qexo-panel" },
            h(
              "div",
              { className: "qexo-panel-head" },
              h("div", null, h("h2", null, "最近文章"), h("p", null, "快速回到最近维护的内容")),
              h("a", { className: "qexo-link", href: "#/collections/posts" }, "全部文章")
            ),
            latestPosts.length
              ? h(
                  "ul",
                  { className: "qexo-post-list" },
                  latestPosts.map(function (post) {
                    return h(
                      "li",
                      { className: "qexo-post-item", key: post.path || post.title },
                      h(
                        "a",
                        {
                          href: absoluteUrl(site.url, post.path),
                          target: "_blank",
                          rel: "noopener noreferrer"
                        },
                        h("span", { className: "qexo-post-title" }, post.title || "未命名文章"),
                        h("time", { className: "qexo-post-date" }, formatDate(post.date))
                      )
                    );
                  })
                )
              : h("div", { className: "qexo-empty" }, "暂时没有文章")
          ),
          h(
            "section",
            { className: "qexo-panel" },
            h(
              "div",
              { className: "qexo-panel-head" },
              h("div", null, h("h2", null, "快捷操作"), h("p", null, "常用入口集中在工作台"))
            ),
            h(
              "div",
              { className: "qexo-actions" },
              action("#/collections/posts/new", "新建文章", "Markdown 编辑器"),
              action("#/collections/talks/entries/main", "发布说说", "短内容时间线"),
              action("#/collections/settings/entries/fluid", "主题与友链", "导航、横幅、友链"),
              action("#/media", "图片媒体库", "上传与复用图片")
            )
          )
        ),
        h(
          "section",
          { className: "qexo-panel qexo-workflow" },
          h(
            "div",
            { className: "qexo-panel-head" },
            h(
              "div",
              null,
              h("h2", null, "发布流程"),
              h("p", null, "采用 Netlify CMS 的编辑工作流，保存后先进入待审草稿")
            ),
            h("a", { className: "qexo-link", href: "#/workflow" }, "打开待审队列")
          ),
          h(
            "div",
            { className: "qexo-steps" },
            h("div", { className: "qexo-step" }, h("b", null, "1"), "在内容集合中编辑并保存草稿"),
            h("div", { className: "qexo-step" }, h("b", null, "2"), "在编辑流程中检查修改内容"),
            h("div", { className: "qexo-step" }, h("b", null, "3"), "发布后触发 Netlify 自动构建"),
            h("div", { className: "qexo-step" }, h("b", null, "4"), "构建完成后新内容自动上线")
          ),
          h(
            "div",
            { className: "qexo-meta" },
            h("span", null, "构建清单：" + formatDateTime(manifest.generatedAt)),
            h("span", null, "Hexo " + (manifest.hexoVersion || "6")),
            h("span", null, "后台版本：" + (manifest.adminVersion || "3.0.0"))
          )
        )
      );
    }
  });

  try {
    window.CMS.registerWidget("qexo-dashboard", Dashboard, Dashboard);
  } finally {
    window.CMS.init();
  }
})();
