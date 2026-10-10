// 台架：把「文档在抄一个已经不存在的数」逐类塞回代码，证明文档闸会红，且红在**它点名的那一条**上。
//
// 为什么不是"整体 rc 非 0 就算逼到"：一条断言被别的断言顺带咬红，说明不了它自己会红。
// 所以每把刀都要求在日志里出现它点名的那条 FAIL 标签（按标签前缀逐行匹配），否则记为「未逼红」。
//
// 三条硬规矩（都是被咬过之后加的）：
//   * 复原只用内存里读回的原始字节 writeFileSync，绝不借 git 命令；写完逐字节回读比对，
//     对不上立刻停——半把刀留在树里，后面每一条读数都是假的。
//   * needle 必须在目标文件里恰好命中 count 次。命中 0 次说明文档/代码的形状已经漂了，
//     这时静默"补一句"会把台账写成小说；命中多次说明我在改一个不唯一的东西。两种都判 ERROR。
//   * 刀跑之前先跑对照：干净树上的 doctest 与 engine-test 都必须绿。否则"红了"说明不了是刀咬的。
//
// 台账里的 rc 与咬到的标签是从子进程读回来的真实读数，跑完自钉回 README 那张表（幂等：
// 钉对之后干净重跑不再改写）。钉法本身在 tools/pin.mjs，由 doctest 的 D19 拿合成文本现测——
// 因为"写文档的那只手"上一版做的是全局替换，把台账里那句**历史**读数也改成了本轮的数。
// 用法：node tools/sabotage.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { pinReadme } from './pin.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DOC = { cmd: 'node', args: ['tools/doctest.mjs'], timeout: 180000 };
const ENG = { cmd: 'node', args: ['tools/engine-test.mjs'], timeout: 900000 };

