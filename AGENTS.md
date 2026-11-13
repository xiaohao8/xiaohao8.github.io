# 项目约定（所有 agent 必读）

## Git 推送：本环境 `git push` 不可用，必须走 API 重放脚本

本机 `~/.gitconfig` 把 `https://github.com/` 全局重写到 `https://gh-proxy.com/`（只读加速镜像，写入报 "No anonymous write access"），沙箱内 GCM 无法交互取凭证，SSH 也没有密钥。因此 **agent 不要反复尝试 `git push` / 改 remote / 改全局 gitconfig**，正确流程：

1. `git fetch origin`（读操作经 gh-proxy 正常可用）；
2. 确认是快进：`git merge-base --is-ancestor origin/main main`。若非快进，先 `git rebase origin/main`（工作区须干净），**绝不 force push**；
3. `node tools/git-api-push.mjs main --dry-run` 预览，再去掉 `--dry-run` 真实推送。
   脚本通过 GitHub Git Data API 按内容寻址逐个重放 blob/tree/commit（每步比对 SHA，与本地不一致立即中止），最后 `PATCH /git/refs/heads/main`（`force:false`，纯快进），效果与 `git push` 逐字节等价。
   **CLI 工具必须放在 `tools/`，不能放 `scripts/`**：Hexo 会把 `scripts/` 下所有 `.js/.mjs` 当 Hexo 脚本用 vm 包装加载，带 shebang / ESM import 的独立 CLI 会报 `SyntaxError: Invalid or unexpected token`，甚至被误执行。
   历史教训：v1 统计聚合脚本曾误放 `scripts/`，导致每次构建输出
   `ERROR Script load failed`。该脚本、空转的 `.github/workflows/analytics.yml`
   与废弃静态快照已在统计 v6 重构中一并删除，别再往 `scripts/` 放独立 CLI。
4. 推送后 `git fetch origin` 同步本地引用；不要 `git reset` / `git stash` 远端协作产物。

备用（用户自己的终端，非沙箱）：`git push https://x-access-token@github.com/xiaohao8/xiaohao8.github.io.git main` —— 带 userinfo 前缀可绕开 insteadOf 重写。

### token 纪律（不可妥协）

- 只从环境变量 `GITHUB_TOKEN`/`GH_TOKEN` 或 `git credential fill` 取用，仅存在于进程内存；
- 绝不打印、绝不写入任何文件（包括 `.git/config`、脚本、提交信息、聊天回复）；
- 未经用户明确同意不修改 `~/.gitconfig` 和凭据管理器。

## 提交前必须验证

用户要求：本地检查与功能测试全部通过后才提交（"检查无误后，测试功能全OK后直接提交"）。最低标准：

- `npx hexo generate` 成功、无新增报错；
- 后台改动：全部 ESM 文件 `node --check` 通过，并用浏览器（browser-use MCP，`chrome_devtools` 在本机无 Chrome 不可用）以 demo 模式逐页验证、控制台零报错；
- 提交信息用中文 conventional 风格。

## abbrlink 副产物：默认不提交

`hexo generate` 时 hexo-abbrlink 会回写 `source/_posts/*.md` 的 front-matter（补 abbrlink、YAML 缩进、日期重引号、键序变化），产生约 52 个文件的噪音 diff。这类回写**默认 `git restore source/_posts` 丢弃**（用户 2026-11 已确认），除非用户明确要求入库。

### 永久链接锁定（勿删）

- `source/_data/abbrlinks.yml` 按文件名锁定每篇文章的 abbrlink；`scripts/abbrlink-lock.js` 在 hexo-abbrlink（priority 15）之前以 priority 9 写入，保证任何一次构建（本地 / Netlify）生成的 URL 都一致。
- 新增文章后必须在锁定表追加一行 `"文件名.md": 编号`，否则仍由插件生成、可能随构建漂移；构建结束会输出 `[abbrlink-lock] ... 未锁定` 警告。
- 重命名文章文件时同步修改 key，否则会被视为新文章。
- 锁定值以 2026-11-10 线上实际地址为准（52 篇与 sitemap 完全一致）；不要为了「整齐」重排或重新生成编号，否则旧链接会 404。

