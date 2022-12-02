---
title: Fluid主题修改字体
date: 2022-12-02 16:23:36
updated: 2022-12-02 16:23:36
comments: true
---
1﻿.<https://hexo.fluid-dev.com/docs/advance/#hexo-注入代码>

1. 打开﻿下载字体的网站google-webfonts-helper[](https://google-webfonts-helper.herokuapp.com/)<https://gwfh.mranftl.com/fonts>搜索思源宋体—Noto Serif SC，然后去掉latin,选择简体中文。
2. 在﻿下方点击下载，然后传到github仓库source目录中的fonts目录。如图

   ![](/images/uploads/screenshot_20221202-163210.png)

   ![](/images/uploads/screenshot_20221202-163310.png)
3. 在﻿source目录创建css目录，如上图，然后再创建custom.css写入

   ```
   /* noto-serif-sc-regular - chinese-simplified */

   @font-face {

     font-family: 'Noto Serif SC';

     font-style: normal;

     font-weight: 400;

     src: local(''),

          url('../fonts/noto-serif-sc-v22-chinese-simplified-regular.woff2') format('woff2'), /* Chrome 26+, Opera 23+, Firefox 39+ */

          url('../fonts/noto-serif-sc-v22-chinese-simplified-regular.woff') format('woff'); /* Chrome 6+, Firefox 3.6+, IE 9+, Safari 5.1+ */

   }
   ```
4. 最后﻿打开主题的配置文件在如图所在行数修改配置

   ![](/images/uploads/screenshot_20221202-164843.png)

   ```
   font_family: Noto Serif SC,"Microsoft Yahei", Hiragino Sans GB, Microsoft Sans Serif, WenQuanYi Micro Hei, sans-serif
   ```

   ![](/images/uploads/screenshot_20221202-165033.png)
5. 修改﻿完就保存(一起修改)，然后重新部署，就可以了。