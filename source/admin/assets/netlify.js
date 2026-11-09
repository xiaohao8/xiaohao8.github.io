/* netlify.js — Netlify API 封装（部署状态/历史 + Build Hook 触发） */

const NL_API = "https://api.netlify.com/api/v1";

const STATE_MAP = {
  ready: { label: "已发布", cls: "badge-success" },
  current: { label: "当前版本", cls: "badge-success" },
  building: { label: "构建中", cls: "badge-info" },
  processing: { label: "处理中", cls: "badge-info" },
  enqueued: { label: "排队中", cls: "badge-neutral" },
  error: { label: "失败", cls: "badge-danger" },
  cancelled: { label: "已取消", cls: "badge-neutral" },
};

export function deployState(state) {
  return STATE_MAP[state] || { label: state || "未知", cls: "badge-neutral" };
}

export class NetlifyAPI {
  constructor(settings) {
    const nl = settings.netlify || {};
    this.siteId = nl.siteId || "";
    this.token = nl.token || "";
    this.buildHook = nl.buildHook || "";
    this.mode = "netlify";
  }

  get configured() {
    return Boolean(this.siteId && this.token) || Boolean(this.buildHook);
  }

  /** 是否配置了查看部署历史的凭据 */
  get canReadDeploys() {
    return Boolean(this.siteId && this.token);
  }

  async deploys(limit = 8) {
    const res = await fetch(
      `${NL_API}/sites/${encodeURIComponent(this.siteId)}/deploys?per_page=${limit}`,
      {
        headers: { Authorization: "Bearer " + this.token },
      }
    );
    if (!res.ok) {
      let msg = "Netlify API 错误 " + res.status;
      try {
        const j = await res.json();
        if (j && j.message) msg = j.message;
      } catch (_) { /* ignore */ }
      throw new Error(msg);
    }
    const list = await res.json();
    return list.map((d) => ({
      id: d.id,
      state: d.state,
      title: d.title || d.name || "部署",
      context: (d.context || "").replace(/^\w/, (c) => c.toUpperCase()),
      commitMsg: d.commit_subject || d.title || "",
      createdAt: d.created_at,
      publishTime: d.published_at,
      url: d.admin_url,
    }));
  }

  /** 触发 Build Hook（跨域简单请求，不需要 Token） */
  async triggerBuild() {
    if (!this.buildHook) throw new Error("未配置 Netlify Build Hook URL");
    const res = await fetch(this.buildHook, { method: "POST" });
    if (!res.ok) throw new Error("Build Hook 触发失败：" + res.status);
    return true;
  }
}
