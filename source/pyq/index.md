---
comments: true
date: ''
layout: ''
title: 醉里的朋友圈
updated: 2023-5-6T23:6:35.96+8:0
---
<!-- fontawesome图标的依赖，主题自带的不用加这行 -->

<link rel="stylesheet" href="https://cdn1.tianli0.top/npm/@fortawesome/fontawesome-free/css/all.min.css">

<!-- 友链朋友圈样式 -->

<link rel="stylesheet" href="https://cdn1.tianli0.top/gh/Rock-Candy-Tea/hexo-friendcircle-demo@main/css/akilar-SAO.css">

<!-- 挂载友链朋友圈的容器 -->

<div id="fcircleContainer"></div>

<!-- 全局引入友链朋友圈配置项 -->

<script>

  // 全局变量声明区域

  var fdata = {

    apiurl: 'https://pyq.202271.xyz/all',

    initnumber: 20, //【可选】页面初始化展示文章数量

    stepnumber: 10,//【可选】每次加载增加的篇数

    error_img: 'https://avatars.githubusercontent.com/u/109055045?s=96&v=4' //【可选】头像加载失败时默认显示的头像

  }

  //存入本地存储

  localStorage.setItem("fdatalist",JSON.stringify(fdata))

</script>

<!-- 全局引入抓取方法 -->

<script defer src="https://cdn1.tianli0.top/gh/Rock-Candy-Tea/hexo-friendcircle-demo@main/js/fetch.js"></script>

<!-- 局部引入页面元素生成方法 -->

<script async src="https://cdn1.tianli0.top/gh/Rock-Candy-Tea/hexo-friendcircle-demo@main/js/fcircle.js" charset="utf-8"></script>    <!-- js -->
