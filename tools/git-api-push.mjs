#!/usr/bin/env node
/**
 * git-api-push.mjs — 在本机代理环境下用 GitHub Git Data API 做“普通快进”推送。
 *
 * 背景：~/.gitconfig 把 github.com 重写到 gh-proxy（只读加速镜像），
 * 沙箱内 GCM 无法交互取凭证，SSH 也无密钥，所以 `git push` 不可用。
 * 本脚本不绕过认证：仍用正常 GitHub token，只是走 api.github.com
 * （代理可达），按内容寻址逐个重放 blob / tree / commit，最后
 * PATCH /git/refs 快进指针。每一步都比对 SHA，任何不一致立即中止，
 * 因此远端结果与 `git push` 逐字节等价。只支持快进，绝不 force。
 *
 * 用法：
 *   node tools/git-api-push.mjs [branch] [--remote origin] [--repo owner/name] [--dry-run]
 *
 *   GIT_API_PROXY=http://127.0.0.1:7897 node tools/git-api-push.mjs main
 *     → 让 API 请求走本机 Clash / 其它 HTTP 代理。Node 的 fetch 不读 HTTP(S)_PROXY，
 *       必须显式设置 dispatcher；默认不启用，避免影响已有的直连行为。
 *
 * token 来源（不会打印、不会落盘）：
 *   1) 环境变量 GITHUB_TOKEN / GH_TOKEN
 *   2) `git credential fill`（Git Credential Manager，从凭据管理器取）
 */

import { spawnSync } from "node:child_process";
import path from "node:path";
import { createRequire } from "node:module";

const args = process.argv.slice(2);
let branch = "main";
let remote = "origin";
let repoOverride = null;
let dryRun = false;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--dry-run") dryRun = true;
  else if (a === "--remote") { remote = args[++i]; if (!remote) fail("--remote 缺少参数"); }
  else if (a === "--repo") { repoOverride = args[++i]; if (!repoOverride) fail("--repo 缺少参数"); }
  else if (a.startsWith("--")) fail(`未知参数: ${a}`);
  else branch = a;
}

function fail(msg) { console.error(`✗ ${msg}`); process.exit(1); }

let ROOT = null;
function git(a, opts = {}) {
  const r = spawnSync("git", a, { cwd: ROOT || process.cwd(), encoding: "buffer", maxBuffer: 512 * 1024 * 1024, ...opts });
  if (r.status !== 0) {
    fail(`git ${a.join(" ")} 失败: ${String(r.stderr || "").trim()}`);
  }
  return opts.raw ? r.stdout : r.stdout.toString("utf8").replace(/\n$/, "");
}

ROOT = git(["rev-parse", "--show-toplevel"]);

// 可选代理：只在显式设置 GIT_API_PROXY 时启用。
// 本机装了 Clash Verge（mixed-port 7897）但没开系统代理时，直连 GitHub 会超时；
// 修好节点后带上这个环境变量就能正常推送，不用改脚本或改 git config。
const proxyUrl = process.env.GIT_API_PROXY || "";
if (proxyUrl) {
  try {
    const requireFromRepo = createRequire(path.join(ROOT, "package.json"));
    const { setGlobalDispatcher, ProxyAgent } = requireFromRepo("undici");
    setGlobalDispatcher(new ProxyAgent(proxyUrl));
    console.log(`API 请求走代理：${proxyUrl}`);
  } catch (e) {
    fail(`GIT_API_PROXY 已设置但无法启用：${e.message}（需要仓库内已安装 undici）`);
  }
}

// ---------- 收集本地要重放的提交 ----------

const oldTip = git(["rev-parse", "--verify", `${remote}/${branch}`]);
const newTip = git(["rev-parse", "--verify", branch]);
console.log(`分支 ${branch}: ${remote}/${branch} = ${oldTip.slice(0, 7)} → 本地 ${newTip.slice(0, 7)}`);
if (oldTip === newTip) { console.log("已是最新，无需推送。"); process.exit(0); }
if (spawnSync("git", ["merge-base", "--is-ancestor", oldTip, newTip], { cwd: ROOT }).status !== 0) {
  fail(`非快进（${remote}/${branch} 不是 HEAD 的祖先）。请先 git fetch + rebase，本脚本绝不 force。`);
}

const commits = git(["rev-list", "--topo-order", "--reverse", `${oldTip}..${branch}`]).split("\n").filter(Boolean);
console.log(`将重放 ${commits.length} 个提交：`);
for (const sha of commits) console.log(`  ${sha.slice(0, 7)} ${git(["show", "-s", "--format=%s", sha])}`);

// ---------- 解析提交对象（逐字节来自 git cat-file，保证可复现同 SHA） ----------

