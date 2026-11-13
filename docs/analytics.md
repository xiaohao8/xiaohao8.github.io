# 站点统计 v6（自托管 · Netlify Functions + Blobs）

> 无第三方统计、无 Cookie 追踪、不记录 IP、不存原始 UA。
> 事件由 `POST /api/collect` 写入 **Netlify Blobs**，`GET /api/stats` 实时聚合。
> 全部时间按 **Asia/Shanghai (UTC+8)** 切分，不依赖服务器时区。

## 为什么重构（v5.5 的可信度问题）

| 问题 | 后果 | v6 做法 |
| --- | --- | --- |
| 采集端「读整月 NDJSON → 拼一行 → 覆盖写回」 | Netlify Blobs 是 last-write-wins，并发会**静默丢事件**；数据变大后整批超时 | 每条浏览事件一个独立 blob key，`onlyIfNew` 原子写，append-only 幂等 |
| `updated` 用请求时刻 | 空数据也显示「刚刚更新」，无法判断数据新旧 | 分开给 `lastEventAt`（最后一条事件）/ `computedAt`（本次聚合）/ `requestAt` / `cache.hit` |
| 日期与小时用 UTC | 中国访客看到的日期、时段整体差 8 小时 | 统一北京时间，旧 UTC 事件在聚合时重算 |
| 会话直接用前端 `sessionStorage` | 开新标签页就算新会话，会话数/跳出率虚高 | 服务端按 `vid` + 30 分钟空闲重建 |
| 平均停留用会话首末事件差 | 单页会话算 0 秒，均值被拉成 `0:02` | 页面可见心跳累计停留，只平均「有停留数据」的会话，并公开覆盖率 |
| `online/<分钟>` 所有访客写同一 key | 同分钟互相覆盖，且聚合端根本不读 | 由 `ev/` 与 `dwell/` 的最近活动推导 5 分钟在线 |
| 旧 `analytics.yml` 每 6h 空转 | 生成全 0 静态快照、推只改时间戳的空提交、制造推送冲突 | 已删除；数据链路不再经过仓库 |

## 架构

```
浏览器 custom.js
  ├─ pv    页面浏览（每页一次，eid 幂等）
  ├─ dwell 可见心跳（默认 60s，累计停留秒数）
  └─ leave 离开 / pagehide（sendBeacon 兜底）
        │
        ▼  POST /api/collect
   Netlify Function：来源校验 · 爬虫过滤 · UA/来源/UTM 解析
                    · context.ip → 本地 ip2region 库（省 市 运营商）
        │
        ├─ ev/<北京时间日期>/<eid>        ← onlyIfNew，一条浏览一个 key
        ├─ dwell/<日期>/<eid>             ← 覆盖写，取最新累计停留
        └─ visitors/<日期>/<vidHash>      ← onlyIfNew，首次出现日期
        │
        ▼  GET /api/stats?days=30
   Netlify Function：list(ev/) + 并发 get + 兼容旧 raw/*.ndjson
        → 会话重建 → 指标聚合 → 60 秒结果缓存
        │
        ▼
   前台 /stats/ 看板 + 后台「访问统计」页
```

## 存储键

| 键 | 内容 | 写入方式 |
| --- | --- | --- |
| `ev/YYYY-MM-DD/<eid>` | 完整浏览事件（路径/标题/来源/UTM/UA 解析/`geo.display`/屏幕/语言/北京时间） | `setJSON(..., { onlyIfNew: true })` |
| `dwell/YYYY-MM-DD/<eid>` | `{ d: 累计停留秒, t, final }` | `setJSON` 覆盖（同一次浏览取最新值） |
| `visitors/YYYY-MM-DD/<vidHash>` | 访客首次出现日期（日期编码在 key 里） | `setJSON(..., { onlyIfNew: true })` |
| `raw/YYYY-MM.ndjson` | **只读兼容**：v5.5 旧格式事件 | 聚合时读取并重算为北京时间 |
| `cache/stats-<days>.json` | 派生聚合结果，60 秒 TTL | 覆盖写（可重算，无竞态风险） |

