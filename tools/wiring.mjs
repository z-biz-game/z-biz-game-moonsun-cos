// 接线检查：每一个 import 的名字必须在目标模块里真的 export 出来。
// node --check 只看语法，浏览器加载才看得到「imported binding not found」——而门禁的
// 第一条腿之前就崩在一句 typo 上。这条脚本把那种事故挪到 node 里，几毫秒，不用起 Chrome。
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('_tmp')) continue;
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith('.js') || p.endsWith('.cjs') || p.endsWith('.mjs')) files.push(p);
  }
})(ROOT);

function exportsOf(src) {
  const out = new Set();
  for (const m of src.matchAll(/^export\s+(?:async\s+)?(?:function|class)\s+([A-Za-z0-9_$]+)/gm)) out.add(m[1]);
  // 一行多个声明子句也要收到：`export const UP = 0, RIGHT = 1, ...` 只抓第一个名字的话，
  // 后面每一个 import 都会被误报成接线断了。括号内的逗号不算分隔。
  for (const m of src.matchAll(/^export\s+(?:const|let|var)\s+([^\n]+)/gm)) {
    let depth = 0, part = '';
    const parts = [];
    for (const ch of m[1]) {
      if ('([{<'.includes(ch)) depth++;
      if (')]}>'.includes(ch)) depth--;
      if (ch === ',' && depth === 0) { parts.push(part); part = ''; continue; }
      part += ch;
    }
    parts.push(part);
    for (const q of parts) {
      const id = q.trim().match(/^([A-Za-z0-9_$]+)/);
      if (id) out.add(id[1]);
    }
  }
  for (const m of src.matchAll(/^export\s*\{([^}]*)\}/gm)) {
    for (const part of m[1].split(',')) {
      const t = part.trim();
      if (!t) continue;
      out.add(t.includes(' as ') ? t.split(/\s+as\s+/)[1].trim() : t);
    }
  }
  for (const m of src.matchAll(/^export\s+default\b/gm)) out.add('default');
  return out;
}

const cache = new Map();
const exp = (p) => {
  if (!cache.has(p)) cache.set(p, exportsOf(readFileSync(p, 'utf8')));
  return cache.get(p);
};

let bad = 0, checked = 0;
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  for (const m of src.matchAll(/import\s*(?:\{([^}]*)\}|([A-Za-z0-9_$]+))?\s*from\s*['"]([^'"]+)['"]/g)) {
    const spec = m[3];
    if (!spec.startsWith('.')) continue;
    const target = path.resolve(path.dirname(f), spec);
    if (!statSync(target, { throwIfNoEntry: false })) {
      console.log(`MISSING FILE  ${path.relative(ROOT, f)} -> ${spec}`);
      bad++;
      continue;
    }
    if (!m[1]) continue;
    const names = m[1].split(',').map((x) => x.trim()).filter(Boolean).map((x) => x.split(/\s+as\s+/)[0].trim());
    const have = exp(target);
    for (const n of names) {
      checked++;
      if (!have.has(n)) {
        console.log(`MISSING EXPORT  ${path.relative(ROOT, f)} imports { ${n} } from ${spec}`);
        bad++;
      }
    }
  }
}
console.log(`wiring: ${files.length} files, ${checked} named imports, ${bad} broken`);
process.exit(bad ? 1 : 0);