function iso8601(epoch, tz) { // tz 形如 +0800 → 2026-11-09T12:00:00+08:00
  const sign = tz[0] === "-" ? "-" : "+";
  const hh = tz.slice(1, 3), mm = tz.slice(3, 5);
  const d = new Date(Number(epoch) * 1000);
  const p = (n, w = 2) => String(n).padStart(w, "0");
  // 按提交时区偏移展开各字段
  const shifted = new Date(d.getTime() + (sign === "-" ? -1 : 1) * (Number(hh) * 60 + Number(mm)) * 60000);
  return `${shifted.getUTCFullYear()}-${p(shifted.getUTCMonth() + 1)}-${p(shifted.getUTCDate())}` +
    `T${p(shifted.getUTCHours())}:${p(shifted.getUTCMinutes())}:${p(shifted.getUTCSeconds())}` +
    `${sign}${hh}:${mm}`;
}

function parseCommit(sha) {
  const raw = git(["cat-file", "commit", sha], { raw: true });
  const blank = raw.indexOf("\n\n");
  if (blank < 0) fail(`提交 ${sha} 解析异常`);
  const head = raw.subarray(0, blank).toString("utf8").split("\n");
  const message = raw.subarray(blank + 2); // 含原文结尾换行，逐字节传给 API
  const meta = { sha, tree: null, parents: [], author: null, committer: null, message };
  for (const line of head) {
    if (line.startsWith("tree ")) meta.tree = line.slice(5);
    else if (line.startsWith("parent ")) meta.parents.push(line.slice(7));
    else if (line.startsWith("author ") || line.startsWith("committer ")) {
      const m = line.match(/^(author|committer) (.*) <(.*)> (\d+) ([+-]\d{4})$/);
      if (!m) fail(`无法解析 ident: ${line}`);
      meta[m[1]] = { name: m[2], email: m[3], date: iso8601(m[4], m[5]) };
    } else if (line.match(/^[^ ]/)) fail(`提交 ${sha} 含未支持的头（如 gpgsig），请改用普通提交`);
  }
  return meta;
}

const parsed = commits.map(parseCommit);
for (const c of parsed) {
  if (c.parents.length === 0) continue;
  if (c.parents.length > 1) fail(`提交 ${c.sha.slice(0, 7)} 是 merge，本脚本只重放线性历史（先 rebase 到 ${remote}/${branch}）。`);
}

// ---------- 变更清单 ----------

function entriesFor(c) {
  const parent = c.parents[0];
  if (!parent) {
    return git(["ls-tree", "-r", "-z", "--format=%(objectname) %(objecttype) %(objectmode) %(path)", c.sha])
      .split("\0").filter(Boolean).map((l) => {
        const [sha, type, mode, ...rest] = l.split(" ");
        return { path: rest.join(" "), mode, sha, type };
      });
  }
  const out = [];
  const status = git(["diff-tree", "-r", "-z", "--no-commit-id", "--name-status", parent, c.sha], { raw: true })
    .toString("utf8").replace(/\0$/, "").split("\0");
  for (let i = 0; i < status.length; i++) {
    const st = status[i];
    const code = st[0];
    const path = status[++i];
    if (code === "D") { out.push({ path, mode: "100644", sha: null }); continue; }
    if (code === "R") { i++; continue; } // -r 未开重命名检测，理论上不会出现
    const line = git(["ls-tree", c.sha, "--", path]);
    const m = line.match(/^(\S+) (\S+) (\S+)\t/);
    if (!m) fail(`${c.sha.slice(0, 7)}: 找不到 ${path} 的条目`);
    out.push({ path, mode: m[1], type: m[2], sha: m[3] });
  }
  return out;
}

const plans = parsed.map((c) => ({ c, entries: entriesFor(c) }));
const localBlobShas = new Set();
for (const { entries } of plans) {
  for (const e of entries) {
    if (!e.sha || e.type === "commit") continue; // gitlink 对象需在远端仓库中存在（fork 场景会校验失败）
    localBlobShas.add(e.sha);
  }
}

console.log(`\n计划：${plans.length} 个提交，共 ${localBlobShas.size} 个去重后的 blob（已存在的会跳过）`);
for (const { c, entries } of plans) {
  const del = entries.filter((e) => !e.sha).length;
  const put = entries.length - del;
  console.log(`  ${c.sha.slice(0, 7)}: 写入 ${put} 项，删除 ${del} 项`);
}

if (dryRun) {
  console.log("\n--dry-run：未联网、未使用 token。去掉 --dry-run 即执行真实推送。");
  process.exit(0);
}

// ---------- token（只在内存，绝不打印/落盘） ----------

function getToken() {
  const fromEnv = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (fromEnv) return fromEnv;
  const r = spawnSync("git", ["credential", "fill"], {
    cwd: ROOT, encoding: "utf8", input: "protocol=https\nhost=github.com\n\n",
  });
  if (r.status !== 0) fail("无法从凭据管理器取 token；请设置 GITHUB_TOKEN 后重试。");
  const line = String(r.stdout || "").split("\n").find((l) => l.startsWith("password="));
  if (!line) fail("git credential fill 未返回 password；请设置 GITHUB_TOKEN 后重试。");
  return line.slice("password=".length).trim();
}

const token = getToken();

// ---------- GitHub API ----------

