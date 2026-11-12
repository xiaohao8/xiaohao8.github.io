# 博客接入自托管 Umami 统计

> 前提：已按 `deploy/umami/README.md` 在 VPS 完成 Umami v2.4.1 部署，
> 站点 `https://analytics.202271.xyz` 可访问，并且已创建网站拿到 Website ID 与 Token。

## 接入配置（_config.fluid.yml）

在 `web_analytics` 段填入（部署完成后替换三个值）：

```yaml
web_analytics:
  enable: true
  umami:
    src: "https://analytics.202271.xyz/script.js"
    website_id: "你的 Website ID"
    domains: "202271.xyz"
    api_server: "https://analytics.202271.xyz"
    start_time: "2026-11-12T00:00:00.000Z"   # 统计起始时间
    token: "你的 API Token"
```

页脚访问量统计来源切换（可选，当前为 busuanzi）：

```yaml
footer:
  statistics:
    enable: true
    source: "umami"   # busuanzi | leancloud | umami
```

保存提交后 Netlify 自动构建生效。

## 生效内容

- 全站无痕统计（不使用 Cookie，不依赖第三方境内被墙服务）
- 页脚「访问量 / 访客数」改由自托管 Umami API 提供（`umami-view.js` 原生支持）
- 数据完全自持：VPS 上的 PostgreSQL，随时导出

## 注意

- `domains` 用于过滤无效来源，填主域名即可（不要带协议）
- `token` 是 Umami 登录 JWT（APP_SECRET 签发）；改密码/换 APP_SECRET 后需重新生成
- 统计脚本 `script.js` 与上报接口同域，无跨域 Cookie 问题
- 前台页面有 Service Worker 缓存：页面缓存命中时 Umami 脚本走网络
  （SW 仅对同源静态资源缓存优先，跟踪脚本路径不在缓存策略内），统计不受影响
