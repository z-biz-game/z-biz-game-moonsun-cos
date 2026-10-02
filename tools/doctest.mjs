// 文档是被断言的面：README/DESIGN 印出去的每一个「现值」都必须等于代码/脚本里的现在值。
//
// 为什么要有这个文件：引擎断言、bake 进树的读数、balance 的红线都有命令去重测，而散文没有。
// 它可以一直抄下去，直到某天代码改了字、文档还在引用上一个世界的数。本仓文档里有一整类这样
// 的数——三档表、八条文、13 条规则名、两个预算、淘汰句、腿 × 形态 × 报告、端口、逐报告条数、
// 官方例题的两种解数、两家规则原文、CI 到底跑了哪几道门禁、`SAMPLES` 旋钮——每一个都能由一条
// 等式钉住，于是这里钉住它们。
//
// 规矩（和 tools/balance.mjs 的 B5/B6 一样）：
//   * 每一条等式都配一条「解析到的条数」的反空转断言——正则没命中不是绿，是红；
//   * 只比现值，不复测读数：ms、出货率这类本机测量在这里只作为"文档写的数与代码里的界"的
//     关系出现，不在这里重跑；
//   * README 最后一节的破坏试验台账逐条验过这里每类刀真的会红（tools/sabotage.mjs）。
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { TIERS, ELIMINATED, eliminatedLine } from '../js/engine/tiers.js';
import { CAP_WORK, CLAUSE_ORDER, CLAUSE_NAME, CLAUSE_TEXT } from '../js/engine/rules.js';
import { RULE_ORDER, RULE_TEXT } from '../js/engine/pencil.js';
import { DIG_WORK, MAX_ATTEMPTS } from '../js/engine/generate.js';
import { SOURCES, official, officialLoop } from './fixtures.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const fail = [];
let rows = 0;
const ok = (cond, label, detail) => {
  rows++;
  if (!cond) fail.push(label);
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${label} · ${detail}`);
};

const README = read('README.md');
const DESIGN = read('DESIGN.md');
const DOCS = README + '\n' + DESIGN;
const CI = read('.github/workflows/ci.yml');
const BAL = read('tools/balance.mjs');
const ET = read('tools/engine-test.mjs');
const VERIFY = read('tools/verify.sh');
const SCEN = read('tools/scenarios.js');
const FIX = read('tools/fixtures.mjs');
const PKG = JSON.parse(read('package.json'));
const GEN = read('js/engine/generate.js');
const PENCIL = read('js/engine/pencil.js');
const PLAYTEST = read('tools/playtest.cjs');

// 从某个表头那一行往下取连续的数据行。整份文档一起匹配会串味：条款表和 CI 覆盖表
// 都是"反引号开头的三列表格"，只按形状数会数到隔壁那张表上去。
const table = (md, header) => {
  const i = md.indexOf(header);
  if (i < 0) return [];
  const out = [];
  for (const l of md.slice(i + header.length).split('\n').slice(1)) {
    if (!l.startsWith('|')) break;
    const cells = l.split('|').slice(1, -1).map((c) => c.trim());
    if (/^-+$/.test(cells[0].replace(/`/g, '')) || /^:?-{3,}:?$/.test(cells[0])) continue;
    out.push(cells);
  }
  return out;
};

// ── D1 尺寸菜单表：文档那三行 == tiers.js 的现值 ─────────────────────────────
console.log('D1 三档菜单表');
const tierHeader = '| 菜单 | key | 尺寸 | 唯一性节点 med | 唯一性节点 p95 | 出题预算 |';
const tierRows = table(README, tierHeader);
ok(tierRows.length === TIERS.length, 'D1a 文档的三档表解析到的行数等于 TIERS 的档数',
  `解析 ${tierRows.length} 行 vs TIERS ${TIERS.length} 档（解析不到不等于通过）`);
