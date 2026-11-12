/* 月度归档：Actions 触发，将上月统计快照提交到仓库（可选功能） */
import { getStore } from "@netlify/blobs";

export default async function handler(req) {
  const store = getStore({ name: "zui-analytics", consistency: "strong" });
  try {
    const lastMonth = new Date();
    lastMonth.setMonth(lastMonth.getMonth() - 1);
    const key = `raw/${lastMonth.toISOString().slice(0, 7)}.ndjson`;
    const raw = await store.get(key);
    if (!raw) return new Response(JSON.stringify({ ok: true, msg: "no data" }), { headers: { "Content-Type": "application/json" } });
    return new Response(JSON.stringify({ ok: true, key, size: raw.length, events: raw.split("\n").filter(Boolean).length }), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
}
