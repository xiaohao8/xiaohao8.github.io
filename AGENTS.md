# 项目约定（所有 agent 必读）

## Git 推送：本环境 `git push` 不可用，必须走 API 重放脚本

本机 `~/.gitconfig` 把 `https://github.com/` 全局重写到 `https://gh-proxy.com/`（只读加速镜像，写入报 "No anonymous write access"），沙箱内 GCM 无法交互取凭证，SSH 也没有密钥。因此 **agent 不要反复尝试 `git push` / 改 remote / 改全局 gitconfig**，正确流程：

1. `git fetch origin`（读操作经 gh-proxy 正常可用）；
2. 确认是快进：`git merge-base --is-ancestor origin/main main`。若非快进，先 `git rebase origin/main`（工作区须干净），**绝不 force push**；
3. `node tools/git-api-push.mjs main --dry-run` 预览，再去掉 `--dry-run` 真实推送。
   脚本通过 GitHub Git Data API 按内容寻址逐个重放 blob/tree/commit（每步比对 SHA，与本地不一致立即中止），最后 `PATCH /git/refs/heads/main`（`force:false`，纯快进），效果与 `git push` 逐字节等价。
   **CLI 工具必须放在 `tools/`，不能放 `scripts/`**：Hexo 会把 `scripts/` 下所有 `.js/.mjs` 当 Hexo 脚本用 vm 包装加载，带 shebang / ESM import 的独立 CLI 会报 `SyntaxError: Invalid or unexpected token`，甚至被误执行。
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
- Hexo 8.1.2 + fluid 主题已 vendor 进 `themes/fluid`（不再用子模块）。
- `source/admin/` 是纯 ESM 后台 SPA（当前 v4.1.4），**无构建步骤**：hexo-all-minifier 的 uglify 会跳过 ES 模块，原样拷贝即正确，不要引入打包器。
  动态路由 import 由 `app.js` 的 `VERSION` 带 `?v=`；**所有**模块间的静态 import 也都带同一个硬编码版本号
  （`/admin/assets/*` 是 `max-age=600 + SWR`，不带版本会拿到旧模块；带与不带版本又会加载两份实例、
  让 `setMediaConfig` 只改到其中一份）。升级 `VERSION` 时必须把 `source/admin/` 下全部 `?v=` 引用
  与 `index.html` 一起同步（当前约 37 处），漏一处就会混版白屏。
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
  当前 167 篇 / 41 友链，数据停在 2024-06-27（后端最后更新时间）。
- 页面运行时**零外部请求**：`source/fcircle/app.js` 只 `fetch("/fcircle/moments.json")`，
  排序（created / updated）、分页（每页 24）、随机钓鱼全在本地完成。
  `netlify.toml` 不给 `/fcircle/` 配任何 proxy；`/fcircle/moments.json` 保持
  `max-age=0, must-revalidate`。
- `github.com/xiaohao8/pyq` 后端仓库已删除（GitHub API 404），`/all` 端点虽仍
  返回旧数据但随时会断，**不要再作为数据源**。
- 刷新工具 `tools/fcircle-refresh.mjs`：从 `source/_data/fluid_config.yml` 的
  39 条友链抓 Atom/RSS，按文章链接与现有本地数据去重、增量合并
  （抓不到的站点不影响已有条目）。默认 dry-run 不写文件，`--write` 才落盘；
  支持 `--limit` / `--per-link` / `--timeout` / `--concurrency` / `--max-total`。
  **工具必须放 `tools/`，别放 `scripts/`**（Hexo 会当脚本误加载）。
- **完全自动化（勿回退到手动流程）**，两个触发点：
  1. `netlify.toml` 的 build command 在 `npm run build` **之前**自动跑 `--write`：
     后台改友链 → 写 `fluid_config.yml` → 触发部署 → 自动抓新友链，全程零人工。
     命令用 `;` 而不是 `&&`：抓取失败/超时也必须继续构建，页面回退到入库基线。
  2. WorkBuddy 每周一 09:00 的定时自动化「每周自动刷新朋友圈数据」
     （id `cc58c35c-367a-4a75-9d69-230d5a20dcf0`）跑 `--write` → 校验 →
     提交 → `git-api-push` 快进推送，把累积结果与 feed 缓存回写仓库；
     没有 push 时数据也会更新。
  本地 `npm run build` 仍是纯 `hexo generate`，不受影响。
- 稳定性保护（勿删）：`tools/fcircle-feeds.json` 固化已知 feed 地址（当前 14 条），
  命中即直连、不再盲试 4 个候选路径；`--max-total` 给抓取阶段设总时限
  （构建期 45s）；**一个 feed 都没抓到时不覆盖任何文件**，保留入库基线。
  构建容器里生成的 `moments.json` 不会回仓库，入库数据是安全回退点；
  定时任务会把累积结果逐步写回。
- 也可以完全离线直接编辑 `source/fcircle/moments.json`，
  保持 `{ statistical_data, article_data }` 结构即可。
- 2026-11-12 首次全量 dry-run：39 条友链中 13 个拿到 feed、26 个失败
  （多为站点关停或沙箱网络不可达），去重后 59 篇新文章、合并后 226 篇；
  本次**未写入**，`source/fcircle/moments.json` 仍是 167 篇历史数据。
  feed 可达性会随网络波动（同一站点两次运行结果可能不同），以 `--write` 当次为准。
- `source/fcircle/app.js` 必须是 **ES5 语法**（`js_minifier` 开启且 mangle）。
  资源放 `/fcircle/` 而不是 `/js/`、`/css/`，避开 `optimize-speed.js` 的合包 / CSS 内联正则。
  改 JS/CSS 时同步提升 `source/pyq/index.md` 里的 `?v=`。
- 动态内容一律 `textContent` / `createElement`，URL 只允许 `http(s)://`；
  头像必须带 `onerror` 内联 SVG 兜底。
- 旧的 `hexo-friendcircle-demo`（`fetch.js` / `fcircle.js` / `akilar-SAO.css`）不要恢复。
