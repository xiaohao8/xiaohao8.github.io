/* upload.js — 图片上传共享逻辑：命名净化 / 进度提示 / 逐文件错误处理 */

import { loading, toast, previewSrcsFor } from "./app.js?v=4.4.4";

/** 图片文件名净化：保留中文/字母/数字，其余转 - */
function safeImageName(name) {
  const ext = (name.match(/\.[a-z0-9]+$/i) || [""])[0];
  const base = name.slice(0, name.length - ext.length)
    .replace(/[^\w\u4e00-\u9fa5-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "image";
  return base + ext.toLowerCase();
}

/** 上传一张图片到仓库 uploads 目录，返回仓库路径与对外路径/预览候选链 */
export async function uploadImage(ctx, fileObj) {
  const name = safeImageName(fileObj.name || "image.png");
  const finalName = Date.now() + "-" + name;
  const path = "source/images/uploads/" + finalName;
  await ctx.api.uploadFile(path, fileObj, `Upload Image ${finalName} by Qexo`);
  return {
    name,
    path,
    publicPath: "/images/uploads/" + finalName,
    size: fileObj.size,
    fallback: previewSrcsFor(ctx, path),
  };
}

/** 串行上传队列：统一进度与错误提示，返回 { ok, failed } */
export async function runUploadQueue(fileList, uploadOne) {
  const files = Array.from(fileList || []).filter((f) => f.type && f.type.startsWith("image/"));
  if (!files.length) {
    toast("只支持图片文件", "error");
    return { ok: [], failed: 0 };
  }
  loading.show(`上传图片 0/${files.length}…`);
  const ok = [];
  let failed = 0;
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    loading.show(`上传图片 ${i + 1}/${files.length}：${f.name}`);
    try {
      ok.push(await uploadOne(f));
    } catch (e) {
      failed++;
      toast("图片上传失败：" + (e.message || f.name), "error");
    }
  }
  loading.hide();
  return { ok, failed };
}