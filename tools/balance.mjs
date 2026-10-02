// 成本与难度：把出货率、每张耗时、节点代价、难度带，以及"铅笔会不会说谎"量成有红线的表。
// 每条红线都要能在实现变坏时变红；反过来，红线只卡"变坏"，不卡"变好"——
// 被淘汰的 8x8/10x10 那一段测的是**淘汰理由里写着的数**，理由变了红线才跟着变；
// 菜单读数（tiers.js 的 work）由 B5 钉成等式，改生成器/计数器就会红。
// 用法：node tools/balance.mjs [样本数]，或 SAMPLES=<n> —— CI 的 Difficulty ladder 一步设的是
// 环境变量，所以这个 knob 必须真的接到样本数上（tools/doctest.mjs 的 D7 拿子进程验它）。
// BLESS=1 时额外打印"贴回 tiers.js 的那几行"，菜单读数只有一个来源：这个文件跑出来的。
import { countSolutions, CAP_WORK } from '../js/engine/rules.js';
import { solve } from '../js/engine/pencil.js';
import { build, makePuzzle, makeBoard, dig } from '../js/engine/generate.js';
import { makeRng } from '../js/engine/rng.js';
import { readFileSync } from 'node:fs';
import { TIERS, ELIMINATED } from '../js/engine/tiers.js';

const argn = +process.argv[2];
const envn = +process.env.SAMPLES;
const N = Number.isInteger(argn) && argn > 0 ? argn : Number.isInteger(envn) && envn > 0 ? envn : 15;
// 被淘汰档的读数是被 bless 进 tiers.js 的，所以它的分母不能跟着 SAMPLES 漂：固定一把。
const OVER_N = 5;
const med = a => a.length ? a.slice().sort((x, y) => x - y)[a.length >> 1] : NaN;
const p95 = a => a.length ? a.slice().sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * 0.95))] : NaN;
const p10 = a => a.length ? a.slice().sort((x, y) => x - y)[Math.floor(a.length * 0.1)] : NaN;
let red = 0;
const line = (cond, label, detail) => {
  console.log(`  ${cond ? 'ok  ' : '**RED**'} ${label} · ${detail}`);
  if (!cond) red++;
};

console.log(`菜单三档 × ${N} 张（seed 从 5000 起，逐张递增，可复跑）`);
const rows = [];
for (const t of TIERS) {
  const st = { ship: 0, ms: [], steps: [], cuts: [], clues: [], nodes: [], spent: [], attempts: [], rooms: [] };
  const t0 = Date.now();
  for (let s = 0; s < N; s++) {
    const c0 = Date.now();
    const pz = await makePuzzle(t.key, 5000 + s);
    if (pz.fail) { console.log(`  ${t.key} seed ${5000 + s} 退货 ${pz.fail}`); continue; }
    st.ship++;
    st.ms.push(Date.now() - c0);
    st.nodes.push(pz.nodes); st.steps.push(pz.steps); st.cuts.push(pz.cuts);
    st.clues.push(pz.clues); st.rooms.push(pz.rooms); st.spent.push(pz.spent); st.attempts.push(pz.attempts);
  }
  const rate = st.ship / N;
  rows.push({ ...t, rate, medCuts: med(st.cuts), p95Cuts: p95(st.cuts), p10Cuts: p10(st.cuts),
    medSteps: med(st.steps), medMs: med(st.ms), p95Ms: p95(st.ms), maxMs: Math.max(0, ...st.ms),
    medNodes: med(st.nodes), p95Nodes: p95(st.nodes), maxNodes: Math.max(0, ...st.nodes),
    medAttempts: med(st.attempts), ship: st.ship, cutsAll: st.cuts,
    medClues: med(st.clues), medRooms: med(st.rooms) });
  console.log(`  ${t.label} ${t.key}：出货 ${st.ship}/${N} = ${(100 * rate).toFixed(0)}% · 试次 med ${med(st.attempts)} · 线索 med ${med(st.clues)} · 区域 med ${med(st.rooms)} · 用规次数 med ${med(st.cuts)} p95 ${p95(st.cuts)} p10 ${p10(st.cuts)} · 推理轮 med ${med(st.steps)} · 唯一性节点 med ${med(st.nodes)} p95 ${p95(st.nodes)} max ${Math.max(...st.nodes)} · 出题总节点 med ${med(st.spent)} · 每张 med ${med(st.ms)} ms p95 ${p95(st.ms)} ms max ${Math.max(...st.ms)} ms · 墙钟 ${Date.now() - t0} ms`);
}

