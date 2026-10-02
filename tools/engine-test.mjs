// 引擎闸：每条断言都要能在引擎写坏时变红（阴性自证），只打印读数不算闸。
// 用法：node tools/engine-test.mjs [seeds]      GATE_SELFTEST=1 时先证明这套闸会红
import { readFileSync } from 'node:fs';
import { countSolutions, satisfies, checks, prep, CAP_WORK, PAIRS, bit, UP, RIGHT, DOWN, LEFT, OPP } from '../js/engine/rules.js';
import { solve, RULE_TEXT, RULE_ORDER } from '../js/engine/pencil.js';
import { build, makeBoard, dig, makePuzzle, toView } from '../js/engine/generate.js';
import { TIERS } from '../js/engine/tiers.js';
import { SOURCES, official, officialLoop, officialMaskOf } from './fixtures.mjs';

const N = +(process.argv[2] || process.env.SAMPLES || 12);
// A9 要比的是"文档抄的读数 == 本轮读数"，所以把三处读数提到模块作用域。
const GOLD = {};
let HIST = '', SHIPPED = 0;
let fail = 0, pass = 0;
const VERBOSE = !!process.env.VERBOSE;
const ok = (cond, label, extra = '') => {
  if (cond) { pass++; if (VERBOSE) console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  **FAIL** ${label}${extra ? ' · ' + extra : ''}`); }
};
const say = (label, extra) => console.log(`  ——   ${label}${extra ? ' · ' + extra : ''}`);
const officialMask = officialMaskOf({ UP, RIGHT, DOWN, LEFT });
const id = (r, c) => r * official.cols + c;

// ── A0 两条路不许复用代码 ────────────────────────────────────────────────────
// 判据 1 是穷举、判据 2 是命名规则，两者独立才有"会合"这件事可言。
// 断言的是**文件里的事实**（import 与调用），不是注释里的承诺。
console.log('A0 计数器与铅笔相互独立');
{
  const rules = readFileSync(new URL('../js/engine/rules.js', import.meta.url), 'utf8');
  const pen = readFileSync(new URL('../js/engine/pencil.js', import.meta.url), 'utf8');
  ok(!/from '\.\/pencil\.js'/.test(rules), 'A0 rules.js 没有 import pencil.js');
  ok(!/from '\.\/rules\.js'/.test(pen), 'A0 pencil.js 没有 import rules.js');
  ok(!/countSolutions|satisfies\(/.test(pen), 'A0 pencil.js 里没有计数器/叶子复核的调用', pen.match(/countSolutions|satisfies\(/)?.[0]);
  ok(!/RULE_TEXT|N\d+_/.test(rules), 'A0 rules.js 里没有命名规则', rules.match(/N\d+_/.test(rules) ? 'N*_…' : 'RULE_TEXT')?.[0]);
  ok(RULE_ORDER.every(n => n in RULE_TEXT) && Object.keys(RULE_TEXT).every(n => RULE_ORDER.includes(n)),
    'A0 RULE_ORDER 与 RULE_TEXT 同集合', `${RULE_ORDER.length} 条命名规则`);
}

// ── A1 判据会合：官方例题 ────────────────────────────────────────────────────
console.log('A1 官方 5×5 例题上两条路会合');
{
  const printed = officialMask;
  const legal = satisfies(official, printed, prep(official));
  ok(legal.length === 0, 'A1 逐格抄的题面解答本身合法（抄件自证）', legal.join(','));
  ok(officialLoop.filter(s => s.length).length === printed.filter(m => m !== 0).length && printed.every(m => m === 0 || PAIRS.includes(m)),
    'A1 抄件每格要么空、要么是 6 种形状之一');
  const cnt = countSolutions(official, { cap: CAP_WORK });
  ok(cnt.solutions === 1 && !cnt.stopped, 'A1 判据 1：官方例题恰好 1 解、没撞预算', `${cnt.solutions} 解 · ${cnt.nodes} 节点 / 预算 ${CAP_WORK}`);
  const pen = solve(official);
  ok(pen.done && !pen.contradiction, 'A1 判据 2：铅笔在官方例题上 0 猜推满', `${pen.steps} 轮 · ${[...pen.fired].reduce((a, [, c]) => a + c, 0)} 次用规`);
  ok(cnt.first && pen.mask.every((v, i) => v === cnt.first[i]), 'A1 铅笔推出来的 === 计数器数出来的那个解');
  ok(pen.mask.every((v, i) => v === printed[i]), 'A1 铅笔推出来的 === 逐格抄下来的官方解答');
  Object.assign(GOLD, { nodes: cnt.nodes, steps: pen.steps, cuts: [...pen.fired].reduce((a, [, c]) => a + c, 0) });
  say('开火的命名规则', [...pen.fired].map(([n, c]) => `${n}×${c}`).join(' ') || '一条都没开火');
  say('这张盘上没开火的规则（不在此处定罪，A6 管全仓）',
    RULE_ORDER.filter(n => !pen.fired.has(n)).join(' ') || '无');
}

// ── A2 歧义由官方例题钉死：strict 1 解 / literal 3 解 ─────────────────────────
console.log('A2 区域符号的两种读法（题面歧义的裁决要有数）');
{
  const s = countSolutions(official, { cap: CAP_WORK });
  const l = countSolutions({ ...official, strictLabel: false }, { cap: CAP_WORK });
  ok(!s.stopped && !l.stopped, 'A2 两种读法都在预算内数完', `strict ${s.nodes} · literal ${l.nodes} 节点`);
  ok(s.solutions === 1 && l.solutions === 3,
    'A2 STRICT 数出 1 解、LITERAL 数出 3 解（所以本仓采 STRICT，README/DESIGN 写的就是这一句）',
    `实测 strict ${s.solutions} / literal ${l.solutions}`);
  ok(checks(official, officialMask).every(v => v.code !== 'symbol'), 'A2 官方解答在 STRICT 下不违符号条款');
}

// ── A3 条款表双向覆盖：能报的都有的说，会说的都报得出来 ──────────────────────
// 每张反例只违**那一条**：先确认基线合法，再确认改动后红的是被测条款。
console.log('A3 每条条款都有近邻反例（且只有它在红）');
{
  // 两边的集合都从 rules.js 里抠出来：note('code', …) 是报得出来的，CLAUSE_TEXT 的键是说得出口的。
  const src = readFileSync(new URL('../js/engine/rules.js', import.meta.url), 'utf8');
  const codes = new Set([...src.matchAll(/note\('(\w+)'/g)].map(x => x[1]));
  // 只抠 CLAUSE_TEXT 那一段。slice 到文件尾会把 CLAUSE_NAME 的键也当成"有句子"，
  // 于是删掉一句条文文案而 A3 照绿（E2 这一刀第一次就是这么空的）。
  const tb = src.indexOf('export const CLAUSE_TEXT = {');
  const te = src.indexOf('\n};', tb);
  const texts = new Set([...src.slice(tb, te).matchAll(/^  (\w+): /gm)].map(x => x[1]));
  ok(codes.size >= 8 && texts.size >= 8, 'A3 两个集合都真的抠到了（抠不到＝这条断言空转）', `note() ${codes.size} 个 code · CLAUSE_TEXT ${texts.size} 行`);
  ok([...codes].every(c => texts.has(c)), 'A3 checks() 用到的每个 code 都在 CLAUSE_TEXT 里有句子',
    [...codes].filter(c => !texts.has(c)).join(','));
  ok([...texts].every(c => codes.has(c)), 'A3 CLAUSE_TEXT 里没有死行（写了却报不出来的句子）',
    [...texts].filter(c => !codes.has(c)).join(','));

  // "被自己那一条抓到"＝这条 code 在反例上不许沉默；别的条款同时红可以原谅（一次改动
  // 常常牵动好几条），但**结构类**（度 1、不对称、出界）一旦在场，checks() 会提前收工，
  // 后面的区域条款根本轮不到发言——所以 cross/symbol/alternation 三张反例必须结构干净。
  const hits = (bd, mask, code) => {
    const v = checks(bd, Array.from(mask));
    return { hit: v.some(x => x.code === code), all: v.map(x => `${x.code}:${x.level}`).join(',') || 'legal' };
  };
  const onlyCodes = (bd, mask, code) => {
    const v = checks(bd, Array.from(mask));
    return { hit: v.length > 0 && v.every(x => x.code === code), all: v.map(x => `${x.code}:${x.level}`).join(',') || 'legal' };
  };
  const base = checks(official, officialMask);
  ok(base.length === 0, 'A3 基线（官方解答）一条都不报', base.map(x => x.code).join(','));
  const m = i => { const a = officialMask.slice(); a[i] = 0; return a; };
  const set = (i, d) => { const a = officialMask.slice(); a[i] |= bit(d); return a; };
  // 擦掉一条边的两头：两格各剩一条线，红的是度数，而不对称条款无话可说
  const cut = officialMask.slice();
  cut[id(0, 0)] &= ~bit(DOWN); cut[id(1, 0)] &= ~bit(UP);
  const deg = hits(official, cut, 'degree');
  ok(deg.hit && !/asym/.test(deg.all), 'A3 近邻反例：擦掉一条边的两头 → 度数条款红（不对称不陪跑）', deg.all);
  // 整格擦空只报 asym：邻居还朝它引着线，而 checks() 在结构类违规处提前收工。
  // 这个读数本身就是"为什么区域条款不能在没有线头时才评判"的证据，别把它当反例修掉。
  const erased = hits(official, m(id(0, 0)), 'asym');
  ok(erased.hit && !/degree/.test(erased.all), 'A3 整格擦空 → 红的是不对称（度数那条此时轮不到）', erased.all);
  // 接第三条线：两头一起接，才只有度数在红（不对称条款不会被顺带触发）
  const both = officialMask.slice();
  both[id(0, 1)] |= bit(DOWN); both[id(1, 1)] |= bit(UP);
  const deg3 = hits(official, both, 'degree');
  ok(deg3.hit && !/asym|edge|empty/.test(deg3.all), 'A3 近邻反例：给一格接第三条线 → 只有度数条款红', deg3.all);
  const asy = hits(official, set(id(4, 2), UP), 'asym');
  ok(asy.hit && asy.all.includes('asym'), 'A3 近邻反例：只有一头朝对方引线 → 不对称条款红', asy.all);
  const edg = hits(official, set(id(0, 0), LEFT), 'edge');
  ok(edg.hit, 'A3 近邻反例：线穿出棋盘边界 → 边界条款红', edg.all);
  const emp = hits(official, new Array(official.rows * official.cols).fill(0), 'empty');
  ok(emp.hit, 'A3 近邻反例：什么都没有 → 空盘条款红', emp.all);
  // 分段/闭合：官方那条环挪断成两段（同一张盘，只有 disjoint 该红）
  {
    // 断头盘：走到断点之前每一格的度数都已经是 1，所以红的是"线头"这一类（warn 级），
    // 区域条款此时必须闭嘴——这就是 report() 按 level 过滤的全部理由。
    const a = officialMask.slice();
    a[id(0, 0)] = bit(DOWN);                     // (0,0) 只留一条向下的线，环在这一格断了头
    const v = checks(official, a);
    ok(v.length > 0 && v.every(x => x.level === 'warn'), 'A3 断头盘只报 warn 级线头，区域条款此时不评判',
      v.map(x => `${x.code}:${x.level}`).join(','));
    // 两段闭合环：度数和对称都挑不出错，disjoint 必须以 error 级说话
    const two = new Array(official.rows * official.cols).fill(0);
    const put = (i, j, d) => { two[i] |= bit(d); two[j] |= bit(OPP[d]); };
    // 圈 1：左上 2x2；圈 2：右下 2x2 —— 都是合法的度 2，但不是"一整条"
    put(id(0, 0), id(0, 1), RIGHT); put(id(0, 1), id(1, 1), DOWN); put(id(1, 1), id(1, 0), LEFT); put(id(1, 0), id(0, 0), UP);
    put(id(3, 3), id(3, 4), RIGHT); put(id(3, 4), id(4, 4), DOWN); put(id(4, 4), id(4, 3), LEFT); put(id(4, 3), id(3, 3), UP);
    const v2 = checks(official, two);
    ok(v2.some(x => x.code === 'disjoint' && x.level === 'error'), 'A3 两段闭合环 → disjoint 以 error 级红',
      v2.map(x => `${x.code}:${x.level}`).join(','));
  }
  // 区域只穿多次 / 符号走反 / 交替破：三张反例都保持结构干净，才轮得到区域条款发言。
  {
    // 把 (0,0) 从区域 0 划给区域 1：两个区域各被穿 4 次，环本身一个字节都没动
    const room = official.room.map(r => r.slice());
    room[0][0] = 1;
    const cr = onlyCodes({ ...official, room }, officialMask, 'cross');
    ok(cr.hit, 'A3 近邻反例：区域被穿 4 次 → 只有 cross 红', cr.all);
  }
  {
    const sym = official.sym.map(r => r.slice());
    sym[1][2] = 'M';                             // 区域 1 里同时留 M 和 S
    const v = hits({ ...official, sym }, officialMask, 'symbol');
    ok(v.hit, 'A3 近邻反例：一个区域两种符号 → symbol 红', v.all);
  }
  {
    // 整区域的符号对调：环走的那批格换了名字，区域条款本身仍然满足，破的只有"沿环交替"
    const room = official.room, sym = official.sym.map(r => r.slice());
    for (let rr = 0; rr < official.rows; rr++) for (let cc = 0; cc < official.cols; cc++) {
      if (room[rr][cc] === 2) sym[rr][cc] = sym[rr][cc] === 'M' ? 'S' : sym[rr][cc] === 'S' ? 'M' : sym[rr][cc];
    }
    const v = onlyCodes({ ...official, sym }, officialMask, 'alternation');
    ok(v.hit, 'A3 近邻反例：环上相邻两个区域同符号 → 只有 alternation 红', v.all);
  }
}

// ── A4/A5/A6 出货盘：合法、唯一、铅笔 0 猜、条款与规则都真在干活 ──────────────
console.log(`A4–A6 出货盘逐张对账（菜单三档 × ${N} 张）`);
{
  const fired = new Map();
  let boards = 0;
  for (const t of TIERS) {
    for (let s = 0; s < N; s++) {
      const p = await makePuzzle(t.key, 7000 + s);
      ok(!p.fail, `A4 ${t.key} seed ${7000 + s} 出货`, p.fail || '');
      if (p.fail) continue;
      boards++;
      const bd = toView(p);
      const legal = checks(bd, p.answer);
      ok(legal.length === 0, `A4 ${t.key} seed ${p.seed} 的答案逐格合法`, legal.map(x => x.code).join(','));
      const cnt = countSolutions(bd, { cap: CAP_WORK });
      ok(cnt.solutions === 1 && !cnt.stopped, `A4 ${t.key} seed ${p.seed} 判据 1：1 解、没撞预算`, `${cnt.solutions} 解 · ${cnt.nodes} 节点`);
      ok(cnt.first.every((v, i) => v === p.answer[i]), `A4 ${t.key} seed ${p.seed} 出货带的是计数器那张盘，不是生成器自记的`);
      const pen = solve(bd);
      ok(pen.done && !pen.contradiction, `A6 ${t.key} seed ${p.seed} 判据 2：铅笔 0 猜推满`, pen.contradiction || `stall ${pen.undetermined.length} 格`);
      ok(pen.mask.every((v, i) => v === p.answer[i]), `A6 ${t.key} seed ${p.seed} 铅笔推出来的 === 出货答案`);
      for (const [n, c] of pen.fired) fired.set(n, (fired.get(n) || 0) + c);
      ok(RULE_ORDER.every(n => n in RULE_TEXT), `A6 ${t.key} seed ${p.seed} 开火的名字都在名单里`,
        [...pen.fired.keys()].filter(n => !(n in RULE_TEXT)).join(','));
    }
  }
  SHIPPED = boards;
  ok(boards === TIERS.length * N, 'A4 三档一张都没退货', `出货 ${boards}/${TIERS.length * N}`);
  HIST = RULE_ORDER.map(n => `${n}×${fired.get(n) || 0}`).join(' ');
  say('全仓用规次数直方图', HIST);
  const dead = RULE_ORDER.filter(n => !fired.has(n));
  ok(dead.length === 0, 'A5 每条命名规则都至少开火过一次（从不开火的规则是装饰，得删）', dead.join(' ') || '无死规则');
}

// ── A7 生成器的中间盘不会说谎 ───────────────────────────────────────────────
// 补/挖线索之后 board 就不再是任何解了，所以出货前要用计数器那张覆盖回去。
// 这里验的是：**没**覆盖回去的那一类盘（挖到过头）确实会非法，而 build 会拒收。
console.log('A7 挖坏了的盘必须被 build 拒收');
{
  let rejected = 0, tried = 0;
  for (const [r, c] of [[5, 5], [6, 6]]) {
    for (let s = 0; s < 4; s++) {
      const seed = 40000 + s * 7919 + r;
      const made = makeBoard(r, c, seed);
      if (made.fail) continue;
      const { bd, mask } = made;
      dig(bd, mask, { seed: seed * 7919 + 1 });
      // 再硬挖：把剩下的线索随便抹掉一片，于是"铅笔推满 + 唯一"至少断一条
      let wiped = 0;
      for (let rr = 0; rr < r && wiped < 4; rr++) for (let cc = 0; cc < c && wiped < 4; cc++) {
        if (bd.sym[rr][cc] !== '.') { bd.sym[rr][cc] = '.'; wiped++; }
      }
      tried++;
      const b = countSolutions(bd, { cap: CAP_WORK });
      const p = solve(bd);
      const shouldReject = !p.done || b.solutions !== 1 || b.stopped;
      if (shouldReject) rejected++;
      ok(!p.done || b.solutions !== 1 || b.stopped || satisfied(bd, p.mask),
        `A7 ${r}x${c} seed ${seed}：抹掉 ${wiped} 条之后仍然出货的盘，铅笔的答案必须合法`,
        satisfied(bd, p.mask).map(x => x.code).join(','));
    }
  }
  ok(rejected >= 1, 'A7 真的构造出了该被拒收的盘（否则这条断言空转）', `抹过线索的 ${tried} 张里有 ${rejected} 张读不唯一/推不满`);
}
function satisfied(bd, mask) { return checks(bd, Array.from(mask)); }

// ── A8 存档恢复走的是同一条路 ───────────────────────────────────────────────
// 同一个 seed 在任何一台机器上画同一张盘，这是存档只记 seed 的前提。
console.log('A8 seed 的确定性');
{
  const a = await makePuzzle(TIERS[1].key, 12345);
  const b = await makePuzzle(TIERS[1].key, 12345);
  ok(!a.fail && !b.fail, 'A8 两次都能出货', `${a.fail}${b.fail}`);
  ok(JSON.stringify(a.sym) === JSON.stringify(b.sym) && JSON.stringify(a.room) === JSON.stringify(b.room)
    && a.answer.every((v, i) => v === b.answer[i]), 'A8 同 seed 同盘（题面、区域、答案三者逐格相同）');
}

if (process.env.GATE_SELFTEST) {
  console.log('GATE_SELFTEST：故意把官方解答改坏一格，上面那套必须抓到');
  const broken = officialMask.slice();
  broken[id(2, 2)] = bit(UP) | bit(LEFT);
  const v = checks(official, broken);
  ok(v.length > 0, '自我破坏被 checks() 抓到（抓到才说明这条闸不是空转）', v.map(x => x.code).join(','));
  const b2 = officialMask.slice();
  b2[id(0, 1)] = 0;
  ok(checks(official, b2).length > 0, '自我破坏（擦掉一格）也被抓到');
}

// ── A9 文档抄的引擎读数 == 本轮读数 ──────────────────────────────────────────
// README 里那几句"1 解 · 1108 节点""5 轮 · 44 次用规""36/36 张出货""294 条通过"和整行直方图，
// 之前是人抄的：改一行代码、文档照样绿。这里把它们接到本轮真实读数上。
// 只在默认口径（12 张/档、非自证轮）下比——文档那句写的就是这个口径，
// 换了样本量还拿文档去比，红的是闸而不是谎。
if (N === 12 && !process.env.GATE_SELFTEST) {
  const rd = (u) => readFileSync(new URL(u, import.meta.url), 'utf8');
  const docs = rd('../README.md') + '\n' + rd('../DESIGN.md');
  const quoted = (re) => [...docs.matchAll(re)].map((m) => m[0]);
  const one = (arr, want, label) => ok(arr.length >= 1 && arr.every((x) => x === want),
    label, `文档 ${arr.length ? arr.join(' ∥ ') : '(没抄)'} vs 本轮 ${want}`);
  // 44 是文档抄了很久的数；A9 第一次跑就发现现值是 45（node 与 Chrome 两条腿同一份模块读数一致）。
  ok(GOLD.nodes === 1108 && GOLD.steps === 5 && GOLD.cuts === 45,
    'A9 官方例题上的三个读数是钉死的字面量（改了计数器/铅笔就会红，而不是静漂）',
    `${GOLD.nodes} 节点 · ${GOLD.steps} 轮 · ${GOLD.cuts} 次用规（期望 1108 · 5 · 45）`);
  one(quoted(/1 解 · \d+ 节点 \/ 预算 \d+/g), `1 解 · ${GOLD.nodes} 节点 / 预算 ${CAP_WORK}`,
    'A9 文档那句判据 1 的读数等于本轮（节点、预算一起比）');
  one(quoted(/\d+ 轮 · \d+ 次用规/g), `${GOLD.steps} 轮 · ${GOLD.cuts} 次用规`,
    'A9 文档那句判据 2 的读数等于本轮');
  one(quoted(/N0_有边即在环×\d+(?: N\d+\S*×\d+)+/g), HIST,
    'A9 文档那整行全仓用规直方图逐字等于本轮（每条规则的次数都在里面）');
  one(quoted(/\d+\/\d+ 张出货/g), `${SHIPPED}/${TIERS.length * N} 张出货`,
    'A9 文档那句「三档一张都没退货」的分子分母等于本轮');
  // 这一条必须在最后：期望值 `pass + 1` 说的是"加上它自己这一条"。
  const passDoc = [...docs.matchAll(/(\d+) 条通过/g)].map((m) => +m[1]);
  ok(passDoc.length >= 2 && passDoc.every((v) => v === pass + 1),
    'A9 文档抄的本命令总条数等于本轮（命令表 + 承诺表两处都得改，少一处就是抄漏）',
    `文档 ${passDoc.join(' ∥ ') || '(没抄)'} vs 本轮 ${pass + 1} 条`);
} else {
  say('A9 跳过与 README 的比对', `本轮 N=${N}${process.env.GATE_SELFTEST ? ' · 自证轮' : ''}，文档那句写的是默认 12 张/档`);
}

console.log(`\nengine-test: ${pass} 条通过 · ${fail} 条失败`);
process.exit(fail ? 1 : 0);
