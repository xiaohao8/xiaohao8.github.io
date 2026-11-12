---
comments: true
title: 醉里的朋友圈
updated: 2023-05-06 23:06:35
---

<!-- 朋友圈：数据获取方式对齐 https://blog.anheyu.com/fcircle
     目标接口 /api/pro/moments 无 CORS 响应头，浏览器不能直连；
     运行时经 netlify.toml 的同源反代取实时数据，构建期快照 /fcircle/moments.json 兜底。
     旧的 hexo-friendcircle-demo（fetch.js / fcircle.js / akilar-SAO.css）依赖已移除。 -->

<link rel="stylesheet" href="/fcircle/app.css?v=1">

<div id="fcircleApp"></div>

<script defer src="/fcircle/app.js?v=1"></script>