// B1 成本红线：每一档 p95 都必须停在"点换一局不觉得卡"的那一侧。ms 只卡上界（机器速度）。
// B1b 判据 1 的预算：出货的每一张，唯一性那一次穷举都必须在 CAP_WORK 内走完。
let B4LIVE = null;
console.log('红线');
for (const r of rows) {
  line(r.p95Ms <= r.budgetMs, `B1 ${r.key} 出题 p95 <= ${r.budgetMs} ms`, `实测 p95 ${r.p95Ms} ms · med ${r.medMs} ms · max ${r.maxMs} ms`);
  line(r.maxNodes <= CAP_WORK, `B1b ${r.key} 唯一性节点 <= 预算 ${CAP_WORK}`, `实测 max ${r.maxNodes} · med ${r.medNodes}（占预算 ${(100 * r.maxNodes / CAP_WORK).toFixed(0)}%）`);
  line(r.rate >= 0.5, `B2 ${r.key} 出货率 >= 50%`, `实测 ${r.ship}/${N} = ${(100 * r.rate).toFixed(0)}%（低于一半＝按一次按钮要等好几张退货）`);
}
// B3 难度轴：三档的"命名规则被用了几次"必须单调。推理**轮**数不单调也不行，但轮数
// 只有个位数（5/6/7），带与带必然重叠；用规次数才是这张盘上真正的推理量。
line(rows[0].medCuts < rows[1].medCuts && rows[1].medCuts < rows[2].medCuts,
  'B3 难度带单调（按实测用规次数）', `${rows.map(r => `${r.key} med ${r.medCuts}`).join(' < ')}`);
line(rows[0].medSteps < rows[2].medSteps, 'B3c 首末两档的推理轮数不重合', `${rows[0].key} med ${rows[0].medSteps} < ${rows[2].key} med ${rows[2].medSteps}`);
// 档位如果是真轴，首末两档的区间就不该重叠：中位数单调可以靠一张离群盘蒙出来，
// 区间不重叠要求**这批样本里最难的入门盘也比最简单的进阶盘短**。
line(rows[0].p95Cuts < rows[2].p10Cuts, 'B3b 首末两档的用规次数区间不重叠', `${rows[0].key} p95 ${rows[0].p95Cuts} < ${rows[2].key} p10 ${rows[2].p10Cuts}`);
// B4 铅笔的选择性：在**没推满**的盘上它当然不推满；要证伪的是它会不会把多解盘推满。
// 多解盘不是"少挖几条线索"就能造出来的：生产那把刀每挖一条都要求铅笔还推得满，于是
// 提前收手的盘**照样唯一**（第一版就是这么写的，12 张样本里一张多解都没有，B4 当场
// 变成一盏永远绿的灯）。第二版拿唯一性当尺子往下挖，结果每挖深一点计数器就撞预算，
// 于是"读不出来"被当成了"还是唯一"，6 张又全数空转。
// 现在的造法打在点上：先用生产那把刀挖到底（出货盘），再**只多拿掉一条线索**——
// 那张盘是"差一条线索就多解"的盘，计数器说 >=2 解，铅笔在它上面必须推不满。
console.log('B4 铅笔不说谎（对着多解盘）');
{
  function oneClueShort(r, c, seed, cap = 300000) {
    const made = makeBoard(r, c, seed);
    if (made.fail) return { fail: made.fail };
    dig(made.bd, made.mask, { seed: seed * 7919 + 1 });
    const held = [];
    for (let i = 0; i < r * c; i++) {
      const rr = (i / c) | 0, cc = i % c;
      if (made.bd.sym[rr][cc] !== '.') held.push([i, rr, cc, made.bd.sym[rr][cc]]);
    }
    let unreadable = 0;
    for (const [i, rr, cc, ch] of held) {
      made.bd.sym[rr][cc] = '.';
      const t = countSolutions(made.bd, { cap, upTo: 2 });
      if (t.solutions >= 2) return { bd: made.bd, solutions: t.solutions, of: held.length, nodes: t.nodes };
      if (t.stopped) unreadable++;
      made.bd.sym[rr][cc] = ch;
    }
    return { fail: `拿掉任意一条线索后仍读不出多解（${held.length} 条线索，撞预算 ${unreadable} 次）` };
  }
  let multi = 0, lied = 0, noSample = 0, unreadable = 0;
  for (const t of [TIERS[0], TIERS[1]]) {
    for (let s = 0; s < Math.max(3, N >> 3); s++) {
      const seed = 90000 + s * 7919 + t.rows;
      const w = oneClueShort(t.rows, t.cols, seed);
      if (w.fail) { noSample++; console.log(`    ${t.key} seed ${seed}：${w.fail}，不算样本`); continue; }
      multi++;
      const p = solve(w.bd);
      if (p.done) { lied++; console.log(`    **RED** ${t.key} seed ${seed}：这张盘被计数器数出至少 ${w.solutions} 个解（${w.of} 条线索里拿掉一条、${w.nodes} 节点），却被铅笔推满了`); }
    }
  }
  B4LIVE = { multi, lied, noSample };
  line(lied === 0, 'B4 铅笔从不把多解盘推满（选择性）', `见证多解盘 ${multi} · 被推满 ${lied}`);
  line(multi >= 3, 'B4 的样本真的含多解盘（否则 B4 空转）', `见证多解盘 ${multi}，另有 ${noSample} 张造不出样本（撞预算 ${unreadable} 次）`);
}