`ev/` 是唯一数据源，任何并发写入都不会覆盖别人的事件。`cache/` 丢失只影响速度，不影响数据。

## 指标口径

对齐 51.la / Umami / Plausible 的通行定义，并由接口 `meta.definitions` 原样下发给 UI：

- **PV**：一次有效页面浏览；同一 `eid` 重复上报会去重。
- **UV / 日均 UV**：区间内唯一匿名访客（浏览器本地标识）；另给日均，对齐 51.la 的单日 UV 口径。
- **会话**：同一访客相邻浏览间隔 > 30 分钟即切分，服务端重建。
- **跳出率**：只浏览 1 页的会话 ÷ 总会话。
- **平均停留**：只累计有心跳数据的会话，公开 `dwellCoverage`；旧数据没有心跳，覆盖率偏低属正常。
- **当前在线**：最近 5 分钟内有浏览或心跳的唯一访客。
- **新老访客**：按 `visitors/` 里编码的首次出现日期判断，清除浏览器缓存会重新计数。

另有环比（与上一等长周期对比）、入口页 / 退出页、访问深度、来源分类（搜索 / 社交 / 外链 / 直接 / 站内）、搜索关键词、UTM、浏览器 / 系统 / 设备 / 分辨率 / 语言 / 地区、实时访客列表。

## 访客地区（v6.1）

Netlify 边缘 `context.geo` 对国内 IP 常常只给到 `China`，也没有运营商。现在改为：

- `collect.mjs` 从 `context.ip`（Netlify 提供、不可被请求头伪造）取客户端 IP，
  用 `netlify/lib/geoip.mjs` 查**仓库自带的离线 IPv4 库**
  `netlify/data/ip2region_v4.xdb`（ip2region，Apache-2.0 / MIT，
  字段 `国家|省份|城市|ISP|国家码`），零网络请求、零第三方接口。
- `formatGeoParts()` 把 `中国|湖北省|孝感市|联通|CN` 清洗成 `湖北 孝感 联通`：
  去掉省 / 市后缀、自治区简称、直辖市重复、ISP 的「中国」前缀。
  国内省略「中国」，国外保留国家名（如 `United States California Google LLC`）。
- 落库的只有 `geo = { country, province, city, isp, display, source }`；
  **原始 IP 不写入事件、Blobs、日志或响应**。
- 聚合输出三个维度：`regions`（省 市 运营商）、`provinces`（省份）、`isps`（运营商），
  实时访客表也显示完整地区串。
- IPv6、内网 IP、库缺失或查询失败时降级到 `context.geo`，此时有省市但无运营商，
  `geo.source = "netlify-geo"`；健康条的 `geoip.available` 显示库是否随函数部署。

> IPv4 库约 11 MB，靠 `netlify.toml` 的 `included_files = ["netlify/data/*.xdb"]`
> 随函数部署；运行时懒加载单例，冷启动只读一次，之后都是内存二分查找。

## 数据可信度展示

前台与后台顶部都有健康条，分别列出：

- **数据截至** = 最后一条原始采集事件的北京时间（不是页面打开时间）
- **本次计算** = 本次聚合实际执行时间
- **缓存** = 是否命中、缓存年龄；后台可用「强制重算」(`?fresh=1`) 绕过读取。
  强制重算的结果同样回写派生缓存，避免用户刷新后又退回 60 秒内的旧数字
- **数据覆盖** = 有数据的天数 / 请求天数
- **扫描事件数 / 停留覆盖率 / 引擎版本 / 时区**
- **warnings** = 旧格式事件数、读取失败、扫描截断、无数据等，全部显式列出

没有数据时 `lastEventAt = null`、`health.status = "no_data"`，界面显示「尚无采集数据」而不是估算值。
单次扫描上限 30000 条，超出会标记 `truncated` 并提示缩小天数，绝不悄悄给一个偏小的总数。

