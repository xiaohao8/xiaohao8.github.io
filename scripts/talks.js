"use strict";

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

function renderImages(images) {
  if (!Array.isArray(images) || images.length === 0) {
    return "";
  }

  return (
    '<div class="qexo-talk-images">' +
    images
      .filter(function (image) {
        return image && image.image;
      })
      .map(function (image) {
        return (
          '<a class="qexo-talk-image" href="' +
          escapeAttr(image.image) +
          '" target="_blank" rel="noopener noreferrer"><img src="' +
          escapeAttr(image.image) +
          '" alt="说说配图" loading="lazy" /></a>'
        );
      })
      .join("") +
    "</div>"
  );
}

function renderContent(content) {
  const text = String(content || "").trim();
  if (!text) {
    return "";
  }

  return hexo.render.renderSync({
    text: text,
    engine: "markdown"
  });
}

hexo.extend.tag.register("qexo_talks", function () {
  const data = hexo.locals.get("data") || {};
  const items = data.talks && Array.isArray(data.talks.items) ? data.talks.items : [];

  if (items.length === 0) {
    return '<div class="qexo-talks-empty">暂时还没有说说，登录 <a href="/admin/">管理后台</a> 发布第一条。</div>';
  }

  const sorted = items.slice().sort(function (left, right) {
    return new Date(right.date || 0).getTime() - new Date(left.date || 0).getTime();
  });

  return (
    '<div class="qexo-talks">' +
    sorted
      .map(function (item) {
        const date = item.date ? new Date(item.date) : null;
        const dateText =
          date && !Number.isNaN(date.getTime())
            ? date.toLocaleString("zh-CN", {
                hour12: false,
                year: "numeric",
                month: "2-digit",
                day: "2-digit",
                hour: "2-digit",
                minute: "2-digit"
              })
            : "";

        return (
          '<article class="qexo-talk">' +
          '<div class="qexo-talk-rail"><span></span></div>' +
          '<div class="qexo-talk-body">' +
          (dateText ? '<time class="qexo-talk-date">' + escapeHtml(dateText) + "</time>" : "") +
          '<div class="qexo-talk-content markdown-body">' +
          renderContent(item.content) +
          "</div>" +
          renderImages(item.images) +
          "</div>" +
          "</article>"
        );
      })
      .join("") +
    "</div>"
  );
});
