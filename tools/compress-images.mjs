/* 图片库存压缩：JPEG 重构(mozjpeg q80, ≤1800w) / PNG 调色板化(q90)。
   仅当结果比原文件小才替换；输出对比清单。 */
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const DIR = path.join("source", "images", "uploads");
const MIN_BYTES = 150 * 1024;   // 只处理 >150KB
const MAX_W = 1800;             // 内容列 ~900px，2x retina 足够

async function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...await walk(p));
    else out.push(p);
  }
  return out;
}

const files = (await walk(DIR)).filter((f) => {
  const ext = path.extname(f).toLowerCase();
  return [".jpg", ".jpeg", ".png"].includes(ext) && fs.statSync(f).size > MIN_BYTES;
});

console.log("待处理:", files.length, "张\n");
let before = 0, after = 0, saved = 0, replaced = 0;

for (const f of files) {
  const ext = path.extname(f).toLowerCase();
  const orig = fs.statSync(f).size;
  before += orig;
  try {
    const tmpIn = path.join(process.cwd(), "tmp-in-" + path.basename(f));
    fs.copyFileSync(f, tmpIn);
    let buf;
    if (ext === ".png") {
      buf = await sharp(tmpIn)
        .resize({ width: MAX_W, withoutEnlargement: true })
        .png({ palette: true, quality: 90, compressionLevel: 9, effort: 8 })
        .toBuffer();
    } else {
      buf = await sharp(tmpIn)
        .resize({ width: MAX_W, withoutEnlargement: true })
        .jpeg({ quality: 80, progressive: true, mozjpeg: true })
        .toBuffer();
    }
    fs.rmSync(tmpIn, { force: true });
    if (buf.length < orig * 0.95 && buf.length > 10000) { // 至少省 5% 且非损坏
      fs.writeFileSync(f, buf);
      after += buf.length;
      saved += orig - buf.length;
      replaced++;
      console.log("✓", path.basename(f).slice(0, 44), (orig / 1024 | 0) + "KB →", (buf.length / 1024 | 0) + "KB");
    } else {
      after += orig;
      console.log("－", path.basename(f).slice(0, 44), "保持原样 (" + (orig / 1024 | 0) + "KB, 压缩收益不足)");
    }
  } catch (e) {
    after += orig;
    console.log("✗", path.basename(f), e.message);
  }
}
console.log(`\n处理 ${files.length} 张，替换 ${replaced} 张；${(before / 1048576).toFixed(1)}MB → ${(after / 1048576).toFixed(1)}MB，节省 ${(saved / 1048576).toFixed(1)}MB`);
