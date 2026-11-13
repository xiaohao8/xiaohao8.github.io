/* ============================================================
   朋友圈实时刷新核心（v7）

   为什么要有这一层：
   - GitHub Actions 的 schedule 最小间隔是 5 分钟，官方明确不支持 1 分钟，
     而且高负载时还会延迟或跳过；本机定时任务已被明确要求删掉。
   - 所以把「高频探测」交给 Netlify Scheduled Function（每分钟一次），
     GitHub Actions 退化为「每天一次的全量对齐 + 基线备份」。

   数据三层，任何一层挂掉页面都还有数据：
   1. source/fcircle/moments.json ── 入库基线，随部署发布为 /fcircle/moments.json；
   2. Netlify Blobs fcircle/moments.json ── 实时层，每分钟由 fcircle-tick 增量合并；
   3. GET /api/fcircle ── 读实时层，实时层还没建立时 302 回落到第 1 层。

   单次执行必须挤进 Scheduled Function 的 30 秒硬上限，所以这里刻意做了四件事：
   - 每个站点优先直连上次命中的 feed 地址，不再逐个盲试 4 个候选路径（4 倍省）；
   - 带 If-None-Match / If-Modified-Since，绝大多数请求是 304 而不是整份 XML；
   - 并发 + 单请求超时 + 总预算三重约束，超预算立刻收工，已抓到的照常合并；
   - 连续失败的站点按 2 的幂退避（最长 30 分钟一次），死站不会拖垮每分钟的预算。

   抓取只读 RSS/Atom，不请求任何第三方聚合接口，也不需要对方改造。
   ============================================================ */

export const STORE_NAME = "zui-fcircle";
export const BLOB_MOMENTS = "fcircle/moments.json";
export const BLOB_STATE = "fcircle/state.json";
export const BLOB_LOCK = "fcircle/lock.json";

/** 常见 feed 路径：Hexo/Hugo 多为 atom.xml / index.xml，WordPress/Typecho 多为 feed */
export const FEED_CANDIDATES = ["/atom.xml", "/rss.xml", "/feed", "/index.xml"];

export const USER_AGENT =
  "Mozilla/5.0 (compatible; FriendCircleBot/2.0; +https://202271.xyz/pyq/)";

/** 合并后的文章上限：只留最新的一批，避免 blob 无限增长拖慢 /api/fcircle */
export const MAX_ARTICLES = 900;

/** 每个站点每次最多取几篇（跟旧脚本保持一致） */
export const PER_LINK = 5;

/* ---------- 小工具 ---------- */

