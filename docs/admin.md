# 后台使用与维护

## 入口

- 后台地址：`https://202271.xyz/admin/`
- 登录方式：Netlify Identity 轻量登录页，登录成功后才加载 CMS
- 内容发布：Netlify CMS Editorial Workflow + Git Gateway

后台静态资源全部由本站托管，不依赖 jsDelivr、unpkg 或 Netlify Identity CDN。

后台入口会先加载轻量登录页，只拉取 Netlify Identity 客户端；认证成功后再动态加载 Netlify CMS、工作台和 Git Gateway 数据。这样不会在登录前初始化整站内容，能减少弱网或旧会话导致的卡死、白屏和反复刷新。

后台入口已从独立子域名迁移到主站 `/admin/`。请确认 `202271.xyz` 对应的 Netlify 站点已启用 Identity 与 Git Gateway；如果 Identity 只配置在旧的管理子站上，需要在新站点重新启用并邀请账号。

`admin.202271.xyz` 当前指向 Vercel 上的旧 Qexo 实例，和主站 Netlify CMS 不是同一套后台。发布后请统一使用 `https://202271.xyz/admin/`；如果不再保留旧实例，可删除该 DNS 记录，或在 Cloudflare 把旧子域名 301 到新后台路径。

## 内容模块

| 模块 | 用途 | 数据位置 |
| --- | --- | --- |
| 工作台 | 内容统计、最近文章、快捷入口 | `source/_data/admin_overview.yml` |
| 文章 | Hexo 文章的新建与编辑 | `source/_posts` |
| 页面 | 关于、友链、说说、朋友圈、计划清单 | `source` 下对应 Markdown |
| 说说 | 短内容时间线和配图 | `source/_data/talks.yml` |
| 主题与友链 | 导航、横幅、首页、友链列表 | `source/_data/fluid_config.yml` |
| 站点资料 | 标题、描述、关键词、作者 | `source/_data/site_meta.yml` |

文章集合保留了 `abbrlink` 和 `password` 字段，编辑旧文章时不要清空 `abbrlink`，否则旧永久链接会失效。

## 工作台实现

- `source/admin/assets/custom.js` 注册 `qexo-dashboard` 自定义 widget。
- `scripts/admin-manifest.js` 在构建时生成 `public/admin/manifest.json`。
- 工作台读取该文件展示文章、页面、友链、说说、标签数量以及最近文章。
- `scripts/site-meta.js` 在构建前把站点资料覆盖到 Hexo 配置。
- `scripts/talks.js` 注册 `qexo_talks` 标签，读取 `talks.yml` 生成说说时间线。

## 后台资源与缓存

- `source/admin/vendor/` 存放固定版本的 Netlify CMS 和 Identity Widget。
- `source/admin/assets/` 存放后台样式、启动逻辑和工作台代码。
- `source/admin/assets/admin.js` 负责登录页、会话校验、懒加载 CMS 和错误恢复。
- `source/admin/index.html` 中 CSS/JS 地址带 `?v=` 版本号。
- 修改后台 CSS/JS 后，需要同步修改 `?v=` 版本号，避免浏览器继续使用旧缓存。
- `netlify.toml` 对 `vendor` 使用长期缓存，对 `config.yml` 和 `manifest.json` 禁止缓存。

## 本地检查

```bash
git submodule update --init --recursive
npm install
npm run build
```

后台是纯静态文件，可以直接检查 `public/admin/`。本地没有 Netlify Identity/Git Gateway 时，只能验证启动页和资源加载；完整登录与内容读写需要线上 Netlify 环境。

如果本机安装 `hexo-all-minifier` 的图片压缩二进制失败，可在本地测试配置中关闭 `image_minifier`，不要为此改动线上构建配置。

Netlify 构建使用 Node.js 22，RSS 依赖固定在 `package.json` 的 `hexo-generator-feed@3.0.0`，不再在构建命令中临时安装未锁版本的插件。

## 发布流程

1. 在后台编辑内容并保存。
2. 在“工作流”中检查并发布。
3. Netlify 收到 Git 提交后自动构建。
4. 构建完成后新内容上线。

## 常见故障

### 登录后提示 Git Gateway token 失效

错误示例：

```text
Git Gateway Error: Please ask your site administrator to reissue the Git Gateway token.
```

处理方式：进入 Netlify 站点设置，打开 Identity 服务，在 Git Gateway 中重新签发 token。这个问题不是前端资源导致的，重新部署静态文件也不能代替重签 token。

### 登录按钮点击后没有反应

现在的登录页不再依赖 Netlify Identity 弹窗 iframe，而是直接调用同站 `/.netlify/identity` 接口。若登录失败：

1. 先检查邮箱和密码是否正确。
2. 点击登录页下方的“清除会话并重试”，清除过期或损坏的 Netlify Identity 本地会话。
3. 关闭可能注入 iframe 或翻译页面的浏览器扩展后重试。
4. 确认 Netlify Identity 已启用，且账号已完成邮箱验证。

### 登录页一直转圈或 CMS 闪退

先点击“清除会话并重试”。如果仍出现：

- 在浏览器开发者工具 Network 中检查 `/.netlify/identity/token` 和 `/.netlify/git/github/*` 是否超时或返回 401。
- 确认 `source/admin/assets/admin.js`、`custom.js` 和 `index.html` 的 `?v=` 版本号一致。
- 删除旧的浏览器缓存后重新打开 `https://202271.xyz/admin/`。
- 查看控制台是否有扩展注入脚本导致的异常；可先用无痕窗口验证。

### 国内访问仍然偏慢

本地化后台资源和静态缓存只消除了第三方 CDN 与重复访问的开销，站点主体仍托管在 Netlify，首屏链路依然受跨境网络影响。当前域名使用 Cloudflare DNS；如果记录仍是 DNS only，流量不会经过 Cloudflare 代理和缓存，需要把主站记录切换为 Proxied，并开启 Brotli 与 HTTP/3。对 `/images/*`、`/css/*`、`/js/*` 设置缓存规则，`/admin/*` 必须绕过缓存，避免后台登录和配置读取被缓存。Cloudflare 免费线路在国内仍可能绕行境外节点，如果要求稳定低延迟，需要国内可访问的反向代理或迁移到国内/亚太节点。不要在仓库中写入任何 token、密码或私钥。

## 升级 Netlify CMS

1. 下载对应版本的 Netlify CMS 浏览器 bundle 和 Identity Widget。
2. 替换 `source/admin/vendor/` 中的文件，同时保留 LICENSE。
3. 更新 `source/admin/index.html` 中的文件名和 `?v=` 版本号。
4. 登录后台检查内容集合、工作台、文章编辑器、说说和主题设置。
5. 在 Netlify 部署后检查 `/admin/config.yml`、`/admin/manifest.json` 和静态资源的响应头。
