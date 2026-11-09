/* pages/settings.js — 设置：仓库 / Netlify / 站点资料 / 导航菜单 / 首页外观 */

import {
  ic, esc, el, toast, loading, store,
} from "../app.js";
import { NetlifyAPI } from "../netlify.js";
import { loadYaml, dumpYaml } from "../yaml.js";

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
    s.owner = repoCard.querySelector("#s-owner").value.trim() || s.owner;
    s.repo = repoCard.querySelector("#s-repo").value.trim() || s.repo;
    s.branch = repoCard.querySelector("#s-branch").value.trim() || "main";
    s.siteUrl = repoCard.querySelector("#s-siteurl").value.trim();
    store.saveSettings(s);
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
  let meta = {};
  loading.show("正在加载配置文件…");
  try {
    meta = loadYaml(await ctx.api.readFile(SITE_META_PATH)) || {};
  } catch (e) {
    handleErr(e);
    meta = {};
  }

  metaCard.querySelector("#m-title").value = meta.title || "";
  metaCard.querySelector("#m-subtitle").value = meta.subtitle || "";
  metaCard.querySelector("#m-desc").value = meta.description || "";
  metaCard.querySelector("#m-kw").value = Array.isArray(meta.keywords) ? meta.keywords.join(",") : (meta.keywords || "");
  metaCard.querySelector("#m-author").value = meta.author || "";
  metaCard.querySelector("#m-lang").value = meta.language || "zh-CN";

  metaCard.querySelector("#save-meta").addEventListener("click", async () => {
    const next = {
      ...meta,
      title: metaCard.querySelector("#m-title").value.trim(),
      subtitle: metaCard.querySelector("#m-subtitle").value.trim(),
      description: metaCard.querySelector("#m-desc").value.trim(),
      keywords: metaCard.querySelector("#m-kw").value.split(/[,，]/).map((s) => s.trim()).filter(Boolean),
      author: metaCard.querySelector("#m-author").value.trim(),
      language: metaCard.querySelector("#m-lang").value.trim() || "zh-CN",
    };
    loading.show("正在保存站点资料…");
    try {
      await ctx.api.writeFile(SITE_META_PATH, dumpYaml(next), "Update Site Meta by Qexo");
      toast("站点资料已保存，Netlify 构建已触发", "success");
    } catch (e) { handleErr(e); }
    loading.hide();
  });

  /* 导航菜单 + 首页外观（同一个 fluid_config.yml） */
  let fluid = {};
  try {
    fluid = loadYaml(await ctx.api.readFile(FLUID_PATH)) || {};
  } catch (e) {
    fluid = {};
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

  async function saveFluid(extraMessage) {
    navbar.menu = menu.filter((m) => m.key && m.link);
    navbar.blog_title = indexCard.querySelector("#i-blogtitle").value.trim();
    fluid.navbar = navbar;
    fluid.index = {
      ...(fluid.index || {}),
      banner_img: indexCard.querySelector("#i-banner").value.trim(),
      banner_img_height: Number(indexCard.querySelector("#i-height").value) || undefined,
      slogan: { ...((fluid.index || {}).slogan || {}), text: indexCard.querySelector("#i-slogan").value },
    };
    if (fluid.index.banner_img_height == null) delete fluid.index.banner_img_height;
    loading.show("正在保存…");
    try {
      await ctx.api.writeFile(FLUID_PATH, dumpYaml(fluid), "Update Fluid Config by Qexo");
      toast("配置已保存，Netlify 构建已触发", "success");
    } catch (e) { handleErr(e); }
    loading.hide();
  }

  indexCard.querySelector("#save-index").addEventListener("click", saveFluid);

  loading.hide();
}
