# 后台使用与维护（Qexo 风格 · Netlify 版）

> v4.4.3：朋友圈改成**每分钟更新**。GitHub Actions 的 `schedule` 最小间隔是 5 分钟、
> 高峰还会延迟或跳过，做不到 1 分钟，所以新增 Netlify 定时函数 `fcircle-tick`
> （cron `* * * * *`）做「增量探测 + 合并」，结果写 Netlify Blobs，页面读 `GET /api/fcircle`；
> GitHub Actions 退化为每天一次的全量基线任务。函数单次只有 30 秒，因此用
> 「已知 feed 直连 + ETag 条件请求（常态 304）+ 总预算 20 秒 + 死站指数退避」控制开销；
> 空转的分钟只写约 6 KB 状态，不重写文章 JSON。后台设置页新增「实时层状态」与
> 「基线运行记录」两块，`/api/fcircle?debug=1` 可直接看最近一轮探测摘要。
> 数据三层兜底：Blobs 实时层 → 静态 `/fcircle/moments.json` → 页面骨架。

> v4.4.2：修「加载巨慢」。根因不是统计接口，而是**页面体积**：旧版把 83 KB 未压缩 CSS
> 逐页内联、首页再内联 74 KB banner base64，HTML 最高 197 KB，且每翻一页都要重新下载
> （实测 Netlify 到国内仅 2–8 KB/s）。现在 CSS 改成带内容 hash 的外链 + 永久缓存、
> banner 改成原图 + preload、预取降为 `conservative`：首页约 40 KB、统计页约 30 KB。
> 统计侧同步提速：聚合读写并行、停留数据先 list 再按需读、11 MB IP 库只随采集函数部署；
> 前台 `/stats/` 与后台统计页改为**先出骨架、12 秒超时、失败可重试**，不再无限转圈。
> 健康条「IP 归属库」改成显示 `本地库 N / 降级 M`（按真实事件统计，比查文件是否存在可信）。

> v4.4.1：排除 Netlify 自身的机器流量。采集端在写数据之前统一拦截
> `*.netlify.app` / `netlify.com` 的部署预览与后台跳转、Netlify 构建/健康检查服务、
> 监控、无头浏览器与脚本客户端（curl / Go-http-client / UptimeRobot 等），
> pv / dwell / leave 全部静默丢弃，不计入任何指标。判定只看来源域名与明确机器 UA，
> 不按 IP 段或云厂商猜，避免误杀走代理的真实访客；正常浏览器访问不受影响。
> 健康条新增「机器流量：已过滤 N 类」，`health.machineFilter.labels` 列出完整规则。
> 过滤只影响新采集，**历史数据不回改**。

> v4.4.0：访客地区改成「省 市 运营商」（如 `湖北 孝感 联通`）。用 Netlify 提供的
> `context.ip` 查仓库自带的离线 IPv4 归属库 `netlify/data/ip2region_v4.xdb`，
> 不请求任何第三方 IP 接口；事件里**只保存解析后的标签，不保存原始 IP**。
> 新增「省份分布」「运营商分布」面板与实时访客完整地区串，健康条显示 IP 库是否加载成功。
> IPv6 或库缺失时自动降级到边缘 geo（有省市、无运营商）。

> v4.3.0：统计按 51.la / Umami / Plausible 的口径整体重做（数据引擎 v6）。
> 采集改为「一条浏览一个独立 key + 原子幂等写」，不再读整月 NDJSON 覆盖写回；
> 服务端按 30 分钟空闲重建会话，新增页面可见心跳累计停留、跳出率、访问深度、
> 新老访客、入口页/退出页、搜索关键词、UTM、实时访客、环比等。时间一律北京时间，
> 并把「数据截至（最后一条事件）/ 本次计算 / 请求时间 / 缓存命中」分开显示，
> 附带数据健康状态与指标口径说明，不再拿当前时间冒充更新时间。后台统计页新增
> 「强制重算」可绕过 60 秒聚合缓存。详见 `docs/analytics.md`。

