---
title: 使用netlify搭建hexo博客并使用Fluid主题
date: 2023-04-19 23:43:50
updated: 2023-04-19 23:43:50
tags:
  - fluid
categories:
  - 技术
comments: true
---
搭建博客是一个很好的方式，可以将你的想法和知识与世界分享，并在过程中提高自己的写作技能。Hexo是一个非常流行的静态博客生成器，它可以帮助你快速地创建漂亮的博客并优化SEO。在本篇文章中，我们将介绍如何使用Netlify搭建Hexo博客并使用Fluid主题。

步骤
1.安装Hexo
首先，你需要安装Node.js和Hexo。打开终端并输入以下命令：

sudo apt-get install nodejs npm
sudo npm install hexo-cli -g
2.初始化Hexo
在你的工作目录下，输入以下命令以设置你的博客配置文件：

hexo init myblog
cd myblog
npm install
3.选择Fluid主题
在Hexo中，主题是通过下载和安装来添加的。打开终端并进入到你的博客目录下。然后，使用以下命令来克隆Fluid主题的存储库：

git clone https://github.com/fluid-dev/hexo-theme-fluid.git themes/fluid
4.编辑博客配置
在你的博客目录中找到_config.yml文件并打开它。在文件中找到“theme”设置，并将其更改为Fluid：

theme: fluid
5.部署到Netlify
在Netlify上创建一个新网站。

在“Deploy settings”下设置以下内容：

Branch to deploy: master
Build command: hexo generate
Public directory: public/
在“Site settings”中，找到“Domain management”，并为你的网站添加自定义域名。

在“Site overview”中，点击“Trigger deploy”来部署你的网站。

6.访问博客
现在，你可以通过你的自定义域名或Netlify提供的URL访问你的Hexo博客，并使用Fluid主题展示你的文章。你可以在本地编辑和预览博客，并将其部署到Netlify以进行生产环境中的发布。

结论
使用Netlify可以快速搭建Hexo博客，并使用Fluid主题轻松实现漂亮的界面设计和博客风格。借助Netlify和Hexo，你可以更专注于写作和创作，而不必担心博客构建和托管等方面的技术细节。

我的github主页：https://github.com/xiaohao8