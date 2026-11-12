"use strict";

const fs = require("fs");
const path = require("path");

/**
 * 生成 /admin/posts-index.json —— 后台文章列表的单请求数据源。
 * 后台优先读本文件（1 个静态请求）替代逐篇 contents API（52 个请求），
 * 编辑/删除后的本地覆盖由后台自己维护；强制刷新仍走 GitHub 全量。
 * 注意：生成期在 before_post_render 锁表之后，abbrlink 已是锁定值。
 */

/**
 * 输出与 front-matter 原文一致的「无时区」时间串。
 * `_config.yml` 的 timezone 为空，Hexo 会按构建机时区解析日期：本地是 CST、
 * Netlify 是 UTC，直接 toISOString() 会让两份索引差 8 小时，后台把 UTC 串
 * 再按本地时间显示就变成了次日 00:41。按本地字段格式化则两种环境结果相同。
 */
function dateText(d) {
  if (!d) return "";
  if (typeof d.format === "function") return d.format("YYYY-MM-DD HH:mm:ss");
  const p = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " +
    p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds());
}

/**
 * 优先取 front-matter 里的原始字符串（与后台 splitFrontMatter 的还原逻辑一致）。
 * 文章日期写法不统一：既有 `2025-01-26 16:41:30`，也有带偏移的
 * `'2023-10-16T22:45:27.563423+08:00'`，任何 Date→字符串转换都会受构建机时区影响；
 * 直接回传原文才能让本地(CST) 与 Netlify(UTC) 生成完全相同的索引。
 */
function rawFrontDate(post, key) {
  try {
    const src = post.full_source || path.join(hexo.source_dir, post.source);
    const text = fs.readFileSync(src, "utf8");
    const m = text.match(new RegExp("^" + key + ":\\s*(.+)$", "m"));
    return m ? m[1].trim().replace(/^['"]|['"]$/g, "") : "";
  } catch (_) { return ""; }
}

hexo.extend.generator.register("posts-index", function (locals) {
  // 后台 loadAllPosts 的 finish() 会按 dateValue 重排，这里只需产物确定：
  // 按文件路径做稳定排序（不用 localeCompare，避免受构建机 locale 影响），
  // 否则日期相近的两篇文章在不同构建时区下会互换位置，两次构建产物不同。
  const posts = locals.posts.toArray().sort(function (a, b) {
    const x = String(a.source), y = String(b.source);
    return x < y ? -1 : x > y ? 1 : 0;
  });
  const data = posts.map(function (post) {
    const src = String(post.source || "");
    return {
      name: src.replace(/^_posts\//, ""),
      path: "source/" + src,
      title: String(post.title || ""),
      date: rawFrontDate(post, "date") || dateText(post.date),
      updated: rawFrontDate(post, "updated") || dateText(post.updated),
      sticky: post.sticky == null ? null : Number(post.sticky) || 0,
      tags: post.tags ? post.tags.toArray().map(function (t) { return String(t.name); }) : [],
      categories: post.categories ? post.categories.toArray().map(function (c) { return String(c.name); }) : [],
      password: post.password ? true : false,
      permalink: post.permalink ? String(post.permalink || "") : "",
      abbrlink: post.abbrlink == null ? "" : String(post.abbrlink),
      slug: String(post.slug || ""),
    };
  });
  return {
    path: "admin/posts-index.json",
    data: JSON.stringify(data),
  };
});
