// 文档是被断言的面：README 印出去的每一个「现值」都必须等于代码/脚本里的现在值。
//
// 为什么要有这个文件：引擎断言、bake 出来的数据、balance 的红线都有命令去重测，
// 而一段散文没有。它可以一直抄下去，直到某天代码改了字、文档还在引用上一个世界的数。
// 本仓的 README 里有一整类这样的数——三档表、腿与形态的条数、端口、节点预算、
// CI 里到底跑了哪几条门禁、`SAMPLES` 旋钮的值——它们每一个都能由一条等式钉住，
// 于是这里钉住它们。
//
// 规矩（和 tools/balance.mjs 的 B5/B6 一样）：
//   * 每一条等式都配一条「解析到的条数」的反空转断言——正则没命中不是绿，是红；
//   * 只比现值，不比读数：ms、出货率、节点数这类本机测量在这里只作为「文档写的数
//     与代码里的界」的关系出现（D5），不去复测它们；
//   * 破坏试验台账（README 最后一节）逐条验过这里的刀真的会红。
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { TIERS } from '../js/ui/game.js';

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
const VERIFY = read('tools/verify.sh');
const PKG = JSON.parse(read('package.json'));
const GEN = read('js/engine/generate.js');
const PENCIL = read('js/engine/pencil.js');
const GAME = read('js/ui/game.js');
const PLAYTEST = read('tools/playtest.cjs');

// ---- D1 三档菜单表：页面印给玩家的那张表 == TIERS 的现值 ----
const tierRows = [...README.matchAll(/^\| (初|中|高) \| (\d+)×(\d+) \| (\d+) \| (\d+) 步 \/ \d+ ms/gm)];
ok(tierRows.length === TIERS.length, 'D1a README 的三档表解析到的行数等于 TIERS 的档数',
  `解析 ${tierRows.length} 行 vs TIERS ${TIERS.length} 档（解析不到不等于通过）`);
for (const t of TIERS) {
  const row = tierRows.find((m) => m[1] === t.name);
  const dims = row && +row[2] === t.R && +row[3] === t.C && +row[4] === t.K;
  const steps = row && +row[5] === t.med.steps;
  ok(!!row && dims && steps, `D1 ${t.name} ${t.R}×${t.C} K=${t.K} ${t.med.steps} 步：文档那行等于 TIERS`,
    row ? `文档 ${row[2]}×${row[3]} K=${row[4]} ${row[5]} 步 vs 代码 ${t.R}×${t.C} K=${t.K} ${t.med.steps} 步`
        : 'README 的三档表里没有这一档');
}