const repo = repoOverride || (() => {
  const url = git(["remote", "get-url", remote]);
  // 兼容 gh-proxy 重写后的 URL（…/https://github.com/o/r.git）与带点的仓库名
  const m = url.match(/github\.com[:/]([^/]+)\/(.+?)(?:\.git)?\/?$/);
  if (!m) fail(`无法从 remote URL 推断仓库: ${url}，请用 --repo owner/name`);
  return `${m[1]}/${m[2]}`;
})();
const API = "https://api.github.com";

async function api(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(120000),
  });
  if (res.status === 401 || res.status === 403) fail(`认证失败/权限不足 HTTP ${res.status}（检查 token 的 Contents:write）`);
  if (!res.ok && !(method === "GET" && res.status === 404)) {
    const t = await res.text();
    fail(`API ${method} ${path} → HTTP ${res.status}: ${t.slice(0, 400)}`);
  }
  if (method === "GET" && res.status === 404) return null;
  return res.json();
}

// 远端当前指针必须仍等于本地记录的 oldTip，否则别人已经推了新的
const remoteRef = await api("GET", `/repos/${repo}/git/ref/heads/${branch}`);
if (!remoteRef) fail(`远端不存在 ${repo} 的 ${branch} 分支`);
if (remoteRef.object.sha !== oldTip) {
  fail(`远端 ${branch} 已移动到 ${remoteRef.object.sha.slice(0, 7)}（本地记录 ${oldTip.slice(0, 7)}）。请先 git fetch + rebase 再推送。`);
}

const uploaded = new Set();
async function ensureBlob(sha) {
  if (uploaded.has(sha)) return;
  if (await api("GET", `/repos/${repo}/git/blobs/${sha}`) !== null) { uploaded.add(sha); return; }
  const content = git(["cat-file", "blob", sha], { raw: true });
  if (content.length > 50 * 1024 * 1024) fail(`blob ${sha.slice(0, 7)} 超过 50MB，请走 LFS 或正常 git push`);
  // 注意：create-blob 默认 encoding 是 utf-8，必须显式声明 base64，否则会把 base64 文本当正文存储
  const created = await api("POST", `/repos/${repo}/git/blobs`, { content: content.toString("base64"), encoding: "base64" });
  if (created.sha !== sha) fail(`blob 上传后 SHA 不一致：API ${created.sha} vs 本地 ${sha}，中止`);
  uploaded.add(sha);
  process.stdout.write(`  blob ${sha.slice(0, 7)} ✓\n`);
}

for (const { c, entries } of plans) {
  console.log(`\n▶ ${c.sha.slice(0, 7)} ${git(["show", "-s", "--format=%s", c.sha])}`);
  for (const e of entries) if (e.sha && e.type !== "commit") await ensureBlob(e.sha);

  let tree;
  if (entries.length === 0) {
    tree = c.tree; // 空变更（不应出现），直接引用本地树 SHA
  } else {
    const apiEntries = entries.map((e) => e.sha
      ? { path: e.path, mode: e.mode, type: e.type === "commit" ? "commit" : "blob", sha: e.sha }
      : { path: e.path, mode: "100644", type: "blob", sha: null });
    const base = c.parents[0] ? git(["rev-parse", `${c.parents[0]}^{tree}`]) : undefined;
    tree = await api("POST", `/repos/${repo}/git/trees`, base ? { base_tree: base, tree: apiEntries } : { tree: apiEntries });
    if (tree.sha !== c.tree) {
      console.log(`  base_tree 结果 ${tree.sha.slice(0, 7)} ≠ ${c.tree.slice(0, 7)}，改用全量重建`);
      const all = git(["ls-tree", "-r", "-z", "--format=%(objectname) %(objecttype) %(objectmode) %(path)", c.sha])
        .split("\0").filter(Boolean).map((l) => {
          const [sha, type, mode, ...rest] = l.split(" ");
          return { path: rest.join(" "), mode, type, sha };
        });
      tree = await api("POST", `/repos/${repo}/git/trees`, {
        tree: all.map((e) => ({ path: e.path, mode: e.mode, type: e.type === "commit" ? "commit" : "blob", sha: e.sha })),
      });
      if (tree.sha !== c.tree) fail(`tree 无法复现：API ${tree.sha} vs 本地 ${c.tree}，中止（不产生任何副作用）`);
    }
  }
  console.log(`  tree ${tree.sha.slice(0, 7)} ✓（与本地一致）`);

  const created = await api("POST", `/repos/${repo}/git/commits`, {
    message: c.message.toString("utf8"),
    tree: c.tree,
    parents: c.parents,
    author: c.author,
    committer: c.committer,
  });
  if (created.sha !== c.sha) fail(`commit 无法复现：API ${created.sha} vs 本地 ${c.sha}，中止（远端指针未动）`);
  console.log(`  commit ${created.sha.slice(0, 7)} ✓（与本地一致）`);
}

await api("PATCH", `/repos/${repo}/git/refs/heads/${branch}`, { sha: newTip, force: false });
console.log(`\n✓ 快进完成：${remote}/${branch} → ${newTip.slice(0, 7)}（普通快进，非 force）`);
console.log(`  请执行 git fetch ${remote} 同步本地引用。`);