// B5/B6：树里写着的"实测"数得有闸读。
//   B5 钉菜单每档的节点读数（tiers.js 的 work），等式在 blessN 那张表上成立；
//   样本数不等于 blessN 时只卡方向，因为中位数随分母漂（跨分母比会编出假数）。
//   ms 不进等式：那是机器速度，只卡方向（B5b）。
const BLESS_N = 15;
{
  const mds = rows.map(r => r.medNodes), p95s = rows.map(r => r.p95Nodes);
  const eq = N === BLESS_N;
  for (let i = 0; i < rows.length; i++) {
    if (eq) {
      line(TIERS[i].work.med === mds[i] && TIERS[i].work.p95 === p95s[i],
        `B5 选尺寸页印的「${TIERS[i].key} 节点 med ${TIERS[i].work.med}／p95 ${TIERS[i].work.p95}」等于本轮实测`, `实测 med ${mds[i]} p95 ${p95s[i]}（样本 ${N}）`);
    }
    line(TIERS[i].work.med <= CAP_WORK, `B5 ${TIERS[i].key} 写进树里的节点读数没越预算`, `树 ${TIERS[i].work.med} vs 本轮实测 ${mds[i]}（样本 ${N}${eq ? '' : '，与 blessN 不同故不卡等式'}）`);
  }
  line(TIERS.every((t, i) => i === 0 || t.budgetMs > TIERS[i - 1].budgetMs),
    'B5b 每档耗时预算只卡方向（ms 是机器速度，不进等式）', TIERS.map(t => t.budgetMs).join(' < '));
}

// B6：淘汰档的理由里印着的数，必须在**当前这棵树**上重新量得出来。
// 这一条最容易被写坏：一旦生成器改了而理由没跟着改，页面上就挂着一句没人验过的话。
console.log('B6 被淘汰档的实测读数（单试、不重试，走 build）');
{
  for (const e of ELIMINATED) {
    const nodes = [], fails = [];
    let ship = 0;
    const t0 = Date.now();
    for (let s = 0; s < OVER_N; s++) {
      const b = build(e.rows, e.cols, 5000 + s * 101);
      if (b.fail) { fails.push(b.fail); continue; }
      ship++; nodes.push(b.nodes);
    }
    const wall = Date.now() - t0;
    const back = [...new Set(fails)].sort();
    line(e.samples === OVER_N && e.ship === ship && e.nodesMed === med(nodes) && e.nodesMax === Math.max(...nodes)
      && e.fails.slice().sort().join('|') === back.join('|'),
      `B6 ${e.key} 的理由里的数等于本轮实测`, `本轮 出货 ${ship}/${OVER_N} · 节点 med ${med(nodes)} max ${Math.max(0, ...nodes)}（树里写 ${e.ship}/${e.samples} · med ${e.nodesMed} max ${e.nodesMax} · 退货 ${e.fails.join('/') || '无'}）· 本轮退货 ${back.join('/') || '无'} · 墙钟 ${wall} ms（每张 med ${ship ? Math.round(wall / ship) : '—'} ms）`);
  }
}

