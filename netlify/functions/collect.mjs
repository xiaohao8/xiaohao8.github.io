/* ============================================================
   采集端点：POST /.netlify/functions/collect
   接收前台页面的匿名浏览事件（无 IP / 无 UA 存储），
   追加写入 GitHub 仓库 analytics/events-YYYY-MM.ndjson。
   需要的环境变量（Netlify 后台 → Site configuration → Environment variables）：
     GITHUB_TOKEN  —— Fine-grained Token，本仓库 Contents: Read and write
   可选：GITHUB_REPO（默认 xiaohao8/xiaohao8.github.io）、GITHUB_BRANCH（默认 main）
   ============================================================ */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });

export default async function handler(req) {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "method not allowed" }, 405, CORS);

  const token = process.env.GITHUB_TOKEN;
  if (!token) return json({ ok: false, error: "GITHUB_TOKEN 未配置" }, 500, CORS);
  const repo = process.env.GITHUB_REPO || "xiaohao8/xiaohao8.github.io";
  const branch = process.env.GITHUB_BRANCH || "main";

  // 来源校验：只接受博客自身域名的上报
  const site = (process.env.SITE_URL || "https://202271.xyz").replace(/\/$/, "");
  const origin = req.headers.get("origin") || "";
  if (origin && !origin.startsWith(site)) return json({ ok: false, error: "forbidden" }, 403, CORS);

  let body;
  try { body = await req.json(); } catch (_) { return json({ ok: false, error: "bad json" }, 400, CORS); }

  const p = String(body.p || "/").slice(0, 200);
  if (!p.startsWith("/") || /^\/(admin|\.netlify)/.test(p)) return new Response(null, { status: 204, headers: CORS });
  const vid = String(body.v || "").replace(/[^a-zA-Z0-9-]/g, "").slice(0, 64);
  if (!vid) return new Response(null, { status: 204, headers: CORS }); // 无匿名访客 ID 则丢弃
  const ref = String(body.r || "").slice(0, 100);
  const w = parseInt(body.w, 10) || 0;

  const line = JSON.stringify({ t: Math.floor(Date.now() / 1000), v: vid, p, r: ref, w });
  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  const month = day.slice(0, 7);
  const ghPath = `analytics/events-${month}.ndjson`;
  const api = `https://api.github.com/repos/${repo}/contents/${ghPath}`;
  const ghHeaders = {
    Authorization: "Bearer " + token,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
    "X-GitHub-Api-Version": "2022-11-28",
  };

  try {
    // 追加写入（最多重试 3 次，处理并发 sha 冲突）
    for (let attempt = 0; attempt < 3; attempt++) {
      let sha = null;
      let existing = "";
      const getUrl = `${api}?ref=${encodeURIComponent(branch)}`;
      const getRes = await fetch(getUrl, { headers: ghHeaders });
      if (getRes.ok) {
        const meta = await getRes.json();
        sha = meta.sha;
        existing = Buffer.from(meta.content || "", "base64").toString("utf8");
      } else if (getRes.status !== 404) {
        return json({ ok: false, error: "github get " + getRes.status }, 502, CORS);
      }
      const content = existing ? existing.replace(/\n$/, "") + "\n" + line + "\n" : line + "\n";
      const putRes = await fetch(api, {
        method: "PUT",
        headers: ghHeaders,
        body: JSON.stringify({
          message: "analytics: +" + line.length + "B (" + day + ")",
          content: Buffer.from(content, "utf8").toString("base64"),
          branch,
          ...(sha ? { sha } : {}),
        }),
      });
      if (putRes.ok) return json({ ok: true }, 200, CORS);
      if (putRes.status !== 409 && putRes.status !== 422) {
        const t = await putRes.text();
        return json({ ok: false, error: "github put " + putRes.status + ": " + t.slice(0, 120) }, 502, CORS);
      }
      // sha 冲突 → 重试
    }
    return json({ ok: false, error: "conflict" }, 502, CORS);
  } catch (e) {
    return json({ ok: false, error: String(e && e.message || e).slice(0, 160) }, 502, CORS);
  }
}