## 构建与部署

- 部署路径是 Netlify（https://202271.xyz，`netlify.toml` → `npm run build`）；**不要添加或修改 GitHub Pages 相关 workflow**（用户明确要求，原 jekyll-gh-pages.yml 已删除）。
  注意区分：用户 2026-11-12 已明确授权用 **GitHub Actions** 做数据刷新
  （`.github/workflows/fcircle-refresh.yml`），这与 GitHub Pages 是两回事；
  只是别再建任何 Pages 部署 workflow。
- Hexo 8.1.2 + fluid 主题已 vendor 进 `themes/fluid`（不再用子模块）。
- `source/admin/` 是纯 ESM 后台 SPA（当前 v4.4.3），**无构建步骤**：hexo-all-minifier 的 uglify 会跳过 ES 模块，原样拷贝即正确，不要引入打包器。
  动态路由 import 由 `app.js` 的 `VERSION` 带 `?v=`；**所有**模块间的静态 import 也都带同一个硬编码版本号
  （`/admin/assets/*` 是 `max-age=600 + SWR`，不带版本会拿到旧模块；带与不带版本又会加载两份实例、
  让 `setMediaConfig` 只改到其中一份）。升级 `VERSION` 时必须把 `source/admin/` 下全部 `?v=` 引用
  与 `index.html` 一起同步（当前约 37 处），漏一处就会混版白屏。
- **编辑器资源加载（v4.1.9，勿回退成「静默空白」）**：`pages/editor.js` 与 `pages/talks.js`
  依赖 Vditor，而 Vditor 的正文 DOM 是**异步渲染**的——`new Vditor()` 本身不报错，
  要等 `dist/js/lute/lute.min.js`（≈3.8MB）等子资源就绪才建 UI；子资源被拦截或超时，
  容器就一直是空的，且不抛任何异常（曾表现为「编辑文章页面空白，右侧属性面板正常」）。约定：
  - **资源源**：Vditor 的 `cdn` 走 `editor-shared.js` 的 `SOURCES`——优先
    `https://registry.npmmirror.com/vditor/<ver>/files`，失败回退本站
    `/admin/vendor/vditor`，成功哪个就把 base 记到 `localStorage`。
    实测 Netlify→国内只有 3~8 KB/s，lute 压缩后 700KB 要 200 秒以上，本站单源根本跑不动；
    npmmirror 同版本同文件 0.6 秒。`VDITOR_VERSION` 必须与 vendor 里的版本一致。
  - Gitee raw 返回 `Content-Type: text/plain`，浏览器会拒绝执行 `<script>`
    （图片能跟随 302，脚本不行），**不要**拿 Gitee 当脚本源。
  - `editor-shared.js` 必须显式预加载 lute **和** `icons/ant.js`，沿用 Vditor 内部的
    `id="vditorLuteScript"` / `id="vditorIconScript"`：Vditor 的 `addScript` 按 id 去重，
    而它的图标加载还有一条「同步 XHR 取源码内联执行」的路径，跨域镜像没有 CORS 会失败，
    先占住 id 就能绕开。加载失败要抛出可读错误。
  - `editor.js` 必须「先可写、后升级」：一进页面先渲染 `<textarea>`（立刻能写），
    引擎在后台加载，成功后再无缝换成 Vditor（保留已输入内容）；`talks.js` 至少要保留
    15 秒 watchdog 降级。降级后仍可正常保存；加载失败不要永久缓存 promise，
    否则一次抖动会让编辑器直到刷新都打不开。
