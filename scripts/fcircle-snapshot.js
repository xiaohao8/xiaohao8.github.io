"use strict";

/**
 * 构建期朋友圈快照 —— /fcircle/moments.json
 *
 * 朋友圈数据源对齐 blog.anheyu.com/fcircle：该页用 Next.js 客户端请求
 *   GET /api/pro/moments?page=1&page_size=50&sort_type=published_at
 * 返回 { code:200, data:{ list, page, page_size, total, statistics } }。
 *
 * 但目标接口不返回 Access-Control-Allow-Origin（带 Origin 请求也没有），
 * OPTIONS 预检直接 403，浏览器无法跨域直连。因此：
 *   1) 运行时走 netlify.toml 的同源反代 /fcircle/api/moments 拿实时数据；
 *   2) 这里在构建时抓一份同源静态快照，反代不通 / 目标站临时故障时
 *      页面仍能在首屏出内容，不会白屏。
 *
 * 实现约束：
 * - Hexo 用 vm 包装加载 scripts/*.js，Node 全局 fetch / AbortSignal 不保证存在，
 *   所以用 require("https") 发请求；Buffer 也从 require("buffer") 取。
 * - 抓取结果存在模块变量里，generator 保持同步返回，避免异步 generator 的兼容问题。
 * - 抓取「尽力而为」：任何失败只输出空结构并 warn，绝不阻断 hexo generate。
 * - 本文件必须入库，否则 Netlify 构建不会生成快照。
 */

var https = require("https");
var Buffer = require("buffer").Buffer;

var API = "https://blog.anheyu.com/api/pro/moments?page=1&page_size=24&sort_type=published_at";
var TIMEOUT = 8000;

function emptyPayload() {
  return {
    code: 200,
    message: "构建期快照不可用",
    snapshot: true,
    data: {
      list: [],
      page: 1,
      page_size: 24,
      total: 0,
      statistics: {
        total_links: 0,
        active_links: 0,
        total_moments: 0,
        last_updated_time: ""
      }
    }
  };
}

var snapshot = emptyPayload();

function requestJson(url) {
  return new Promise(function (resolve, reject) {
    var req = https.get(url, {
      timeout: TIMEOUT,
      headers: {
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0 (compatible; HexoFcircleBuild/1.0; +https://202271.xyz)"
      }
    }, function (res) {
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error("HTTP " + res.statusCode));
        return;
      }
      var chunks = [];
      res.on("data", function (chunk) { chunks.push(chunk); });
      res.on("end", function () {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        } catch (err) {
          reject(err);
        }
      });
      res.on("error", reject);
    });
    req.on("timeout", function () { req.destroy(new Error("请求超时")); });
    req.on("error", reject);
  });
}

hexo.extend.filter.register("before_generate", function () {
  return requestJson(API).then(function (json) {
    if (!json || json.code !== 200 || !json.data || !Array.isArray(json.data.list)) {
      throw new Error("响应结构不符合预期");
    }
    snapshot = {
      code: 200,
      message: "ok",
      snapshot: true,
      fetched_at: new Date().toISOString(),
      data: json.data
    };
    console.info("[fcircle-snapshot] 已抓取 " + json.data.list.length + " 条朋友圈文章");
  }).catch(function (err) {
    snapshot = emptyPayload();
    console.warn("[fcircle-snapshot] 构建期抓取失败，运行时依赖同源反代：" + (err && err.message));
  });
});

hexo.extend.generator.register("fcircle-snapshot", function () {
  return { path: "fcircle/moments.json", data: JSON.stringify(snapshot) };
});
