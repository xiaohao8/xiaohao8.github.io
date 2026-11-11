/* github.js — GitHub REST API 封装（Qexo 同款模式：Token 直连仓库） */

const API = "https://api.github.com";
const RATE_SAFE = 30; // 剩余请求数低于该值时提示
const GET_CACHE_TTL = 30 * 1000; // 会话内 GET 结果缓存 30 秒：切页不再重复拉取同一份配置

/* 图片预览源配置（Gitee 主力，本站兜底）——app.js 启动时注入，设置页可实时切换 */
export const mediaConfig = {
  type: "gitee", // gitee | site | custom
  giteeOwner: "xiaohao3",
  giteeRepo: "xiaohao8.github.io",
  giteeBranch: "main",
  siteUrl: "",
  customPrefix: "",
};

export function setMediaConfig(src) {
  if (!src) return;
  mediaConfig.type = src.type || "gitee";
  mediaConfig.giteeOwner = src.giteeOwner || "xiaohao3";
  mediaConfig.giteeRepo = src.giteeRepo || "xiaohao8.github.io";
  mediaConfig.giteeBranch = src.giteeBranch || "main";
  mediaConfig.siteUrl = String(src.siteUrl || "").replace(/\/+$/, "");
  mediaConfig.customPrefix = String(src.customPrefix || "").replace(/\/+$/, "");
}

function encRepoPath(path) {
  return String(path).replace(/^\/+/, "").split("/").map(encodeURIComponent).join("/");
}

