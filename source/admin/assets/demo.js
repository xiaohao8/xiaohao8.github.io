/* demo.js — 演示模式：本地内存模拟仓库数据，不连任何远端 */

const POST_TEMPLATES = [
  {
    name: "hello-world.md",
    fm: {
      title: "你好，世界",
      date: "2026-01-01 12:00:00",
      updated: "2026-02-14 09:30:00",
      tags: ["随笔"],
      categories: ["日常"],
      sticky: 1,
      comments: true,
      abbrlink: "a1b2c3d4",
      excerpt: "新的开始，新的博客，新的世界。",
    },
    body:
      "欢迎来到我的博客！\n\n这是第一篇文章，使用 **Qexo 风格后台** 编写。\n\n## 为什么重写后台\n\n- 更顺手的 Markdown 编辑器\n- 说说、友链、图库一站式管理\n- 保存即自动部署到 Netlify\n\n> 逆光而来，配得上这世间所有的好。\n",
  },
  {
    name: "hexo-fluid-guide.md",
    fm: {
      title: "Hexo + Fluid 主题折腾记录",
      date: "2026-03-02 21:14:33",
      updated: "2026-03-10 11:02:10",
      tags: ["Hexo", "Fluid", "建站"],
      categories: ["技术"],
      comments: true,
      abbrlink: "b2c3d4e5",
    },
    body:
      "记录一次完整的 Hexo 博客搭建过程。\n\n## 环境准备\n\n```bash\nnpm install hexo-cli -g\nhexo init blog && cd blog\nnpm install\n```\n\n## Fluid 配置要点\n\n1. 毛玻璃导航栏\n2. 自定义 slogan\n3. 友链页面数据化\n\n| 项目 | 说明 |\n| --- | --- |\n| 主题 | Fluid |\n| 部署 | Netlify |\n",
  },
  {
    name: "weekly-2026w14.md",
    fm: {
      title: "第 14 周周报：春日阅读计划",
      date: "2026-03-30 08:20:00",
      updated: "2026-03-30 08:20:00",
      tags: ["周报"],
      comments: true,
      index_img: "/images/uploads/demo-cover.svg",
    },
    body:
      "本周完成：\n\n- [x] 读完《置身事内》前六章\n- [x] 跑步 20 公里\n- [ ] 整理书桌\n\n下周继续加油。\n",
  },
  {
    name: "netlify-notes.md",
    fm: {
      title: "Netlify 部署踩坑笔记",
      date: "2026-04-12 15:41:07",
      updated: "2026-04-12 15:41:07",
      tags: ["Netlify", "建站"],
      categories: ["技术"],
      comments: true,
      abbrlink: "c3d4e5f6",
    },
    body:
      "把部署从 GitHub Pages 迁到 Netlify 之后的一些记录。\n\n## Build Hook 的妙用\n\n`POST` 一下就能触发全站构建，配合后台一键部署非常方便。\n\n## 缓存策略\n\n对 `/admin/assets/*` 设置一年缓存 + 版本号参数。\n",
  },
  {
    name: "night-thoughts.md",
    fm: {
      title: "深夜随想：慢一点也没关系",
      date: "2026-04-20 23:58:12",
      updated: "2026-04-20 23:58:12",
      tags: ["随笔"],
      comments: true,
      password: "",
    },
    body:
      "夜深了，窗外的车流声像潮水。\n\n其实慢一点也没关系，只要方向是对的。\n",
  },
  {
    name: "qexo-admin.md",
    fm: {
      title: "给我的博客装上 Qexo 风格后台",
      date: "2026-05-01 10:05:00",
      updated: "2026-05-06 19:22:45",
      tags: ["Hexo", "Qexo"],
      categories: ["技术"],
      sticky: 2,
      comments: true,
      abbrlink: "d4e5f6a7",
    },
    body:
      "参考 [Qexo](https://github.com/Qexo/Qexo) 的交互重写了一版纯静态后台：\n\n1. GitHub Token 直连仓库\n2. Vditor 编辑器\n3. 说说 / 友链 / 图库全都有\n4. Netlify 部署状态实时可见\n",
  },
];

const TALKS_INITIAL = `items:
  - date: "2026-05-02 22:31:00"
    content: "今晚的风很舒服，下楼跑了五公里 🏃"
    images: []
  - date: "2026-05-05 09:12:00"
    content: "新后台上线了！以后说说直接在这里发。"
    images: []
`;

const FLUID_INITIAL = `navbar:
  blog_title: 醉里博客
  ground_glass:
    enable: true
  menu:
    - { key: "home", link: "/", icon: "iconfont icon-home-fill" }
    - { key: "archive", link: "/archives/", icon: "iconfont icon-archive-fill" }
    - { key: "about", link: "/about/", icon: "iconfont icon-user-fill" }
index:
  banner_img: https://i.imgtg.com/2023/05/05/CJFsq.jpg
  banner_img_height: 100
  slogan:
    text: " You are back it with all the good things in the world. 你逆光而来，配得上这世间所有的好。"
post:
  banner_img: https://imgapi.xl0408.top/index.php
  banner_img_height: 70
links:
  title: 友情链接
  subtitle: "欢迎交换友链"
  items:
    - title: "Qexo 官方博客"
      intro: "Hexo 一站式后台"
      link: "https://www.oplog.cn/qexo"
      avatar: "https://avatars.githubusercontent.com/u/60140794"
    - title: "Fluid 主题"
      intro: "Material 风格 Hexo 主题"
      link: "https://hexo.fluid-dev.com"
      avatar: ""
    - title: "示例站点"
      intro: "演示模式的第三个友链"
      link: "https://example.com"
      avatar: ""
`;

