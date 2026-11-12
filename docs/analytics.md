# 站点统计（自托管 · Netlify Functions + GitHub Actions）

> 无服务器方案：采集端点跑在 **Netlify Functions**，事件存 **GitHub 仓库**，
> 聚合由 **GitHub Actions** 定时完成，数据 100% 自持、无 Cookie / 无 IP / 无 UA 存储。
> 旧 Umami VPS 部署包已移除（历史可在 git 记录中找回）。

## 架构

```
访客浏览器 ──beacon──▶ Netlify Function(/.netlify/functions/collect)
                            │  追加 NDJSON（Contents API）
                            ▼
                    GitHub 仓库 analytics/events-YYYY-MM.ndjson
                            │  GitHub Actions 每 6h 聚合
                            ▼
              analytics/stats.json（存档）+ source/analytics/stats.json（部署）
                            │  Netlify 自动构建
                            ▼
              前台 /stats/ 统计看板 + 页脚 PV/UV（zui 数据源）
```

## 启用步骤（一次性，2 分钟）

1. **生成仓库 Token**：GitHub → Settings → Developer settings →
   Fine-grained tokens → 仅授权本仓库、**Contents: Read and write**
2. **添加到 Netlify**：Site configuration → Environment variables →
   添加 `GITHUB_TOKEN` = 上述 Token
3. 推送本仓库（workflow 与 function 已内置），完成

## 工作流

- 访客浏览任意页面 → custom.js 匿名 beacon（vid 为 localStorage 随机 ID）
- Netlify Function 校验来源、追加事件行到当月 NDJSON（并发冲突自动重试）
- Actions 每 6h 聚合：总量 / 每日 PV·UV / 热门页面 / 访问来源
- 有变化才提交 → 自动部署 → `/stats/` 看板与页脚数字更新

## 文件清单

| 文件 | 作用 |
| --- | --- |
| `netlify/functions/collect.mjs` | 采集端点（来源校验 / NDJSON 追加 / 冲突重试） |
| `scripts/aggregate-analytics.mjs` | 聚合脚本（无第三方依赖） |
| `.github/workflows/analytics.yml` | 定时聚合 + 有变化才提交 |
| `source/stats/index.md` | `/stats/` 统计看板页 |
| `source/_data/fluid_config.yml` | `footer.statistics.source: "zui"` 页脚数据源 |

## 注意

- 不存储 IP / User-Agent / Cookie；访客 ID 为浏览器本地随机 UUID
- 原始事件在仓库 `analytics/` 目录（公开仓库可见，无敏感信息）
- Actions 免费额度：每日 ≤4 次构建（仅数据变化时提交），远低于限额
- 统计脚本路径 `/.netlify/functions/*` 不经过 Service Worker，计数不受缓存影响