/** 仓库路径 → 站点对外路径：Hexo 把 source/ 下的静态文件输出到站点根 */
function sitePublicPath(path) {
  const p = String(path).replace(/^\/+/, "").replace(/^source\//, "");
  return "/" + p.split("/").map(encodeURIComponent).join("/");
}

/** Gitee 镜像 raw 直链（不受当前预览源影响，供复制链接使用） */
export function mediaGiteeUrl(path) {
  return `https://gitee.com/${mediaConfig.giteeOwner}/${mediaConfig.giteeRepo}/raw/${mediaConfig.giteeBranch}/${encRepoPath(path)}`;
}

/** 仓库路径 → 预览直链（按当前预览源设置） */
export function mediaPreviewUrl(path) {
  const enc = encRepoPath(path);
  if (mediaConfig.type === "custom" && mediaConfig.customPrefix) {
    return mediaConfig.customPrefix + "/" + enc;
  }
  if (mediaConfig.type === "gitee") return mediaGiteeUrl(path);
  // site：后台可能与站点不同域，有站点地址时用绝对地址，否则退回同源相对路径
  const rel = sitePublicPath(path);
  return mediaConfig.siteUrl ? mediaConfig.siteUrl + rel : rel;
}

/** 候选兜底链：当前源 → Gitee → 本站相对 → 本站绝对 → 自定义前缀（自动去重） */
export function mediaFallbackUrls(path) {
  const list = [];
  const push = (u) => { if (u && !list.includes(u)) list.push(u); };
  const enc = encRepoPath(path);
  const rel = sitePublicPath(path);
  push(mediaPreviewUrl(path));
  push(mediaGiteeUrl(path));
  push(rel);
  if (mediaConfig.siteUrl) push(mediaConfig.siteUrl + rel);
  if (mediaConfig.customPrefix) push(mediaConfig.customPrefix + "/" + enc);
  return list;
}

export class GitHubError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export class GitHubAPI {
  constructor(token, settings) {
    this.token = token;
    this.owner = settings.owner;
    this.repo = settings.repo;
    this.branch = settings.branch || "main";
    this.siteUrl = (settings.siteUrl || "").replace(/\/$/, "");
    this.mode = "github";
    // 仅缓存 GET（展示用）；写操作、写前重读一律绕过，避免覆盖仓库最新改动
    this._getCache = new Map();
  }

  get repoPath() { return this.owner + "/" + this.repo; }

  async req(path, { method = "GET", body, raw = false, fresh = false } = {}) {
    const isGet = method === "GET";
    const cacheKey = (raw ? "raw|" : "json|") + path;
    if (isGet && !fresh) {
      const hit = this._getCache.get(cacheKey);
      if (hit && Date.now() - hit.ts < GET_CACHE_TTL) return hit.value;
    }
    const headers = {
      Accept: raw ? "application/vnd.github.raw+json" : "application/vnd.github+json",
      Authorization: "Bearer " + this.token,
      "X-GitHub-Api-Version": "2022-11-28",
    };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    // 同一个 contents URL 会被 raw（纯文本）与 json（含 sha 的元数据）两种 Accept
    // 连续请求：写操作先 readFile(fresh) 拿原文、再 GET 元数据取 sha。GitHub 虽返回
    // Vary: Accept，但部分浏览器缓存 / 国内代理不严格按 Vary 区分，会把上一次的
    // YAML 原文回给需要 JSON 的请求，触发 "Unexpected token ... is not valid JSON"
    // （v4.1.1 删除友链失败的根因）。两层隔离：raw 请求换一个 URL，且所有请求
    // 一律不走 HTTP 缓存（会话内 30 秒 GET 缓存已足够，不会再增加回源次数）。
    const url = API + path + (raw && isGet
      ? (path.includes("?") ? "&" : "?") + "raw=1"
      : "");
    const res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
    const remain = res.headers.get("x-ratelimit-remaining");
    if (remain && Number(remain) < RATE_SAFE) {
      console.warn("[qexo] GitHub API 剩余请求：", remain);
    }
    if (!res.ok) {
      let msg = "GitHub API 错误 " + res.status;
      try {
        const text = await res.text();
        let j = null;
        try { j = text ? JSON.parse(text) : null; } catch (_) { /* 错误体是 HTML/纯文本 */ }
        if (j && j.message) msg = j.message + " (" + res.status + ")";
        else if (text) msg += "：" + text.slice(0, 80).replace(/\s+/g, " ").trim();
      } catch (_) { /* ignore */ }
      const err = new GitHubError(msg, res.status);
      // 限流也会返回 403，不能当成 Token 失效
      if ((res.status === 403 || res.status === 429) &&
          (remain === "0" || /rate limit/i.test(msg))) {
        err.rateLimited = true;
        const retry = res.headers.get("retry-after");
        err.retryAfter = retry ? Number(retry) : null;
      }
      throw err;
    }
    let value = null;
    if (res.status !== 204) {
      const text = await res.text();
      if (raw) {
        value = text;
      } else {
        // 先取文本再解析：任何「响应不是 JSON」的情况都转成可读错误，
        // 不要把浏览器原生的 "Unexpected token ..." 直接抛给用户。
        try {
          value = text ? JSON.parse(text) : null;
        } catch (_) {
          const ctype = res.headers.get("content-type") || "未知类型";
          const snippet = text.slice(0, 60).replace(/\s+/g, " ").trim();
          throw new GitHubError(
            `GitHub API 返回内容不是 JSON（HTTP ${res.status}，${ctype}）："${snippet}…"；` +
            "通常是缓存/代理把上一次的文件原文回给了元数据请求，请硬刷新后台后重试",
            res.status
          );
        }
      }
    }
    if (!isGet) this._getCache.clear();               // 写后立刻失效全部展示缓存
    else if (!fresh) this._getCache.set(cacheKey, { ts: Date.now(), value });
    return value;
  }

  /** 登录校验：Token 有效 + 对仓库有 push 权限 */
  async validate() {
    const user = await this.req("/user");
    let repo;
    try {
      repo = await this.req("/repos/" + this.repoPath);
    } catch (e) {
      if (e.status === 404) {
        throw new GitHubError("找不到仓库 " + this.repoPath + "，请检查设置或 Token 授权范围", 404);
      }
      throw e;
    }
    if (!repo.permissions || !repo.permissions.push) {
      throw new GitHubError("当前 Token 没有 " + this.repoPath + " 的写权限，请重新生成", 403);
    }
    return {
      login: user.login,
      name: user.name || user.login,
      avatar: user.avatar_url,
      repoUrl: repo.html_url,
      private: repo.private,
    };
  }

  /* ---------- contents ---------- */

  async listDir(path) {
    const items = await this.req(
      "/repos/" + this.repoPath + "/contents/" + encodePath(path) + "?ref=" + encodeURIComponent(this.branch)
    );
    return Array.isArray(items) ? items : [];
  }

  /** fresh=true 用于「写前重读」：绕过展示缓存，确保拿到仓库最新版本 */
  async readFile(path, { fresh = false } = {}) {
    return this.req(
      "/repos/" + this.repoPath + "/contents/" + encodePath(path) + "?ref=" + encodeURIComponent(this.branch),
      { raw: true, fresh }
    );
  }

  async writeFile(path, contentText, message) {
    let sha = null;
    try {
      const cur = await this.req(
        "/repos/" + this.repoPath + "/contents/" + encodePath(path) + "?ref=" + encodeURIComponent(this.branch),
        { fresh: true }
      );
      if (cur && cur.sha) sha = cur.sha;
    } catch (e) {
      if (e.status !== 404) throw e;
    }
    const body = {
      message,
      content: btoaUtf8(contentText),
      branch: this.branch,
    };
    if (sha) body.sha = sha;
    await this.req("/repos/" + this.repoPath + "/contents/" + encodePath(path), {
      method: "PUT",
      body,
    });
    return { created: !sha };
  }

  async deleteFile(path, message) {
    const cur = await this.req(
      "/repos/" + this.repoPath + "/contents/" + encodePath(path) + "?ref=" + encodeURIComponent(this.branch),
      { fresh: true }
    );
    await this.req("/repos/" + this.repoPath + "/contents/" + encodePath(path), {
      method: "DELETE",
      body: { message, sha: cur.sha, branch: this.branch },
    });
  }

  async uploadFile(path, blobOrFile, message) {
    const buf = await blobOrFile.arrayBuffer();
    const content = bytesToB64(new Uint8Array(buf));
    let sha = null;
    try {
      const cur = await this.req(
        "/repos/" + this.repoPath + "/contents/" + encodePath(path) + "?ref=" + encodeURIComponent(this.branch),
        { fresh: true }
      );
      if (cur && cur.sha) sha = cur.sha;
    } catch (e) {
      if (e.status !== 404) throw e;
    }
    const body = { message, content, branch: this.branch };
    if (sha) body.sha = sha;
    await this.req("/repos/" + this.repoPath + "/contents/" + encodePath(path), {
      method: "PUT",
      body,
    });
  }

  /* ---------- issues（友链自助申请） ---------- */

  async listOpenIssues(perPage = 30) {
    return this.req(
      '/repos/' + this.repoPath + '/issues?state=open&per_page=' + perPage
    );
  }

  async updateIssue(number, patch) {
    return this.req(
      '/repos/' + this.repoPath + '/issues/' + number,
      { method: 'PATCH', body: patch }
    );
  }

  async createIssueComment(number, body) {
    return this.req(
      '/repos/' + this.repoPath + '/issues/' + number + '/comments',
      { method: 'POST', body: { body } }
    );
  }

  /* ---------- git tree ---------- */

  async tree(ref) {
    const data = await this.req(
      "/repos/" + this.repoPath + "/git/trees/" + encodeURIComponent(ref || this.branch) + "?recursive=1"
    );
    return data.tree || [];
  }

  /* ---------- 便捷方法 ---------- */

  mediaUrl(path) {
    return mediaPreviewUrl(path);
  }

  async listPosts() {
    const items = await this.listDir("source/_posts");
    return items
      .filter((it) => it.type === "file" && /\.(md|markdown)$/i.test(it.name))
      .map((it) => ({
        name: it.name,
        path: it.path,
        size: it.size,
        sha: it.sha,
        url: it.html_url,
      }));
  }

  async readPost(path) {
    const text = await this.readFile(path);
    const { splitFrontMatter } = await import("./yaml.js?v=4.1.3");
    return splitFrontMatter(text);
  }
}

function encodePath(p) {
  return String(p)
    .split("/")
    .map(encodeURIComponent)
    .join("/");
}

function btoaUtf8(str) {
  return bytesToB64(new TextEncoder().encode(str));
}

/** 分块转 base64，避免 spread 大数组抛 RangeError（长文/大图） */
function bytesToB64(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
