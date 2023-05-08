---
abbrlink: ''
categories: []
date: '2023-05-08T23:50:07.068131+08:00'
tags:
- hexo
title: titleUrl Submission 一个工具Hexo插件
updated: 2023-5-8T23:50:10.51+8:0
---
*介绍*

Url Submission 是一个工具型Hexo插件，主动推送站点链接至谷歌、必应、百度等搜索引擎，提升网站收录质量和速度。


## 开始前的准备工作

尽管我们已经尽可能降低使用门槛，但是要想使用的舒服，还需要做一些准备工作，最最重要的是，遇到问题知道该如何高效地寻找答案：

[X] 翻阅和搜索文档

[X] 搜索 issues 中是否已经有解决办法

[X] 如果没有，新建 issue 并按照要求进行操作，详尽地描述您遇到的问题

## 注册站长平台

### Baidu

* 使用百度账号登录 [百度搜索资源平台](https://ziyuan.baidu.com/dashboard)
* 添加并认证您的站点
* 快速收录(关联小程序才有权限开启)
* Sitemap提交
* 普通收录，在右侧找到类似如下地址: `接口调用地址：http://data.zz.baidu.com/urls?site=https://abnerwei.com&token=xxxxxxxxx` 将其中的 `token` 记录下来

### Bing

* 使用`Microsoft`、`Google(推荐)`、`Facebook`等账号登录 [Bing Webmasters](https://www.bing.com/webmasters)
* 添加并认证您的站点
* Sitemap提交
  ![在如下入口找到 Bing API Key](https://cdn.abnerwei.com/gh/abnerwei/cdn/images/screenshot/bing_key.png)
* Google
* 重要提示
* 在使用谷歌平台时，默认您已经学会使用科学上网工具，在接下来的谷歌Indexing API推送中将会使用到。 部署过程可以通过与 Github集成的一些 CI/CD 工具解决如 Github Action 和 Travis CI

使用谷歌账号登录 Google Cloud Platform

创建服务帐号

打开服务帐号页面。如果看到提示，请选择项目。

点击 add 创建服务帐号，并输入服务帐号的名称和说明。您可以使用默认服务帐号 ID，也可以选择其他唯一的帐号 ID。完成后，点击创建。

后面的服务帐号权限（可选）部分无需设置。点击继续。

在向用户授予访问此服务帐号的权限屏幕上，向下滚动到创建密钥部分。点击 add 创建密钥。

在随即显示的侧面板中，选择密钥的格式：建议使用 JSON。

点击创建。您的新公钥/私钥对随后会生成并下载到您的计算机上；该密钥仅此一份。

Shenma

注册并登录 神马站长平台

添加并认证您的站点

Sitemap提交

MIP数据提交，在右侧找到类似如下地址: 接口调用地址：https://data.zhanzhang.sm.cn/push?site=abnerwei.com&user_name=xxx@abnerwei.com&resource_name=mip_add&token=xxxxxx 将其中的 user_name和token 记录下来

安装与更新

安装方法



在终端中输入：

npm i hexo-url-submission

在 blog/_config.yml 文件中添加配置：

url_submission:

  enable: true

  type: "all" # latest or all

  channels: # included channels are `baidu`, `google`, `bing`, `shenma`

```
baidu:
```


```
token: "" # Baidu Private Token
```


```
count: 10 # Optional
```


```
bing:
```


```
token: "" # Bing Access Token
```


```
count: 10 # Optional
```


```
google:
```


```
key: "google.json" # Google key path (e.g. `google_key.json` or `data/google_key.json`)
```


```
count: 10 # Optional
```


```
shenma:
```


```
count: 10 # Optional
```


```
user: "" # Username used when registering
```


```
token: "" # ShenMa Private Key
```


  prefix: ["/post", "/wiki"] # URL prefix

  ignore: ["/post/a*", "/post/a?c"] # URL addresses that do not need to be submitted (wildcards are supported)

  count: 100

  proxy: "" # Set the proxy used to submit urls to Google

  urls_path: "submit_url.txt" # The file wait for submission

  sitemap: "baidusitemap.xml" # The filepath for sitemap

更新方法



在站点根目录执行：

npm update hexo-url-submission

或

yarn upgrade hexo-url-submission

阅读更新日志进行迁移操作。

小技巧: Watch Github 项目获取插件升级提醒!



再次确认以下数据都已获取



Baidu API Token

Bing API Key

Google Account Key

到此为止三大搜索引擎平台的密钥配置与获取就基本完成啦!

配置并启用

配置

enable

类型: Boolean

默认值: false

必要性: true

示例: true

是否启用插件



type

类型: String

默认值: all

必要性: false

示例: latest

latest



只有本次更新的 page 或 post 才会被提交

all



全部page和post按更新时间倒序



channels

类型: Object

默认值: null

必要性: true

备注: ≥@v2.0.0-beta.0

示例: channels: {baidu: {}, bing: {}, google: {}, shenma: {}}

通道名,

小写英文! 百度: baidu; 必应: bing; 谷歌: google; 神马: shenma



channels.baidu

类型: Object

默认值: {}

必要性: true

备注: ≥@v2.0.0-beta.0

示例: {token:"xxx", count: 10}

百度站长平台API Token



`count`

优先级大于全局配置, 不配置默认取全局 count 配置.



channels.bing

类型: Object

默认值: {}

必要性: true

备注: ≥@v2.0.0-beta.0

示例: {token:"xxx", count: 10}

必应webmasters平台API Token



`count`

优先级大于全局配置, 不配置默认取全局 count 配置.



channels.google

类型: Object

默认值: {}

必要性: true

备注: ≥@v2.0.0-beta.0

示例: {key:"xxx", count: 10}

谷歌Indexing API平台API Token



`count`

优先级大于全局配置, 不配置默认取全局 count 配置. key 配置 google.json 文件文件路径.



channels.shenma

类型: Object

默认值: {}

必要性: true

备注: ≥@v2.0.0-beta.0

示例: {token:"xxx", user: "xxx", count: 10}

神马搜索站长平台API Token



`count`

优先级大于全局配置, 不配置默认取全局 count 配置.



prefix

类型: Array

默认值: []

必要性: false

示例: ['/post', '/wiki']

URL前缀

例如您想只推送 wiki 里 go 相关的链接(例如: https://abnerwei.com/wiki/go/questions/), 以及 post 里 2021 年的文章(例如: https://abnerwei.com/post/2021/09/01/article.html), 那么您可以填写 [/post/2021, /wiki/go]



ignore

类型: Array

默认值: []

必要性: false

备注: ≥@v2.0.0-beta.0

示例: ['/post/a*', '/wiki/a?b']

url过滤参数

支持通配符



count

类型: Integer

默认值: 100

必要性: true

示例: 10

提交URL数量



Bing提交限制

Bing站长平台默认只支持10个URL提交, 若配置里count大于10，提交时会报错: [ERROR!!! Quota remaining for today: 10, Submitted: 80]



proxy

类型: String

默认值: ""

必要性: false

示例: 127.0.0.1:10809

代理服务器



代理访问`Google`提交API

Windows(需要添加http://头): http://127.0.0.1:10809

Unix: 127.0.0.1:10809



urls_path

类型: String

默认值: ""

必要性: true

示例: submit_url.txt

生成URL列表文件路径



sitemap

类型: String

默认值: null

必要性: false

示例: sitemap.xml

站点 sitemap 文件相对路径, 如: https://abnerwei.com/sitemap.xml, 可填写sitemap.xml



发布

deploy:

  - type: url_submission # 多渠道合并, 精简配置