for (const t of TIERS) {
  const r = tierRows.find((x) => (x[1] || '') === `\`${t.key}\``);
  const got = r ? `${r[0]} / ${r[2]} / ${r[3]} / ${r[4]} / ${r[5]}` : '表里没有这一档';
  const want = `${t.label} / ${t.rows}×${t.cols} / ${t.work.med} / ${t.work.p95} / ${t.budgetMs} ms`;
  ok(!!r && got === want, `D1 ${t.key} 文档那行等于 TIERS 现值（${want}）`, got);
}
const stray = tierRows.filter((x) => !TIERS.some((t) => `\`${t.key}\`` === x[1])).map((x) => x[1]);
ok(stray.length === 0, 'D1b 文档表里没有 TIERS 之外的档（多出来的行没人测）',
  stray.length ? `多了：${stray.join(' ')}` : `${tierRows.length} 行逐行都有对应档`);

// ── D2 八条文：文档表逐字 == CLAUSE_ORDER / CLAUSE_NAME / CLAUSE_TEXT ─────────
console.log('D2 八条文表');
const clauseHeader = '| code | 条文 | 违反时页面上那句话（`CLAUSE_TEXT`，逐字） |';
const clauseRows = table(README, clauseHeader);
ok(clauseRows.length === CLAUSE_ORDER.length, `D2a 文档解析到 ${CLAUSE_ORDER.length} 条文（少一条就是解析器空转）`,
  `解析 ${clauseRows.length} 行 vs CLAUSE_ORDER ${CLAUSE_ORDER.length} 条`);
for (let k = 0; k < CLAUSE_ORDER.length; k++) {
  const code = CLAUSE_ORDER[k];
  const r = clauseRows[k];
  const want = `\`${code}\` / ${CLAUSE_NAME[code]} / ${CLAUSE_TEXT[code]}`;
  const got = r ? `${r[0]} / ${r[1]} / ${r[2]}` : '这一行不在';
  ok(!!r && got === want, `D2 ${code} 第 ${k + 1} 行逐字等于代码（名字与句子都读 CLAUSE_*）`, got);
}

// ── D3 13 条命名规则：文档表逐字 == RULE_TEXT，且名字必须在正文里 ─────────────
console.log('D3 命名规则表');
const ruleRows = table(README, '| 规则 | 说的是（逐字） |');
ok(ruleRows.length === RULE_ORDER.length, `D3a 文档解析到 ${RULE_ORDER.length} 条规则（少一条就是解析器空转）`,
  `解析 ${ruleRows.length} 行 vs RULE_ORDER ${RULE_ORDER.length} 条`);
for (let k = 0; k < RULE_ORDER.length; k++) {
  const name = RULE_ORDER[k];
  const r = ruleRows[k];
  const got = r ? `${r[0]} / ${r[1]}` : '这一行不在';
  ok(!!r && got === `\`${name}\` / ${RULE_TEXT[name]}`, `D3 ${name} 第 ${k + 1} 行逐字等于 RULE_TEXT`, got);
}
// 名字必须出现在**非注释行**里：整份文件一起数会被 RULE_TEXT 那行声明凑够次数，
// 于是"每条都真的在正文里被用到"这句标签就在说谎——清单里挂着、正文里没有实现，
// 正是 A5 之外第二种"装饰规则"的形状。
const PENCIL_BODY = PENCIL.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
const ghost = RULE_ORDER.filter((n) => PENCIL_BODY.split(n).length - 1 < 1);
ok(ghost.length === 0, 'D3b 每条规则名都不只活在清单里（剥掉注释的正文里各出现 ≥1 次）',
  ghost.length ? `只有声明没有实现：${ghost.join(' ')}` : `${RULE_ORDER.length} 条名字在正文里各出现 ≥1 次`);

// ── D4 三个预算数：文档写的就是代码里的现在值 ────────────────────────────────
console.log('D4 预算');
const capDoc = (README.match(/节点预算是 (\d+)/) || [])[1];
const digDoc = (README.match(/总花费上限是 (\d+)/) || [])[1];
const attDoc = (README.match(/`MAX_ATTEMPTS = (\d+)`/) || [])[1];
ok(!!capDoc && !!digDoc && !!attDoc, 'D4a 三个预算数都从文档解析到了',
  `文档 CAP ${capDoc} · DIG ${digDoc} · ATTEMPTS ${attDoc}`);