> v4.2.0：新增「访问统计」侧栏页与「设置 → 访问统计」配置卡片，并修复前台
> `/stats/` 看板 UI。之前明细区误用了后台的 `.grid-2` / `.card` 类名（前台 CSS 里没有，
> 所以卡片边框和间距全丢）、`.zui-hbar` / `.zui-bars-sm` 缺样式（24 小时只剩一排数字），
> 而且图表直接渲染接口返回的日子，只有几天有数据就只剩两三根细条。现在序列会补齐到
> 完整 N 天和 24 小时、标签抽样显示、空值画灰色基线，并补上操作系统 / 设备类型 / 实时动态面板。
> 采集开关、排除路径、统计天数统一由 `source/analytics/config.json` 控制。

> v4.1.9：编辑器资源换源 + 先可写后升级。实测 Netlify（Cloudflare 边缘）到国内只有
> 3~8 KB/s，而 Vditor 的 Markdown 引擎 lute 压缩后约 700KB，按这个速度要 200 多秒——
> 之前 30 秒超时正是卡在这里。现在：① 资源按「npmmirror（阿里 npm 镜像，同版本同文件
> 0.6 秒）→ 本站」顺序加载，成功哪个记住哪个；② 进入编辑页先渲染可写的纯文本框，
> 引擎在后台加载，就绪后自动升级为富文本，保留已输入内容；③ 预加载图标脚本并占住
> Vditor 内部的 script id，绕开它「同步 XHR 取源码」在跨域镜像上缺 CORS 的失败。
>
> v4.1.7：修复「编辑文章 / 说说页面正文区空白」。根因是 Vditor 的正文渲染挂在异步链上
> ——构造函数本身不报错，要等 `dist/js/lute/lute.min.js`、图标等子资源就绪才渲染；
> 子资源被网络拦截或超时时，编辑器容器会一直空着，且没有任何提示。现在：
> ① Vditor 及其脚本固定走本站（Gitee raw 返回 `text/plain`，浏览器会拒绝执行 script，
> 不能作为脚本源）；② 提前显式加载 Markdown 引擎，失败即抛出可读错误；
> ③ 页面加 15 秒 watchdog，仍未生成编辑器就自动降级为纯文本编辑，给出原因和
> 「重新加载编辑器」按钮；④ 加载失败不再永久缓存，可重试。加载期间也有明确提示，
> 不再是无声空白。
>
> v4.1.4：让两个提速改动真正在线上生效。① 构建期文章索引 `scripts/posts-index.js` 入库，
> Netlify 才会生成 `/admin/posts-index.json`；同时修正后台用相对路径取索引的 bug
> （hash 路由下会解析成 `/admin/admin/posts-index.json`）。② 前台 Speculation Rules
> 文档预取与 `fluid-bundle.js` 预加载随 `_config.fluid.yml` 上线，并清掉重复的字体样式表引用。
> 文章列表 / 工作台从逐篇 52 次 GitHub API 降为 1 个静态请求；编辑后靠本地覆盖 +
> 工具条「强制刷新」保持真实。
>
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
| 访问统计 | 可信度健康条、PV/UV/会话/跳出率/停留/新老访客/在线、环比、来源与搜索词、入口/退出页、UTM、实时访客、指标口径说明；可「强制重算」 | 只读 `GET /api/stats?days=30`（`&fresh=1` 绕过缓存） |
| 设置 | 仓库连接、Netlify、图片预览源、站点资料、导航菜单、首页外观、朋友圈自动更新、访问统计 | localStorage + `site_meta.yml` + `fluid_config.yml` + `fcircle.yml` + `analytics/config.json` |

## 注意事项

- **保存即发布**：所有写操作都会直接 commit 到 `main` 分支并触发 Netlify 生产构建；
  部署约 1-2 分钟完成。想先看看效果可以用 `?demo=1` 演示模式。
- **abbrlink 勿动**：编辑旧文章时 `abbrlink` 为只读展示，不要清空，否则旧链接 404。
- **图片路径**：编辑器/图库上传的图片在文章里写相对路径 `/images/uploads/文件名`；
  后台预览另走 Gitee 镜像（仓库路径 `source/images/uploads/文件名`），二者不是同一条 URL。
