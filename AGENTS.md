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

## 构建与部署

- 部署路径是 Netlify（https://202271.xyz，`netlify.toml` → `npm run build`）；**不要添加或修改 GitHub Pages 相关 workflow**（用户明确要求，原 jekyll-gh-pages.yml 已删除）。
- Hexo 8.1.2 + fluid 主题已 vendor 进 `themes/fluid`（不再用子模块）。
- `source/admin/` 是纯 ESM 后台 SPA（当前 v4.1.0），**无构建步骤**：hexo-all-minifier 的 uglify 会跳过 ES 模块，原样拷贝即正确，不要引入打包器。
- `image_minifier` 在 `_config.yml` 中保持关闭（沙箱缺 gifsicle 二进制）。
