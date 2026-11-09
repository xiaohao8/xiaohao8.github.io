"use strict";

hexo.extend.filter.register("before_generate", function () {
  const data = hexo.locals.get("data");
  const meta = data && data.site_meta;

  if (!meta) {
    return;
  }

  ["title", "subtitle", "description", "keywords", "author", "language"].forEach(function (key) {
    if (meta[key] !== undefined && meta[key] !== null && meta[key] !== "") {
      hexo.config[key] = meta[key];
    }
  });
});