- **缓存**：`/admin/vendor/*` 长期强缓存；`/admin/assets/*` 用 `max-age=600, stale-while-revalidate=86400`
  （切页直接命中本地缓存，不再为每个模块发一次 304）；入口 `/admin/` 保持 `max-age=0`，
  入口脚本带 `?v=版本号`（v4.1.4），大版本更新立即生效；所有模块间的静态 import
  都带同一版本号，保证只加载一份模块实例、不会混版白屏。
  `/admin/posts-index.json` 与 `/admin/manifest.json` 保持 `max-age=0, must-revalidate`。
- **数据读取**：GitHub API 的 GET 结果在会话内缓存 30 秒，写操作自动清空；
  所有 API 请求禁用浏览器 HTTP 缓存（`cache: no-store`），raw 读取额外带 `&raw=1`，
  避免文件原文与元数据响应被缓存串用。
  **写前重读必须传 `readFile(path, { fresh: true })`**，否则可能覆盖仓库最新改动。
  文章列表优先读构建期索引 `/admin/posts-index.json`（1 个静态请求，替代逐篇 52 次 API），
  结果仍缓存在 `localStorage`（5 分钟，跨标签页复用）；保存 / 删除后自动失效并写本地覆盖，
  索引重建完成前列表依然真实。索引不可用时会在控制台给出警告并回退 GitHub 全量读取，
  工具条「强制刷新」可主动绕过索引与缓存。
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
**编辑器正文空白 / 一直显示「正在加载富文本编辑器」？**（v4.1.9 已换源）
Vditor 的 Markdown 引擎 `lute.min.js` 压缩后约 700KB，从 Netlify（Cloudflare 边缘）到国内
实测只有 3~8 KB/s，要 200 多秒，等于拉不动——这是此前「正文空白」的真正原因。
现在资源优先走 npmmirror（`registry.npmmirror.com/vditor/<ver>/files`，同版本同文件约 0.6 秒），
失败自动回退本站 `/admin/vendor/vditor`；并且进入编辑页会**先给一个可写的纯文本框**，
引擎就绪后再自动升级成富文本，期间写的内容不会丢。
如果一直停在纯文本：说明两个源都没连上，内容仍可正常编辑保存，点「重新加载编辑器」重试即可；
也可在控制台看 `lute.min.js` 的请求状态。注意不能用 Gitee 当脚本源——它返回
`Content-Type: text/plain`，浏览器会拒绝执行 script（图片能跟随 302，脚本不行）。

## 国内访问加速与稳定性（v2.5）

- **Service Worker**（`source/sw.js`）：页面网络优先（新内容即时可见）、
  静态资源缓存优先 + 后台更新（回访近乎秒开）、断网时整站照常可读。
  `/admin/` 后台与访问统计脚本不经过 SW。
  更新缓存：改 `sw.js` 顶部的 `VERSION` 常量即可全量刷新。
- **Gitee 镜像兜底**：站内图片（`/images/uploads/*`）加载失败时，
  custom.js 自动切换到 Gitee 仓库 raw 地址（依赖 Gitee 镜像保持同步；
  在 Gitee 仓库页面可手动「强制同步」）。
- **智能选路**：后台登录时对 GitHub API（直连 vs gh-proxy 镜像）与编辑器资源
  （本站 vs Gitee 镜像）自动竞速，12h 记住最快线路；可在「设置 → 网络优化」
  手动指定。
- **后台静态资源缓存**：SW 现在也缓存 /admin/assets 与 /admin/vendor
  （编辑器 4.5MB 资源回访零加载）。
- **预连接**：`custom_head` 注入了 baomitu / alicdn 的 preconnect 与
  busuanzi / gitee 的 dns-prefetch，降低首次请求延迟。

## 朋友圈自动更新（v4.4.3 · 每分钟实时层 + 每日基线）

后台「设置 → 朋友圈自动更新」是唯一操作入口，**本机不需要跑任何刷新命令**。

从 v4.4.3 起分成两层，两者都全自动、都不需要你的电脑开机：

| | 谁来跑 | 多久一次 | 写到哪里 | 作用 |
| --- | --- | --- | --- | --- |
| 实时层 | Netlify 定时函数 `fcircle-tick` | **每分钟** | Netlify Blobs | 页面读 `/api/fcircle` 立刻看到新文章 |
| 基线层 | GitHub Actions `fcircle-refresh.yml` | 每天 09:00 | 仓库里的 `source/fcircle/moments.json` | 全量对齐 + 留一份数据在仓库，Blobs 被清空也能恢复 |