// ---- D2 铅笔的 10 条命名规则：文档列的名字集 == 实现头部的清单，且每条在实现体里再现一次 ----
const implRules = [...PENCIL.matchAll(/^\/\/ {3}(P\d-\S+)/gm)].map((m) => m[1]);
const docRules = (README.match(/一共 10 条：\n?\s*`([^`]+)`/) || [])[1];
const docRuleList = docRules ? docRules.trim().split(/\s+/) : [];
ok(implRules.length === 10 && docRuleList.length === 10,
  'D2a 两边都解析到 10 条规则名（少一条就是解析器空转）',
  `实现清单 ${implRules.length} 条 · 文档 ${docRuleList.length} 条`);
ok(implRules.length === docRuleList.length && implRules.every((r, i) => docRuleList[i] === r),
  'D2 README 列的规则名逐条等于 pencil.js 头部清单',
  `实现 ${implRules.join(' ')} vs 文档 ${docRuleList.join(' ')}`);
// 名字必须出现在**非注释行**里：整份文件一起数会被头部注释凑够次数，
// 那样「不只活在注释里」这句标签就在说谎（P0-区 的注释出现 3 次，代码里只有 1 次）。
const PENCIL_BODY = PENCIL.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
const ghost = implRules.filter((r) => PENCIL_BODY.split(r).length - 1 < 1);
ok(ghost.length === 0, 'D2b 每条规则名都不只活在注释里（非注释行里至少出现一次）',
  ghost.length ? `只有声明没有实现：${ghost.join(' ')}` : `10 条名字在 pencil.js 的非注释行里各出现 ≥1 次`);

// ---- D3 闸的形状：腿数、形态数、每形态报告数、合计，全部从脚本现值推 ----
const legsM = VERIFY.match(/LEGS=\$\{LEGS:-([^}]*)\}/);
const legs = legsM ? legsM[1].trim().split(/\s+/) : [];
const shapesM = VERIFY.match(/SHAPES=\(([^)]*)\)/);
const shapes = shapesM ? (shapesM[1].match(/"([^"]+)"/g) || []).length : 0;
const reportsPerShape = (VERIFY.match(/^\s*run_scenario [a-z]+/gm) || []).length
  + (VERIFY.match(/^\s*run_cmd [a-z]+/gm) || []).length;
const shapeDoc = DOCS.match(/闸的形状：腿 (\d+) 条 · 形态 (\d+) 种 · 每形态 (\d+) 份报告 · 合计 (\d+) 份/);
ok(legs.length >= 5 && shapes >= 1 && reportsPerShape >= 5 && !!shapeDoc,
  'D3a 脚本与文档两边都解析到了闸的形状',
  `verify.sh: ${legs.length} 腿 × ${shapes} 形态 × ${reportsPerShape} 报告 · 文档句 ${shapeDoc ? '在' : '不在'}`);
ok(!!shapeDoc && +shapeDoc[1] === legs.length, `D3 文档写的腿数等于 LEGS 默认值（${legs.join(' ')}）`,
  shapeDoc ? `文档 ${shapeDoc[1]} vs 脚本 ${legs.length}` : '解析不到');
ok(!!shapeDoc && +shapeDoc[2] === shapes, 'D3b 文档写的形态数等于 SHAPES 的条目数',
  shapeDoc ? `文档 ${shapeDoc[2]} vs 脚本 ${shapes}` : '解析不到');
ok(!!shapeDoc && +shapeDoc[3] === reportsPerShape,
  `D3c 文档写的每形态报告数等于脚本里的 run_scenario+run_cmd 次数（${reportsPerShape}）`,
  shapeDoc ? `文档 ${shapeDoc[3]} vs 脚本 ${reportsPerShape}` : '解析不到');
ok(!!shapeDoc && +shapeDoc[4] === reportsPerShape * shapes, 'D3d 合计份数 == 每形态 × 形态数',
  shapeDoc ? `文档 ${shapeDoc[4]} vs ${reportsPerShape}×${shapes}=${reportsPerShape * shapes}` : '解析不到');

// ---- D4 端口：文档那一句 == package.json / verify.sh / playtest.cjs 的现值 ----
const httpM = VERIFY.match(/HTTP=\$\{HTTP_PORT:-(\d+)\}/);
const cdpM = VERIFY.match(/PORT=\$\{CDP_PORT:-(\d+)\}/);
const devM = (PKG.scripts?.dev || '').match(/server\.cjs\s+(\d+)/);
const phM = PLAYTEST.match(/CDP_PORT \|\| (\d+)/);
const pbM = PLAYTEST.match(/BASE_URL \|\| 'http:\/\/127\.0\.0\.1:(\d+)/);
const portDoc = DOCS.match(/端口：本地 (\d+) · CDP (\d+)/);
ok(httpM && cdpM && devM && phM && pbM && portDoc,
  'D4a 五个来源都解析到了端口（少一个就说明接线改了形状）',
  `verify ${httpM?.[1]}/${cdpM?.[1]} · package ${devM?.[1]} · playtest ${pbM?.[1]}/${phM?.[1]} · 文档 ${portDoc?.[1]}/${portDoc?.[2]}`);
const httpVals = [httpM?.[1], devM?.[1], pbM?.[1]];
const cdpVals = [cdpM?.[1], phM?.[1]];
ok(!!portDoc && httpVals.every((v) => +v === +portDoc[1]), `D4 HTTP 端口三处一致且等于文档（${httpVals.join('/')}）`,
  portDoc ? `文档 ${portDoc[1]}` : '解析不到');
ok(!!portDoc && cdpVals.every((v) => +v === +portDoc[2]), `D4b CDP 端口两处一致且等于文档（${cdpVals.join('/')}）`,
  portDoc ? `文档 ${portDoc[2]}` : '解析不到');

// ---- D5 唯一性预算：文档写的读数必须真的小于代码里的 cap ----
const capM = GEN.match(/opts\.cap \?\? (\d+)/);
const capDoc = README.match(/唯一性计数本轮最大 (\d+) 节点，预算 (\d+) 节点/);
ok(!!capM && !!capDoc, 'D5a 两边都读到了节点预算',
  `代码 opts.cap ${capM?.[1]} · 文档读数 ${capDoc?.[1]} / 界 ${capDoc?.[2]}`);
ok(!!capM && !!capDoc && +capDoc[2] === +capM[1], 'D5 文档写的预算等于 generate.js 的 opts.cap',
  capM && capDoc ? `文档 ${capDoc[2]} vs 代码 ${capM[1]}` : '解析不到');
ok(!!capM && !!capDoc && +capDoc[1] < +capM[1], 'D5b 「远没花完预算」这句散文是真的：读数 < cap',
  capM && capDoc ? `${capDoc[1]} < ${capM[1]}，余量 ${((1 - +capDoc[1] / +capM[1]) * 100).toFixed(1)}%` : '解析不到');

// ---- D6 CI 覆盖表：文档声称在 CI 跑的门禁，必须真在那个 job 里 ----
const jobBlocks = {};
// 只在 jobs: 那一段里找 job——`on:` 与 `permissions:` 下也是两空格缩进的 key，
// 整份文件一起匹配会把 push/pull_request 当成 job 名。
const jobsSrc = CI.slice(CI.indexOf('\njobs:'));
for (const m of jobsSrc.matchAll(/^ {2}([A-Za-z0-9_-]+):([\s\S]*?)(?=\n {2}[A-Za-z0-9_-]+:|\n(?=\S)|(?![\s\S]))/gm)) {
  jobBlocks[m[1]] = m[2];
}
const ciRows = [...README.matchAll(/^\| (`[^`]+`|GATE_SELFTEST=1 bash tools\/verify\.sh) \| (check|browser) \| `([^`]+)`/gm)];
const listedTokens = new Set();
ok(Object.keys(jobBlocks).length >= 2 && ciRows.length >= 4,
  'D6a CI 的 job 块与文档的覆盖表都解析到了东西',
  `job ${Object.keys(jobBlocks).join('/')} · 覆盖表 ${ciRows.length} 行`);
for (const r of ciRows) {
  const block = jobBlocks[r[2]] || '';
  const cmd = r[1].replace(/`/g, '');
  listedTokens.add(r[3]);
  ok(block.includes(r[3]) && block.includes(cmd.split(' ').slice(-2).join(' ')),
    `D6 覆盖表那一行真在 ${r[2]} job 里：${cmd}`, `步骤名 ${r[3]}`);
}
const ciCommands = [...CI.matchAll(/node tools\/([\w.-]+\.mjs)/g)].map((m) => m[1]);
const unlisted = [...new Set(ciCommands)].filter((c) => ![...ciRows].some((r) => r[1].includes(c)));
ok(unlisted.length === 0, 'D6b ci.yml 里跑的每个 tools 门禁都被覆盖表列了（文档不许比门禁松）',
  unlisted.length ? `漏了：${unlisted.join(' ')}` : `runner 里 ${[...new Set(ciCommands)].join(' ')} 全在表上`);

