"use strict";

/**
 * 生成 /fcircle/links.json —— 朋友圈实时刷新用的友链清单。
 *
 * 为什么不在函数里直接读 YAML：
 * Netlify 的函数包只带 netlify/ 目录，source/_data/fluid_config.yml 不会被打包；
 * 而构建期 Hexo 已经解析好这份数据（locals.data），顺手导出一份 JSON 最省事，
 * 也保证「朋友圈采集的站点」与「友链页面展示的站点」永远是同一份名单。
 *
 * 消费方：netlify/functions/fcircle-tick.mjs（每分钟探测一次，只读不写）。
 * 名单本身随部署更新，所以缓存 60 秒足够，不需要额外配置。
 */
hexo.extend.generator.register("fcircle-links", function () {
  const data = hexo.locals.get("data") || {};
  const fluid = data.fluid_config || {};
  const raw = (fluid.links && fluid.links.items) || [];
  const seen = new Set();
  const items = [];

  for (const it of raw) {
    if (!it || !it.title || !it.link) continue;
    const link = String(it.link).trim();
    if (!/^https?:\/\//i.test(link)) continue;
    if (seen.has(link)) continue;
    seen.add(link);
    items.push({
      title: String(it.title).trim(),
      link: link,
      avatar: String(it.avatar || "").trim()
    });
  }

  return {
    path: "fcircle/links.json",
    data: JSON.stringify({
      count: items.length,
      generatedAt: new Date().toISOString(),
      items: items
    })
  };
});