> 为什么实时层不放 GitHub Actions：Actions 的 `schedule` 最小间隔是 5 分钟，
> 官方明确不支持 1 分钟，而且高峰期还会延迟或跳过，做不到「每分钟」。

- **页面怎么取数**：先请求 `/api/fcircle`（实时层），失败自动回落到
  `/fcircle/moments.json`（静态快照）。两者结构完全一致，任何一边挂了页面都不会空。
  页脚「更新于」只在新文章入库时变，「检查于」是最近一次真正跑完探测的时间。
- **配置项**（`source/_data/fcircle.yml`，后台可直接编辑）：
  - `enabled`：`false` 只暂停每日基线任务，实时层与手动触发不受影响。
  - `per_link`：每个友链每次最多取几篇（1–20，默认 5）。
- **降负载 / 改频率**：不用改代码，在 Netlify → Site settings → Environment variables 里设
  - `FCIRCLE_INTERVAL_SEC`：全局间隔秒数，默认 60；改成 180 就是 3 分钟一轮
  - `FCIRCLE_SITE_INTERVAL_SEC`：单个站点最小探测间隔，默认 60
  - `FCIRCLE_MAX_PER_TICK` / `FCIRCLE_CONCURRENCY` / `FCIRCLE_TIMEOUT_MS` / `FCIRCLE_BUDGET_MS`
  改完重新部署生效。**想彻底停掉实时层**：删掉 `netlify.toml` 里
  `[functions."fcircle-tick"]` 的 `schedule` 行并重新部署，页面会自动回到静态快照。
- **立即刷新**：后台点「立即刷新」触发的是**每日基线任务**（GitHub Actions），
  约 1–2 分钟后点「运行状态」看结果；实时层不需要手动触发，下一分钟自己就会跑。
- **验证实时层是否在工作**：
  1. 浏览器打开 `https://202271.xyz/api/fcircle?debug=1`，
     `ok: true` 且 `lastRun` 在一分钟内 = 正常；
  2. `sweep.active` 是当前能抓到 feed 的站点数（39 条友链里通常 13 个左右）；
  3. `failingSites` 是正在退避的站点数，偶尔为 0 也正常。
- **新增友链**：改完 `fluid_config.yml` 部署一次即可，实时层与基线层都会自动包含它
  （构建期由 `scripts/fcircle-links.js` 导出成 `/fcircle/links.json` 给函数用）。
- **查看结果与日志**：Netlify → Functions → `fcircle-tick` → Logs 有每轮
  `{due, ok304, okNew, added, ms}` 摘要；Actions 运行记录里有成功/失败站点清单。
- **注意**：39 个友链里通常只有约 13 个能抓到 feed，其余多为站点关停或
  网络不可达；抓不到不影响已有文章，实时层会让失败站点自动退避（最长 30 分钟一次），
  不会因为它们把每分钟的额度耗光。

## 访问统计（v4.3.0 · 数据引擎 v6）

### 看什么

- 后台侧栏「站点 → 访问统计」：可信度健康条、10 个概览指标（PV / UV / 日均 UV /
  会话 / 跳出率 / 平均停留 / 访问深度 / 当前在线 / 新访客 / 老访客）、PV·UV·会话环比、
  30 天与 24 小时趋势、来源分类、热门页面表、入口/退出页、浏览器 / OS / 设备 / 屏幕 /
  语言 / 地区、搜索关键词、外链域名、UTM、实时访客表、指标口径说明。
  顶部按钮：「刷新数据」「强制重算」（`?fresh=1` 绕过 60 秒聚合缓存）
  「打开前台统计页」「统计设置」。
- 前台 `/stats/` 是同一接口的完整看板；两处都不经过 GitHub，也不需要登录。
- 页面顶部「数据截至」是**最后一条采集事件**的北京时间，不是打开页面的时间；
  「本次计算」是这次聚合执行时间；缓存命中会显示命中与年龄。空数据时明确显示
  「尚无采集数据」，不会拿当前时间冒充更新时间。

### 数据链路

