/* ============================================================
   统计聚合：读取仓库 analytics/events-*.ndjson → 生成
   analytics/stats.json（仓库存档）与 source/analytics/stats.json
   （部署产物，前台统计页与页脚读取）。
   由 GitHub Actions 定时（每 6h）与手动触发；有变化才提交。
   仅用 Node 内置模块，无第三方依赖。
   ============================================================ */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const EVENTS_DIR = path.join(ROOT, "analytics");
const SRC_OUT = path.join(ROOT, "source", "analytics");
const REPO_OUT = path.join(ROOT, "analytics", "stats.json");

const listFiles = () => {
  if (!fs.existsSync(EVENTS_DIR)) return [];
  return fs
    .readdirSync(EVENTS_DIR)
    .filter((f) => /^events-\d{4}-\d{2}\.ndjson$/.test(f))
    .sort()
    .map((f) => path.join(EVENTS_DIR, f));
};

const days = new Map(); // date -> {pv, uvs:Set}
const pages = new Map(); // path -> pv
const refs = new Map(); // source -> pv
const visitors = new Set();
let totalPV = 0;

for (const f of listFiles()) {
  const lines = fs.readFileSync(f, "utf8").split("\n").filter(Boolean);
  for (const line of lines) {
    let ev;
    try { ev = JSON.parse(line); } catch (_) { continue; }
    if (!ev || !ev.p) continue;
    const day = ev.t ? new Date(ev.t * 1000).toISOString().slice(0, 10) : "unknown";
    const d = days.get(day) || { pv: 0, uvs: new Set() };
    d.pv += 1;
    if (ev.v) d.uvs.add(ev.v);
    days.set(day, d);
    pages.set(ev.p, (pages.get(ev.p) || 0) + 1);
    const src = ev.r || "直接访问";
    refs.set(src, (refs.get(src) || 0) + 1);
    if (ev.v) visitors.add(ev.v);
    totalPV += 1;
  }
}

const dayList = [...days.entries()]
  .sort((a, b) => a[0].localeCompare(b[0]))
  .map(([date, d]) => ({ date, pv: d.pv, uv: d.uvs.size }));

const stats = {
  version: 1,
  updated: new Date().toISOString(),
  totals: { pv: totalPV, uv: visitors.size, days: dayList.length },
  days: dayList,
  pages: [...pages.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)
    .map(([path, pv]) => ({ path, pv })),
  referrers: [...refs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
    .map(([source, pv]) => ({ source, pv })),
};

fs.mkdirSync(path.dirname(REPO_OUT), { recursive: true });
fs.mkdirSync(SRC_OUT, { recursive: true });
fs.writeFileSync(REPO_OUT, JSON.stringify(stats, null, 2) + "\n");
fs.writeFileSync(path.join(SRC_OUT, "stats.json"), JSON.stringify(stats) + "\n");

console.log(
  `聚合完成：${dayList.length} 天 / PV ${totalPV} / UV ${visitors.size} / ` +
  `${pages.size} 个页面 / ${refs.size} 个来源`
);
