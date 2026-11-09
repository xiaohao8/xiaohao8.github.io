(function () {
  var boot = document.getElementById("admin-boot");
  if (!boot) {
    return;
  }

  var copy = document.getElementById("admin-boot-copy");
  var retry = document.getElementById("admin-boot-retry");
  var finished = false;

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

  function showFailure(message) {
    if (finished) {
      return;
    }
    boot.classList.add("is-error");
    copy.textContent = message;
    retry.hidden = false;
  }

  function cmsHasRendered() {
    var root = document.getElementById("nc-root");
    return Boolean(root && root.childNodes.length > 0);
  }

  function detectFailure() {
    if (window.__adminAssetError === "identity") {
      return "Netlify Identity 组件没有加载成功，请刷新页面重试。";
    }
    if (window.__adminAssetError === "cms") {
      return "Netlify CMS 主程序没有加载成功，请刷新页面重试。";
    }
    if (!window.netlifyIdentity) {
      return "登录组件未就绪，请检查网络后刷新页面。";
    }
    if (!window.CMS) {
      return "后台主程序未就绪，请检查网络后刷新页面。";
    }
    return "";
  }

  var attempts = 0;
  function poll() {
    if (finished) {
      return;
    }

    if (cmsHasRendered()) {
      revealCms();
      return;
    }

    var failure = detectFailure();
    if (failure) {
      showFailure(failure);
      return;
    }

    attempts += 1;
    if (attempts >= 100) {
      showFailure("后台启动超时。国内网络首次加载可能需要更久，请刷新后重试。");
      return;
    }

    window.setTimeout(poll, 250);
  }

  if (cmsHasRendered()) {
    revealCms();
    return;
  }

  poll();
})();
