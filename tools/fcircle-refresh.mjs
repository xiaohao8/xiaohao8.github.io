#!/usr/bin/env node
/**
 * 刷新本站朋友圈的本地数据（source/fcircle/moments.json）。
 *
 * 朋友圈页面运行时只读取这个静态文件，不请求任何外部服务；
 * 本工具是唯一会联网的入口，由你在本地手动运行，产物提交入库后随部署生效。
 *
 * 用法：
 *   node tools/fcircle-refresh.mjs                 # 从本站 /all 后端拉取并写入
 *   node tools/fcircle-refresh.mjs --dry-run       # 只预览，不写文件
 *   node tools/fcircle-refresh.mjs --url <url>     # 换一个同源格式的接口
 *
 * 也可以完全离线维护：直接编辑 source/fcircle/moments.json 即可，
 * 只要保持 { statistical_data, article_data } 结构。
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "..", "source", "fcircle", "moments.json");
const DEFAULT_URL = "https://pyq.202271.xyz/all";

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const url = arg("--url", DEFAULT_URL);
const dryRun = process.argv.includes("--dry-run");
const timeout = Number(arg("--timeout", "15000"));

function clean(raw) {
  if (!raw || !Array.isArray(raw.article_data)) {
    throw new Error("响应缺少 article_data 数组");
  }
  const keys = ["title", "link", "author", "avatar", "created", "updated"];
  const rows = raw.article_data
    .map((x) => {
      const row = {};
      for (const k of keys) row[k] = String((x && x[k]) || "").trim();
      row.floor = x && x.floor;
      return row;
    })
    .filter((r) => r.title && /^https?:\/\//i.test(r.link))
    .sort((a, b) => {
      const x = Number.isInteger(a.floor) ? a.floor : Number.MAX_SAFE_INTEGER;
      const y = Number.isInteger(b.floor) ? b.floor : Number.MAX_SAFE_INTEGER;
      return x - y;
    });
  if (!rows.length) throw new Error("没有可用文章，拒绝覆盖本地数据");
  return {
    statistical_data: raw.statistical_data || {},
    article_data: rows,
  };
}

async function main() {
  console.log("数据源：" + url);
  const res = await fetch(url, {
    signal: AbortSignal.timeout(timeout),
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error("HTTP " + res.status);
  const payload = clean(await res.json());
  const s = payload.statistical_data;
  console.log(
    "文章 " + payload.article_data.length + " 篇，友链 " +
    (s.friends_num ?? "-") + " / 活跃 " + (s.active_num ?? "-") +
    "，更新于 " + (s.last_updated_time || "-")
  );

  if (dryRun) {
    console.log("--dry-run：未写入文件");
    return;
  }
  fs.writeFileSync(OUT, JSON.stringify(payload, null, 2) + "\n", "utf8");
  console.log("已写入：" + path.relative(path.join(HERE, ".."), OUT));
  console.log("提交该文件后随 Netlify 部署生效（页面运行时无需联网）。");
}

main().catch((err) => {
  console.error("刷新失败：" + (err && err.message));
  process.exitCode = 1;
});
