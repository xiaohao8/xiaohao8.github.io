"use strict";

hexo.extend.generator.register("admin-manifest", function (locals) {
  const data = hexo.locals.get("data") || {};
  const fluidConfig = data.fluid_config || {};
  const talks = data.talks || {};
  const links = (fluidConfig.links && fluidConfig.links.items) || [];
  const talkItems = Array.isArray(talks.items) ? talks.items : [];
  const posts = locals.posts.sort("-date").toArray();
  const latestPosts = posts.slice(0, 6).map(function (post) {
    return {
      title: post.title,
      date: post.date && post.date.toISOString ? post.date.toISOString() : String(post.date || ""),
      path: post.path,
      tags: post.tags && post.tags.toArray ? post.tags.toArray().map(function (tag) {
        return tag.name;
      }) : []
    };
  });

  const manifest = {
    adminVersion: "3.2.2",
    generatedAt: new Date().toISOString(),
    hexoVersion: hexo.version,
    site: {
      title: hexo.config.title,
      subtitle: hexo.config.subtitle || "",
      description: hexo.config.description || "",
      url: hexo.config.url || "",
      path: "/"
    },
    counts: {
      posts: posts.length,
      pages: locals.pages.length,
      tags: locals.tags.length,
      categories: locals.categories.length,
      friends: Array.isArray(links) ? links.length : 0,
      talks: talkItems.length
    },
    latestPosts: latestPosts
  };

  return {
    path: "admin/manifest.json",
    data: JSON.stringify(manifest)
  };
});
