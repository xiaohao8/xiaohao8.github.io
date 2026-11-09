(function () {
  "use strict";

  var ADMIN_VERSION = "3.2.2";
  var boot = document.getElementById("admin-boot");
  if (!boot) {
    return;
  }

  var copy = document.getElementById("admin-boot-copy");
  var hint = document.getElementById("admin-boot-hint");
  var progress = document.getElementById("admin-boot-progress");
  var form = document.getElementById("admin-login-form");
  var emailInput = document.getElementById("admin-login-email");
  var passwordInput = document.getElementById("admin-login-password");
  var submitButton = document.getElementById("admin-login-submit");
  var forgotButton = document.getElementById("admin-forgot-password");
  var errorBox = document.getElementById("admin-login-error");
  var retryButton = document.getElementById("admin-boot-retry");
  var resetButton = document.getElementById("admin-boot-reset");
  var fallback = document.getElementById("admin-boot-fallback");

  var authClient = null;
  var cmsStarted = false;
  var finished = false;
  var runtimeError = "";

  function setText(element, value) {
    if (element) {
      element.textContent = value;
    }
  }

  function setMode(mode) {
    boot.setAttribute("data-mode", mode);
  }

  function setProgress(visible) {
    if (progress) {
      progress.hidden = !visible;
    }
  }

  function showAuthError(message) {
    if (!errorBox) {
      return;
    }
    errorBox.textContent = message || "";
    errorBox.hidden = !message;
  }

  function setAuthBusy(busy) {
    if (emailInput) {
      emailInput.disabled = busy;
    }
    if (passwordInput) {
      passwordInput.disabled = busy;
    }
    if (submitButton) {
      submitButton.disabled = busy;
    }
    if (forgotButton) {
      forgotButton.disabled = busy;
    }
  }

  function showLogin(message) {
    if (finished) {
      return;
    }
    setMode("auth");
    boot.classList.remove("is-error");
    setProgress(false);
    setAuthBusy(false);
    showAuthError("");
    form.hidden = false;
    retryButton.hidden = true;
    resetButton.hidden = false;
    setText(copy, message || "请输入 Netlify Identity 账号继续。");
    setText(hint, "登录由 Netlify Identity 提供，登录成功后才加载 CMS。");
    window.setTimeout(function () {
      if (emailInput && !emailInput.value) {
        emailInput.focus();
      } else if (passwordInput) {
        passwordInput.focus();
      }
    }, 60);
  }

  function showFailure(message) {
    if (finished) {
      return;
    }
    setMode("error");
    boot.classList.add("is-error");
    setProgress(false);
    setAuthBusy(false);
    form.hidden = true;
    retryButton.hidden = false;
    resetButton.hidden = false;
    setText(copy, message);
    setText(
      hint,
      "可先清除旧会话后重试；若仍失败，请检查 Netlify Identity、Git Gateway 和当前网络。"
    );
    if (runtimeError) {
      console.error("[admin] " + runtimeError);
    }
  }

  function clearSession() {
    try {
      Object.keys(window.localStorage).forEach(function (key) {
        if (/^(gotrue\.|netlify-cms\.|netlifySiteURL$|nf_)/.test(key)) {
          window.localStorage.removeItem(key);
        }
      });
    } catch (error) {
      console.warn("[admin] Unable to clear local storage", error);
    }

    try {
      document.cookie = "nf_jwt=; Path=/; Max-Age=0; SameSite=Lax";
      document.cookie = "nf_jwt=; Path=/; Max-Age=0; SameSite=Lax; Secure";
    } catch (error) {
      console.warn("[admin] Unable to clear identity cookie", error);
    }
  }

  function readStoredSession() {
    try {
      var raw = window.localStorage.getItem("gotrue.user");
      if (!raw) {
        return null;
      }
      var session = JSON.parse(raw);
      if (!session || !session.url || !session.token) {
        clearSession();
        return null;
      }
      return session;
    } catch (error) {
      clearSession();
      return null;
    }
  }

  function withTimeout(promise, timeout, message) {
    return new Promise(function (resolve, reject) {
      var timer = window.setTimeout(function () {
        reject(new Error(message));
      }, timeout);

      Promise.resolve(promise).then(
        function (value) {
          window.clearTimeout(timer);
          resolve(value);
        },
        function (error) {
          window.clearTimeout(timer);
          reject(error);
        }
      );
    });
  }

  function loadScript(src, kind, timeout, attempt) {
    attempt = attempt || 1;
    return new Promise(function (resolve, reject) {
      var settled = false;
      var script = document.createElement("script");
      var timer = null;

      function fail(message) {
        if (!settled) {
          settled = true;
          if (timer) {
            window.clearTimeout(timer);
          }
          if (script.parentNode) {
            script.parentNode.removeChild(script);
          }
          if (attempt < 2) {
            setText(
              hint,
              kind === "cms"
                ? "网络不稳定，正在重新加载编辑器资源…"
                : "网络不稳定，正在重新连接登录服务…"
            );
            window.setTimeout(function () {
              loadScript(src, kind, timeout, attempt + 1).then(resolve, reject);
            }, 1500);
          } else {
            reject(new Error(message));
          }
        }
      }

      timer = window.setTimeout(function () {
        fail(kind + " resource timed out");
      }, timeout || 20000);

      script.src = src;
      script.async = false;
      script.onload = function () {
        if (!settled) {
          settled = true;
          if (timer) {
            window.clearTimeout(timer);
          }
          resolve();
        }
      };
      script.onerror = function () {
        fail(kind + " resource failed to load");
      };
      document.head.appendChild(script);
    });
  }

  function ensureDashboardRoute() {
    var hash = window.location.hash;
    if (!hash || hash === "#" || hash === "#/") {
      window.history.replaceState(null, "", "#/collections/overview/entries/dashboard");
    }
  }

  function revealCms() {
    if (finished) {
      return;
    }
    finished = true;
    boot.classList.add("is-hidden");
    window.setTimeout(function () {
      if (boot.parentNode) {
        boot.parentNode.removeChild(boot);
      }
    }, 360);
  }

  function waitForCms(attempt) {
    if (finished) {
      return;
    }

    var root = document.getElementById("nc-root");
    if (root && root.childNodes.length > 0 && (root.querySelector("header") || root.querySelector("nav"))) {
      revealCms();
      return;
    }

    if (attempt >= 200) {
      showFailure(
        runtimeError
          ? "工作台初始化失败：" + runtimeError
          : "工作台启动超时，可能是网络、旧会话或 Git Gateway 响应异常。"
      );
      return;
    }

    window.setTimeout(function () {
      waitForCms(attempt + 1);
    }, 250);
  }

  function startCms() {
    if (cmsStarted || finished) {
      return;
    }
    cmsStarted = true;
    ensureDashboardRoute();
    setMode("loading");
    boot.classList.remove("is-error");
    setProgress(true);
    setAuthBusy(false);
    form.hidden = true;
    retryButton.hidden = true;
    resetButton.hidden = false;
    showAuthError("");
    setText(copy, "登录成功，正在加载内容工作台…");
    setText(hint, "正在读取 Git Gateway 内容，首次进入通常需要几秒。");

    loadScript("/admin/vendor/netlify-cms-2.10.192.js", "cms", 60000)
      .then(function () {
        return loadScript("/admin/assets/custom.js?v=" + ADMIN_VERSION, "custom", 30000);
      })
      .then(function () {
        if (!window.CMS) {
          throw new Error("CMS 主程序未初始化");
        }
        window.setTimeout(function () {
          waitForCms(0);
        }, 0);
      })
      .catch(function (error) {
        runtimeError = error && error.message ? error.message : "资源加载失败";
        showFailure("CMS 资源加载失败，请检查网络后重试。");
      });
  }

  function loginErrorMessage(error) {
    var message = String((error && error.message) || error || "");
    if (/confirm|confirmed/i.test(message)) {
      return "账号还没有完成邮箱验证，请先查收 Netlify Identity 验证邮件。";
    }
    if (/401|400|invalid|credential|password|email/i.test(message)) {
      return "邮箱或密码不正确，请重新输入。";
    }
    if (/timeout|timed out|network|fetch|failed/i.test(message)) {
      return "连接登录服务失败，请检查网络后重试。";
    }
    return "登录失败：" + message;
  }

  function submitLogin(event) {
    event.preventDefault();
    if (!authClient) {
      showFailure("登录组件尚未就绪，请重新加载页面。");
      return;
    }

    var email = emailInput.value.trim();
    var password = passwordInput.value;
    if (!email || !password) {
      showAuthError("请填写邮箱和密码。");
      return;
    }

    showAuthError("");
    setAuthBusy(true);
    setProgress(true);
    setMode("login");
    setText(copy, "正在验证账号…");
    setText(hint, "正在连接 Netlify Identity，请不要关闭页面。");

    withTimeout(authClient.login(email, password, true), 20000, "登录超时")
      .then(function () {
        passwordInput.value = "";
        startCms();
      })
      .catch(function (error) {
        setMode("auth");
        setProgress(false);
        setAuthBusy(false);
        setText(copy, "登录没有成功，请检查账号和网络。");
        showAuthError(loginErrorMessage(error));
      });
  }

  function sendPasswordRecovery() {
    if (!authClient) {
      showFailure("登录组件尚未就绪，请重新加载页面。");
      return;
    }

    var email = emailInput.value.trim();
    if (!email) {
      showAuthError("请先填写邮箱，再发送重置邮件。");
      emailInput.focus();
      return;
    }

    showAuthError("");
    setAuthBusy(true);
    setText(copy, "正在发送密码重置邮件…");

    withTimeout(
      window.fetch("/.netlify/identity/recover", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ email: email })
      }),
      15000,
      "请求超时"
    )
      .then(function (response) {
        if (!response.ok) {
          throw new Error("HTTP " + response.status);
        }
        setAuthBusy(false);
        setText(copy, "重置邮件已发送，请查收邮箱。");
        setText(hint, "如果没有收到，请检查垃圾邮件或 Netlify Identity 用户设置。");
      })
      .catch(function () {
        setAuthBusy(false);
        setText(copy, "重置邮件发送失败，请稍后重试。");
        showAuthError("无法发送重置邮件，请确认邮箱地址或直接联系站点管理员。");
      });
  }

  function startIdentity() {
    setMode("checking");
    setText(copy, "正在连接登录服务…");
    setProgress(true);

    loadScript("/admin/vendor/netlify-identity-widget-1.9.2.js", "identity", 30000)
      .then(function () {
        if (!window.netlifyIdentity || !window.netlifyIdentity.store) {
          throw new Error("Netlify Identity 未初始化");
        }

        if (!window.netlifyIdentity.store.gotrue) {
          window.netlifyIdentity.init({
            APIUrl: window.location.origin + "/.netlify/identity"
          });
        }

        authClient =
          window.netlifyIdentity.store.gotrue ||
          new window.GoTrue({
            APIUrl: window.location.origin + "/.netlify/identity"
          });

        var session = readStoredSession();
        if (!session) {
          showLogin("请输入 Netlify Identity 账号继续。");
          return null;
        }

        var user = window.netlifyIdentity.currentUser();
        if (!user) {
          clearSession();
          showLogin("旧登录状态已失效，请重新登录。");
          return null;
        }

        setText(copy, "正在验证登录状态…");
        return withTimeout(user.jwt(), 15000, "验证登录状态超时")
          .then(function () {
            startCms();
          })
          .catch(function () {
            clearSession();
            showLogin("登录状态已过期或网络异常，请重新登录。");
          });
      })
      .catch(function (error) {
        runtimeError = error && error.message ? error.message : "登录组件加载失败";
        showFailure("Netlify Identity 登录组件加载失败，请检查网络后重试。");
      });
  }

  window.addEventListener("error", function (event) {
    if (!finished && event && event.message) {
      runtimeError = event.message;
    }
  });

  window.addEventListener("unhandledrejection", function (event) {
    if (!finished) {
      var reason = event && event.reason;
      runtimeError = String((reason && reason.message) || reason || "未知脚本错误");
    }
  });

  form.addEventListener("submit", submitLogin);
  forgotButton.addEventListener("click", sendPasswordRecovery);
  retryButton.addEventListener("click", function () {
    window.location.reload();
  });
  resetButton.addEventListener("click", function () {
    clearSession();
    window.location.replace("/admin/");
  });

  if (fallback && /\.netlify\.app$/i.test(window.location.hostname)) {
    fallback.hidden = true;
  }

  startIdentity();
})();
