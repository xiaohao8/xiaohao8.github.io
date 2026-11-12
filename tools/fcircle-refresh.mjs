#!/usr/bin/env node
/**
 * 刷新本站朋友圈的本地数据（source/fcircle/moments.json）。
 *
 * github.com/xiaohao8/pyq 后端仓库已删除，/all 不再是数据源。
 * 现在直接从 source/_data/fluid_config.yml 的友情链接抓 Atom/RSS，
 * 与已有本地数据按文章链接去重后增量合并；抓不到的站点不影响已有条目。
 *
 * 页面运行时只读静态 JSON，零外部请求。本工具是唯一联网入口，两种触发方式：
 *   1) Netlify 构建期：netlify.toml 的 build command 会先跑 `--write`（自动）；
 *   2) 每周定时任务：跑 `--write` 后把数据与 feed 缓存回写仓库并推送（自动）。
 * 也可以手动跑 --dry-run 预览，或完全离线直接编辑 moments.json。
 *
 * tools/fcircle-feeds.json 固化已探测成功的 feed 地址：命中就直连，
 * 不再逐个盲试候选路径，构建更快也更稳；每次 --write 会把新发现的地址补进去。
 * --max-total 是抓取阶段总时限，超时后停止探测、用已抓到的结果继续，
 * 保证 Netlify 构建不会被慢站点拖垮；抓取失败一律回退到入库基线数据。
 *
 * 用法：
 *   node tools/fcircle-refresh.mjs --dry-run          # 预览（默认，不写任何文件）
 *   node tools/fcircle-refresh.mjs --write            # 写入本地 JSON 与 feed 缓存
 *   node tools/fcircle-refresh.mjs --write --timeout 4000 --concurrency 12 --max-total 45000
 *   node tools/fcircle-refresh.mjs --dry-run --limit 10
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const CONFIG = path.join(ROOT, "source", "_data", "fluid_config.yml");
const OUT = path.join(ROOT, "source", "fcircle", "moments.json");
const FEEDS = path.join(HERE, "fcircle-feeds.json");

// 常见 feed 路径：Hexo/Hugo 多为 atom.xml 或 index.xml，WordPress/Typecho 多为 feed
const CANDIDATES = ["/atom.xml", "/rss.xml", "/feed", "/index.xml"];

function readFeedCache() {
  try { return JSON.parse(fs.readFileSync(FEEDS, "utf8")) || {}; }
  catch (_) { return {}; }
}
function writeFeedCache(map) {
  try { fs.writeFileSync(FEEDS, JSON.stringify(map, null, 2) + "\n", "utf8"); }
  catch (_) { /* 构建容器里写不进去也不影响本次构建 */ }
}

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
function has(name) { return process.argv.includes(name); }

const write = has("--write");
const limit = Number(arg("--limit", "0"));
const perLink = Number(arg("--per-link", "5"));
const timeout = Number(arg("--timeout", "6000"));
const concurrency = Number(arg("--concurrency", "8"));
const maxTotal = Number(arg("--max-total", "45000"));
const deadline = Date.now() + maxTotal;

/* ---------- 读取本站友情链接 ---------- */

