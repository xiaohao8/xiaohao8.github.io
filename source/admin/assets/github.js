/* github.js — GitHub REST API 封装（Qexo 同款模式：Token 直连仓库） */

const API = "https://api.github.com";
const RATE_SAFE = 30; // 剩余请求数低于该值时提示

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
  }

  get repoPath() { return this.owner + "/" + this.repo; }

  async req(path, { method = "GET", body, raw = false } = {}) {
    const headers = {
      Accept: raw ? "application/vnd.github.raw+json" : "application/vnd.github+json",
      Authorization: "Bearer " + this.token,
      "X-GitHub-Api-Version": "2022-11-28",
    };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const res = await fetch(API + path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const remain = res.headers.get("x-ratelimit-remaining");
    if (remain && Number(remain) < RATE_SAFE) {
      console.warn("[qexo] GitHub API 剩余请求：", remain);
    }
    if (!res.ok) {
      let msg = "GitHub API 错误 " + res.status;
      try {
        const j = await res.json();
        if (j && j.message) msg = j.message + " (" + res.status + ")";
      } catch (_) { /* ignore */ }
      throw new GitHubError(msg, res.status);
    }
    if (res.status === 204) return null;
    if (raw) return res.text();
    return res.json();
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
      "/repos/" + this.repoPath + "/contents/" + encodePath(path) + "?ref=" + this.branch
    );
    return Array.isArray(items) ? items : [];
  }

  async readFile(path) {
    return this.req(
      "/repos/" + this.repoPath + "/contents/" + encodePath(path) + "?ref=" + this.branch,
      { raw: true }
    );
  }

  async writeFile(path, contentText, message) {
    let sha = null;
    try {
      const cur = await this.req(
        "/repos/" + this.repoPath + "/contents/" + encodePath(path) + "?ref=" + this.branch
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
      "/repos/" + this.repoPath + "/contents/" + encodePath(path) + "?ref=" + this.branch
    );
    await this.req("/repos/" + this.repoPath + "/contents/" + encodePath(path), {
      method: "DELETE",
      body: { message, sha: cur.sha, branch: this.branch },
    });
  }

  async uploadFile(path, blobOrFile, message) {
    const buf = await blobOrFile.arrayBuffer();
    let binary = "";
    const bytes = new Uint8Array(buf);
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    let sha = null;
    try {
      const cur = await this.req(
        "/repos/" + this.repoPath + "/contents/" + encodePath(path) + "?ref=" + this.branch
      );
      if (cur && cur.sha) sha = cur.sha;
    } catch (e) {
      if (e.status !== 404) throw e;
    }
    const body = { message, content: btoa(binary), branch: this.branch };
    if (sha) body.sha = sha;
    await this.req("/repos/" + this.repoPath + "/contents/" + encodePath(path), {
      method: "PUT",
      body,
    });
  }

  /* ---------- git tree ---------- */

  async tree(ref) {
    const data = await this.req(
      "/repos/" + this.repoPath + "/git/trees/" + (ref || this.branch) + "?recursive=1"
    );
    return data.tree || [];
  }

  /* ---------- 便捷方法 ---------- */

  mediaUrl(path) {
    return "/" + String(path).replace(/^\/+/, "");
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
    const { splitFrontMatter } = await import("./yaml.js");
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
  return btoa(String.fromCharCode(...new TextEncoder().encode(str)));
}
