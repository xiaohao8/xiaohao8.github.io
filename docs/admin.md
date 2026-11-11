# 后台使用与维护（Qexo 风格 · Netlify 版）

> v4.1.2：修复「删除 / 编辑友链等写操作报 `Unexpected token ... is not valid JSON`」。
> 根因是同一个 `contents` URL 先后以 raw（文件原文）与 json（含 sha 的元数据）两种
> `Accept` 连续请求，部分浏览器缓存 / 代理不按 `Vary: Accept` 区分，把 YAML 原文回给了
> 需要 JSON 的请求。现在 raw 请求走独立 URL（`&raw=1`）、所有 API 请求 `cache: no-store`，
> 非 JSON 响应会给出带状态码与内容片段的可读错误；对 `github.js` 的静态 import 统一加
> `?v=版本号`，避免 SWR 缓存下新旧模块混用。
>
> v4.1.0：修复高优先级 bug（图片/链接 XSS、GitHub 限流误判登出、路由切换竞态、
> 友链/说说/设置保存覆盖仓库最新改动、图库复制弹窗缺 import）；后台重构
> （统一上传模块与 Vditor 加载器、缓存隔离与资源回收、版本号单一来源）；
> 构建链升级 **Hexo 8** 与插件、Fluid 主题内置 vendored。
>
> v4.0.0：完全重写。不再使用 Netlify CMS / Netlify Identity / Git Gateway，
> 改为 **Qexo 同款模式**：浏览器用 GitHub Token 直连 GitHub API 读写仓库，
> 保存即提交到 `main`，Netlify 自动构建发布。界面按 Qexo 的 Argon Dashboard 风格实现。
>
> v4.0.2：后台图片预览改为 **Gitee 镜像主力 + 本站自动兜底**，设置页可实时切换预览源，
> 图库复制链接新增 Gitee 直链选项。

## 入口

- 后台地址：`https://202271.xyz/admin/`（站内导航「管理后台」）
- 演示模式：`https://202271.xyz/admin/?demo=1`（本地模拟数据，不连 GitHub，随便点）
- 所有前端资源（Vditor 编辑器、js-yaml、样式）都由本站托管，不依赖外网 CDN

## 首次配置（一次性）

### 1. 生成 GitHub Token

1. 打开 <https://github.com/settings/personal-access-tokens/new>（Fine-grained token）
2. **Repository access** → Only select repositories → 选 `xiaohao8/xiaohao8.github.io`
3. **Permissions → Repository permissions → Contents** 设为 `Read and write`（其他保持默认）
4. 建议同时勾选 **Issues: Read and write**（用于「友链自助申请」的后台审批）
5. 生成后复制 Token（`github_pat_` 开头）

### 2. 登录

在 `/admin/` 登录页输入 **GitHub 用户名**（xiaohao8）和上一步的 Token，勾选「记住登录状态」。
Token 只保存在你本机浏览器（localStorage / sessionStorage），不经过任何第三方。
Token 过期或失效时后台会提示重新登录。

### 3.（可选）配置 Netlify 集成

登录后进入「设置 → Netlify 集成」，**通常只需要粘贴一个 Access Token**：

| 配置项 | 作用 | 获取方式 |
| --- | --- | --- |
| Access Token | 查部署状态；保存时自动识别 Site ID | Netlify → User settings → Applications → New access token |
| Site ID | 一般不用填，保存时按 Token 自动识别 | 仅识别失败时手动填（Site settings → General） |
| Build Hook URL | 顶栏「一键部署」手动触发 | Site settings → Build & deploy → Build hooks |

不配置也不影响正常写作：保存文章 = 提交 GitHub = 自动触发 Netlify 构建。

### 4.（可选）关闭旧的 Netlify Identity

新后台不再使用 Identity / Git Gateway。可在 Netlify 后台
（Integrations → Netlify Identity）关闭它，不影响新后台。

### 5.（可选）图片预览源（v4.0.2）

国内访问 Cloudflare 上的大图当缩略图偏慢，所以后台缩略图默认走 Gitee 镜像：

```
https://gitee.com/xiaohao3/xiaohao8.github.io/raw/main/source/images/uploads/1000.jpg
```

raw 地址会 302 到签名直链，`<img>` 会自动跟随。Gitee 镜像尚未同步到刚上传的图片时，
预览会依次回退到本站 `/images/uploads/1000.jpg`、站点绝对地址、自定义前缀，全部失败才显示破图。
注意：仓库里的 `source/` 前缀在部署产物里会被去掉，**本站路径是 `/images/uploads/...`，不是 `/source/images/uploads/...`**。

「设置 → 图片预览源」可切换：

| 预览源 | 说明 |
| --- | --- |
| Gitee 镜像（推荐） | 国内加载快；可改 Gitee 用户名 / 仓库 / 分支 |
| 本站直连 | 走站点地址，大图可能偏慢 |
| 自定义前缀 | 例如 `https://cdn.jsdelivr.net/gh/xiaohao8/xiaohao8.github.io@main`，按 `前缀/source/...` 拼接（须镜像整个仓库） |

「测试预览链接」会按候选链逐条探测并报告第一个可用地址；保存后立即生效，已打开的图库页刷新即可。
图库「复制链接」始终提供 Gitee 直链（演示模式不显示），可用于外链引用；文章正文仍建议写相对路径。

## 功能与数据位置