- `image_minifier` 在 `_config.yml` 中保持关闭（沙箱缺 gifsicle 二进制）。
- **前台脚本合包（`scripts/optimize-speed.js`，勿回退）**：主题自带 JS 在
  `themes/fluid/source/js/`，**不在**项目 `source/`；读取资源必须支持主题目录回退。
  曾因只读 `source/`，`/js/fluid-bundle.js` 里只剩 `custom.js` 一个脚本，
  但 6 个 `<script>` 标签照样被删，`img-lazyload.js` 不执行，首页图片永远停在
  `/img/loading.gif` 转圈。替换标签前必须校验每个脚本都读到了源码，
  读不到就整段保留原标签（宁可多几个请求，也不能让 JS 静默消失）。
  bundle URL 必须带内容 hash 版本参数（`?v=`），且 `custom_head` 的 preload 与
  script 用同一个值；否则修完 bundle 后浏览器仍拿 `/js/*`（`max-age=3600`）里
  缓存的旧文件，看起来就像「没修好」。

## 前台首屏体积约定（勿回退到全量内联）

- **跨境带宽才是本站最大瓶颈**：实测 Netlify 到国内只有 2–8 KB/s。旧版把
  `main.css` + `fonts.css` + `custom.css` 共 83 KB **未压缩源码逐页内联**，
  首页还把 banner 内联成 74 KB base64，HTML 高达 197 KB，且每翻一页都要重新下载。
  按 2 KB/s 计算光 HTML 就要 90 秒——这就是「加载巨慢」的根因。
- `scripts/optimize-speed.js` 现在只给这三个 CSS 的 `<link>` 加内容 hash `?v=`，
  **不再内联**；外链吃到 Hexo 压缩后的体积（29K/44K），并可跨页复用缓存。
  `netlify.toml` 对这三个 CSS 与 `fluid-bundle.js` 设 `max-age=31536000, immutable`
  （URL 随内容变化，不会被锁死），其余 `/css/*` `/js/*` 仍是 1 小时。
- **CSS 版本号必须缓存「Promise」而不是结果对象**：`after_render:html` 并发渲染
  多个页面，若在 `await` 前先赋一个空对象，其它页面会拿到空对象全部退化成 `v=1`。
- banner 不再内联 base64，改为原图 URL + `<link rel="preload" as="image">`，
  图片走 `/images/*` 的 7 天缓存。
- `_config.fluid.yml` 的 Speculation Rules 保持 `eagerness: conservative`；
  `moderate` 会在慢网下预取一堆文档抢当前页面的带宽。
- 改动后首页约 40 KB、统计页约 30 KB；若某天 HTML 又回到 100 KB 以上，
  先查是不是有人把 CSS / 图片重新内联了。

## 后台性能约定（勿回退）

- `/admin/assets/*` 必须是 `max-age=600, stale-while-revalidate=86400`；**不要改回 `max-age=0`**——
  后台每个页面有 8–12 个 ESM 模块请求，改回后每次切页都要为每个模块发一次条件请求（实测 0.4–1.3s/次），
  用户会明显感到「读取很久」。入口 `/admin/` 保持 `max-age=0`，入口脚本带 `?v=VERSION`。
- `GitHubAPI.req` 的 GET 结果在实例内缓存 30 秒（切页复用 talks.yml / fluid_config.yml / site_meta.yml）；
  写操作自动清空缓存，**新增任何「写前重读」必须显式传 `readFile(path, { fresh: true })`**，
  否则会读到展示缓存、覆盖仓库最新改动（v4.1.0 修过的高危 bug）。
- 文章列表缓存放 `localStorage`（`qexo4_cache_posts`，TTL 5 分钟，跨标签页复用），
  由 `invalidatePostsCache()` 在新增/编辑/删除后清除；不要换回 `sessionStorage`（新标签页会重复拉 52 篇文章）。