ok(+capDoc === CAP_WORK, `D4 文档写的穷举节点预算等于 CAP_WORK（${CAP_WORK}）`, `文档 ${capDoc}`);
ok(+digDoc === DIG_WORK && DIG_WORK === CAP_WORK * 8, `D4b 文档写的挖线索上限等于 DIG_WORK（${DIG_WORK} = CAP_WORK × 8）`,
  `文档 ${digDoc} · 代码 ${DIG_WORK} · CAP_WORK×8=${CAP_WORK * 8}`);
ok(+attDoc === MAX_ATTEMPTS, `D4c 文档写的顺延上限等于 MAX_ATTEMPTS（${MAX_ATTEMPTS}）`, `文档 ${attDoc}`);
{
  // DIG_WORK 那句"等于 CAP_WORK * 8"必须仍是源码里的事实，不是这里推断出来的。
  const m = GEN.match(/export const DIG_WORK = ([^;]+);/);
  ok(!!m && m[1].replace(/\s+/g, '') === 'CAP_WORK*8', 'D4d generate.js 里 DIG_WORK 的定义仍是 CAP_WORK × 8',
    m ? `源码 ${m[1]}` : '解析不到那一行');
}

// ── D5 淘汰档的理由：页面那句由字段拼出，文档必须逐字抄同一句 ─────────────────
console.log('D5 淘汰档的理由');
const quoted = README.split('\n').filter((l) => /^> \d+×\d+：/.test(l));
ok(quoted.length === ELIMINATED.length, `D5a 文档解析到 ${ELIMINATED.length} 行淘汰理由（形状改了就是没数到）`,
  `解析 ${quoted.length} 行 vs ELIMINATED ${ELIMINATED.length} 档`);
for (const e of ELIMINATED) {
  const line = `> ${eliminatedLine(e)}`;
  ok(quoted.includes(line), `D5 ${e.key} 文档那行逐字等于 eliminatedLine()`, quoted.find((l) => l.startsWith(`> ${e.rows}×${e.cols}`)) || '没有这一行');
}

