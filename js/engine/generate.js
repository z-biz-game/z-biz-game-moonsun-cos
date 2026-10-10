// Moonsun 出题器：铺一条合法的环 → 沿环序把环切成区域 → 读满符号 → 挖线索。
//
// 为什么这样铺：把环按环序切成 R（偶数）段，段序就是环经过区域的次序，所以「月亮/太阳
// 交替」在建盘那一刻就成立，不需要事后修。符号取极大化：环经过的格写本区域的符号，
// 环外的格写相反符号——于是玩家看到的每一条线索都是「这个区不能是另一边」的证据。
//
// 挖线索的判据是 forced 进度，不是解数：拿掉一条线索后，铅笔必须仍能从空盘 0 猜推满
// （判据 2），计数器必须仍说 1 解（判据 1），两个都过才真拿掉。
//
// 出货前不可省的一刀：挖完之后 bd 已经不是任何解的答案盘，所以把计数器那张（唯一解）
// 覆盖回 answer，再整盘 verify 一次。
import { OPP, bit, pop, prep, satisfies, countSolutions, DR, DC, CAP_WORK } from './rules.js';
import { solve } from './pencil.js';
import { makeRng } from './rng.js';
import { parseSize } from './tiers.js';

// 一次出题允许的计数器节点数。它是**确定性**的量（同一个 seed 在任何机器上烧掉同样的节点），
// 所以拿它当闸；不用 ms——ms 随机器漂，漂了就等于悄悄改了承诺。
export const DIG_WORK = CAP_WORK * 8;

// [direction, cell] 成对返回：方向必须跟着邻居一起走，压成紧凑列表会在网格边缘把方向错位。
function nbrs(rows, cols, i) {
  const r = (i / cols) | 0, c = i % cols, out = [];
  for (let d = 0; d < 4; d++) {
    const rr = r + DR[d], cc = c + DC[d];
    if (rr >= 0 && rr < rows && cc >= 0 && cc < cols) out.push([d, rr * cols + cc]);
  }
  return out;
}
const cellsOf = (list) => list.map((x) => x[1]);

// 随机自避走，闭合成一条长度 ≥ minLen 的圈
export function layCycle(rows, cols, rnd, minLen, budget = 300000) {
  const n = rows * cols;
  for (const start of rnd.shuffle([...Array(n).keys()])) {
    const on = new Uint8Array(n); on[start] = 1;
    const path = [start];
    let left = budget;
    const dfs = (cur) => {
      if (left-- <= 0) return false;
      const nb = cellsOf(nbrs(rows, cols, cur));
      const canClose = path.length >= minLen && nb.includes(start);
      const opts = rnd.shuffle(nb.filter((z) => z !== start && !on[z]));
      if (canClose && (!opts.length || rnd.next() < 0.2)) return true;
      for (const z of opts) {
        on[z] = 1; path.push(z);
        if (dfs(z)) return true;
        path.pop(); on[z] = 0;
      }
      return canClose;
    };
    if (dfs(start)) return path.slice();
  }
  return null;
}

export function makeBoard(rows, cols, seed, { minLoopFrac = 0.5, avgChunk = 2.5, rooms = null } = {}) {
  const rnd = makeRng(seed);
  const n = rows * cols;
  const cycle = layCycle(rows, cols, rnd, Math.max(6, Math.round(n * minLoopFrac)));
  if (!cycle) return { fail: 'no cycle' };
  let R = rooms || 2 * Math.max(2, Math.round(cycle.length / (2 * avgChunk)));
  if (R % 2) R -= 1;
  if (R > cycle.length) R = cycle.length - (cycle.length % 2);
  if (R < 4) return { fail: 'bad room count' };
  // 切 R 段：段序 = 环经过区域的序 ⇒ 交替由构造保证
  const inner = rnd.shuffle([...Array(cycle.length - 1).keys()].map((x) => x + 1)).slice(0, R - 1).sort((a, b) => a - b);
  const bounds = [0, ...inner, cycle.length];
  const roomOf = new Int16Array(n).fill(-1);
  const roomCells = [];
  for (let k = 0; k < R; k++) {
    roomCells[k] = [];
    for (let t = bounds[k]; t < bounds[k + 1]; t++) { roomOf[cycle[t]] = k; roomCells[k].push(cycle[t]); }
  }
  // 环外的格挂到相邻区域：它们碰不到穿越计数，所以区域仍然是环上的一段连续路
  let pending = rnd.shuffle([...Array(n).keys()].filter((i) => roomOf[i] < 0));
  let guard = 0;
  while (pending.length && guard++ < 200) {
    const keep = [];
    for (const i of pending) {
      if (roomOf[i] >= 0) continue;
      const opts = [...new Set(nbrs(rows, cols, i).map(([, j]) => roomOf[j]).filter((k) => k >= 0))];
      if (!opts.length) { keep.push(i); continue; }
      const k = opts[Math.floor(rnd.next() * opts.length)];
      roomOf[i] = k; roomCells[k].push(i);
    }
    if (keep.length === pending.length) return { fail: 'orphan cells' };
    pending = rnd.shuffle(keep);
  }
  if ([...roomOf].some((k) => k < 0)) return { fail: 'unassigned cells' };
  if (roomCells.some((cs) => !cs.length)) return { fail: 'empty room' };

  const mask = new Int16Array(n);
  for (let t = 0; t < cycle.length; t++) {
    const a = cycle[t], b = cycle[(t + 1) % cycle.length];
    const hit = nbrs(rows, cols, a).find((x) => x[1] === b);
    if (!hit) return { fail: 'cycle not adjacent' };
    const d = hit[0];
    mask[a] |= bit(d); mask[b] |= bit(OPP[d]);
  }
  const label = (k) => (k % 2 === 0 ? 'M' : 'S');
  const other = (s) => (s === 'M' ? 'S' : 'M');
  const onLoop = new Uint8Array(n);
  for (const i of cycle) onLoop[i] = 1;
  const sym = [];
  for (let r = 0; r < rows; r++) {
    const line = [];
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      line.push(onLoop[i] ? label(roomOf[i]) : other(label(roomOf[i])));
    }
    sym.push(line);
  }
  const room = [];
  for (let r = 0; r < rows; r++) room.push([...Array(cols).keys()].map((c) => roomOf[r * cols + c]));
  const bd = { rows, cols, room, sym };
  const bad = satisfies(bd, Array.from(mask), prep(bd));
  if (bad.length) return { fail: 'laid board illegal: ' + bad.join(',') };
  return { bd, mask: Array.from(mask), cycle, R };
}