- **构建期文章索引（勿回退）**：`scripts/posts-index.js` 在构建时生成 `/admin/posts-index.json`
  （52 条含锁定 abbrlink），后台文章列表/工作台从逐篇 52 次 GitHub API 降为 1 个静态请求。
  该脚本**必须入库**：只在本地存在时 Netlify 不会生成索引、线上 404，后台会静默回退到慢路径。
  `posts.js` 的 `fetch` 必须用站点根绝对路径 `/admin/posts-index.json`——后台是 hash 路由
  （`/admin/#/posts`），相对路径会被解析成 `/admin/admin/posts-index.json`。
  索引是构建产物，编辑/删除后用 `qexo4_post_overrides` 本地覆盖保持即时真实，
  「强制刷新」按钮可绕过缓存与索引从 GitHub 全量拉取；`/admin/posts-index.json` 在
  `netlify.toml` 保持 `max-age=0, must-revalidate`。
  索引的 `date/updated` 必须回传 front-matter 原始字符串（仅去引号），不能做 Date→字符串转换：
  文章日期混杂无时区写法（`2025-01-26 16:41:30`）与带偏移写法
  （`'2023-10-16T22:45:27+08:00'`），`toISOString()` 或按本地字段格式化都会让
  Netlify(UTC) 与本地(CST) 的索引差 8 小时，后台再按本地时间显示就成了次日。
  索引顺序按文件名稳定排序即可，后台 `finish()` 会按 `dateValue` 重排。
- **GitHub API raw / json 响应隔离（勿回退）**：`GET /contents/{path}` 会先以 `Accept: raw+json`
  读文件原文、再以 `+json` 读含 sha 的元数据，两个请求 URL 相同。GitHub 虽有 `Vary: Accept`，
  浏览器缓存 / 国内代理未必遵守，曾导致写操作把 YAML 原文交给 `JSON.parse`，报
  `Unexpected token ... is not valid JSON`（v4.1.1 删除友链失败）。`req()` 必须保持
  raw 请求追加 `&raw=1`、所有请求 `cache: "no-store"`，并用 `res.text()` + `JSON.parse`
  容错给出可读错误；不要把 `await res.json()` 直接写回去。

## 朋友圈 /pyq/ 数据源（必须本地化，勿接第三方接口）

- 用户明确要求：**数据必须是本站自己的友情链接，且本地化**。
  `blog.anheyu.com/fcircle` 的 `/api/pro/moments` 是别人站点的聚合接口
  （文章不是本站友链的、且无 CORS 响应头），2026-11-12 已全部移除；
  不要恢复 `/fcircle/api/*` 反代或 `scripts/fcircle-snapshot.js` 这类外部抓取脚本。
- 唯一数据源：`source/fcircle/moments.json`（**入库**，Hexo 原样复制成
  `/fcircle/moments.json`）。格式沿用本站 `hexo-circle-of-friends` 后端 `/all` 的原始结构：
  `{statistical_data:{friends_num,active_num,error_num,article_num,last_updated_time},
  article_data:[{floor,title,link,author,avatar,created,updated}]}`。
  入库基线 167 篇（停在旧后端最后更新 2024-06-27）；云端任务抓取后会累积增长，
  线上已到 226 篇 / 39 友链 / 13 活跃。
- 页面运行时**只读本站**：`source/fcircle/app.js` 只 `fetch("/fcircle/moments.json")`，
  排序（created / updated）、分页（每页 24）、随机钓鱼全在本地完成。
  `netlify.toml` 不给 `/fcircle/` 配任何 proxy；`/fcircle/moments.json` 保持
  `max-age=0, must-revalidate`。
- `github.com/xiaohao8/pyq` 后端仓库已删除（GitHub API 404），`/all` 端点虽仍
  返回旧数据但随时会断，**不要再作为数据源**。
- 刷新脚本 `.github/scripts/fcircle-refresh.mjs`：从 `source/_data/fluid_config.yml`
  的 39 条友链抓 Atom/RSS，按文章链接与现有数据去重、增量合并。
  默认 dry-run，`--write` 才落盘；支持 `--per-link` / `--timeout` /
  `--concurrency` / `--max-total` / `--limit`。
  **只由 GitHub Actions 调用**：用户明确要求删掉本机刷新，
  本机与 Netlify 构建期都不跑它，也不要放回 `tools/`。
- **自动化全在云端（勿回退到本机定时任务或构建期抓取）**，只有一条通道：
  `.github/workflows/fcircle-refresh.yml`，`cron: "*/5 * * * *"`（**5 分钟，Actions 硬下限**）
  + `workflow_dispatch`；检出仓库 → 装 `js-yaml` → 读 `source/_data/fcircle.yml`
  → 跑脚本 `--write` → 有变化才 commit + push → 触发 Netlify 部署。
  `permissions: contents: write` 用 Actions 自带 `GITHUB_TOKEN`。
  `netlify.toml` 的 command 保持纯 `npm run build`（构建期不抓取）；
  workflow 没有 `push` 触发，不会自循环；已删除 WorkBuddy 每周自动刷新任务。
