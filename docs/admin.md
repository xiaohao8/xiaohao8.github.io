# 后台使用与维护（Qexo 风格 · Netlify 版）

> v4.0.0：完全重写。不再使用 Netlify CMS / Netlify Identity / Git Gateway，
> 改为 **Qexo 同款模式**：浏览器用 GitHub Token 直连 GitHub API 读写仓库，
> 保存即提交到 `main`，Netlify 自动构建发布。界面按 Qexo 的 Argon Dashboard 风格实现。

## 入口

- 后台地址：`https://202271.xyz/admin/`（站内导航「管理后台」）
- 演示模式：`https://202271.xyz/admin/?demo=1`（本地模拟数据，不连 GitHub，随便点）
- 所有前端资源（Vditor 编辑器、js-yaml、样式）都由本站托管，不依赖外网 CDN

## 首次配置（一次性）

### 1. 生成 GitHub Token

1. 打开 <https://github.com/settings/personal-access-tokens/new>（Fine-grained token）
2. **Repository access** → Only select repositories → 选 `xiaohao8/xiaohao8.github.io`
3. **Permissions → Repository permissions → Contents** 设为 `Read and write`（其他保持默认）
4. 生成后复制 Token（`github_pat_` 开头）

### 2. 登录

在 `/admin/` 登录页输入 **GitHub 用户名**（xiaohao8）和上一步的 Token，勾选「记住登录状态」。
Token 只保存在你本机浏览器（localStorage / sessionStorage），不经过任何第三方。
Token 过期或失效时后台会提示重新登录。

### 3.（可选）配置 Netlify 集成

登录后进入「设置 → Netlify 集成」：

| 配置项 | 作用 | 获取方式 |
| --- | --- | --- |
| Site ID | 读取部署状态/历史 | Netlify 后台 → Site settings → General → Site information |
| Access Token | 配合 Site ID 查部署 | Netlify → User settings → Applications → New access token |
| Build Hook URL | 一键重新部署 | Site settings → Build & deploy → Build hooks |

不配置也不影响正常写作：保存文章 = 提交 GitHub = 自动触发 Netlify 构建。

### 4.（可选）关闭旧的 Netlify Identity

新后台不再使用 Identity / Git Gateway。可在 Netlify 后台
（Integrations → Netlify Identity）关闭它，不影响新后台。

## 功能与数据位置

| 模块 | 功能 | 数据位置 |
| --- | --- | --- |
| 工作台 | 统计卡、最近文章、最新图片、Netlify 部署状态、快捷入口 | 实时读取仓库 + `/admin/manifest.json` |
| 文章管理 | 列表/搜索/新建/删除，置顶、加密状态展示 | `source/_posts/*.md` |
| 编辑器 | Vditor（IR 所见即所得 Markdown）、front-matter 侧栏、自动摘要、图片直传、Ctrl+S | 文章 front-matter + 正文 |
| 页面管理 | 关于 / 友链页 / 说说页 / 朋友圈 / 计划清单 | `source/about/index.md` 等对应 md |
| 说说 | 快发框（Markdown + 配图 + 时间）、时间线编辑/删除 | `source/_data/talks.yml` |
| 友链 | 表格增删改 | `source/_data/fluid_config.yml` → `links.items` |
| 图库 | 拖拽多图上传、缩略图预览、复制相对路径/URL/Markdown、删除 | `source/images/uploads/` |
| 设置 | 仓库连接、Netlify、站点资料、导航菜单、首页外观 | localStorage + `site_meta.yml` + `fluid_config.yml` |

## 注意事项

- **保存即发布**：所有写操作都会直接 commit 到 `main` 分支并触发 Netlify 生产构建；
  部署约 1-2 分钟完成。想先看看效果可以用 `?demo=1` 演示模式。
- **abbrlink 勿动**：编辑旧文章时 `abbrlink` 为只读展示，不要清空，否则旧链接 404。
- **图片路径**：编辑器/图库上传的图片在文章里写相对路径 `/images/uploads/文件名`。
- **缓存**：`/admin/assets/*`、`/admin/vendor/*` 有一年强缓存（netlify.toml），
  代码更新会带 `?v=版本号` 参数刷新。本地调试请用无痕窗口或 `hexo server`。
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
**部署状态一直加载失败？** Site ID 或 Token 不对；只填 Build Hook 也能一键部署，只是看不到状态。
**编辑器空白？** Vditor 资源由 `/admin/vendor/vditor/` 提供，确认部署产物里有该目录。