| 模块 | 功能 | 数据位置 |
| --- | --- | --- |
| 工作台 | 统计卡、最近文章、最新图片、Netlify 部署状态、快捷入口 | 实时读取仓库 + `/admin/manifest.json` |
| 文章管理 | 列表/搜索/新建/删除，置顶、加密状态展示 | `source/_posts/*.md` |
| 编辑器 | Vditor（IR 所见即所得 Markdown）、front-matter 侧栏、自动摘要、图片直传、Ctrl+S | 文章 front-matter + 正文 |
| 页面管理 | 关于 / 友链页 / 说说页 / 朋友圈 / 计划清单 | `source/about/index.md` 等对应 md |
| 说说 | 快发框（Markdown + 配图 + 时间）、时间线编辑/删除 | `source/_data/talks.yml` |
| 友链 | 表格增删改 | `source/_data/fluid_config.yml` → `links.items` |
| 图库 | 拖拽多图上传、缩略图预览（Gitee + 本站兜底）、复制相对路径/本站 URL/Gitee 直链/Markdown、删除 | `source/images/uploads/` |
| 设置 | 仓库连接、Netlify、图片预览源、站点资料、导航菜单、首页外观 | localStorage + `site_meta.yml` + `fluid_config.yml` |

## 注意事项

- **保存即发布**：所有写操作都会直接 commit 到 `main` 分支并触发 Netlify 生产构建；
  部署约 1-2 分钟完成。想先看看效果可以用 `?demo=1` 演示模式。
- **abbrlink 勿动**：编辑旧文章时 `abbrlink` 为只读展示，不要清空，否则旧链接 404。
- **图片路径**：编辑器/图库上传的图片在文章里写相对路径 `/images/uploads/文件名`；
  后台预览另走 Gitee 镜像（仓库路径 `source/images/uploads/文件名`），二者不是同一条 URL。
- **缓存**：`/admin/vendor/*` 长期强缓存；`/admin/assets/*` 用 `max-age=600, stale-while-revalidate=86400`
  （切页直接命中本地缓存，不再为每个模块发一次 304）；入口 `/admin/` 保持 `max-age=0`，
  入口脚本带 `?v=版本号`（v4.1.2），大版本更新立即生效；引用 `github.js` 的静态 import
  也带同一版本号，保证只加载一份模块实例。
- **数据读取**：GitHub API 的 GET 结果在会话内缓存 30 秒，写操作自动清空；
  所有 API 请求禁用浏览器 HTTP 缓存（`cache: no-store`），raw 读取额外带 `&raw=1`，
  避免文件原文与元数据响应被缓存串用。
  **写前重读必须传 `readFile(path, { fresh: true })`**，否则可能覆盖仓库最新改动。
  文章列表 front-matter 缓存在 `localStorage`（5 分钟，跨标签页复用），保存/删除后自动失效。
- 本地调试请用无痕窗口或 `hexo server`。
- **安全**：后台 HTML 带 `noindex`；请勿把 Token 提交进仓库或贴给别人。

## 本地开发

```bash
npm install        # 首次
npm run server     # http://localhost:4000/admin/ 打开后台
npm run build      # 生成到 public/
```

本地 `hexo server` 下后台可用演示模式（`?demo=1`）完整预览；
连 GitHub 时直接在登录页填 Token 即可（浏览器直接访问 api.github.com）。

## 目录结构

```
source/admin/
├── index.html              # 壳（内联 SVG 图标 + 启动画面）
├── assets/
│   ├── admin.css           # Argon/Qexo 风格样式（手写，无框架）
│   ├── app.js              # 会话 / 路由 / 骨架 / 通用 UI
│   ├── github.js           # GitHub REST 封装
│   ├── netlify.js          # Netlify API 封装
│   ├── yaml.js             # front-matter / YAML 往返
│   ├── demo.js             # 演示模式数据源
│   └── pages/              # 各页面模块（dashboard/posts/editor/…）
└── vendor/
    ├── vditor/dist/        # Vditor 编辑器（Qexo 同款）
    └── js-yaml.min.js
```

## 常见问题

**登录报 404 / 找不到仓库？** 检查设置页 Owner / 仓库名；Token 需要勾选该仓库。
**保存报 403？** Token 的 Contents 权限需要是 Read and write，或 Token 已过期。
**部署状态一直加载失败 / 填了 Token 没识别到站点？** 确认 Token 是账号级 Personal Access Token，且站点属于该账号。
**编辑器空白？** Vditor 资源由 `/admin/vendor/vditor/` 提供，确认部署产物里有该目录。

## 国内访问加速与稳定性（v2.4）

- **Service Worker**（`source/sw.js`）：页面网络优先（新内容即时可见）、
  静态资源缓存优先 + 后台更新（回访近乎秒开）、断网时整站照常可读。
  `/admin/` 后台与访问统计脚本不经过 SW。
  更新缓存：改 `sw.js` 顶部的 `VERSION` 常量即可全量刷新。
- **Gitee 镜像兜底**：站内图片（`/images/uploads/*`）加载失败时，
  custom.js 自动切换到 Gitee 仓库 raw 地址（依赖 Gitee 镜像保持同步；
  在 Gitee 仓库页面可手动「强制同步」）。
- **预连接**：`custom_head` 注入了 baomitu / alicdn 的 preconnect 与
  busuanzi / gitee 的 dns-prefetch，降低首次请求延迟。