- **v4.4.3 的 Netlify 每分钟方案已按用户要求整体删除，不要再加回来**：
  `fcircle-tick` / `/api/fcircle` / `netlify/lib/fcircle.mjs` / `scripts/fcircle-links.js`
  全部移除。理由：1440 次/天的函数调用与运行时，换来的还是「几分钟后才看得到」
  的同一份数据；而本站是 public repo，Actions 分钟数不计费，5 分钟一轮成本近乎为零。
  用户的原话是「netlify那个浪费资源，直接用稳定的github action」。
- `cancel-in-progress` 必须是 `false`：5 分钟一轮，若某轮稍慢，新一轮会把正在提交的
  那轮掐掉，结果就是「永远跑不完、数据永不更新」。推送前必须
  `git fetch` + `git rebase origin/$GITHUB_REF_NAME`，5 分钟一轮后 non-fast-forward
  的概率显著上升，rebase 冲突就 `--abort` 并 exit 0（下一轮重抓，不丢数据）。
- 后台「设置 → 朋友圈自动更新」（v4.1.9）可编辑 `source/_data/fcircle.yml`
  的 `enabled`（总开关，只管定时任务；手动触发不受影响）与 `per_link`（1–20），
  显示当前数据状态，提供「立即刷新」（`POST /actions/workflows/.../dispatches`，
  需 Token 具备 Actions 写入权限）与操作说明。
- 稳定性保护（勿删）：`.github/scripts/fcircle-feeds.json` 固化已知 feed
  地址（当前 14 条），命中即直连、不再盲试 4 个候选路径；`--max-total`
  给抓取设总时限；**一个 feed 都没抓到时不覆盖任何文件**，保留入库基线；
  **抓到 feed 但没有新文章时同样不覆盖数据文件**，避免每周产生只改
  `last_updated_time` 的空提交。Actions 只在有新文章或新 feed 地址时才提交，
  入库基线逐步增长。
- 也可以完全离线直接编辑 `source/fcircle/moments.json`，
  保持 `{ statistical_data, article_data }` 结构即可。

## 访问统计 v6（勿回退到 v5.5 的写覆盖与假更新时间）

完整架构、存储键、指标口径与排障见 `docs/analytics.md`。这里只列不可违背的约定：

- **唯一数据源**是 Netlify Blobs 的 `ev/<北京时间日期>/<eid>`，每条浏览事件一个独立 key，
  用 `setJSON(..., { onlyIfNew: true })` 原子写。**绝对不要改回**「读整月 NDJSON → 追加一行
  → 覆盖写回」：Blobs 是 last-write-wins，并发会静默丢事件，数据量变大还会整批超时。
  `dwell/<日期>/<eid>` 是覆盖写（同一次浏览取最新停留值），`visitors/<日期>/<vidHash>`
  用 `onlyIfNew` 记录首次出现日期；`cache/stats-<days>.json` 是可重算的派生缓存。
- `netlify/functions/stats.mjs` 必须兼容读取旧 `raw/YYYY-MM.ndjson`（v5.5 数据），
  并把旧 UTC 日期/小时重算为北京时间，否则上线后历史数据会「消失」。
- **时间统一 Asia/Shanghai (UTC+8)**，用 `netlify/lib/analytics.mjs` 的 `zoned()` / `dateKeys()`，
  不要再用 `toISOString().slice(0,10)` 或 `getUTCHours()` 当展示口径。
- `dateKeys(days, now)` 必须返回**过去 days 天（含今天）的升序数组**，实现是
  `anchor - i * 86400000`。曾误写成 `+`，生成的是未来 29 天：图表日期跑到下个月、
  环比对比区间全空、新老访客全判成老访客、旧格式事件被日期过滤掉。
  改统计口径后必须跑 `NODE_OPTIONS= node tools/analytics-probe.mjs`（离线 mock Blobs 的
  端到端回归探针），至少断言 `daily[last].date === 今天`、`range.from < range.to`；有 FAIL 不要上线。
