/* 仅测试用：把 "@netlify/blobs" 解析到本目录的内存实现。
   Node 22 的 module.register() 会加载本文件并接管解析。 */

export async function resolve(specifier, context, next) {
  if (specifier === "@netlify/blobs") {
    return {
      url: new URL("./blobs-mock.mjs", import.meta.url).href,
      shortCircuit: true,
    };
  }
  return next(specifier, context);
}