// ---- D7 SAMPLES 旋钮：ci.yml 的值 == 文档引用的值 == 不接线时的默认，且 env 真的接得上 ----
const ciSamples = (CI.match(/SAMPLES: "(\d+)"/) || [])[1];
const docSamples = (README.match(/CI 用 SAMPLES=(\d+) 跑 balance\.mjs/) || [])[1];
const defaultN = (BAL.match(/const N = [^\n]*[:?]\s*(\d+);/) || [])[1];
ok(!!ciSamples && !!docSamples && !!defaultN, 'D7a 三处都读到了样本数',
  `ci.yml ${ciSamples} · 文档 ${docSamples} · 默认 ${defaultN}`);
ok(ciSamples && docSamples && +ciSamples === +docSamples && +ciSamples === +defaultN,
  'D7 CI 的 SAMPLES == 文档引用的那个值 == 不设 env 时的默认',
  `${ciSamples} / ${docSamples} / ${defaultN}`);
const probe = await new Promise((resolve) => {
  const child = spawn(process.execPath, [join(ROOT, 'tools/balance.mjs')], { env: { ...process.env, SAMPLES: '3' } });
  let buf = '';
  const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(buf || '(no output)'); }, 15000);
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (d) => {
    buf += d;
    const first = buf.split('\n')[0];
    if (/菜单三档 × \d+ 张/.test(buf)) { clearTimeout(timer); child.kill('SIGKILL'); resolve(first); }
  });
  child.on('close', () => { clearTimeout(timer); resolve(buf.split('\n')[0] || '(exited silently)'); });
});
ok(/× 3 张/.test(probe), 'D7b 子进程探针：SAMPLES=3 必须真的改成 3 张（env 是接上的，不是装饰）',
  `balance 第一行：${probe}`);