- **更新时间不能造假**：`meta.lastEventAt`（最后一条原始事件）、`meta.computedAt`（本次聚合）、
  `meta.requestAt`、`meta.cache.hit/ageSeconds` 必须分开返回；空数据时 `lastEventAt = null`、
  `health.status = "no_data"`，不能拿当前时间冒充「统计更新于」。
- **会话在服务端重建**：按 `vid` 分组 + 30 分钟空闲切分，不要信任前端 `sessionStorage` 的 `s`。
  平均停留只累计有 `dwell` 数据的会话，并公开 `dwellCoverage`；不要把单页会话按 0 秒平均。
- 聚合结果必须自带 `meta.definitions`（指标口径文本）与 `health`（覆盖天数、扫描事件数、
  旧格式事件数、截断、warnings），UI 直接展示，不让用户猜数据是否完整。
  单次扫描上限 `MAX_EVENTS = 30000`，超出要标记 `truncated`，不能悄悄给偏小的总数。
- `source/js/custom.js` 的采集器必须发 `pv` + 可见心跳 `dwell` + `leave`（sendBeacon），
  pv 带前端生成的 `eid` 并与 dwell 共用；`eid` 同时是服务端幂等去重的依据。
  该文件走 `js_minifier` + mangle，**必须保持 ES5 语法**。
- `source/js/custom.js` 会被 `scripts/optimize-speed.js` 合进 `fluid-bundle.js`；
  bundle 的 `?v=` 由内容 hash 自动生成，改完不需要手动清缓存。
- 明细面板用 `source/css/custom.css` 自带的 `.zui-stat-panels` / `.zui-stat-panel` 等类，
  **不要借用后台的 `.grid-2` / `.card`**（前台 CSS 里没有）。
- 采集配置是**仓库静态文件** `source/analytics/config.json` → `/analytics/config.json`：
  `enabled` / `days`(7–90) / `heartbeatSeconds`(15–300) / `excludePaths`。
  `netlify.toml` 用 `max-age=60, stale-while-revalidate=86400`（这份文件只有几百字节，
  却每个页面都要读，强制回源白搭一个跨境 RTT）；后台改配置仍需等 Netlify 部署才生效。
- 后台 `pages/stats.js` 与前台 `/stats/` 读同一个接口；后台额外提供「强制重算」(`?fresh=1`)
  绕过 60 秒缓存。改后台页面记得同步 `app.js` 的 `NAV` / `ROUTES` / `ROUTE_TITLES` 与版本号。
- **访客地区**：`netlify/lib/geoip.mjs` 用 `context.ip` 查仓库内
  `netlify/data/ip2region_v4.xdb`（ip2region IPv4 离线库，Apache-2.0 / MIT，字段
  `国家|省份|城市|ISP`），清洗成「省 市 运营商」（如 `湖北 孝感 联通`）写进 `event.geo`。
  **绝不把原始 IP 写进事件 / Blobs / 日志 / 响应**；IPv6、库缺失、查询失败时降级到
  Netlify `context.geo`（有省市、无运营商）并在 `geo.source` 标注。
  `netlify.toml` 必须用**函数级** `[functions.collect] included_files = ["netlify/data/*.xdb"]`，
  不要放回全局 `[functions]`：11 MB 库只属于采集函数，放全局会让 `/api/stats` 也背着它冷启动。
  相应地 `stats.mjs` **绝不 import** `../lib/geoip.mjs`；`health.geoip` 改为按本次扫描事件的
  `geo.source` 如实统计 `ip2regionEvents` / `fallbackEvents`，前后台健康条显示这两个数。
  自定义 `database` 与 `families` 互斥，构造 `IP2Region` 时不要同时传。
