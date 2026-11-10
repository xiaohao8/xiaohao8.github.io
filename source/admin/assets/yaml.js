/* yaml.js — front-matter 与数据文件的 YAML 解析/序列化（基于 vendored js-yaml） */

const FM_FIELD_ORDER = [
  "title", "subtitle", "date", "updated", "tags", "categories", "sticky",
  "banner_img", "index_img", "excerpt", "keywords", "password", "comments",
  "permalink", "abbrlink", "layout", "type", "description", "toc",
];

function jsYaml() {
  if (typeof window === "undefined" || !window.jsyaml) {
    throw new Error("js-yaml 未加载");
  }
  return window.jsyaml;
}

/**
 * 拆分 front-matter。返回 { data, body, hasFm }。
 * 对 date/updated 做 Date→原始字符串还原，避免 js-yaml 时间戳类型转换。
 */
export function splitFrontMatter(text) {
  const t = String(text || "").replace(/^\uFEFF/, "");
  const m = t.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/);
  if (!m) {
    return { data: {}, body: t, hasFm: false };
  }
  const raw = m[1];
  let data;
  try {
    data = jsYaml().load(raw, { json: true }) || {};
  } catch (e) {
    throw new Error("front-matter YAML 解析失败：" + e.message);
  }
  if (typeof data !== "object" || data === null) data = {};
  // js-yaml 会把时间戳解析成 Date，还原成原始字符串
  for (const key of Object.keys(data)) {
    if (isDateObj(data[key])) {
      const line = raw.match(new RegExp("^" + key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ":\\s*(.+)$", "m"));
      // 原始行取不到时按 UTC 还原（js-yaml 对无时区时间戳按 UTC 解析）
      data[key] = line ? line[1].trim().replace(/^['"]|['"]$/g, "") : isoToUtc(data[key]);
    }
  }
  reviveDates(data);
  const body = t.slice(m[0].length).replace(/^\r?\n/, "");
  return { data, body, hasFm: true };
}

/** 组装 front-matter 文本 */
export function buildFrontMatter(data, body) {
  const clean = {};
  for (const key of FM_FIELD_ORDER) {
    if (data[key] !== undefined && data[key] !== null && data[key] !== "") clean[key] = data[key];
  }
  for (const key of Object.keys(data)) {
    if (!(key in clean) && data[key] !== undefined && data[key] !== null && data[key] !== "") {
      clean[key] = data[key];
    }
  }
  const yaml = dumpYaml(clean);
  return "---\n" + yaml + "---\n\n" + (body || "");
}

/** 通用 dump（保留键顺序） */
export function dumpYaml(obj) {
  return jsYaml().dump(obj, {
    lineWidth: -1,
    noRefs: true,
    quotingType: '"',
    forceQuotes: false,
  });
}

/** 通用 load（嵌套日期也还原为原始字符串，避免 dump 时格式漂移） */
export function loadYaml(text) {
  return reviveDates(jsYaml().load(text, { json: true }));
}

const isDateObj = (v) => Object.prototype.toString.call(v) === "[object Date]";

function reviveDates(v) {
  // js-yaml 把无时区时间戳按 UTC 解析成 Date；用 UTC 字段还原才能拿回原始字符串，
  // 否则东八区浏览器上每次 loadYaml→dumpYaml 往返都会让日期漂移 +8 小时
  if (isDateObj(v)) return isoToUtc(v);
  if (Array.isArray(v)) return v.map(reviveDates);
  if (v && typeof v === "object") {
    for (const k of Object.keys(v)) v[k] = reviveDates(v[k]);
    return v;
  }
  return v;
}

export function isoToLocal(d) {
  if (!(d instanceof Date)) return String(d || "");
  const p = (n) => (n < 10 ? "0" + n : "" + n);
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) +
    " " + p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds());
}

function isoToUtc(d) {
  const p = (n) => (n < 10 ? "0" + n : "" + n);
  return d.getUTCFullYear() + "-" + p(d.getUTCMonth() + 1) + "-" + p(d.getUTCDate()) +
    " " + p(d.getUTCHours()) + ":" + p(d.getUTCMinutes()) + ":" + p(d.getUTCSeconds());
}

/** Date / 字符串 → datetime-local 控件值（兼容不补零的月/日/时/分/秒） */
export function toInputDate(value) {
  if (!value) return "";
  if (isDateObj(value)) return isoToLocal(value).replace(" ", "T");
  let s = String(value).trim().replace("T", " ");
  const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
  if (!m) return "";
  const p = (n) => (n.length < 2 ? "0" + n : n);
  return m[1] + "-" + p(m[2]) + "-" + p(m[3]) + "T" +
    p(m[4] || "00") + ":" + p(m[5] || "00") + ":" + p(m[6] || "00");
}

/** datetime-local 值 → front-matter 常用格式 */
export function fromInputDate(value, withTime = true) {
  if (!value) return "";
  const s = String(value);
  if (!withTime) return s.slice(0, 10);
  const m = s.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return s;
  return m[1] + " " + m[2] + ":" + m[3] + ":" + (m[4] || "00");
}

export function nowLocal() {
  return isoToLocal(new Date());
}

/** 从 markdown 正文提取纯文本摘要 */
export function extractExcerpt(body, limit = 110) {
  let text = String(body || "");
  text = text
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[#>*`~\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > limit ? text.slice(0, limit) + "..." : text;
}