| 环节 | 位置 | 说明 |
| --- | --- | --- |
| 采集 | `source/js/custom.js` | PV + 页面可见心跳 dwell + 离开 leave，`sendBeacon` / keepalive fetch |
| 上报 | `netlify/functions/collect.mjs` | `POST /api/collect`，过滤后台路径、爬虫、非法 ID |
| 存储 | Netlify Blobs `zui-analytics` | `ev/<北京时间日期>/<eid>` 一条浏览一个 key，`onlyIfNew` 原子幂等写 |
| 停留 | `dwell/<日期>/<eid>` | 同一次浏览覆盖写最新累计秒数 |
| 访客 | `visitors/<日期>/<vidHash>` | 只记首次出现日期，用于新老访客判定 |
| 聚合 | `netlify/functions/stats.mjs` | 服务端按 vid + 30 分钟空闲重建会话，60 秒派生缓存 |
| 共用库 | `netlify/lib/analytics.mjs` | 北京时间、UA / 来源 / UTM 解析、地区清洗、指标口径文本 |
| IP 归属 | `netlify/lib/geoip.mjs` + `netlify/data/ip2region_v4.xdb` | 离线 IPv4 库，把客户端 IP 解析成「省 市 运营商」，只存标签 |
| 配置 | `source/analytics/config.json` | 部署为 `/analytics/config.json` |

v5.5 的「读整月 NDJSON → 追加一行 → 覆盖写回」已废弃：Blobs 是 last-write-wins，
并发会静默丢事件。旧 `raw/YYYY-MM.ndjson` 仍会被读取并按北京时间重算，历史数据不会消失。
无 Cookie、不记录 IP、不存原始 UA；仓库里看不到访问明细。

### 指标口径

会话 = 同一访客 30 分钟内有动作的一组浏览；跳出率 = 只看 1 个页面就离开的会话占比；
平均停留 = 只平均有心跳数据的会话（公开「停留覆盖率」，不把单页访问按 0 秒计入）；
当前在线 = 最近 5 分钟有浏览或心跳的匿名访客；来源分直接访问 / 搜索引擎 / 社交媒体 /
外部链接 / 站内跳转。接口通过 `meta.definitions` 下发完整口径，页面底部可直接展开查看。

### 在后台配置

「设置 → 访问统计」可改四项：

- **访问采集**：开启 / 暂停。暂停只停止上报，历史数据保留。
- **前台统计天数**：7–90，默认 30。
- **停留心跳间隔（秒）**：15–300，默认 60。越小停留越准，但请求更多。
- **排除路径**：每行一个路径前缀，默认 `/admin`、`/stats`。

**保存后不是立刻生效**：这是仓库静态文件，保存会提交并触发 Netlify 部署（约 1–2 分钟）。
`netlify.toml` 给 `/analytics/config.json` 配了 `max-age=0, must-revalidate`。

### 常见问题

- **显示「尚无采集数据」**：部署刚完成还没有访问，或采集被 DNT / 排除路径挡住。
  健康条会显示覆盖天数、扫描事件数与 warnings，不会伪装成「刚刚更新」。
- **数字偏小 / 健康条显示「数据可能不完整」**：检查 warnings。事件超过 30000 条会标记截断，
  应缩小统计天数；旧格式事件、Blobs 读取失败也会单独列出。
- **改了统计脚本但前台没变**：`source/js/custom.js` 会被合进 `fluid-bundle.js`，
  其 `?v=` 由内容 hash 自动生成；强刷一次或等 `/js/*` 的 1 小时缓存过期。
- **本地 `hexo s` 看不到数据**：本地没有 Netlify Functions，属正常；后台统计页会提示接口不可用。
- **地区只显示国家、没有运营商**：多为 IPv6 访问或 IP 库未加载。健康条会显示
  「IP 归属库：本地库可用 / 降级兜底」；若长期降级，检查
  `netlify.toml` 的 `included_files = ["netlify/data/*.xdb"]` 是否还在。
- **在 Netlify 预览域名访问却没有统计**：属预期，部署预览 / 分支预览、
  Netlify 后台跳转和内部抓取已在采集端被排除，只统计正式域名。
  健康条「机器流量」会显示已过滤的规则数。