// 挖线索：每试一条都要同时过两道判据，过了才真拿掉。spent 累计计数器节点，超预算就收手。
export function dig(bd, mask, { cap = CAP_WORK, seed = 1, work = DIG_WORK, maxRemoved = Infinity } = {}) {
  const rnd = makeRng(seed);
  const order = rnd.shuffle([...Array(bd.rows * bd.cols).keys()]);
  let removed = 0, spent = 0;
  for (const i of order) {
    if (spent > work || removed >= maxRemoved) break;
    const r = (i / bd.cols) | 0, c = i % bd.cols;
    const held = bd.sym[r][c];
    if (held === '.') continue;
    bd.sym[r][c] = '.';
    const pen = solve(bd);
    if (!pen.done || !pen.mask.every((v, t) => v === mask[t])) { bd.sym[r][c] = held; continue; }
    const cnt = countSolutions(bd, { cap });
    spent += cnt.nodes;
    if (cnt.solutions !== 1 || cnt.stopped) { bd.sym[r][c] = held; continue; }
    removed++;
  }
  return { removed, spent };
}

export function build(rows, cols, seed, opts = {}) {
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const made = makeBoard(rows, cols, seed, opts);
  if (made.fail) return { fail: made.fail };
  const { bd, mask } = made;
  const before = bd.sym.flat().filter((v) => v !== '.').length;
  const d = dig(bd, mask, { seed: seed * 7919 + 1 });
  const pen = solve(bd);
  const cnt = countSolutions(bd);
  const ms = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - now;
  const answer = cnt.first || mask;
  const legal = satisfies(bd, answer, prep(bd));
  if (cnt.stopped) return { fail: 'counter stopped during dig', nodes: cnt.nodes, spent: d.spent };
  if (cnt.solutions !== 1) return { fail: cnt.solutions ? `not unique (${cnt.solutions})` : 'no solution', spent: d.spent };
  if (!pen.done) return { fail: 'pencil stalls on the dug board', spent: d.spent };
  if (legal.length) return { fail: 'answer illegal: ' + legal.join(','), spent: d.spent };
  return {
    bd, answer, laid: mask, pencilMask: Array.from(pen.mask),
    before, clues: before - d.removed, removed: d.removed,
    rooms: bd.room.flat().reduce((a, k) => Math.max(a, k + 1), 0),
    loopCells: answer.filter((m) => pop(m) === 2).length,
    steps: pen.steps, cuts: [...pen.fired.values()].reduce((a, b) => a + b, 0), spent: d.spent + cnt.nodes,
    nodes: cnt.nodes, stopped: cnt.stopped, illegal: legal,
    ms, fired: [...pen.fired].map(([name, times]) => `${name}x${times}`),
  };
}

// ── 页面用的那一层 ─────────────────────────────────────────────────────────
// 同一个 seed 画同一张盘：画不成就顺延下一个 seed（决定论，换机器也一样），
// 所以存档只需要记 seed，不需要记盘面对。
export const MAX_ATTEMPTS = 24;

// async 只是为了能把浏览器让出去一次一试：7×7 的最坏一次要跑几秒，不让出去页面就
// 是「点了没反应的死窗口」，而那正是玩家判断「这页坏了」的唯一依据。
export async function makePuzzle(sizeKey, seed, { tick = null } = {}) {
  const t = parseSize(sizeKey);
  let lastFail = 'no attempt';
  for (let a = 0; a < MAX_ATTEMPTS; a++) {
    if (tick) await tick();
    const use = (seed >>> 0) + a * 101;
    const built = build(t.rows, t.cols, use);
    if (!built.fail) {
      return {
        sizeKey: t.key, rows: t.rows, cols: t.cols, seed: use, attempts: a + 1,
        room: built.bd.room, sym: built.bd.sym, answer: built.answer,
        clues: built.clues, rooms: built.rooms, loopCells: built.loopCells,
        nodes: built.nodes, steps: built.steps, cuts: built.cuts, spent: built.spent, fired: built.fired,
      };
    }
    lastFail = built.fail;
  }
  return { fail: `no board in ${MAX_ATTEMPTS} seeds (${lastFail})` };
}

export function toView(p) {
  return { rows: p.rows, cols: p.cols, room: p.room, sym: p.sym };
}