const K = (id, file, from, to, breaks, note, count = 1) => ({ id, group: 'doc', file, from, to, breaks, note, count });
const KNIVES = [
  K('K1', 'js/engine/tiers.js', 'work: { med: 125573, p95: 1801534 }', 'work: { med: 1, p95: 1801534 }',
    'D1 7x7', '改代码那半：tiers.js 的读数漂了，文档还写着旧的'),
  K('K2', 'README.md', '| 7×7 进阶 | `7x7` | 7×7 | 125573 | 1801534 | 16000 ms |',
    '| 7×7 进阶 | `7x7` | 7×7 | 125573 | 1801535 | 16000 ms |', 'D1 7x7', '改文案那半：同一个等式的另一头'),
  K('K3', 'README.md', '| `N0_有边即在环` | 有一条线连进这格，这格就在环上。 |\n', '',
    'D3a', '删掉规则表一行（先数条数，再逐条比）'),
  K('K4', 'README.md', '| `N9_环序平衡` | 月亮区与太阳区沿环交替，数量各占一半；',
    '| `N9_环序平衡` | 月亮区和太阳区沿环交替，数量各占一半；', 'D3 N9_环序平衡', '规则句子改一个字'),
  { id: 'K5', group: 'doc', file: 'js/engine/pencil.js', count: 2,
    from: `'N9_环序平衡')) changed = true;`, to: `'RENAMED_N9')) changed = true;`,
    breaks: 'D3b', note: '清单里留着名字、正文里的实现改名＝装饰规则' },
  K('K6', 'README.md', '| `symbol` | 区域的符号 | 环进哪个区域，', '| `symbol` | 区域的符号 | 环进哪一个区域，',
    'D2 symbol', '条款文案改一个字'),
  K('K7', 'js/engine/rules.js', "'alternation', 'empty'];", "'alternation', 'empty', 'open'];",
    'D2a', '代码变 9 条而文档与面板都还是 8 行'),
  K('K8', 'README.md', '闸的形状：腿 7 条', '闸的形状：腿 8 条', 'D6', '分母从 LEGS 现算，手抄就漂'),
  K('K9', 'tools/verify.sh', 'LEGS=${LEGS:-core play win mouse touch keys save}',
    'LEGS=${LEGS:-core play win mouse touch keys save foo}', 'D6e', '加一条没有 scenario 的腿'),
  K('K10', 'README.md', '端口：本地 5276 · CDP 9363', '端口：本地 5277 · CDP 9363', 'D7 verify.sh HTTP', '文档端口漂了'),
  K('K11', 'package.json', '"dev": "node server.cjs 5276"', '"dev": "node server.cjs 5277"',
    'D7 package.json dev', '打的是接线本身：五个来源必须逐源点名'),
  K('K12', 'README.md', '节点预算是 2000000', '节点预算是 1000000', 'D4 文档写的穷举', 'CAP_WORK 抄错一半'),
  K('K13', 'README.md', '唯一性计数节点中位 1,101,971', '唯一性计数节点中位 1,101,972',
    'D5 8x8', '页面那句是 eliminatedLine() 拼的，文档得逐字跟上'),
  K('K14', '.github/workflows/ci.yml', 'SAMPLES: "15"', 'SAMPLES: "16"', 'D10 CI 的 SAMPLES', 'CI 值 == 文档引用值 == 默认值'),
  K('K15', 'README.md', '每形态 332 条 · 合计 664 条', '每形态 331 条 · 合计 664 条', 'D8 文档列的逐报告条数', '逐报告条数加起来必须等于它自己写的每形态数'),
  K('K16', 'tools/scenarios.js', "sym: [['.', 'M', '.', 'S', 'S'],", "sym: [['.', 'M', '.', 'S', 'M'],",
    'D11 拷贝逐字段等于', '浏览器腿那份官方例题拷贝挪一格'),
  K('K17', 'README.md', '| `node tools/doctest.mjs` | check | `Docs are asserted surface` |\n', '',
    'D12b ci.yml', '反向：runner 里跑的门禁必须都被列出来'),
  K('K18', 'README.md', '（`js/engine/rules.js:170` 的 `CAP_WORK`）', '（`js/engine/rules.js:9999` 的 `CAP_WORK`）',
    'D13 每一条', '行号引用越界'),
  K('K19', 'README.md', 'wiring: 24 files, 123 named imports', 'wiring: 24 files, 122 named imports',
    'D17 文档抄的 wiring 汇总', 'wiring 那一行是现跑一遍比对的，抄错一个数就红'),
  K('K21', 'README.md', '_tmp-moonsun-sab-r1.log', '_tmp-moonsun-sab-old.log',
    'D19g 真 README', '把历史那句的轮次日志名改掉：它就不再是"某一轮的读数"，而是一处漂在文档里的旧数'),
  // 这两把改的是 tools/ci.sh 自己，而 `npm run ci` 正在边读边执行它：所以 from/to 必须**同字节数、
  // 同行数**——长度一动，bash 没读到的那半截就从中间错位开始解析，那种红（或绿）都跟闸门无关。
  K('K22', 'tools/ci.sh', 'run sabotage node tools/sabotage.mjs', 'run sabotage node tools/sabotage.bak',
    'D20a', '本地入口少跑台账那一步：ci.yml 有的门，本地绿着跳过（同长度换后缀，不动字节数）'),
  K('K23', 'tools/ci.sh', 'echo "${name}_RC=$step_rc" >>"$LOG"', 'echo "${name}_RX=$step_rc" >>"$LOG"',
    'D20b', '每步的 rc 不再按步落进日志：借 tail 当整闸 rc 的形状（同样只改一个字母）'),
  { id: 'K20', group: 'eng', file: 'README.md', count: 1,
    from: '`5 轮 · 45 次用规`', to: '`5 轮 · 46 次用规`',
    breaks: 'A9', note: '文档抄的引擎读数漂一个数字：A9 现跑引擎比对文档' },
  { id: 'E1', group: 'eng', file: 'js/engine/pencil.js', count: 1,
    from: `  N2_两越定边: '一个区域已经穿够两条边界，它剩下的边界就都不许再穿。',\n`, to: '',
    breaks: 'A0', note: '名单与句子必须同集合——RULE_ORDER 手写了才测得出这一刀' },
  { id: 'E2', group: 'eng', file: 'js/engine/rules.js', count: 1,
    from: `  cross: '每个区域恰好被环穿过两次（穿过边界线，不是走进去）。',\n`, to: '',
    breaks: 'A3', note: '报得出 note(\'cross\') 的必须有句子' },
  { id: 'N1', group: 'doc', file: 'README.md', count: 1, expect: 'green',
    from: '- **冲突回显**：', to: '- （这一句只用来证明台账不咬无关的话：它不承载任何数。）\n- **冲突回显**：',
    breaks: '', note: '对照组：插一句纯散文，闸必须照绿' },
];

const failHard = (msg) => { console.log(`  **ERROR** ${msg}`); process.exit(2); };

const specOf = (k) => (k.group === 'eng' ? ENG : DOC);
const hit = (out, token) => out.split('\n').some((l) => {
  const m = l.match(/^\s+(?:\*\*FAIL\*\*|FAIL)\s+(.*)$/);
  return !!m && m[1].startsWith(token);
});
const firstFail = (out) => (out.split('\n').find((l) => /^\s+(?:\*\*FAIL\*\*|FAIL)\s+/.test(l)) || '').trim();

