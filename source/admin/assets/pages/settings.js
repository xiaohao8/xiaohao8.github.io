/* pages/settings.js — 设置：仓库 / Netlify / 站点资料 / 导航菜单 / 首页外观 */

import {
  ic, esc, el, toast, loading, store, safeHttpUrl,
} from "../app.js?v=4.1.3";
import { NetlifyAPI } from "../netlify.js?v=4.1.3";
import { setMediaConfig, mediaFallbackUrls } from "../github.js?v=4.1.3";
import { loadYaml, dumpYaml } from "../yaml.js?v=4.1.3";

const SITE_META_PATH = "source/_data/site_meta.yml";
const FLUID_PATH = "source/_data/fluid_config.yml";

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

  loading.hide();
}
