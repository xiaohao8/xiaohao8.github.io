---
abbrlink: ''
categories: []
date: '2023-05-27T23:53:02.178907+08:00'
excerpt: 小程序是java的 带后台 本来准备给你们带上接口的然后么后台是和接口连接的【未测试小程序源码，仅供参考学习】 我改什么内容你们前段都会显示所以 开源自己搭建下吧，腾讯云买个国外服务器就可以了 几十块钱！  而且最近openkey 封号比较频繁所以大家自己弄下！ *小程序需配合java程序，上面的链接为Java开源程序的搭建以及教程 *下面将详细介绍此套系统的前端搭建过程谢谢！ 所需环境 unia...
tags: []
title: chatgpt3.5小程序vue开源
updated: 2023-5-27T23:54:9.422+8:0
---
小程序是java的 带后台 本来准备给你们带上接口的然后么后台是和接口连接的【未测试小程序源码，仅供参考学习】



我改什么内容你们前段都会显示所以 开源自己搭建下吧，腾讯云买个国外服务器就可以了



几十块钱！  而且最近openkey 封号比较频繁所以大家自己弄下！



*小程序需配合java程序，上面的链接为Java开源程序的搭建以及教程



*下面将详细介绍此套系统的前端搭建过程谢谢！



所需环境



uniapp nodejs



搭建教学



首先前端源码下载下来，用idea源码编辑器打开,只需要修改配置文件中的请求api（request/request.js）,需要搭建好后端请求

1.服务器配置



centos7.9



2.宝塔面板安装宝塔



3.如果在线下载地址报错:



下载xshell



4.前端使用工具 :



HBuilder X



node.js



伪静态最后面地址改为自己的服务器地址（带端口）

```
try_files $uri $uri/ /index.html;
```


```
location /prod-api/ {
```


```
proxy_set_header Host $http_host;
```


```
proxy_set_header X-Real-IP $remote_addr;
```


```
proxy_set_header REMOTE-HOST $remote_addr;
```


```
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
```


```
proxy_pass http://120.48.124.77:7697/;}
```




下载地址：https://pan.baidu.com/share/init?surl=WlvQnD_JcabK2E-bCSwgvA

密码：oxnx