// ---- D8 逐报告条数的自洽：文档列的 14 个数加起来，必须等于它自己写的两个总数 ----
const items = [...README.matchAll(/\b(engine|gen|play|hint|win|layout|mouse|touch|keys|save|nav|resume|reload|corrupt) (\d+)(?=\s*\/|\s*，)/g)]
  .map((m) => ({ name: m[1], n: +m[2] }));
const totals = README.match(/每形态 (\d+) 条 · 合计 (\d+) 条/);
ok(items.length === reportsPerShape && !!totals, 'D8a 逐报告条数与总数都解析到了',
  `解析 ${items.length} 项 / 期望 ${reportsPerShape} 份 · 总句 ${totals ? '在' : '不在'}`);
const perShape = items.reduce((a, b) => a + b.n, 0);
ok(!!totals && perShape === +totals[1], 'D8 文档列的逐报告条数加起来 == 它写的每形态条数',
  totals ? `加起来 ${perShape} vs 文档 ${totals[1]}` : '解析不到');
ok(!!totals && perShape * shapes === +totals[2], 'D8b 每形态条数 × 形态数 == 文档写的合计（两种形态必须等量）',
  totals ? `${perShape}×${shapes} vs ${totals[2]}` : '解析不到');

// ---- D9 引用不漂：文档里每一个 path:NN 都指向真实文件里真实存在的那一行 ----
const cites = [...DOCS.matchAll(/((?:\.github\/workflows\/)?[\w./-]+\.(?:js|mjs|cjs|sh|json|html|yml)):(\d+)(?:-(\d+))?/g)];
const bad = [];
for (const c of cites) {
  let src;
  try {
    src = read(c[1]);
  } catch {
    bad.push(`${c[1]}:${c[2]}（文件不存在）`);
    continue;
  }
  const n = src.split('\n').length;
  if (+c[2] > n || (+c[3] && +c[3] > n)) bad.push(`${c[1]}:${c[2]}${c[3] ? '-' + c[3] : ''}（该文件只有 ${n} 行）`);
}
ok(cites.length >= 20, 'D9a 文档里的行号引用解析到了一大堆（少于 20 条说明引用格式改了）',
  `${cites.length} 条引用`);
ok(bad.length === 0, 'D9 每一条 path:NN 引用都落在真实文件的行数内',
  bad.length ? `越界：${bad.join('，')}` : `${cites.length} 条全部在范围内`);

// ---- D10 红线标签双向：文档点名的每条红线都得存在，存在的每条红线都得有人写 ----
const realLabels = [...new Set([...BAL.matchAll(/\b(B\d(?:b)?)(?=[ 　])/g)].map((m) => m[1]))];
const docLabels = [...new Set([...DOCS.matchAll(/`?(B\d(?:b)?)`?/g)].map((m) => m[1]))];
ok(realLabels.length >= 6, 'D10a balance.mjs 里的红线标签解析到了',
  `${realLabels.sort().join(' ')}`);
const missing = docLabels.filter((l) => !realLabels.includes(l));
const undocumented = realLabels.filter((l) => !docLabels.includes(l));
ok(missing.length === 0, 'D10 文档点名的每条红线在 balance.mjs 里都还在',
  missing.length ? `文档引用了不存在的红线：${missing.join(' ')}` : `${docLabels.sort().join(' ')} 全部存在`);
ok(undocumented.length === 0, 'D10b balance.mjs 里每条红线都被文档点名（新增红线不能没人写）',
  undocumented.length ? `没写进文档：${undocumented.join(' ')}` : '一一对上');

console.log(`\n合计 ${rows} 项，${fail.length} 项失败`);
console.log(`rows: ${rows} fail: ${fail.length}`);
if (fail.length) {
  for (const f of fail) console.log(`  未过：${f}`);
  process.exit(1);
}
