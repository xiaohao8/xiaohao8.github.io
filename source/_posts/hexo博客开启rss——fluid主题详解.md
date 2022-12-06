---
title: hexo博客开启rss——fluid主题详解
date: 2022-12-06 22:06:32
updated: 2022-12-06 22:06:32
tags:
  - 博客
categories:
  - 技术
comments: true
---
环境﻿准备:netlify,github。

1﻿.打开github博客仓库**netlify.toml文件，如果没有就在netlify后台设置的部署命令中修改，如图所示。**

![](/images/uploads/screenshot_20221206-220930.png)

```
npm install hexo-generator-feed --save;npm run build
```

然后﻿打开博客总配置文件**_config.yml，在最后添加以下内容**

```
# 订阅 RSS
feed:

type: atom

path: atom.xml

limit: 20
    type: atom
    path: atom.xml
    limit: false
```

在﻿主题的配置文件中添加一行代码

```
rss: /atom.xml
```

然后﻿访问域名/atom.xml就行啦。