- **聚合接口性能（勿回退）**：`stats.mjs` 里 `loadEvents` 与 `loadFirstSeen` 无依赖必须
  `Promise.all` 并行，旧格式月份存档也并行读；`loadDwell` 先 `list({ prefix: "dwell/" })`
  拿到真正有心跳的 eid，**不要为每条事件盲发一次 get**（旧版绝大多数是 404）。
  `tools/analytics-probe.mjs` 有对应断言，改聚合前先跑一遍。
- **统计页不能无限转圈**：前台 `/stats/` 与后台 `pages/stats.js` 必须先渲染骨架、
  请求带 12 秒超时（AbortController + 超时 Promise）、失败给出重试按钮；
  统计请求**不要串行等** `/analytics/config.json`，两者并行，默认 30 天。
- **Netlify 机器流量过滤**：`netlify/lib/machine-filter.mjs` 按「来源域名 + UA」拦截
  `*.netlify.app` / `netlify.com` 的部署预览与后台跳转，以及 Netlify 构建服务、
  健康检查、监控、无头浏览器、脚本客户端。`collect.mjs` 必须在**写 Blobs 之前**、
  对 **pv / dwell / leave 所有事件类型**调用，命中静默返回 204。
  规则只按域名与明确机器 UA 判断，**不要按 IP 段 / 云厂商 ISP 猜**（会误杀代理访客）。
  过滤只影响新采集，历史数据不回改；`health.machineFilter` 下发规则清单供排障。
  `tools/analytics-probe.mjs` 必须同时断言「拦截生效」与「正常访客不被误杀」。
- 已删除：空转的 `.github/workflows/analytics.yml`（每 6h 推只改时间戳的空提交、
  制造推送冲突）、`tools/aggregate-analytics.mjs`、`netlify/functions/archive.mjs`、
  `analytics/stats.json`、`source/analytics/stats.json`。**不要恢复**。

## 朋友圈补充约定

- 抓取率参考：39 条友链中约 13 个能拿到 feed、26 个失败（站点关停或网络不可达）；
  去重后可新增约 59 篇。可达性随网络波动，以当次运行为准。
- `source/fcircle/app.js` 必须是 **ES5 语法**（`js_minifier` 开启且 mangle）。
  资源放 `/fcircle/` 而不是 `/js/`、`/css/`，避开 `optimize-speed.js` 的合包 / CSS 内联正则。
  改 JS/CSS 时同步提升 `source/pyq/index.md` 里的 `?v=`。
- 动态内容一律 `textContent` / `createElement`，URL 只允许 `http(s)://`；
  头像必须带 `onerror` 内联 SVG 兜底。
- 旧的 `hexo-friendcircle-demo`（`fetch.js` / `fcircle.js` / `akilar-SAO.css`）不要恢复。

## 朋友圈采集 v4.4.4（5 分钟 GitHub Actions，勿再搬回 Netlify）

- 一条链路，没有第二层：`cron "*/5 * * * *"` → 脚本抓 RSS → 有新文章才提交
  `source/fcircle/moments.json` → 推送触发 Netlify 部署 → 页面读静态 JSON。
- **5 分钟是硬下限**：Actions 定时任务不支持更短，写成 `* * * * *` 也按 5 分钟跑，
  而且高峰会延迟 5–15 分钟。别在文档/后台里承诺「每分钟」。
- **为什么删掉 Netlify 定时函数**（用户明确要求）：它确实能做到每分钟，但等于
  1440 次/天调用、每次几秒运行时，只为了把「几分钟后可见」变成「一分钟后可见」；
  本站是 public repo，Actions 分钟数不计费，5 分钟 cadence 的边际成本近乎为零。
- 空提交保护没变：`--write` 但没抓到新文章时不覆盖文件，所以 `git diff --quiet`
  真的成立，不会每 5 分钟制造一个只改时间戳的提交。
- 抓取失败不影响已有数据：一个 feed 都没抓到时脚本直接 return，文件保持原样。
- 已知抓取率：39 条友链里约 13 个能拿到 feed，其余关站或被墙；可达性随网络波动。
- 不要再用 `last_updated_time` 判断任务是否执行——它只在有新文章时变。
  判断「跑没跑」看 GitHub Actions 的运行记录（后台设置页已内嵌最近 3 次）。
