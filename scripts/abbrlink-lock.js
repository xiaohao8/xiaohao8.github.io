"use strict";

/**
 * 永久链接锁定：按 source/_data/abbrlinks.yml 固定每篇文章的 abbrlink。
 *
 * 背景：hexo-abbrlink 只在文章 front-matter 没有 abbrlink 时才生成编号，且
 * 冲突处理依赖本次构建的处理顺序；本项目默认不把 abbrlink 回写提交，导致
 * 每次构建同一篇文章可能拿到不同编号，旧链接随之 404。
 *
 * 本脚本在 hexo-abbrlink（priority 15）之前运行（priority 9），为锁定表中的
 * 文章直接写入 data.abbrlink；不修改任何文章文件，也不产生 front-matter 噪音。
 * 新增文章后请在 source/_data/abbrlinks.yml 追加一行。
 */

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

const MAP_FILE = "source/_data/abbrlinks.yml";
let cache = null;

function loadMap(ctx) {
  if (cache) return cache;
  cache = {};
  let file = MAP_FILE;
  try {
    file = path.join(ctx.base_dir, MAP_FILE);
    const doc = yaml.load(fs.readFileSync(file, "utf8")) || {};
    for (const [name, value] of Object.entries(doc)) {
      if (value !== null && value !== undefined && String(value) !== "") {
        cache[name] = String(value);
      }
    }
  } catch (e) {
    ctx.log.warn("[abbrlink-lock] 读取 %s 失败：%s", MAP_FILE, e.message);
  }
  return cache;
}

hexo.extend.filter.register("before_post_render", function (data) {
  if (data.layout !== "post") return data;
  const map = loadMap(this);
  const name = path.basename(String(data.source || ""));
  if (map[name]) data.abbrlink = map[name];
  return data;
}, 9);

hexo.extend.filter.register("after_generate", function () {
  try {
    const map = loadMap(hexo);
    const posts = hexo.locals.get("posts") || [];
    const missing = posts.filter(function (post) {
      return post.layout === "post" && !map[path.basename(String(post.source || ""))];
    });
    if (missing.length) {
      hexo.log.warn(
        "[abbrlink-lock] %d 篇文章未锁定永久链接，URL 可能随构建变化：%s",
        missing.length,
        missing.slice(0, 5).map(function (post) { return post.source; }).join(", ")
      );
    }
  } catch (e) {
    /* 仅提示，不影响构建 */
  }
});
