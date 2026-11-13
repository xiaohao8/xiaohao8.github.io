/* 仅测试用：内存版 Netlify Blobs。
   通过 tools/sim/blobs-hook.mjs 把 "@netlify/blobs" 重定向到这里，
   让 fcircle-tick 的核心逻辑能在本机跑完整流程（不联网、不碰真实存储）。 */

const memory = new Map();

export function _dump() {
  const out = {};
  for (const [k, v] of memory) out[k] = v;
  return out;
}
export function _reset() {
  memory.clear();
}
export function _bytes() {
  let n = 0;
  for (const [k, v] of memory) n += k.length + JSON.stringify(v).length;
  return n;
}
export function _writes() {
  return writes;
}
let writes = 0;
let writtenKeys = [];
export function _writtenKeys() {
  return writtenKeys.slice();
}
export function _resetWrites() {
  writes = 0;
  writtenKeys = [];
}

export function getStore() {
  return {
    async get(key, opts) {
      if (!memory.has(key)) return null;
      const v = memory.get(key);
      if (opts && opts.type === "json") return JSON.parse(JSON.stringify(v));
      return typeof v === "string" ? v : JSON.stringify(v);
    },
    async setJSON(key, value, opts) {
      if (opts && opts.onlyIfNew && memory.has(key)) return { modified: false };
      memory.set(key, JSON.parse(JSON.stringify(value)));
      writes += 1;
      writtenKeys.push(key);
      return { modified: true };
    },
    async set(key, value) {
      memory.set(key, value);
      writes += 1;
      writtenKeys.push(key);
      return { modified: true };
    },
    async delete(key) {
      memory.delete(key);
      return { modified: true };
    },
  };
}