// ── D6 闸的形状：腿、形态、每形态报告，全部从脚本现值推 ──────────────────────
console.log('D6 闸的形状');
const legsM = VERIFY.match(/LEGS=\$\{LEGS:-([^}]*)\}/);
const legs = legsM ? legsM[1].trim().split(/\s+/) : [];
const bodies = new Map([...VERIFY.matchAll(/^ {4}([a-z]+)\)\s+echo "([^"]*)"/gm)].map((m) => [m[1], m[2].trim().split(/\s+/)]));
const shapesM = VERIFY.match(/SHAPES=\(([^)]*)\)/);
const shapes = shapesM ? (shapesM[1].match(/"[^"]*"/g) || []).length : 0;
// dispatch 块：'@' 打头的那几步各自展开成一份报告，报告名 = 紧随其后的 run_cmd/run_scenario 的第一个参数。
// 从每个 token 自己的 case 标签往下找（`@frag)` 与它的 run_cmd 之间隔着注释，所以不能一路跨过去）。
const dispatch = VERIFY.slice(VERIFY.indexOf('for step in $steps'));
const atTokens = [...new Set(legs.flatMap((l) => (bodies.get(l) || []).filter((s) => s.startsWith('@') && s !== '@witness').map((s) => s.slice(1))))];
const expand = new Map();
for (const token of atTokens) {
  const at = dispatch.indexOf(`@${token})`);
  const m = at < 0 ? null : dispatch.slice(at, at + 400).match(/(?:run_scenario|run_cmd) +(\S+)/);
  if (m) expand.set(token, m[1]);
}
const reportNames = [];
for (const leg of legs) {
  for (const step of (bodies.get(leg) || [])) {
    if (step === '@witness') continue;
    reportNames.push(step.startsWith('@') ? (expand.get(step.slice(1)) || `?${step}`) : step);
  }
}
const perShape = reportNames.length;
const shapeDoc = DOCS.match(/闸的形状：腿 (\d+) 条 · 形态 (\d+) 种 · 每形态 (\d+) 份报告 · 合计 (\d+) 份/);
ok(legs.length >= 5 && bodies.size >= 5 && shapes >= 1 && perShape >= 5 && !!shapeDoc,
  'D6a 脚本与文档两边都解析到了闸的形状',
  `verify.sh ${legs.length} 腿 / ${bodies.size} 个案 / ${shapes} 形态 / ${perShape} 份报告 · 文档句 ${shapeDoc ? '在' : '不在'}`);
const unresolved = atTokens.filter((t) => !expand.has(t));
ok(unresolved.length === 0, 'D6f dispatch 里每个 @步骤都在产出报告名（认不出就数不到份数，不能当它不存在）',
  unresolved.length ? `没展开：${unresolved.join(' ')}` : `${atTokens.length} 个 @步骤都拿到了名字`);
ok(!!shapeDoc && +shapeDoc[1] === legs.length, `D6 文档写的腿数等于 LEGS 默认值（${legs.join(' ')}）`,
  shapeDoc ? `文档 ${shapeDoc[1]} vs 脚本 ${legs.length}` : '解析不到');
const orphan = legs.filter((l) => !bodies.has(l));
ok(orphan.length === 0, 'D6e LEGS 默认值里每个腿名都在 scenarios_for 的表里（认不出的腿名会让脚本当场红）',
  orphan.length ? `表里没有：${orphan.join(' ')}` : '一一对上');
ok(!!shapeDoc && +shapeDoc[2] === shapes, 'D6b 文档写的形态数等于 SHAPES 的条目数',
  shapeDoc ? `文档 ${shapeDoc[2]} vs 脚本 ${shapes}` : '解析不到');
ok(!!shapeDoc && +shapeDoc[3] === perShape, `D6c 文档写的每形态报告数等于 scenarios_for 现场展开的份数（${perShape}）`,
  shapeDoc ? `文档 ${shapeDoc[3]} vs 脚本 ${perShape}` : '解析不到');
ok(!!shapeDoc && +shapeDoc[4] === perShape * shapes, 'D6d 合计份数 == 每形态 × 形态数',
  shapeDoc ? `文档 ${shapeDoc[4]} vs ${perShape}×${shapes}=${perShape * shapes}` : '解析不到');

// ── D7 端口：文档那一句 == 四个来源的现值 ────────────────────────────────────
console.log('D7 端口');
const httpSrc = {
  'verify.sh HTTP': (VERIFY.match(/HTTP=\$\{HTTP_PORT:-(\d+)\}/) || [])[1],
  'package.json dev': (PKG.scripts?.dev || '').match(/server\.cjs\s+(\d+)/)?.[1],
  'playtest.cjs BASE': (PLAYTEST.match(/BASE_URL \|\| 'http:\/\/127\.0\.0\.1:(\d+)/) || [])[1],
  'server.cjs DEFAULT_PORT': (read('server.cjs').match(/const DEFAULT_PORT = (\d+);/) || [])[1],
};
const cdpSrc = {
  'verify.sh CDP': (VERIFY.match(/PORT=\$\{CDP_PORT:-(\d+)\}/) || [])[1],
  'playtest.cjs CDP': (PLAYTEST.match(/CDP_PORT \|\| (\d+)/) || [])[1],
};
const portDoc = DOCS.match(/端口：本地 (\d+) · CDP (\d+)/);
ok(Object.values(httpSrc).every(Boolean) && Object.values(cdpSrc).every(Boolean) && !!portDoc,
  'D7a 六个来源与文档那句都解析到了端口（少一个就说明接线改了形状）',
  `HTTP ${Object.entries(httpSrc).map(([k, v]) => `${k}=${v}`).join(' ')} · CDP ${Object.values(cdpSrc).join('/')} · 文档 ${portDoc?.[1]}/${portDoc?.[2]}`);
for (const [src, v] of Object.entries(httpSrc)) {
  ok(!!portDoc && +v === +portDoc[1], `D7 ${src} 的 HTTP 端口等于文档那句（${portDoc?.[1]}）`, `该源 ${v}`);
}
for (const [src, v] of Object.entries(cdpSrc)) {
  ok(!!portDoc && +v === +portDoc[2], `D7 ${src} 的 CDP 端口等于文档那句（${portDoc?.[2]}）`, `该源 ${v}`);
}

// ── D8 逐报告条数的自洽：加起来必须等于它自己写的两个总数 ────────────────────
console.log('D8 逐报告条数');
const itemRe = new RegExp(`\\b(${reportNames.join('|')}) (\\d+)(?=\\s*/|\\s*，)`, 'g');
const items = [...README.matchAll(itemRe)].map((m) => ({ name: m[1], n: +m[2] }));
const totals = README.match(/每形态 (\d+) 条 · 合计 (\d+) 条/);
ok(items.length === perShape && new Set(items.map((i) => i.name)).size === perShape && !!totals,
  'D8a 逐报告条数与总数都解析到了，且名字集合就是脚本展开的那一份',
  `解析 ${items.length} 项（去重 ${new Set(items.map((i) => i.name)).size}）/ 期望 ${perShape} 份 · 总句 ${totals ? '在' : '不在'}`);
const sum = items.reduce((a, b) => a + b.n, 0);
ok(!!totals && sum === +totals[1], 'D8 文档列的逐报告条数加起来 == 它写的每形态条数',
  totals ? `加起来 ${sum} vs 文档 ${totals[1]}` : '解析不到');
ok(!!totals && sum * shapes === +totals[2], `D8b 每形态条数 × 形态数（${shapes}）== 文档写的合计`,
  totals ? `${sum}×${shapes} vs ${totals[2]}` : '解析不到');

// ── D9 题面歧义的裁决：文档那句 1/3 必须就是 A2 断言的两个字面量 ──────────────
console.log('D9 strict/literal');
const etLit = ET.match(/s\.solutions === (\d+) && l\.solutions === (\d+)/);
const docLit = DOCS.match(/STRICT 数出 (\d+) 解、LITERAL 数出 (\d+) 解/);
ok(!!etLit && !!docLit, 'D9a 引擎闸的字面量与文档那句都读到了',
  `engine-test ${etLit?.[1]}/${etLit?.[2]} · 文档 ${docLit?.[1]}/${docLit?.[2]}`);
ok(!!etLit && !!docLit && etLit[1] === docLit[1] && etLit[2] === docLit[2],
  'D9 文档写的「STRICT 1 解、LITERAL 3 解」等于 A2 断言的那两个字面量（改一边就红）',
  etLit && docLit ? `闸 ${etLit[1]}/${etLit[2]} vs 文档 ${docLit[1]}/${docLit[2]}` : '解析不到');

// ── D10 SAMPLES 旋钮：ci.yml == 文档引用 == 默认值，且 env 真的接得上 ─────────
console.log('D10 SAMPLES 旋钮');
const ciSamples = (CI.match(/SAMPLES: "(\d+)"/) || [])[1];
const docSamples = (README.match(/CI 用 SAMPLES=(\d+) 跑 balance\.mjs/) || [])[1];
const defaultN = (BAL.match(/const N = [^\n]*[:?]\s*(\d+);/) || [])[1];
ok(!!ciSamples && !!docSamples && !!defaultN, 'D10a 三处都读到了样本数',
  `ci.yml ${ciSamples} · 文档 ${docSamples} · 默认 ${defaultN}`);
ok(!!ciSamples && !!docSamples && +ciSamples === +docSamples && +ciSamples === +defaultN,
  'D10 CI 的 SAMPLES == 文档引用的那个值 == 不设 env 时的默认',
  `${ciSamples} / ${docSamples} / ${defaultN}`);
const probe = await new Promise((resolve) => {
  const child = spawn(process.execPath, [join(ROOT, 'tools/balance.mjs')], { env: { ...process.env, SAMPLES: '3', BLESS: '' } });
  let buf = '';
  const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(buf.split('\n')[0] || '(no output)'); }, 20000);
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (d) => {
    buf += d;
    if (/菜单三档 × \d+ 张/.test(buf)) { clearTimeout(timer); child.kill('SIGKILL'); resolve(buf.split('\n')[0]); }
  });
  child.on('close', () => { clearTimeout(timer); resolve(buf.split('\n')[0] || '(exited silently)'); });
});
ok(/× 3 张/.test(probe), 'D10b 子进程探针：SAMPLES=3 必须真的改成 3 张（env 是接上的，不是装饰）',
  `balance 第一行：${probe}`);