export function clampInt(v, fallback, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

export function normalizeLink(u) {
  return String(u || "")
    .trim()
    .replace(/#.*$/, "")
    .replace(/\/+$/, "")
    .toLowerCase();
}

function pad2(n) {
  return n < 10 ? "0" + n : String(n);
}

/** 北京时间 "YYYY-MM-DD HH:mm:ss"，全站统一 UTC+8，不跟随服务器时区 */
export function nowText(ms = Date.now()) {
  const d = new Date(ms + 8 * 3600 * 1000);
  return (
    d.getUTCFullYear() + "-" + pad2(d.getUTCMonth() + 1) + "-" + pad2(d.getUTCDate()) +
    " " + pad2(d.getUTCHours()) + ":" + pad2(d.getUTCMinutes()) + ":" + pad2(d.getUTCSeconds())
  );
}

/* ---------- feed 解析（无第三方依赖） ---------- */

export function decodeXml(s) {
  return String(s || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]*>/g, "")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function xmlTag(block, name) {
  const m = block.match(new RegExp("<" + name + "[^>]*>([\\s\\S]*?)</" + name + ">", "i"));
  return m ? m[1] : "";
}

/**
 * 发布日期统一裁成 YYYY-MM-DD（页面按天展示）。
 * 规则分三种，别简化成「先正则抠日期」：
 *   1. 纯日期（2026-11-10）→ 原样；
 *   2. 有明确时区（Z / +08:00 / RFC822 的 +0800）→ 换算成北京时间再切日，
 *      否则 UTC 晚上发的文章会被算到前一天；
 *   3. 有时间但没时区（2026-11-10 20:00:00）→ 取原文日期，按作者本地时间理解，
 *      不用 Date 解析（Netlify 运行时是 UTC，硬转会整体偏移 8 小时）。
 */
export function dayOf(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const iso = s.match(/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?)?(Z|[+-]\d{2}:?\d{2})?$/);
  if (iso && !iso[3]) return s.slice(0, 10);
  const d = new Date(s);
  if (isNaN(d.getTime())) {
    const any = s.match(/\d{4}-\d{2}-\d{2}/);
    return any ? any[0] : "";
  }
  const bj = new Date(d.getTime() + 8 * 3600 * 1000);
  return bj.getUTCFullYear() + "-" + pad2(bj.getUTCMonth() + 1) + "-" + pad2(bj.getUTCDate());
}

export function looksLikeFeed(xml) {
  return /<rss[\s>]|<feed[\s>]|<rdf:RDF/i.test(String(xml || "").slice(0, 4000));
}

/** 从 Atom / RSS / RDF 文本里抽文章，返回按日期倒序的前 perLink 篇 */
export function parseFeed(xml, link, perLink = PER_LINK) {
  const isAtom = /<feed[\s>]/i.test(String(xml).slice(0, 3000));
  const blocks =
    (isAtom ? xml.match(/<entry[\s\S]*?<\/entry>/gi) : xml.match(/<item[\s\S]*?<\/item>/gi)) || [];
  const rows = [];
  for (const b of blocks) {
    const title = decodeXml(xmlTag(b, "title"));
    let href = "";
    if (isAtom) {
      const links = b.match(/<link[^>]*>/gi) || [];
      const chosen = links.find((t) => /rel=["']alternate["']/i.test(t)) || links[0] || "";
      const h = chosen.match(/href=["']([^"']+)["']/i);
      if (h) href = h[1];
      if (!href) href = decodeXml(xmlTag(b, "link"));
    } else {
      href = decodeXml(xmlTag(b, "link"));
      if (!href) {
        const g = b.match(/<guid[^>]*>([\s\S]*?)<\/guid>/i);
        if (g) href = decodeXml(g[1]);
      }
    }
    let abs = "";
    try {
      abs = new URL(href, link.link).href;
    } catch (_) {
      /* 忽略无效链接 */
    }
    if (!/^https?:\/\//i.test(abs)) continue;
    const raw = decodeXml(
      xmlTag(b, "pubDate") || xmlTag(b, "published") || xmlTag(b, "updated") || xmlTag(b, "dc:date")
    );
    const day = dayOf(raw);
    if (!title || !day) continue;
    rows.push({
      title: title.slice(0, 120),
      link: abs,
      author: link.title,
      avatar: link.avatar || "",
      created: day,
      updated: day,
    });
  }
  rows.sort((a, b) => String(b.created).localeCompare(String(a.created)));
  return rows.slice(0, perLink);
}

/* ---------- 合并 ---------- */

const byCreatedDesc = (a, b) => String(b.created || "").localeCompare(String(a.created || ""));

/**
 * 增量合并：新的优先入表，按文章链接去重（去 hash、去尾斜杠、忽略大小写）。
 * 超出上限时丢最旧的，保证 blob 不会无限膨胀。
 */
export function mergeArticles(base, incoming, cap = MAX_ARTICLES) {
  const seen = new Set();
  const out = [];
  const push = (r) => {
    if (!r || !r.link || !r.title) return;
    const k = normalizeLink(r.link);
    if (!k || seen.has(k)) return;
    seen.add(k);
    out.push(r);
  };
  (incoming || []).slice().sort(byCreatedDesc).forEach(push);
  (base || []).slice().sort(byCreatedDesc).forEach(push);
  out.sort(byCreatedDesc);
  return out.slice(0, cap);
}

/** 部分站点的标题里带站点名，去重后按站点统计「活跃数」更有意义 */
export function countActive(links, state) {
  const map = (state && state.links) || {};
  let active = 0;
  for (const l of links) {
    const st = map[l.link];
    if (st && st.feed && !st.fails) active += 1;
  }
  return active;
}

export function momentsPayload({ links, rows, active, lastUpdated, lastChecked }) {
  const total = links.length;
  const act = Math.max(0, Math.min(total, active));
  return {
    statistical_data: {
      friends_num: total,
      active_num: act,
      error_num: Math.max(0, total - act),
      article_num: rows.length,
      last_updated_time: lastUpdated || "",
      // 「更新于」只在新文章入库时才变；「检查于」是最近一次真正跑完探测的时间。
      // 两个字段分开，才不会出现「每分钟都显示刚刚更新，其实一篇都没变」的假新鲜。
      last_checked_time: lastChecked || "",
      source: "netlify-scheduled",
    },
    article_data: rows,
  };
}

/* ---------- 网络 ---------- */

export async function fetchJson(url, timeoutMs = 6000) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
  });
  if (!res.ok) throw new Error("HTTP " + res.status);
  return res.json();
}

/**
 * 探测单个站点的 feed。
 * 命中过就直连（1 个请求）；否则按候选路径顺序盲试，命中后由调用方写回缓存。
 * 返回 { url, xml, etag, lastModified } / { notModified: true } / null。
 */
export async function probeFeed(link, cachedUrl, opts = {}) {
  const timeoutMs = opts.timeoutMs || 4000;
  const deadline = opts.deadline || Date.now() + timeoutMs;
  const cond = opts.conditional || {};

  const urls = [];
  if (cachedUrl) urls.push(cachedUrl);
  for (const p of FEED_CANDIDATES) {
    let u;
    try {
      u = new URL(p, link.link).href;
    } catch (_) {
      continue;
    }
    if (urls.indexOf(u) === -1) urls.push(u);
  }

  for (const url of urls) {
    const left = deadline - Date.now();
    if (left < 600) return { budget: true };
    const headers = {
      "User-Agent": USER_AGENT,
      Accept: "application/atom+xml,application/rss+xml,application/xml,text/xml,*/*",
    };
    if (url === cachedUrl) {
      if (cond.etag) headers["If-None-Match"] = cond.etag;
      if (cond.lastModified) headers["If-Modified-Since"] = cond.lastModified;
    }
    try {
      const res = await fetch(url, {
        headers,
        redirect: "follow",
        signal: AbortSignal.timeout(Math.min(timeoutMs, left)),
      });
      if (res.status === 304) {
        return { notModified: true, url };
      }
      if (!res.ok) continue;
      const xml = await res.text();
      if (!looksLikeFeed(xml)) continue;
      return {
        url,
        xml,
        etag: res.headers.get("etag") || "",
        lastModified: res.headers.get("last-modified") || "",
      };
    } catch (_) {
      /* 换下一个候选路径 */
    }
  }
  return null;
}

/** 有并发上限的 map，单项异常不影响其它项 */
export async function mapLimit(items, n, fn) {
  const out = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const i = cursor++;
      try {
        out[i] = await fn(items[i], i);
      } catch (e) {
        out[i] = { error: e && e.message };
      }
    }
  }
  const size = Math.max(1, Math.min(n, items.length));
  await Promise.all(Array.from({ length: size }, worker));
  return out;
}