function fallbackLinks(text) {
  const start = text.indexOf("\nlinks:");
  if (start < 0) return [];
  const rest = text.slice(start + "\nlinks:".length);
  const nextTop = rest.search(/^\S/m);
  const block = nextTop > -1 ? rest.slice(0, nextTop) : rest;
  const out = [];
  let cur = null;
  for (const line of block.split(/\r?\n/)) {
    if (/^\s{4,}-\s/.test(line)) {
      if (cur) out.push(cur);
      cur = {};
    }
    if (!cur) continue;
    const m = line.match(/^\s*(title|link|avatar|intro):\s*(.+)$/);
    if (m) cur[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, "");
  }
  if (cur) out.push(cur);
  return out.filter((x) => x.title && /^https?:\/\//i.test(x.link || ""));
}

function readLinks() {
  const text = fs.readFileSync(CONFIG, "utf8");
  let items = null;
  try {
    const yaml = require("js-yaml");
    const d = yaml.load(text);
    items = (d && d.links && d.links.items) || [];
  } catch (e) {
    console.warn("js-yaml 不可用，改用简易解析：" + (e && e.message));
  }
  if (!items || !items.length) items = fallbackLinks(text);
  return items
    .filter((x) => x && x.title && x.link)
    .map((x) => ({
      title: String(x.title).trim(),
      link: String(x.link).trim(),
      avatar: String(x.avatar || "").trim(),
    }))
    .filter((x) => /^https?:\/\//i.test(x.link));
}

/* ---------- feed 抓取与解析（无第三方依赖） ---------- */

function decode(s) {
  return String(s || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]*>/g, "")
    .replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"').replace(/&#39;/gi, "'")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function tag(block, name) {
  const m = block.match(new RegExp("<" + name + "[^>]*>([\\s\\S]*?)</" + name + ">", "i"));
  return m ? m[1] : "";
}

function dayOf(s) {
  if (!s) return "";
  const direct = String(s).match(/\d{4}-\d{2}-\d{2}/);
  if (direct) return direct[0];
  const d = new Date(s);
  if (isNaN(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(d);
  const g = (t) => (parts.find((p) => p.type === t) || {}).value || "";
  return g("year") + "-" + g("month") + "-" + g("day");
}

function nowText() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).formatToParts(new Date());
  const g = (t) => (parts.find((p) => p.type === t) || {}).value || "";
  return g("year") + "-" + g("month") + "-" + g("day") + " " +
    g("hour") + ":" + g("minute") + ":" + g("second");
}

function normalizeLink(u) {
  return String(u || "").trim().replace(/#.*$/, "").replace(/\/+$/, "").toLowerCase();
}

async function probe(link, cached) {
  // 已知 feed 优先直连，命中后不再盲试候选路径
  const urls = [];
  if (cached) urls.push(cached);
  for (const p of CANDIDATES) {
    let u;
    try { u = new URL(p, link.link).href; } catch (_) { continue; }
    if (urls.indexOf(u) === -1) urls.push(u);
  }
  for (const url of urls) {
    if (Date.now() >= deadline) return null;
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(timeout),
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; FriendCircleRefresh/1.0; +https://202271.xyz)",
          "Accept": "application/atom+xml,application/rss+xml,application/xml,text/xml,*/*",
        },
      });
      if (!res.ok) continue;
      const xml = await res.text();
      if (/<rss[\s>]|<feed[\s>]|<rdf:RDF/i.test(xml.slice(0, 4000))) {
        return { url, xml, cached: url === cached };
      }
    } catch (_) { /* 换下一个候选路径 */ }
  }
  return null;
}