const run = (spec) => {
  const r = spawnSync(spec.cmd, spec.args, { cwd: ROOT, encoding: 'utf8', timeout: spec.timeout, maxBuffer: 64 * 1024 * 1024 });
  if (r.error) failHard(`跑不动 ${spec.args.join(' ')}：${r.error.message}`);
  return { rc: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
};

// SAB_NEEDLES=1：只数 needle，不跑闸。改文档/改代码之后想先确认刀还打得住，就用这个。
if (process.env.SAB_NEEDLES) {
  let bad = 0;
  for (const k of KNIVES) {
    const n = readFileSync(join(ROOT, k.file), 'utf8').split(k.from).length - 1;
    if (n !== k.count) { bad++; console.log(`  **ERROR** ${k.id} 在 ${k.file} 里命中 ${n} 次（要求 ${k.count}）`); }
  }
  console.log(`needle: ${KNIVES.length} 把 · 对不上 ${bad} 把`);
  process.exit(bad ? 1 : 0);
}

// ── 对照：干净树上两套闸都必须绿 ─────────────────────────────────────────────
console.log('对照（干净树）');
const ctrl = { doc: run(DOC), eng: run(ENG) };
for (const [name, r] of Object.entries(ctrl)) {
  const line = (r.out.split('\n').find((l) => /^rows: \d+ fail: \d+$/.test(l))
    || r.out.split('\n').find((l) => /engine-test: \d+ 条通过/.test(l)) || '').trim();
  console.log(`  ${r.rc === 0 ? 'ok  ' : '**RED**'} 对照 ${name}：rc=${r.rc} · ${line || '(没有汇总行)'}`);
  if (r.rc !== 0) failHard(`干净树上的 ${name} 闸就是红的——这时候"刀咬红了"说明不了任何事`);
}

// ── 逐把刀 ───────────────────────────────────────────────────────────────────
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
// 开工前把每份要动的文件抄一份 pristine：中途异常（比如我自己的正则崩了）也要按它回写，
// 而不是按"上一次读到的内容"——那可能已经是某把刀留下的残骸。
const pristine = new Map([...new Set(KNIVES.map((k) => k.file))].map((f) => [f, read(f)]));
const results = [];
try {
  for (const k of KNIVES) {
    const path = join(ROOT, k.file);
    const original = read(k.file);
    const n = original.split(k.from).length - 1;
    if (n !== k.count) { results.push({ ...k, error: `needle 命中 ${n} 次（要求 ${k.count}）` }); continue; }
    writeFileSync(path, original.split(k.from).join(k.to));
    const r = run(specOf(k));
    writeFileSync(path, original);
    if (read(k.file) !== original) { results.push({ ...k, error: '复原后字节不一致' }); failHard(`${k.id}：复原失败，树是脏的，停`); }
    const expectRed = k.expect !== 'green';
    const named = expectRed ? hit(r.out, k.breaks) : false;
    const verdict = expectRed ? (r.rc !== 0 && named ? `红 \`${k.breaks}\`` : r.rc !== 0 ? `红在别处(${firstFail(r.out).slice(0, 26)}…)` : '未红')
      : (r.rc === 0 ? '不红' : `不该红却红了(${firstFail(r.out).slice(0, 26)}…)`);
    const okv = expectRed ? (r.rc !== 0 && named) : r.rc === 0;
    results.push({ ...k, rc: r.rc, verdict, ok: okv });
    console.log(`  ${okv ? 'ok  ' : '**RED**'} ${k.id} ${k.note} · rc=${r.rc} · ${verdict}`);
  }
} finally {
  // 任何异常都不能把刀留在树里：逐份回写 pristine 字节并回读校验。
  for (const [f, bytes] of pristine) {
    if (read(f) === bytes) continue;
    writeFileSync(join(ROOT, f), bytes);
    console.log(`  兜底复原 ${f}`);
    if (read(f) !== bytes) failHard(`${f} 复原后仍不一致——工作区是脏的，别信后面任何读数`);
  }
}

const red = results.filter((r) => r.ok).length;
const bad = results.filter((r) => !r.ok || r.error).length;
console.log(`\n逼红 ${red} · 未逼红 ${bad}（刀 ${KNIVES.length} 把，含对照组）`);
for (const r of results) if (!r.ok || r.error) console.log(`  未逼红：${r.id}${r.error ? ' · ' + r.error : ` · ${r.verdict}`}`);

// ── 自钉回 README 的台账（写法在 tools/pin.mjs，那里由 doctest 的 D19 现测）──────
const RM = 'README.md';
const rm = read(RM);
const summary = `逼红 ${red} · 未逼红 ${bad}`;
const { text: pinned, nailed, fail: pinFail } = pinReadme(rm, results, summary);
if (pinFail.length) {
  for (const f of pinFail) console.log(`  **RED** ${f}`);
  process.exit(1);
}
if (pinned !== rm) {
  writeFileSync(join(ROOT, RM), pinned);
  console.log(`  已把真实读数钉回 README（台账 ${results.length} 行的"实跑"那一格 + ${nailed} 处逼红合计）`);
} else {
  console.log('  README 台账已经等于本轮读数（幂等：没有改写）');
}
process.exit(bad ? 1 : 0);