## 配置

`source/analytics/config.json`（构建为 `/analytics/config.json`，配 `max-age=0, must-revalidate`）：

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `enabled` | `true` | 总开关；`false` 时前台不上报，历史数据保留 |
| `days` | `30` | 7–90，图表横轴与接口查询区间 |
| `heartbeatSeconds` | `60` | 15–300，页面可见时的停留心跳间隔 |
| `excludePaths` | `["/admin","/stats"]` | 路径前缀，命中不上报 |

后台「设置 → 访问统计」可编辑，写入仓库后**需等 Netlify 部署完成**才生效（静态文件，不是运行时开关）。
前端另尊重 `navigator.doNotTrack`，并过滤爬虫 UA。

## 文件清单

| 文件 | 作用 |
| --- | --- |
| `netlify/lib/analytics.mjs` | 共用库：北京时间、UA / 来源 / UTM 解析、地区清洗、指标口径文本 |
| `netlify/lib/geoip.mjs` | 本地 IP 归属解析（`context.ip` → 省 市 运营商，懒加载单例，降级到边缘 geo） |
| `netlify/data/ip2region_v4.xdb` | 离线 IPv4 归属库（约 11 MB，Apache-2.0 / MIT），由 `included_files` 随函数部署 |
| `netlify/functions/collect.mjs` | 采集端点（append-only 写入、幂等去重） |
| `netlify/functions/stats.mjs` | 聚合端点 v6（完整 meta / 健康度 / 60 秒缓存） |
| `source/js/custom.js` | 前台采集器 + `/stats/` 看板 |
| `source/css/custom.css` | 统计看板样式 |
| `source/admin/assets/pages/stats.js` | 后台统计概览与排障 |
| `source/admin/assets/pages/settings.js` | 采集配置卡片 |
| `source/analytics/config.json` | 采集配置（仓库内静态文件） |

## 排障

- **显示「统计接口暂不可用」**：本地 `hexo s` 没有 Functions；或刚部署、Functions 尚未就绪。
- **所有面板为空但状态是「尚无采集数据」**：确实没有事件，属正常；随便浏览几个前台页面再回来。
- **平均停留为 0:00 / 停留覆盖率低**：历史 v5.5 事件没有心跳数据；等新数据积累即可，不会被 0 秒拉低均值。
- **地区只有 "China" 或没有运营商**：通常是 IPv6 访问或 IP 库没加载。看健康条
  「IP 归属库」是否为「本地库可用」以及 `health.geoip.error`；
  升级 xdb 后确认 `included_files` 仍包含 `netlify/data/*.xdb`。
- **数字看起来偏小**：先看健康条的「数据截至」与「数据覆盖」。若 `truncated=true`，缩小统计天数。
- **改了采集脚本但没生效**：`source/js/custom.js` 被合进 `fluid-bundle.js`，其 `?v=` 由内容 hash 自动生成，构建后即换 URL；必要时强刷一次。
- **想绕过缓存**：后台点「强制重算」，或直接请求 `/api/stats?days=30&fresh=1`。
- **改了统计口径怕回归**：跑 `NODE_OPTIONS= node tools/analytics-probe.mjs`。它用内存 mock
  替代 Blobs，离线跑真实的 collect / stats handler，覆盖日期序列、幂等、旧格式兼容、
  会话、来源 / UTM、环比、缓存、非法请求；输出 `FAILURES=0` 才可上线。

## 隐私

不写 Cookie（仅 localStorage 存匿名随机 ID）。
客户端 IP **只在采集函数内**用于查询本地离线归属库，落库的是「省 市 运营商」标签，
原始 IP 不写入事件、Blobs、日志或响应，也不发给任何第三方服务。
不存原始 User-Agent（只存解析后的浏览器 / 系统 / 设备类别）、不采集页面正文与表单内容。
`dwell` 与 `visitors` 里的访客标识均为不可逆短哈希。
