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

// 注释与字符串里的词不算使用：board.js 的注释里有「UP/DOWN」这种写法，把它当引用就会
// 误报成接线断了，而误报的闸会被当成噪音绕过去。
const strip = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^[ \t]*\/\/[^\n]*/gm, ' ')
    .replace(/`[\s\S]*?`/g, ' ')
    .replace(/'(?:\\.|[^'\\\n])*'/g, "''")
    .replace(/"(?:\\.|[^"\\\n])*"/g, '""');

// 反向那一半：用到了别处 export 出来的名字，却既没 import 也没在本地声明。这就是
// js/render/board.js 里那句 `ReferenceError: UP is not defined`——语法过得去、模块加载也
// 过得去，只有画到「盘外那一条边」时才崩，而在 headless 里崩只留下一行 console。
// 上面那半边看不见它，因为这个名字根本没出现在任何一条 import 语句里。
function localNames(src) {
  const out = new Set();
  for (const m of src.matchAll(/import\s*(?:\{([^}]*)\}|([A-Za-z0-9_$]+))?\s*from/g)) {
    if (m[2]) out.add(m[2]);
    if (!m[1]) continue;
    for (const part of m[1].split(',')) {
      const t = part.trim();
      if (!t) continue;
      out.add(t.includes(' as ') ? t.split(/\s+as\s+/)[1].trim() : t);
    }
  }
  // 本地声明：const/let/var/function/class，含解构与默认值里的名字（`const { a, b } =`、
  // `const [x, y] =`），以及箭头函数的单参数形式。漏掉一种就是给自己造一条误报。
  for (const m of src.matchAll(/\b(?:const|let|var)\s+([\s\S]{0,400}?=[\s;,\n])/g)) {
    const head = m[1].slice(0, m[1].lastIndexOf('=') + 1);
    for (const id of head.matchAll(/[A-Za-z0-9_$]+/g)) out.add(id[0]);
  }
  for (const m of src.matchAll(/\b(?:function|class)\s+([A-Za-z0-9_$]+)/g)) out.add(m[1]);
  for (const m of src.matchAll(/\bcatch\s*\(\s*([A-Za-z0-9_$]+)/g)) out.add(m[1]);
  for (const m of src.matchAll(/\bfor\s*\(\s*(?:const|let|var)\s+([A-Za-z0-9_$]+)/g)) out.add(m[1]);
  // 形参也是本地名字。漏一种签名，方法参数就会全被报成"没 import"——那这种闸一天红两次，
  // 第三次就没人看它了。
  for (const m of src.matchAll(/function\s*[A-Za-z0-9_$]*\s*\(([^)]*)\)/g)) collect(out, m[1]);
  for (const m of src.matchAll(/^[ \t]+[A-Za-z0-9_$]+\s*\(([^)]*)\)\s*\{/gm)) collect(out, m[1]);
  for (const m of src.matchAll(/(?:const|let|var)\s+[A-Za-z0-9_$]+\s*=\s*(?:async\s*)?\(([^)]*)\)\s*=>/g)) collect(out, m[1]);
  for (const m of src.matchAll(/(?:^|[=(,:[!&|?{};+*/-]\s*)([A-Za-z0-9_$]+)\s*=>/gm)) out.add(m[1]);
  // 解构与方法名：`const { rows, cols } =`、`{ mask: x }` 的键位、`obj.method` 的属性位
  // 都不是"读一个自由变量"，把它们算进声明就不会漏，也不会有误报（见下面 property 的排除）。
  for (const m of src.matchAll(/[{,]\s*([A-Za-z0-9_$]+)\s*[:,}]/g)) out.add(m[1]);
  return out;
}
function collect(set, list) {
  for (const id of list.matchAll(/[A-Za-z0-9_$]+/g)) set.add(id[0]);
}

let bad = 0, checked = 0, bare = 0;
const vocabulary = new Set();
for (const f of files) for (const n of exp(f)) vocabulary.add(n);

for (const f of files) {
  const src = readFileSync(f, 'utf8');
  const code = strip(src);
  const own = exportsOf(src);
  const declared = localNames(src);
  const importedSpecs = [...src.matchAll(/import\s*(?:\{([^}]*)\}|([A-Za-z0-9_$]+))?\s*from\s*['"]([^'"]+)['"]/g)];
  for (const n of vocabulary) {
    if (own.has(n) || declared.has(n) || n === 'default') continue;
    // 属性位与对象键位都不是"读一个自由变量"：`en.checks(...)` 走的是门面，`{ pop: 1 }` 是键。
    // 不排掉这两处，每一份用门面的代码都会被点成接线断了。
    const re = new RegExp(`(?<![.\\w$])${n.replace(/\$/g, '\\$')}(?![\\w$])(?!\\s*:)`);
    if (!re.test(code)) continue;
    bare++;
    console.log(`MISSING IMPORT  ${path.relative(ROOT, f)} 用到 ${n}，但既没 import 也没本地声明`);
  }
  for (const m of importedSpecs) {
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
bad += bare;
console.log(`wiring: ${files.length} files, ${checked} named imports, ${bare} un-imported uses, ${bad} broken`);
process.exit(bad ? 1 : 0);