const SITE_META_INITIAL = `title: 醉里博客
subtitle: 醉里博客——小豪的个人博客
description: 醉里博客——小豪的个人博客
keywords: 醉里博客,hexo美化,fluid主题,个人博客
author: 小豪
language: zh-CN
`;

function demoImage(name) {
  const hue = [...name].reduce((s, c) => (s + c.charCodeAt(0)) % 360, 120);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="300"><rect width="480" height="300" fill="hsl(${hue},64%,72%)"/><circle cx="392" cy="72" r="38" fill="rgba(255,255,255,.65)"/><path d="M0 240 L120 150 L210 220 L320 120 L480 260 L480 300 L0 300 Z" fill="rgba(255,255,255,.5)"/><text x="24" y="52" font-family="sans-serif" font-size="22" fill="rgba(255,255,255,.9)">${name}</text></svg>`;
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}

export class DemoAPI {
  constructor(settings) {
    this.settings = settings;
    this.mode = "demo";
    this.repo = new Map();
    for (const p of POST_TEMPLATES) {
      this.repo.set("source/_posts/" + p.name, {
        text: this.fmText(p.fm) + p.body,
        size: p.body.length + 380,
      });
    }
    this.repo.set("source/_data/talks.yml", { text: TALKS_INITIAL, size: 300 });
    this.repo.set("source/_data/fluid_config.yml", { text: FLUID_INITIAL, size: 1500 });
    this.repo.set("source/_data/site_meta.yml", { text: SITE_META_INITIAL, size: 260 });
    for (const img of ["demo-cover.svg", "demo-mount.svg", "demo-sea.svg", "demo-night.svg"]) {
      this.repo.set("source/images/uploads/" + img, { text: demoImage(img), size: 24000 });
    }
    for (const page of ["source/about/index.md", "source/friends.md", "source/talks.md", "source/pyq/index.md", "source/todolist.md"]) {
      this.repo.set(page, {
        text: `---\ntitle: ${page.split("/").pop().replace(".md", "")}\nlayout: page\n---\n\n页面内容（演示数据）。\n`,
        size: 120,
      });
    }
    this._sha = 1;
  }

  fmText(fm) {
    const lines = ["---"];
    for (const [k, v] of Object.entries(fm)) lines.push(`${k}: ${JSON.stringify(v)}`);
    lines.push("---", "");
    return lines.join("\n");
  }

  async validate() {
    return { login: "demo", name: "演示用户", avatar: "", repoUrl: "#", private: false };
  }

  async listDir(path) {
    const prefix = path.replace(/\/$/, "") + "/";
    const out = [];
    for (const [p, v] of this.repo) {
      if (p.startsWith(prefix) && !p.slice(prefix.length).includes("/")) {
        out.push({
          name: p.slice(prefix.length),
          path: p,
          size: v.size || String(v.text || "").length,
          sha: "demo" + this._sha++,
          type: "file",
          html_url: "#",
        });
      }
    }
    return out;
  }

  async readFile(path) {
    const item = this.repo.get(path);
    if (!item) throw new Error("演示模式：文件不存在 " + path);
    return item.text;
  }

  async _write(path, text, size) {
    this.repo.set(path, { text, size: size || text.length });
    return { created: true };
  }

  async writeFile(path, text, message) {
    const created = !this.repo.has(path);
    await this._write(path, text);
    return { created, demo: true };
  }

  async deleteFile(path) {
    this.repo.delete(path);
  }

  async uploadFile(path, blob) {
    const text = blob.type && blob.type.startsWith("image/") && blob.size < 200000
      ? await blobToDataUri(blob)
      : demoImage(path.split("/").pop());
    await this._write(path, text, blob.size);
  }

  async tree() {
    const out = [];
    for (const p of this.repo.keys()) {
      out.push({ path: p, type: "blob", mode: "100644", sha: "demo" + this._sha++ });
    }
    return out;
  }

  mediaUrl(path) {
    const name = path.split("/").pop();
    const item = this.repo.get(path);
    if (item && item.text && item.text.startsWith("data:image")) return item.text;
    if (name.endsWith(".svg")) return demoImage(name);
    return "/" + path.replace(/^\/+/, "");
  }

  async listPosts() {
    const items = await this.listDir("source/_posts");
    return items.filter((it) => /\.md$/.test(it.name));
  }

  async readPost(path) {
    const text = await this.readFile(path);
    const { splitFrontMatter } = await import("./yaml.js?v=4.1.8");
    return splitFrontMatter(text);
  }

  /* 演示用的部署记录 */
  deployFixtures() {
    const now = Date.now();
    return [
      { state: "ready", title: "Update by Qexo", context: "Production", createdAt: new Date(now - 1000 * 60 * 12).toISOString(), url: "#" },
      { state: "building", title: "Save Post by Qexo", context: "Production", createdAt: new Date(now - 1000 * 60 * 47).toISOString(), url: "#" },
      { state: "ready", title: "Add friend link", context: "Production", createdAt: new Date(now - 1000 * 3600 * 5).toISOString(), url: "#" },
      { state: "error", title: "chore: fix typo", context: "Production", createdAt: new Date(now - 1000 * 86400).toISOString(), url: "#" },
    ];
  }
}

function blobToDataUri(blob) {
  return new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.readAsDataURL(blob);
  });
}