function parseFeed(xml, link) {
  const isAtom = /<feed[\s>]/i.test(xml.slice(0, 3000));
  const blocks = (isAtom
    ? xml.match(/<entry[\s\S]*?<\/entry>/gi)
    : xml.match(/<item[\s\S]*?<\/item>/gi)) || [];
  const rows = [];
  for (const b of blocks) {
    const title = decode(tag(b, "title"));
    let href = "";
    if (isAtom) {
      const links = b.match(/<link[^>]*>/gi) || [];
      const chosen = links.find((t) => /rel=["']alternate["']/i.test(t)) || links[0] || "";
      const h = chosen.match(/href=["']([^"']+)["']/i);
      if (h) href = h[1];
      if (!href) href = decode(tag(b, "link"));
    } else {
      href = decode(tag(b, "link"));
      if (!href) {
        const g = b.match(/<guid[^>]*>([\s\S]*?)<\/guid>/i);
        if (g) href = decode(g[1]);
      }
    }
    let abs = "";
    try { abs = new URL(href, link.link).href; } catch (_) { /* 忽略无效链接 */ }
    if (!/^https?:\/\//i.test(abs)) continue;
    const raw = decode(
      tag(b, "pubDate") || tag(b, "published") || tag(b, "updated") || tag(b, "dc:date")
    );
    const day = dayOf(raw);
    if (!title || !day) continue;
    rows.push({
      title: title.slice(0, 120),
      link: abs,
      author: link.title,
      avatar: link.avatar,
      created: day,
      updated: day,
    });
  }
  rows.sort((a, b) => b.created.localeCompare(a.created));
  return rows.slice(0, perLink);
}

async function mapLimit(items, n, fn) {
  const out = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const i = cursor++;
      try { out[i] = await fn(items[i]); }
      catch (e) { out[i] = { ok: false, error: e && e.message }; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return out;
}

/* ---------- 主流程 ---------- */

async function main() {
  const links = readLinks();
  const use = limit > 0 ? links.slice(0, limit) : links;
  const existing = JSON.parse(fs.readFileSync(OUT, "utf8"));
  const oldRows = existing.article_data || [];

  console.log("友链配置：" + links.length + " 条，本次探测 " + use.length + " 条");
  console.log("现有本地数据：" + oldRows.length + " 篇");
  console.log("模式：" + (write ? "写入（--write）" : "dry-run（不改动任何文件）"));
  const feedCache = readFeedCache();
  console.log("参数：每站最多 " + perLink + " 篇 / 单请求超时 " + timeout + "ms / 并发 " +
    concurrency + " / 抓取总时限 " + maxTotal + "ms");
  console.log("已知 feed 缓存：" + Object.keys(feedCache).length + " 条");

  const seen = new Set(oldRows.map((r) => normalizeLink(r.link)));
  const results = await mapLimit(use, concurrency, async (link) => {
    if (Date.now() >= deadline) return { link, ok: false, skipped: true };
    const hit = await probe(link, feedCache[link.link]);
    if (!hit) return { link, ok: false };
    return { link, ok: true, feed: hit.url, cached: hit.cached, rows: parseFeed(hit.xml, link) };
  });

  const ok = results.filter((r) => r && r.ok);
  const failed = results.filter((r) => !r || !r.ok);
  const fresh = [];
  for (const r of ok) {
    for (const row of r.rows) {
      const k = normalizeLink(row.link);
      if (seen.has(k)) continue;
      seen.add(k);
      fresh.push(row);
    }
  }
  fresh.sort((a, b) => b.created.localeCompare(a.created));

  console.log("\n=== 抓取结果 ===");
  console.log("成功拿到 feed：" + ok.length + " / " + use.length + "；失败 " + failed.length);
  console.log("其中命中已知 feed 缓存：" + ok.filter((r) => r.cached).length + " 个");
  console.log("去重后新文章：" + fresh.length + " 篇；合并后共 " + (oldRows.length + fresh.length) + " 篇");

  console.log("\n=== 新文章样例（最新 12 篇）===");
  for (const r of fresh.slice(0, 12)) {
    console.log("  " + r.created + " | " + r.author + " | " + r.title.slice(0, 48));
  }

  console.log("\n=== 成功站点 ===");
  for (const r of ok) console.log("  " + r.link.title + " -> " + r.feed + "（" + r.rows.length + " 篇）");

  console.log("\n=== 未拿到 feed 的站点 ===");
  for (const r of failed) {
    console.log("  " + (r && r.link ? r.link.title + " " + r.link.link : "未知"));
  }

  if (!write) {
    console.log("\n--dry-run：未写入任何文件，现有 " + oldRows.length + " 篇数据保持原样。");
    console.log("确认无误后执行：node tools/fcircle-refresh.mjs --write");
    return;
  }

  // 构建期若网络整体不可达，一个 feed 都没抓到，就完全保留入库基线，
  // 避免把统计写成「活跃 0」或让数据文件产生无意义的时间戳变化。
  if (!ok.length) {
    console.log("\n本次未抓到任何 feed，保留现有 " + oldRows.length + " 篇数据，不覆盖文件。");
    return;
  }

  // 把本次成功的 feed 地址回写缓存：定时任务会把这份缓存提交进仓库，
  // 下次构建就能直连，不再逐个盲试候选路径。
  const nextCache = Object.assign({}, feedCache);
  for (const r of ok) nextCache[r.link.link] = r.feed;
  writeFeedCache(nextCache);

  const merged = oldRows.concat(fresh);
  merged.sort((a, b) => String(b.created || "").localeCompare(String(a.created || "")));
  const payload = {
    statistical_data: {
      friends_num: links.length,
      active_num: ok.length,
      error_num: links.length - ok.length,
      article_num: merged.length,
      last_updated_time: nowText(),
    },
    article_data: merged,
  };
  fs.writeFileSync(OUT, JSON.stringify(payload, null, 2) + "\n", "utf8");
  console.log("\n已写入 " + OUT + "（共 " + merged.length + " 篇）");
  console.log("提交该文件后随 Netlify 部署生效，页面运行时仍零外部请求。");
}

main().catch((err) => {
  console.error("刷新失败：" + (err && err.message));
  process.exitCode = 1;
});