// ── B7 文档抄的样本统计 == 本轮读数（只在默认 15 张/档时比）──────────────────────
// README 那张三档表与 B3/B4 那几句"本轮 X"此前是人抄的：动一行生成器、表照样绿。
// 换了样本量就不比——文档那句写的口径就是 15 张，拿别的口径去比，红的是闸而不是谎。
console.log('\nB7 README 抄的实测统计');
if (N === 15 && B4LIVE) {
  const rd = (u) => readFileSync(new URL(u, import.meta.url), 'utf8');
  const docs = rd('../README.md') + '\n' + rd('../DESIGN.md');
  const hit = (re, want, label) => {
    const got = [...docs.matchAll(re)].map((m) => m[0]);
    line(got.length >= 1 && got.every((g) => g === want), `B7 ${label}`,
      `文档 ${got.length ? got.join(' ∥ ') : '(没抄)'} vs 本轮 ${want}`);
  };
  const tbl = [...docs.matchAll(/^\| ([^|]+?) \| (\d+)\/(\d+) \| (\d+) \| (\d+) \| (\d+) \| (\d+) \| (\d+) \|[^|\n]*\|$/gm)];
  line(tbl.length === TIERS.length, 'B7 的解析自证：那张三档表要解析到三行（解析不到就比不了，不能算过）',
    `解析 ${tbl.length} 行 vs ${TIERS.length} 档`);
  for (const r of rows) {
    const want = `| ${r.label} | ${r.ship}/${N} | ${r.medClues} | ${r.medRooms} | ${r.medCuts} | ${r.medSteps} | ${r.medNodes} |`;
    const row = tbl.find((m) => m[1].trim() === r.label);
    line(!!row && row[0].startsWith(want), `B7 ${r.key} 那一行的五个数等于本轮实测`,
      `${row ? row[0].slice(0, 62) : '(文档没有这一档)'} vs ${want}`);
  }
  hit(/本轮 `\d+ < \d+ < \d+`/g, `本轮 \`${rows.map((r) => r.medCuts).join(' < ')}\``,
    '难度带单调那句的三个 med 等于本轮');
  hit(/`\d+x\d+ p95 \d+ < \d+x\d+ p10 \d+`/g,
    `\`${rows[0].key} p95 ${rows[0].p95Cuts} < ${rows[2].key} p10 ${rows[2].p10Cuts}\``,
    '区间不重叠那句的两个端点等于本轮');
  hit(/见证多解盘 \d+ · 被推满 \d+/g, `见证多解盘 ${B4LIVE.multi} · 被推满 ${B4LIVE.lied}`,
    'B4 的见证数与被推满数等于本轮');
  hit(/另有 \d+ 张造不出样本/g, `另有 ${B4LIVE.noSample} 张造不出样本`,
    'B4 反空转那句的"造不出"张数等于本轮');
  line(rows.every((r) => r.ship === N), 'B7 的前提：三档真的都全出货（文档那句「三档都是 15/15」靠它）',
    rows.map((r) => `${r.key} ${r.ship}/${N}`).join(' '));
  hit(/\d+\/\d+ = 100%/g, `${N}/${N} = 100%`, '出货率那句的分子分母等于本轮');
} else {
  console.log(`  -- 跳过：本轮 N=${N}${B4LIVE ? '' : '（B4 那段没跑）'}，文档那句写的是 15 张/档`);
}

if (process.env.BLESS) {
  console.log('\nBLESS：把这几行贴回 js/engine/tiers.js（数只有从这里出）');
  for (const r of rows) console.log(`  { key: '${r.key}', rows: ${r.rows}, cols: ${r.cols}, label: '${r.label}', work: { med: ${r.medNodes}, p95: ${r.p95Nodes} }, budgetMs: ${r.budgetMs} },`);
  for (const e of ELIMINATED) console.log(`  { key: '${e.key}', rows: ${e.rows}, cols: ${e.cols}, samples: ${OVER_N}, ship: ${e.ship}, nodesMed: ${e.nodesMed}, nodesMax: ${e.nodesMax}, fails: ${JSON.stringify(e.fails)}, why: '${e.why}' },`);
}

console.log(`\n合计红线 ${red} 条破口`);
process.exit(red ? 1 : 0);
