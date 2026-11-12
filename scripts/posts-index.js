"use strict";

/**
 * 生成 /admin/posts-index.json —— 后台文章列表的单请求数据源。
 * 后台优先读本文件（1 个静态请求）替代逐篇 contents API（52 个请求），
 * 编辑/删除后的本地覆盖由后台自己维护；强制刷新仍走 GitHub 全量。
 * 注意：生成期在 before_post_render 锁表之后，abbrlink 已是锁定值。
 */

hexo.extend.generator.register("posts-index", function (locals) {
  const posts = locals.posts.sort("-date").toArray();
  const data = posts.map(function (post) {
    const src = String(post.source || "");
    return {
      name: src.replace(/^_posts\//, ""),
      path: "source/" + src,
      title: String(post.title || ""),
      date: post.date ? post.date.toISOString() : "",
      updated: post.updated ? post.updated.toISOString() : "",
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