// ── D11 官方例题：浏览器腿那份拷贝 == tools/fixtures.mjs ─────────────────────
// 两处各抄一遍就会漂成两个题面，而"两条路在官方例题上会合"这条承诺就没了主语。
// 这里不比较源码文本（两边格式本就不同），比较的是**解析出来的值**。
console.log('D11 官方例题的两份拷贝');
const lit = (SCEN.match(/const OFFICIAL = \{([\s\S]*?)\n {2}\};/) || [])[1];
let copy = null;
try { copy = lit ? new Function(`return ({${lit}})`)() : null; } catch { copy = null; }
ok(!!copy && ['rows', 'cols', 'room', 'sym', 'loop'].every((k) => k in copy),
  'D11a scenarios.js 里那份 OFFICIAL 解析出来了（解析不到＝形状改了，不是通过）',
  copy ? `字段 ${Object.keys(copy).join('/')}` : '没解析到');
if (copy) {
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const bad = [['rows', copy.rows === official.rows], ['cols', copy.cols === official.cols],
    ['room', same(copy.room, official.room)], ['sym', same(copy.sym, official.sym)],
    ['loop', same(copy.loop, officialLoop)]].filter(([, v]) => !v).map(([k]) => k);
  ok(bad.length === 0, 'D11 拷贝逐字段等于 fixtures（题面、区域、符号、那条环）',
    bad.length ? `对不上：${bad.join(' ')}` : 'rows/cols/room/sym/loop 五件全等');
  ok(/export const official = \{/.test(FIX) && /export const officialLoop = \[/.test(FIX),
    'D11b fixtures.mjs 仍然是那份题面的唯一来源（被搬走就没人对账了）', '两处声明都在');
}

// ── D12 CI 覆盖表：文档声称的门禁真在那个 job 里，跑着的门禁都被列了 ──────────
console.log('D12 CI 覆盖表');
const jobBlocks = {};
// 只在 jobs: 那一段里找 job——`on:` 与 `permissions:` 下也是两空格缩进的 key，
// 整份文件一起匹配会把 push/pull_request 当成 job 名。
const jobsSrc = CI.slice(CI.indexOf('\njobs:'));
for (const m of jobsSrc.matchAll(/^ {2}([A-Za-z0-9_-]+):([\s\S]*?)(?=\n {2}[A-Za-z0-9_-]+:|\n(?=\S)|(?![\s\S]))/gm)) jobBlocks[m[1]] = m[2];
const ciRows = table(README, '| 命令 | job | CI 步骤名 |');
ok(Object.keys(jobBlocks).length >= 2 && ciRows.length >= 5,
  'D12a CI 的 job 块与文档的覆盖表都解析到了东西',
  `job ${Object.keys(jobBlocks).join('/')} · 覆盖表 ${ciRows.length} 行`);
for (const r of ciRows) {
  const cmd = r[0].replace(/`/g, '');
  const block = jobBlocks[r[1]] || '';
  ok(block.includes(`- name: ${r[2].replace(/`/g, '')}`) && block.includes(cmd.split(' ').slice(-2).join(' ')),
    `D12 覆盖表那一行真在 ${r[1]} job 里：${cmd}`, block ? `步骤名 ${r[2]}` : `没有 ${r[1]} 这个 job`);
}
const ciTools = [...new Set([...CI.matchAll(/(?:node|bash) (tools\/[\w.-]+)/g)].map((m) => m[1]))];
const unlisted = ciTools.filter((c) => !ciRows.some((r) => r[0].includes(c)));
ok(unlisted.length === 0, 'D12b ci.yml 里跑的每个 tools 门禁都被覆盖表列了（文档不许比门禁松）',
  unlisted.length ? `漏了：${unlisted.join(' ')}` : `runner 里 ${ciTools.join(' ')} 全在表上`);

// ── D13 引用不漂：文档里每一个 path:NN 都指向真实文件里真实存在的行 ───────────
console.log('D13 行号引用');
const cites = [...DOCS.matchAll(/((?:\.github\/workflows\/)?[\w./-]+\.(?:js|mjs|cjs|sh|json|html|yml)):(\d+)(?:-(\d+))?/g)];
const bad = [];
for (const c of cites) {
  let src;
  try { src = read(c[1]); } catch { bad.push(`${c[1]}:${c[2]}（文件不存在）`); continue; }
  const n = src.split('\n').length;
  if (+c[2] > n || (+c[3] && +c[3] > n)) bad.push(`${c[1]}:${c[2]}${c[3] ? '-' + c[3] : ''}（该文件只有 ${n} 行）`);
}
ok(cites.length >= 15, `D13a 文档里的行号引用解析到了 ${cites.length} 条（少于 15 条说明引用格式改了）`, `${cites.length} 条引用`);
ok(bad.length === 0, 'D13 每一条 path:NN 引用都落在真实文件的行数内',
  bad.length ? `越界：${bad.join('，')}` : `${cites.length} 条全部在范围内`);

// ── D14 规则原文：DESIGN 引的那两家逐字文本 == fixtures 的 SOURCES ───────────
console.log('D14 两家规则原文');
ok(SOURCES.length === 2 && SOURCES.every((s) => s.text.length >= 1), 'D14a 夹具里就是两个独立来源（数源这条不许漂）',
  `${SOURCES.length} 家 · ${SOURCES.map((s) => s.text.length).join('+')} 句`);
for (const s of SOURCES) {
  const miss = s.text.filter((line) => !DESIGN.includes(line));
  ok(miss.length === 0 && DESIGN.includes(s.url), `D14 ${s.who}：${s.text.length} 句逐字在 DESIGN，且 URL 也印着`,
    miss.length ? `缺 ${miss.length} 句：${miss[0].slice(0, 40)}…` : `URL ${s.url}`);
}

// ── D15/D16 红线标签双向：文档点名的每条都得存在，存在的每条都得有人写 ────────
console.log('D15/D16 闸的标签');
const pair = (src, docs, prefix, label, count) => {
  const real = [...new Set([...src.matchAll(new RegExp(`\\b${prefix}(\\d[a-z]?)\\b`, 'g'))].map((m) => `${prefix}${m[1]}`))].sort();
  const cited = [...new Set([...docs.matchAll(new RegExp(`\\b${prefix}(\\d[a-z]?)\\b`, 'g'))].map((m) => `${prefix}${m[1]}`))].sort();
  ok(real.length >= count, `${label}a ${prefix} 系列标签从实现里解析到了`, `${real.join(' ')}（${real.length} 条）`);
  const missing = cited.filter((l) => !real.includes(l));
  const undocumented = real.filter((l) => !cited.includes(l));
  ok(missing.length === 0, `${label} 文档点名的每条 ${prefix} 标签在实现里都还在`,
    missing.length ? `文档引用了不存在的：${missing.join(' ')}` : `${cited.join(' ')} 全部存在`);
  ok(undocumented.length === 0, `${label}b 实现里每条 ${prefix} 都被文档点名（新增一条不能没人写）`,
    undocumented.length ? `没写进文档：${undocumented.join(' ')}` : '一一对上');
};
pair(BAL, DOCS, 'B', 'D15', 9);
pair(ET, DOCS, 'A', 'D16', 9);

console.log(`\n合计 ${rows} 项，${fail.length} 项失败`);
console.log(`rows: ${rows} fail: ${fail.length}`);
if (fail.length) {
  for (const f of fail) console.log(`  未过：${f}`);
  process.exit(1);
}
