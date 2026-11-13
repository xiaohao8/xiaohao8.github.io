/* pages/settings.js — 设置：仓库 / Netlify / 站点资料 / 导航菜单 / 首页外观 */

import {
  ic, esc, el, toast, loading, store, safeHttpUrl,
} from "../app.js?v=4.4.3";
import { NetlifyAPI } from "../netlify.js?v=4.4.3";
import { setMediaConfig, mediaFallbackUrls } from "../github.js?v=4.4.3";
import { loadYaml, dumpYaml } from "../yaml.js?v=4.4.3";

const SITE_META_PATH = "source/_data/site_meta.yml";
const FLUID_PATH = "source/_data/fluid_config.yml";
const FCIRCLE_PATH = "source/_data/fcircle.yml";
const ANALYTICS_PATH = "source/analytics/config.json";

export default async function settings(view, ctx, params, handleErr) {
  view.innerHTML = "";

  const settings = store.getSettings();

  /* ---------- 1. 仓库与站点 ---------- */
  const repoCard = el(`<div class="card settings-section">
      <div class="card-header">${ic("github")}<h2>仓库连接</h2><div class="sub">GitHub 仓库与站点地址（本地保存）</div></div>
      <div class="grid-2" style="gap:1rem">
        <div class="field" style="margin:0"><label>Owner</label><input class="input" id="s-owner" value="${esc(settings.owner)}" /></div>
        <div class="field" style="margin:0"><label>仓库名</label><input class="input" id="s-repo" value="${esc(settings.repo)}" /></div>
        <div class="field" style="margin:0"><label>分支</label><input class="input" id="s-branch" value="${esc(settings.branch)}" /></div>
        <div class="field" style="margin:0"><label>站点地址</label><input class="input" id="s-siteurl" value="${esc(settings.siteUrl)}" /></div>
      </div>
      <div class="hint" style="margin-top:.5rem">修改后刷新页面生效；登录用的 Token 不变。</div>
      <div class="settings-actions"><button class="btn btn-primary" id="save-repo">${ic("save")}保存仓库设置</button></div>
    </div>`);
  view.appendChild(repoCard);

  /* ---------- 2. Netlify ---------- */
  const nl = settings.netlify || {};
  const nlCard = el(`<div class="card settings-section">
      <div class="card-header">${ic("deploy")}<h2>Netlify 集成</h2><div class="sub">部署状态查看 + 一键重新部署（本地保存）</div></div>
      <div class="field"><label>Netlify Access Token</label>
        <input class="input input-mono" id="s-nl-token" type="password" value="${esc(nl.token || "")}" placeholder="只需填这一个，Site ID 会自动识别" />
        <div class="hint">在 <a href="https://app.netlify.com/user/applications" target="_blank" rel="noopener">Netlify → User settings → Applications</a> 创建 Personal Access Token，保存时自动识别你的站点</div>
      </div>
      <div class="field"><label>Site ID（自动识别，一般不用填）</label>
        <input class="input input-mono" id="s-nl-site" value="${esc(nl.siteId || "")}" placeholder="留空 = 按 Token 自动识别" />
        <div class="hint">自动识别失败时才需要手动填：Netlify 后台 → Site settings → General → Site information</div>
      </div>
      <div class="field"><label>Build Hook URL（可选）</label>
        <input class="input input-mono" id="s-nl-hook" value="${esc(nl.buildHook || "")}" placeholder="https://api.netlify.com/build_hooks/xxxx" />
        <div class="hint">保存文章时 push 会自动构建，这里只用于顶栏「一键部署」手动触发</div>
      </div>
      <div class="settings-actions">
        <button class="btn" id="test-nl">${ic("refresh")}测试部署状态读取</button>
        <button class="btn btn-primary" id="save-nl">${ic("save")}保存 Netlify 设置</button>
      </div>
    </div>`);
  view.appendChild(nlCard);

  /* ---------- 2.5 图片预览源 ---------- */
  const imgSrc = settings.imageSource || {};
  /* ---------- 2.4 网络优化 ---------- */
  const netCard = el(`<div class="card settings-section">
      <div class="card-header">${ic("info")}<h2>网络优化</h2><div class="sub">GitHub 通道与编辑器资源的智能选路（国内访问提速）</div></div>
      <div class="grid-2" style="gap:1rem">
        <div class="field" style="margin:0"><label>GitHub API 通道</label>
          <select class="input" id="n-apibase">
            <option value="auto">自动测速（推荐，12h 缓存）</option>
            <option value="direct">直连 api.github.com</option>
            <option value="gh-proxy">gh-proxy.com 镜像</option>
            <option value="custom">自定义前缀</option>
          </select>
          <div class="hint">写操作与读取都走所选通道；自动模式在登录时竞速并记住最快线路</div>
        </div>
        <div class="field" style="margin:0"><label>编辑器资源（Vditor ≈4MB）</label>
          <select class="input" id="n-vendor">
            <option value="site">本站（唯一可用）</option>
          </select>
          <div class="hint">
            脚本只能从本站加载：Gitee raw 返回 text/plain，浏览器会拒绝执行 script 标签
            （图片可走镜像，脚本不行）
          </div>
        </div>
      </div>
      <div class="field" style="max-width:520px;display:none" id="n-custom-wrap"><label>自定义 API 前缀</label>
        <input class="input input-mono" id="n-custom" value="${esc(["auto","direct","gh-proxy"].includes(settings.apiBase) ? "" : (settings.apiBase || ""))}" placeholder="https://your-mirror.example/https://api.github.com" />
      </div>
      <div class="settings-actions"><button class="btn btn-primary" id="save-net">${ic("save")}保存网络设置</button></div>
    </div>`);
  view.appendChild(netCard);
  const apiSel = netCard.querySelector("#n-apibase");
  apiSel.value = ["auto","direct","gh-proxy","custom"].includes(settings.apiBase) ? settings.apiBase : "auto";
  const customWrap = netCard.querySelector("#n-custom-wrap");
  function syncNet() { customWrap.style.display = apiSel.value === "custom" ? "" : "none"; }
  apiSel.addEventListener("change", syncNet); syncNet();
  netCard.querySelector("#save-net").addEventListener("click", () => {
    const s = store.getSettings();
    s.apiBase = apiSel.value === "custom" ? (netCard.querySelector("#n-custom").value.trim() || "auto") : apiSel.value;
    s.vendorSource = netCard.querySelector("#n-vendor").value;
    localStorage.removeItem("qexo4_api_base"); // 重置测速缓存，保存后重新竞速
    store.saveSettings(s);
    toast("网络设置已保存，刷新页面后生效", "success");
  });
  const imgCard = el(`<div class="card settings-section">
      <div class="card-header">${ic("image")}<h2>图片预览源</h2><div class="sub">后台图库/说说缩略图走哪里加载（国内建议 Gitee）</div></div>
      <div class="field" style="max-width:360px">
        <label>预览源</label>
        <select class="input" id="is-type">
          <option value="gitee">Gitee 镜像（国内快，推荐）</option>
          <option value="site">本站直连</option>
          <option value="custom">自定义前缀（如其他 CDN）</option>
        </select>
        <div class="hint">Gitee 加载失败会自动切回本站，不影响使用</div>
      </div>
      <div id="is-gitee-fields">
        <div class="grid-2" style="gap:1rem">
          <div class="field" style="margin:0"><label>Gitee 用户名</label><input class="input" id="is-owner" value="${esc(imgSrc.giteeOwner || "xiaohao3")}" /></div>
          <div class="field" style="margin:0"><label>Gitee 仓库</label><input class="input" id="is-repo" value="${esc(imgSrc.giteeRepo || "xiaohao8.github.io")}" /></div>
        </div>
        <div class="field" style="max-width:260px"><label>分支</label><input class="input" id="is-branch" value="${esc(imgSrc.giteeBranch || "main")}" /></div>
      </div>
      <div id="is-custom-fields" style="display:none">
        <div class="field"><label>自定义前缀</label>
          <input class="input input-mono" id="is-prefix" value="${esc(imgSrc.customPrefix || "")}" placeholder="https://cdn.jsdelivr.net/gh/xiaohao8/xiaohao8.github.io@main" />
          <div class="hint">图片将按 前缀/source/images/uploads/文件名 拼接（须镜像整个仓库）</div>
        </div>
      </div>
      <div class="field" style="max-width:520px">
        <button class="btn" id="is-test">${ic("eye")}测试预览链接</button>
        <span class="small muted" id="is-test-out" style="margin-left:.6rem;word-break:break-all"></span>
      </div>
      <div class="settings-actions"><button class="btn btn-primary" id="save-imgsrc">${ic("save")}保存预览源设置</button></div>
    </div>`);
  view.appendChild(imgCard);

  const isType = imgCard.querySelector("#is-type");
  isType.value = imgSrc.type || "gitee";
  function syncImgFields() {
    imgCard.querySelector("#is-gitee-fields").style.display = isType.value === "gitee" ? "" : "none";
    imgCard.querySelector("#is-custom-fields").style.display = isType.value === "custom" ? "" : "none";
  }
  isType.addEventListener("change", syncImgFields);
  syncImgFields();

  imgCard.querySelector("#is-test").addEventListener("click", async () => {
    const saved = store.getSettings();
    setMediaConfig({ ...readImgSrc(), siteUrl: saved.siteUrl }); // 临时套用表单里的值
    const out = imgCard.querySelector("#is-test-out");
    const urls = mediaFallbackUrls("source/images/uploads/1000.jpg");
    out.textContent = `正在依次测试 ${urls.length} 个候选源…`;
    let hit = "";
    for (const url of urls) {
      const ok = await new Promise((resolve) => {
        const probe = new Image();
        probe.referrerPolicy = "no-referrer";
        const timer = setTimeout(() => { probe.onload = probe.onerror = null; resolve(false); }, 6000);
        probe.onload = () => { clearTimeout(timer); resolve(true); };
        probe.onerror = () => { clearTimeout(timer); resolve(false); };
        probe.src = url;
      });
      if (ok) { hit = url; break; }
    }
    setMediaConfig({ ...saved.imageSource, siteUrl: saved.siteUrl }); // 测试不改动已保存的配置
    out.textContent = hit ? "✓ 可用：" + hit : "✗ 全部候选源都失败（检查 Gitee 同步、站点地址与网络）";
  });

  function readImgSrc() {
    return {
      type: isType.value,
      giteeOwner: imgCard.querySelector("#is-owner").value.trim() || "xiaohao3",
      giteeRepo: imgCard.querySelector("#is-repo").value.trim() || "xiaohao8.github.io",
      giteeBranch: imgCard.querySelector("#is-branch").value.trim() || "main",
      customPrefix: imgCard.querySelector("#is-prefix").value.trim(),
    };
  }

  imgCard.querySelector("#save-imgsrc").addEventListener("click", () => {
    const s = store.getSettings();
    s.imageSource = readImgSrc();
    store.saveSettings(s);
    setMediaConfig({ ...s.imageSource, siteUrl: s.siteUrl }); // 立即生效（后续打开的页面）
    toast("预览源已保存并生效；已打开的图库页刷新后使用新源", "success");
  });

  /* ---------- 3. 站点资料 ---------- */
  const metaCard = el(`<div class="card settings-section">
      <div class="card-header">${ic("globe")}<h2>站点资料</h2><div class="sub">写入 source/_data/site_meta.yml，构建时覆盖站点信息</div></div>
      <div class="field" style="max-width:420px"><label>站点标题</label><input class="input" id="m-title" /></div>
      <div class="field" style="max-width:420px"><label>副标题</label><input class="input" id="m-subtitle" /></div>
      <div class="field"><label>站点描述</label><textarea class="input" id="m-desc" rows="2"></textarea></div>
      <div class="field" style="max-width:520px"><label>关键词</label><input class="input" id="m-kw" /><div class="hint">英文逗号分隔</div></div>
      <div class="grid-2" style="gap:1rem">
        <div class="field" style="margin:0"><label>作者</label><input class="input" id="m-author" /></div>
        <div class="field" style="margin:0"><label>语言</label><input class="input" id="m-lang" /></div>
      </div>
      <div class="settings-actions"><button class="btn btn-primary" id="save-meta">${ic("save")}保存站点资料</button></div>
    </div>`);
  view.appendChild(metaCard);

  /* ---------- 4. 导航菜单 ---------- */
  const navCard = el(`<div class="card settings-section">
      <div class="card-header">${ic("menu")}<h2>导航菜单</h2><div class="sub">写入 fluid_config.yml 的 navbar.menu</div></div>
      <div id="menu-list"></div>
      <div class="settings-actions">
        <button class="btn" id="menu-add">${ic("plus")}添加菜单项</button>
        <button class="btn btn-primary" id="save-nav">${ic("save")}保存导航菜单</button>
      </div>
    </div>`);
  view.appendChild(navCard);

  /* ---------- 5. 首页外观 ---------- */
  const indexCard = el(`<div class="card settings-section">
      <div class="card-header">${ic("home")}<h2>首页外观</h2><div class="sub">首页顶部图与 slogan（fluid_config.yml 的 index 段）</div></div>
      <div class="field"><label>首页顶部图 URL</label><input class="input" id="i-banner" /></div>
      <div class="grid-2" style="gap:1rem">
        <div class="field" style="margin:0"><label>顶部图高度（0-100）</label><input class="input" id="i-height" type="number" min="0" max="100" /></div>
        <div class="field" style="margin:0"><label>博客名称（导航栏）</label><input class="input" id="i-blogtitle" /></div>
      </div>
      <div class="field"><label>首页 Slogan</label><textarea class="input" id="i-slogan" rows="2"></textarea></div>
      <div class="settings-actions"><button class="btn btn-primary" id="save-index">${ic("save")}保存外观设置</button></div>
    </div>`);
  view.appendChild(indexCard);

  /* ---------- 逻辑 ---------- */

  repoCard.querySelector("#save-repo").addEventListener("click", () => {
    const s = store.getSettings();
    const siteUrl = repoCard.querySelector("#s-siteurl").value.trim();
    if (siteUrl && !safeHttpUrl(siteUrl)) {
      toast("站点地址需以 http:// 或 https:// 开头", "error");
      return;
    }
    s.owner = repoCard.querySelector("#s-owner").value.trim() || s.owner;
    s.repo = repoCard.querySelector("#s-repo").value.trim() || s.repo;
    s.branch = repoCard.querySelector("#s-branch").value.trim() || "main";
    s.siteUrl = siteUrl;
    store.saveSettings(s);
    setMediaConfig({ ...s.imageSource, siteUrl: s.siteUrl }); // 站点地址变更立即作用于图片兜底链
    toast("仓库设置已保存，刷新页面后生效", "success");
  });

  nlCard.querySelector("#save-nl").addEventListener("click", async () => {
    const s = store.getSettings();
    const next = {
      siteId: nlCard.querySelector("#s-nl-site").value.trim(),
      token: nlCard.querySelector("#s-nl-token").value.trim(),
      buildHook: nlCard.querySelector("#s-nl-hook").value.trim(),
    };
    // 只填了 Token 没填 Site ID → 自动识别站点
    if (next.token && !next.siteId) {
      loading.show("正在用 Token 自动识别站点…");
      try {
        const tmp = new NetlifyAPI({ netlify: next });
        const found = await tmp.discoverSite(s.siteUrl);
        loading.hide();
        if (found) {
          next.siteId = found.siteId;
          nlCard.querySelector("#s-nl-site").value = found.siteId;
          const how = { domain: "按域名精确匹配", name: "按名称匹配", first: "取账号下第一个站点" }[found.matched];
          toast(`已识别站点「${found.name}」（${how}，共 ${found.total} 个站点）`, "success", 4200);
        } else {
          toast("Token 有效，但账号下没有站点", "error");
        }
      } catch (e) {
        loading.hide();
        toast("自动识别失败：" + e.message + "（Token 仍会保存）", "error", 5200);
      }
    }
    s.netlify = next;
    store.saveSettings(s);
    toast("Netlify 设置已保存", "success");
  });

  nlCard.querySelector("#test-nl").addEventListener("click", async () => {
    // 临时用输入框的值测试
    const tmp = new NetlifyAPI({
      netlify: {
        siteId: nlCard.querySelector("#s-nl-site").value.trim(),
        token: nlCard.querySelector("#s-nl-token").value.trim(),
        buildHook: nlCard.querySelector("#s-nl-hook").value.trim(),
      },
    });
    if (!tmp.token) { toast("请先填写 Netlify Token", "error"); return; }
    if (!tmp.canReadDeploys) {
      loading.show("正在用 Token 自动识别站点…");
      try {
        const found = await tmp.discoverSite(ctx.settings.siteUrl);
        loading.hide();
        if (found) {
          nlCard.querySelector("#s-nl-site").value = found.siteId;
          toast(`自动识别到站点「${found.name}」，点「保存」后生效`, "success", 4200);
        } else {
          toast("Token 有效，但账号下没有站点", "error");
        }
      } catch (e) {
        loading.hide();
        toast("识别失败：" + e.message, "error", 5000);
      }
      return;
    }
    loading.show("正在读取部署状态…");
    try {
      const list = await tmp.deploys(1);
      loading.hide();
      toast(list.length ? `连接成功，最新部署状态：${list[0].state}` : "连接成功，暂无部署记录", "success");
    } catch (e) {
      loading.hide();
      toast("连接失败：" + e.message, "error", 5000);
    }
  });

  /* 站点资料 */
  // 两个配置文件并行发起，避免串行等两次 GitHub API 往返
  let fluidReadError = null;
  const fluidRawPromise = ctx.api.readFile(FLUID_PATH).catch((e) => { fluidReadError = e; return null; });
  let meta = {};
  let metaLoaded = true;
  loading.show("正在加载配置文件…");
  try {
    meta = loadYaml(await ctx.api.readFile(SITE_META_PATH)) || {};
  } catch (e) {
    if (e.status === 404 || ctx.demo) meta = {};
    else {
      handleErr(e);
      meta = {};
      metaLoaded = false;
    }
  }
  if (!metaLoaded) {
    metaCard.querySelector("#save-meta").disabled = true;
    metaCard.querySelector(".card-header").appendChild(
      el(`<div class="sub" style="color:var(--danger)">加载失败，已禁用保存以免覆盖仓库配置</div>`));
  }

  metaCard.querySelector("#m-title").value = meta.title || "";
  metaCard.querySelector("#m-subtitle").value = meta.subtitle || "";
  metaCard.querySelector("#m-desc").value = meta.description || "";
  metaCard.querySelector("#m-kw").value = Array.isArray(meta.keywords) ? meta.keywords.join(",") : (meta.keywords || "");
  metaCard.querySelector("#m-author").value = meta.author || "";
  metaCard.querySelector("#m-lang").value = meta.language || "zh-CN";

  metaCard.querySelector("#save-meta").addEventListener("click", async () => {
    loading.show("正在保存站点资料…");
    try {
      // 写前重读，保留表单之外的未知键
      let fresh = {};
      try {
        fresh = loadYaml(await ctx.api.readFile(SITE_META_PATH, { fresh: true })) || {};
      } catch (e) {
        if (!(e.status === 404 || ctx.demo)) throw e;
      }
      const next = {
        ...fresh,
        title: metaCard.querySelector("#m-title").value.trim(),
        subtitle: metaCard.querySelector("#m-subtitle").value.trim(),
        description: metaCard.querySelector("#m-desc").value.trim(),
        keywords: metaCard.querySelector("#m-kw").value.split(/[,，]/).map((s) => s.trim()).filter(Boolean),
        author: metaCard.querySelector("#m-author").value.trim(),
        language: metaCard.querySelector("#m-lang").value.trim() || "zh-CN",
      };
      await ctx.api.writeFile(SITE_META_PATH, dumpYaml(next), "Update Site Meta by Qexo");
      meta = next;
      toast("站点资料已保存，Netlify 构建已触发", "success");
    } catch (e) { handleErr(e); }
    loading.hide();
  });

  /* 导航菜单 + 首页外观（同一个 fluid_config.yml） */
  let fluid = {};
  let fluidLoaded = true;
  try {
    const fluidRaw = await fluidRawPromise;
    if (fluidReadError) throw fluidReadError;
    fluid = loadYaml(fluidRaw) || {};
  } catch (e) {
    if (e.status === 404 || ctx.demo) fluid = {};
    else {
      fluid = {};
      fluidLoaded = false;
    }
  }
  if (!fluidLoaded) {
    navCard.querySelector("#save-nav").disabled = true;
    indexCard.querySelector("#save-index").disabled = true;
    navCard.querySelector(".card-header").appendChild(
      el(`<div class="sub" style="color:var(--danger)">加载失败，已禁用保存以免覆盖仓库配置</div>`));
  }
  const navbar = fluid.navbar || {};
  const menu = Array.isArray(navbar.menu) ? navbar.menu.map((m) => ({ ...m })) : [];
  const indexCfg = fluid.index || {};

  const menuList = navCard.querySelector("#menu-list");
  function renderMenu() {
    menuList.innerHTML = "";
    if (!menu.length) {
      menuList.innerHTML = `<div class="empty" style="padding:1rem">${ic("menu")}<p>暂无菜单项</p></div>`;
    }
    menu.forEach((m, idx) => {
      const row = el(`<div class="menu-editor-item">
          <input class="input" placeholder="key" value="${esc(m.key || "")}" data-f="key" />
          <input class="input" placeholder="名称（留空用主题默认）" value="${esc(m.name || "")}" data-f="name" />
          <input class="input" placeholder="链接 /" value="${esc(m.link || "")}" data-f="link" />
          <input class="input" placeholder="图标类名 iconfont icon-…" value="${esc(m.icon || "")}" data-f="icon" />
          <button class="icon-btn danger menu-del" title="移除">${ic("trash")}</button>
        </div>`);
      row.querySelectorAll("[data-f]").forEach((inp) => {
        inp.addEventListener("change", () => { m[inp.dataset.f] = inp.value.trim(); });
      });
      row.querySelector(".menu-del").addEventListener("click", () => {
        menu.splice(idx, 1);
        renderMenu();
      });
      menuList.appendChild(row);
    });
  }
  renderMenu();

  navCard.querySelector("#menu-add").addEventListener("click", () => {
    menu.push({ key: "", link: "/", icon: "iconfont icon-link-fill" });
    renderMenu();
  });

  navCard.querySelector("#save-nav").addEventListener("click", saveFluid);

  indexCard.querySelector("#i-banner").value = indexCfg.banner_img || "";
  indexCard.querySelector("#i-height").value = indexCfg.banner_img_height == null ? "" : indexCfg.banner_img_height;
  indexCard.querySelector("#i-blogtitle").value = navbar.blog_title || "";
  indexCard.querySelector("#i-slogan").value = ((indexCfg.slogan || {}).text || "");

  async function saveFluid() {
    if (!fluidLoaded) {
      toast("配置未成功加载，已禁用保存以免覆盖", "error");
      return;
    }
    loading.show("正在保存…");
    try {
      // 写前重读远端配置，只改 navbar.menu / blog_title / index 段，其余键原样保留
      let fresh;
      try {
        fresh = loadYaml(await ctx.api.readFile(FLUID_PATH, { fresh: true })) || {};
      } catch (e) {
        if (e.status === 404 || ctx.demo) fresh = {};
        else throw e;
      }
      const freshNavbar = fresh.navbar || {};
      freshNavbar.menu = menu.filter((m) => m.key && m.link);
      freshNavbar.blog_title = indexCard.querySelector("#i-blogtitle").value.trim();
      fresh.navbar = freshNavbar;
      const hRaw = indexCard.querySelector("#i-height").value.trim();
      const height = hRaw !== "" && !isNaN(Number(hRaw)) ? Number(hRaw) : undefined;
      fresh.index = {
        ...(fresh.index || {}),
        banner_img: indexCard.querySelector("#i-banner").value.trim(),
        banner_img_height: height,
        slogan: { ...((fresh.index || {}).slogan || {}), text: indexCard.querySelector("#i-slogan").value },
      };
      if (fresh.index.banner_img_height == null) delete fresh.index.banner_img_height;
      await ctx.api.writeFile(FLUID_PATH, dumpYaml(fresh), "Update Fluid Config by Qexo");
      fluid = fresh;
      toast("配置已保存，Netlify 构建已触发", "success");
    } catch (e) { handleErr(e); }
    loading.hide();
  }

  indexCard.querySelector("#save-index").addEventListener("click", saveFluid);

  /* ---------- N. 朋友圈自动更新（GitHub Actions 云端） ---------- */
  const s0 = store.getSettings();
  const fcActionsUrl = "https://github.com/" + encodeURIComponent(s0.owner || "") + "/" +
    encodeURIComponent(s0.repo || "") + "/actions/workflows/fcircle-refresh.yml";
  const fcCard = el(`<div class="card settings-section">
      <div class="card-header">${ic("refresh")}<h2>朋友圈自动更新</h2><div class="sub">实时层每分钟（Netlify）· 基线层每天（GitHub Actions），本机零任务</div></div>
      <div class="hint" style="margin-bottom:.9rem">
        数据源是本站 <code>fluid_config.yml</code> 的友情链接，采集全部在云端完成。<br>
        <b>实时层</b>：Netlify 定时函数每分钟探测一次各站 Atom/RSS，增量写入 Blobs，
        页面读 <code>/api/fcircle</code> 就能立刻看到新文章（GitHub Actions 的 cron
        最小 5 分钟，做不到 1 分钟，所以高频这层放在 Netlify）。<br>
        <b>基线层</b>：GitHub Actions 每天 09:00（北京时间）全量抓一次，有变化才提交
        <code>source/fcircle/moments.json</code>，既做全量对齐，也在仓库里留一份备份，
        Blobs 被清空时页面会立刻回落到这份静态快照。<br>
        浏览器只读本站，不请求任何第三方接口；本机与构建期都不跑刷新。
      </div>
      <div class="grid-2" style="gap:1rem">
        <div class="field" style="margin:0"><label>每日基线任务</label>
          <select class="input" id="fc-enabled">
            <option value="true">开启（推荐）</option>
            <option value="false">暂停</option>
          </select>
          <div class="hint">只影响每日基线；实时层与手动触发不受影响</div>
        </div>
        <div class="field" style="margin:0"><label>每个友链取几篇</label>
          <input class="input" id="fc-perlink" type="number" min="1" max="20" value="5" />
          <div class="hint">1–20，数值越大抓得越慢</div>
        </div>
      </div>
      <div class="field" style="margin-top:.8rem"><label>当前数据</label>
        <div class="hint" id="fc-status">读取中…</div>
      </div>
      <div class="field" style="margin-top:.8rem"><label>实时层（每分钟）</label>
        <div class="hint" id="fc-live">读取中…</div>
      </div>
      <div class="field" style="margin-top:.8rem"><label>基线任务运行记录（每天）</label>
        <div class="hint" id="fc-last-run">读取中…</div>
      </div>
      <div class="settings-actions">
        <button class="btn btn-primary" id="fc-save">${ic("save")}保存配置</button>
        <button class="btn" id="fc-run">${ic("deploy")}立即对齐基线</button>
        <button class="btn" id="fc-live-reload">${ic("refresh")}实时层状态</button>
        <button class="btn" id="fc-runs-reload">${ic("refresh")}基线运行记录</button>
        <a class="btn" href="${esc(fcActionsUrl)}" target="_blank" rel="noopener noreferrer">Actions ↗</a>
      </div>
      <details style="margin-top:.9rem">
        <summary style="cursor:pointer;font-weight:600">操作说明</summary>
        <ol style="margin:.6rem 0 0;padding-left:1.3rem;line-height:1.9">
          <li><b>频率怎么调</b>：实时层<b>不用改任何文件</b>，到 Netlify →
            Site settings → Environment variables 设
            <code>FCIRCLE_INTERVAL_SEC</code>（秒，默认 60）即可，改完重新部署生效；
            想彻底停掉实时层，删掉 <code>netlify.toml</code> 里
            <code>[functions."fcircle-tick"]</code> 的 <code>schedule</code> 行。
            基线层改 <code>.github/workflows/fcircle-refresh.yml</code> 的
            <code>cron</code>（UTC，北京时间 = UTC+8），默认每天 09:00。</li>
          <li><b>为什么实时层不放 GitHub Actions</b>：Actions 的 <code>schedule</code>
            最小间隔是 5 分钟，官方不支持 1 分钟，高峰时还会延迟或跳过；
            Netlify 定时函数可以每分钟触发，但单次只有 30 秒，所以它只做
            「增量探测 + 合并」，全量对齐留给每天的基线任务。</li>
          <li><b>立即刷新</b>：「立即对齐基线」触发的是 GitHub Actions，约 1–2 分钟后点
            「基线运行记录」看结果；实时层不需要手动触发，下一分钟自己就会跑，
            想马上确认就点「实时层状态」。</li>
          <li><b>新增友链</b>：改完 <code>fluid_config.yml</code> 部署一次即可，
            实时层与基线层都会自动包含它（构建期会导出 <code>/fcircle/links.json</code>
            给函数读）。抓不到的站点不影响已有文章。</li>
          <li><b>排障</b>：浏览器打开 <code>/api/fcircle?debug=1</code>，能看到最近一轮的
            <code>lastRun</code>（应在一分钟内）、<code>sweep.active</code>（能抓到 feed 的站点数）、
            <code>failingSites</code>（正在退避的站点数）；每轮摘要
            <code>{due, ok304, okNew, added, ms}</code> 在 Netlify → Functions →
            <code>fcircle-tick</code> → Logs。</li>
          <li><b>为什么「更新于」可能不动</b>：那是<b>最后一次抓到新文章</b>的时间，不是执行时间。
            现在还有「检查于」字段，表示最近一次真正跑完探测的时刻，两者分开看才不会误会。</li>
          <li><b>完全离线维护</b>：直接编辑 <code>source/fcircle/moments.json</code>，
            保持 <code>statistical_data</code> / <code>article_data</code> 结构即可。</li>
        </ol>
      </details>
    </div>`);
  view.appendChild(fcCard);

  let fcLoaded = false;
  ctx.api.readFile(FCIRCLE_PATH).then((raw) => {
    const c = loadYaml(raw) || {};
    fcCard.querySelector("#fc-enabled").value = c.enabled === false ? "false" : "true";
    const per = Number(c.per_link);
    fcCard.querySelector("#fc-perlink").value = per >= 1 && per <= 20 ? per : 5;
    fcLoaded = true;
  }).catch((e) => {
    if (e && e.status === 404) {
      fcCard.querySelector("#fc-enabled").value = "true";
      fcCard.querySelector("#fc-perlink").value = 5;
      fcLoaded = true; // 文件尚未创建，允许保存时新建
    } else {
      fcCard.querySelector("#fc-status").textContent = "配置读取失败：" + (e && e.message);
    }
  });

  /* 「当前数据」优先读实时层，读不到再读静态快照——与前台 /pyq/ 的降级顺序一致 */
  function loadFCStatus() {
    const box = fcCard.querySelector("#fc-status");
    if (!box) return;
    const read = (url, live) => fetch(url, { cache: "no-store" }).then((r) => {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    }).then((d) => {
      const rows = (d && d.article_data) || [];
      const st = (d && d.statistical_data) || {};
      box.textContent =
        (live ? "实时层 · " : "静态快照 · ") + "当前 " + rows.length + " 篇 · 活跃友链 " +
        (st.active_num != null ? st.active_num : "-") + " / " +
        (st.friends_num != null ? st.friends_num : "-") +
        " · 更新于 " + (st.last_updated_time || "-") +
        (st.last_checked_time ? " · 检查于 " + st.last_checked_time : "");
    });
    read("/api/fcircle?t=" + Date.now(), true)
      .catch(() => read("/fcircle/moments.json", false))
      .catch(() => { box.textContent = "数据暂不可读（演示模式或尚未部署）"; });
  }
  loadFCStatus();

  /* 实时层状态：直接问函数「最近一轮什么时候跑的」，比看数据文件时间可信 */
  function loadFCLive() {
    const box = fcCard.querySelector("#fc-live");
    if (!box) return;
    box.textContent = "读取中…";
    fetch("/api/fcircle?debug=1&t=" + Date.now(), { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then((d) => {
        if (!d) throw new Error("空响应");
        if (!d.lastRun) {
          box.textContent = "实时层还没跑过第一轮（部署后约 1 分钟开始）";
          return;
        }
        const sweep = d.sweep || {};
        box.innerHTML =
          "最近一轮 " + esc(d.lastRun) + "（耗时 " + esc(d.lastRunMs || 0) + " ms）" +
          " · 实时层" + (d.live ? "已建立" : "尚未建立，页面暂用静态快照") +
          " · 本轮探测 " + esc(sweep.due != null ? sweep.due : "-") + " 站" +
          "<br>能抓到 feed 的站点 " + esc(sweep.active != null ? sweep.active : "-") +
          " / " + esc(sweep.total != null ? sweep.total : "-") +
          " · 文章 " + esc(d.articles || 0) + " 篇" +
          " · 退避中 " + esc(d.failingSites || 0) + " 站" +
          " · 累计跑了 " + esc((d.counters && d.counters.ticks) || 0) + " 轮" +
          (d.lastError ? '<br><span class="muted">最近错误：' + esc(d.lastError) + "</span>" : "") +
          '<br><span class="muted">默认每分钟一轮；想降负载到 Netlify 设 FCIRCLE_INTERVAL_SEC。</span>';
      })
      .catch((e) => {
        box.textContent = "实时层接口不可读（" + (e && e.message) +
          "）：可能还没部署这版，或函数未启用。静态快照仍可用。";
      });
  }
  loadFCLive();
  fcCard.querySelector("#fc-live-reload").addEventListener("click", () => {
    loadFCLive();
    loadFCStatus();
  });

  /* GitHub Actions 最近运行记录：让「自动更新到底跑没跑」变得可见。
     数据文件只在抓到新文章时才写，所以绝不能拿 last_updated_time 判断任务是否执行。 */
  function loadFCRuns() {
    const box = fcCard.querySelector("#fc-last-run");
    if (!box) return;
    const s = store.getSettings();
    if (!s.owner || !s.repo) { box.textContent = "未连接仓库，无法读取运行记录"; return; }
    box.textContent = "读取中…";
    ctx.api.req(
      "/repos/" + encodeURIComponent(s.owner) + "/" + encodeURIComponent(s.repo) +
        "/actions/workflows/fcircle-refresh.yml/runs?per_page=3",
      { fresh: true }
    ).then((d) => {
      const runs = (d && d.workflow_runs) || [];
      if (!runs.length) {
        box.textContent = "基线任务尚未运行过；每天 09:00（北京时间）自动执行，也可点「立即对齐基线」";
        return;
      }
      const lines = runs.slice(0, 3).map((r) => {
        const when = new Date(r.created_at).toLocaleString("zh-CN", {
          timeZone: "Asia/Shanghai", hour12: false,
        });
        const trigger = r.event === "schedule" ? "定时" : "手动";
        const state = r.status !== "completed"
          ? "运行中" : (r.conclusion === "success" ? "成功" : (r.conclusion || "已结束"));
        return esc(when) + " · " + esc(trigger) + " · " + esc(state);
      });
      const age = Math.max(0, Date.now() - new Date(runs[0].created_at).getTime());
      const ago = age < 3600000 ? Math.max(1, Math.round(age / 60000)) + " 分钟"
        : age < 86400000 ? Math.round(age / 3600000) + " 小时"
          : Math.floor(age / 86400000) + " 天";
      box.innerHTML = lines.join("<br>") +
        '<br><span class="muted">最近一次距今 ' + esc(ago) + "。" +
        "这是每天的基线任务；分钟级更新走实时层（上面的「实时层状态」）。</span>";
    }).catch((e) => {
      box.textContent = "运行记录读取失败：" + (e && e.message) +
        "；可点右侧「Actions ↗」到 GitHub 确认";
    });
  }
  loadFCRuns();
  fcCard.querySelector("#fc-runs-reload").addEventListener("click", loadFCRuns);

  async function saveFC() {
    if (!fcLoaded) {
      toast("配置未成功加载，已禁用保存以免覆盖", "error");
      return;
    }
    const enabled = fcCard.querySelector("#fc-enabled").value === "true";
    const per = parseInt(fcCard.querySelector("#fc-perlink").value, 10);
    if (isNaN(per) || per < 1 || per > 20) {
      toast("每个友链篇数需为 1–20", "error");
      return;
    }
    loading.show("正在保存…");
    try {
      let fresh;
      try {
        fresh = loadYaml(await ctx.api.readFile(FCIRCLE_PATH, { fresh: true })) || {};
      } catch (e) {
        if (e.status === 404 || ctx.demo) fresh = {};
        else throw e;
      }
      fresh.enabled = enabled;
      fresh.per_link = per;
      await ctx.api.writeFile(FCIRCLE_PATH, dumpYaml(fresh), "Update Fcircle Config by Qexo");
      toast("配置已保存，GitHub Actions 下次运行生效", "success");
    } catch (e) { handleErr(e); }
    loading.hide();
  }
  fcCard.querySelector("#fc-save").addEventListener("click", saveFC);

  fcCard.querySelector("#fc-run").addEventListener("click", async () => {
    loading.show("正在触发 GitHub Actions…");
    try {
      const s = store.getSettings();
      await ctx.api.req(
        "/repos/" + encodeURIComponent(s.owner) + "/" + encodeURIComponent(s.repo) +
          "/actions/workflows/fcircle-refresh.yml/dispatches",
        { method: "POST", body: { ref: s.branch || "main", inputs: { reason: "后台手动触发" } } }
      );
      toast("已触发，约 1–2 分钟后点「基线运行记录」查看结果", "success");
      setTimeout(loadFCRuns, 4000);
    } catch (e) {
      toast("触发失败（Token 需具备 Actions 写入权限，或改用 GitHub 页面手动运行）：" + (e && e.message), "error");
    }
    loading.hide();
  });

  /* ---------- N+1. 访问统计（采集开关写入仓库静态配置） ---------- */
  const anCard = el(`<div class="card settings-section">
      <div class="card-header">${ic("eye")}<h2>访问统计</h2><div class="sub">采集开关 / 排除路径 / 统计天数</div></div>
      <div class="hint" style="margin-bottom:.9rem">
        统计完全自托管（v6）：前台 <code>/api/collect</code> 上报、<code>/api/stats</code> 实时聚合（Netlify Blobs），
        每条浏览事件独立写入并原子去重，并发不会再互相覆盖；会话按 30 分钟空闲在服务端重建，
        时间统一按北京时间。无 Cookie 追踪、不记录 IP、不存原始 UA。配置写入
        <code>source/analytics/config.json</code>，构建后成为 <code>/analytics/config.json</code>。
        <b>保存后需等 Netlify 重新部署，前台才会读到新配置</b>；统计数据本身不在仓库里。
      </div>
      <div class="grid-2" style="gap:1rem">
        <div class="field" style="margin:0"><label>访问采集</label>
          <select class="input" id="an-enabled">
            <option value="true">开启（推荐）</option>
            <option value="false">暂停（前台不再上报）</option>
          </select>
          <div class="hint">暂停后历史数据保留，只是不再新增</div>
        </div>
        <div class="field" style="margin:0"><label>前台统计天数</label>
          <input class="input" id="an-days" type="number" min="7" max="90" value="30" />
          <div class="hint">7–90，决定图表横轴长度和接口查询区间</div>
        </div>
        <div class="field" style="margin:0"><label>停留心跳间隔（秒）</label>
          <input class="input" id="an-beat" type="number" min="15" max="300" value="60" />
          <div class="hint">15–300，页面可见时定时上报停留；越短越准，请求越多</div>
        </div>
      </div>
      <div class="field" style="margin-top:.8rem"><label>排除路径（每行一个前缀）</label>
        <textarea class="input" id="an-excludes" rows="3" placeholder="/admin&#10;/stats"></textarea>
        <div class="hint">以这些前缀开头的页面不上报；默认排除后台和统计页，避免自己污染数据。留空表示全部统计</div>
      </div>
      <div class="field"><label>当前状态</label><div class="hint" id="an-status">读取中…</div></div>
      <div class="settings-actions">
        <button class="btn btn-primary" id="an-save">${ic("save")}保存统计设置</button>
        <a class="btn" href="#/stats">${ic("eye")}查看统计</a>
        <a class="btn" href="/stats/" target="_blank" rel="noopener">${ic("external")}前台统计页 ↗</a>
      </div>
      <details style="margin-top:.9rem">
        <summary style="cursor:pointer;font-weight:600">操作说明</summary>
        <ol style="margin:.6rem 0 0;padding-left:1.3rem;line-height:1.9">
          <li><b>保存后不是立刻生效</b>：配置是静态文件，保存会向仓库提交一次，
            Netlify 部署完成（约 1–2 分钟）后前台才会读到新值。</li>
          <li><b>彻底停用</b>：把「访问采集」设为暂停即可，已采集的数据仍在，
            恢复开启后继续累计；不会清空历史。</li>
          <li><b>排除路径</b>：写路径前缀，例如 <code>/admin</code>、<code>/pyq</code>。
            不写开头的斜杠会自动补上。</li>
          <li><b>数据在哪</b>：事件存放在 Netlify Blobs（<code>zui-analytics</code> 存储），
            由 <code>netlify/functions/collect.mjs</code> 与 <code>stats.mjs</code> 读写，仓库里看不到明细。</li>
          <li><b>查看</b>：后台侧栏「访问统计」与前台 <code>/stats/</code> 读的是同一个接口，
            只是两套界面。后台多一个「强制重算」按钮，可绕过 60 秒聚合缓存。</li>
          <li><b>数据可信度</b>：页面顶部健康条分别显示「数据截至」（最后一条采集事件的北京时间）、
            「本次计算」（聚合执行时间）、是否命中缓存、数据覆盖天数、扫描事件数、停留覆盖率。
            这些都不是页面打开时间；没有数据时会明确显示「尚无采集数据」，不会伪装成刚更新。</li>
          <li><b>停留时长</b>：由页面可见心跳累计，只对有心跳数据的会话求平均；
            旧版历史数据没有心跳，健康条里的「停留覆盖」偏低属于正常，等新数据积累后会上升。</li>
        </ol>
      </details>
    </div>`);
  view.appendChild(anCard);

  const anStatus = anCard.querySelector("#an-status");
  let anLoaded = false;
  function applyAn(c) {
    anCard.querySelector("#an-enabled").value = c.enabled === false ? "false" : "true";
    const d = Number(c.days);
    anCard.querySelector("#an-days").value = d >= 7 && d <= 90 ? d : 30;
    const beat = Number(c.heartbeatSeconds);
    anCard.querySelector("#an-beat").value = beat >= 15 && beat <= 300 ? beat : 60;
    anCard.querySelector("#an-excludes").value = Array.isArray(c.excludePaths)
      ? c.excludePaths.join("\n") : ["/admin", "/stats"].join("\n");
    anStatus.textContent = "配置文件已读取 · 采集" + (c.enabled === false ? "暂停" : "开启");
    anLoaded = true;
  }
  ctx.api.readFile(ANALYTICS_PATH).then((raw) => {
    try { applyAn(JSON.parse(raw) || {}); }
    catch (e) { anStatus.textContent = "配置文件不是合法 JSON：" + e.message; }
  }).catch((e) => {
    if (e && e.status === 404) {
      applyAn({ enabled: true, days: 30, heartbeatSeconds: 60, excludePaths: ["/admin", "/stats"] });
      anStatus.textContent += "（仓库暂无配置文件，保存时新建）";
    } else {
      anStatus.textContent = "配置读取失败：" + (e && e.message);
    }
  });
  fetch("/api/stats?days=1", { cache: "no-store" }).then((r) => {
    anStatus.textContent += r.ok ? " · 统计接口可用" : " · 统计接口 HTTP " + r.status;
  }).catch(() => {
    anStatus.textContent += " · 统计接口不可用（本地预览或 Functions 未部署）";
  });

  async function saveAn() {
    if (!anLoaded) {
      toast("配置未成功加载，已禁用保存以免覆盖", "error");
      return;
    }
    const days = parseInt(anCard.querySelector("#an-days").value, 10);
    if (!(days >= 7 && days <= 90)) {
      toast("统计天数需为 7–90", "error");
      return;
    }
    const beat = parseInt(anCard.querySelector("#an-beat").value, 10);
    if (!(beat >= 15 && beat <= 300)) {
      toast("心跳间隔需为 15–300 秒", "error");
      return;
    }
    const excludes = anCard.querySelector("#an-excludes").value
      .split("\n").map((s) => s.trim()).filter(Boolean)
      .map((s) => s.charAt(0) === "/" ? s : "/" + s.replace(/^\/+/, ""));
    loading.show("正在保存统计设置…");
    try {
      // 写前重读，保留表单之外的未知键；文件不存在或配置损坏时按新建处理
      let raw = null;
      try { raw = await ctx.api.readFile(ANALYTICS_PATH, { fresh: true }); }
      catch (e) { if (!(e && (e.status === 404 || ctx.demo))) throw e; }
      let fresh = {};
      if (raw) { try { fresh = JSON.parse(raw) || {}; } catch (_) { fresh = {}; } }
      fresh.enabled = anCard.querySelector("#an-enabled").value === "true";
      fresh.days = days;
      fresh.heartbeatSeconds = beat;
      fresh.excludePaths = excludes;
      fresh.note = "由后台「设置 → 访问统计」维护；改动写入仓库后需 Netlify 重新部署才会在前台生效";
      await ctx.api.writeFile(ANALYTICS_PATH, JSON.stringify(fresh, null, 2) + "\n", "Update Analytics Config by Qexo");
      applyAn(fresh);
      toast("统计设置已保存，Netlify 部署完成后在前台生效", "success", 5200);
    } catch (e) { handleErr(e); }
    loading.hide();
  }
  anCard.querySelector("#an-save").addEventListener("click", saveAn);

  loading.hide();
}
