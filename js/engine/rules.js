// Moonsun (月さん / Nikoli "Moon-or-Sun") — rules + exhaustive counter.
//
// Link-based model: each cell carries a shape mask of the four loop links
// (UP|RIGHT|DOWN|LEFT); a cell is on the loop iff exactly two bits are set.
// Two adjacent ON cells are NOT implicitly linked -- the loop is the edge set.
//
// Counter: row-major DFS over per-cell shapes.  Cell i fixes the links to its
// RIGHT and DOWN neighbours, so every edge is decided exactly once.  Pruning is
// only the puzzle text (degree, room crossed twice, room symbol rule) plus
// "a closed cycle must be the whole loop"; the leaf re-checks the board with
// satisfies(), an independently written walk-the-loop translation.
export const UP = 0, RIGHT = 1, DOWN = 2, LEFT = 3;
export const DR = [-1, 0, 1, 0], DC = [0, 1, 0, -1];
export const OPP = [DOWN, LEFT, UP, RIGHT];
export const bit = d => 1 << d;
export const pop = m => (m & 1) + ((m >> 1) & 1) + ((m >> 2) & 1) + ((m >> 3) & 1);
export const PAIRS = [
  bit(UP) | bit(DOWN), bit(LEFT) | bit(RIGHT),
  bit(UP) | bit(RIGHT), bit(RIGHT) | bit(DOWN),
  bit(DOWN) | bit(LEFT), bit(LEFT) | bit(UP),
];
export const OPTIONS = [0, ...PAIRS];

export function prep(bd) {
  const { rows, cols } = bd;
  const n = rows * cols;
  const nb = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const a = [-1, -1, -1, -1];
    for (let d = 0; d < 4; d++) {
      const rr = r + DR[d], cc = c + DC[d];
      if (rr >= 0 && rr < rows && cc >= 0 && cc < cols) a[d] = rr * cols + cc;
    }
    nb.push(a);
  }
  const rid = new Int16Array(n), sym = new Int8Array(n);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const i = r * cols + c;
    rid[i] = bd.room[r][c];
    sym[i] = bd.sym[r][c] === 'M' ? 1 : bd.sym[r][c] === 'S' ? 2 : 0;
  }
  const strict = bd.strictLabel !== false;      // default: strict reading
  const R = Math.max(...rid) + 1;
  const cells = [], moons = [], suns = [], cross = [];
  for (let k = 0; k < R; k++) { cells[k] = []; moons[k] = []; suns[k] = []; cross[k] = []; }
  for (let i = 0; i < n; i++) {
    cells[rid[i]].push(i);
    if (sym[i] === 1) moons[rid[i]].push(i);
    else if (sym[i] === 2) suns[rid[i]].push(i);
  }
  for (let i = 0; i < n; i++) for (let d = 0; d < 4; d++) {
    const j = nb[i][d];
    if (j > i && rid[i] !== rid[j]) { cross[rid[i]].push([i, j, d]); cross[rid[j]].push([i, j, d]); }
  }
  return { n, rows, cols, nb, rid, sym, R, cells, moons, suns, cross, strict };
}

export const isOn = (mask, i) => pop(mask[i]) === 2;
export const dir = (P, i, j) => P.nb[i].indexOf(j);

// One source of truth for "is this legal". The win check, the red marks on the
// board and the counter's leaf all read this list, so the picture cannot
// disagree with the clause table. `text` is the machine token (what the gates
// and the probes print); `code` picks the sentence the player sees, `cells` is
// the part of the board that clause is pointing at.
export function checks(bd, mask, P = prep(bd)) {
  const out = [];
  // level: 'warn' = 环还没接完（玩家画到一半），'error' = 这一条条款被违反了。
  const note = (code, text, cells, level = 'error') => out.push({ code, text, cells: cells || [], level });
  for (let i = 0; i < P.n; i++) {
    if (mask[i] !== 0 && pop(mask[i]) !== 2) note('degree', `deg${i}:${pop(mask[i])}`, [i], pop(mask[i]) === 1 ? 'warn' : 'error');
    for (let d = 0; d < 4; d++) {
      const j = P.nb[i][d];
      const mine = (mask[i] >> d) & 1;
      if (j < 0) { if (mine) note('edge', `out${i}`, [i]); continue; }
      if (mine !== ((mask[j] >> OPP[d]) & 1)) note('asym', `asym${i}d${d}`, [i, j], 'warn');
    }
  }
  if (out.length) return out;
  const on = Array.from(mask, m => pop(m) === 2);
  const cnt = on.filter(Boolean).length;
  if (!cnt) { note('empty', 'empty', [], 'warn'); return out; }
  const start = on.indexOf(true);
  const seen = new Set([start]);
  let prev = -1, cur = start, steps = 0, broke = null;
  for (;;) {
    let nx = -1;
    for (let d = 0; d < 4; d++) {
      const j = P.nb[cur][d];
      if (j >= 0 && j !== prev && ((mask[cur] >> d) & 1)) { nx = j; break; }
    }
    // 'open' 曾是自己的一条码，但它到不了玩家眼前：走到断头之前那格的度数已经是 1，
    // 度数那条先红了。所以断头/runaway 都归给 disjoint，只是 warn 级。
    if (nx < 0) { broke = 'deadend'; break; }
    prev = cur; cur = nx; steps++;
    if (cur === start) break;
    seen.add(cur);
    if (steps > P.n) { broke = 'runaway'; break; }
  }
  if (broke || cur !== start) note('disjoint', `${broke || 'open'}:${steps}`, [...seen], 'warn');
  else if (seen.size !== cnt) note('disjoint', `multi:${cnt - seen.size}`, on.map((v, i) => (v && !seen.has(i) ? i : -1)).filter(i => i >= 0));
  for (let k = 0; k < P.R; k++) {
    const cr = P.cross[k].filter(([i, j, d]) => ((mask[i] >> d) & 1) === 1 && ((mask[j] >> OPP[d]) & 1) === 1).length;
    if (cr !== 2) note('cross', `cross${k}:${cr}`, paint(P, k, on));
    const mv = P.moons[k].filter(i => on[i]).length, sv = P.suns[k].filter(i => on[i]).length;
    const okM = (P.strict ? P.moons[k].length > 0 : true) && mv === P.moons[k].length && sv === 0;
    const okS = (P.strict ? P.suns[k].length > 0 : true) && sv === P.suns[k].length && mv === 0;
    if (!okM && !okS) note('symbol', `sym${k}`, paint(P, k, on));
  }
  const seq = [];
  prev = -1; cur = start;
  for (let g = 0; g < cnt; g++) {
    seqPush(seq, P.rid[cur]);
    let nx = -1;
    for (let d = 0; d < 4; d++) { const j = P.nb[cur][d]; if (j >= 0 && j !== prev && ((mask[cur] >> d) & 1)) { nx = j; break; } }
    if (nx < 0 || nx === start) break;
    prev = cur; cur = nx;
  }
  while (seq.length > 1 && seq[0] === seq[seq.length - 1]) seq.pop();
  const label = k => (P.moons[k].some(i => on[i]) ? 1 : P.suns[k].some(i => on[i]) ? 2 : 0);
  for (let t = 0; t < seq.length; t++) {
    const a = seq[t], b = seq[(t + 1) % seq.length];
    if (label(a) && label(b) && label(a) === label(b)) note('alternation', `alt${a}-${b}`, paint(P, a, on).concat(paint(P, b, on)));
  }
  return out;
}
// The cells a room clause points at: the loop's cells inside it, or the whole
// room when the loop never gets in (an empty room is exactly the case the
// player needs to see).
function paint(P, k, on) {
  const hit = P.cells[k].filter(i => on[i]);
  return hit.length ? hit : P.cells[k].slice();
}
export const satisfies = (bd, mask, P = prep(bd)) => checks(bd, mask, P).map(v => v.text);
function seqPush(seq, r) { if (!seq.length || seq[seq.length - 1] !== r) seq.push(r); }

// What the player is told when a clause fails. Every code `checks` can emit has
// a row here — tools/engine-test.mjs asserts the two sets match, so a new clause
// cannot ship as a red cell with no sentence behind it.
export const CLAUSE_TEXT = {
  degree: '环经过一格就带走两条线：这格引出的线不是 2 条。',
  edge: '环线穿出了棋盘边界。',
  asym: '两格相邻却只有一格朝对方引线，这一头没接上。',
  disjoint: '环分成了互不相连的几段，题目要求的是一整条。',
  cross: '每个区域恰好被环穿过两次（穿过边界线，不是走进去）。',
  symbol: '环进哪个区域，就把那个区域的符号全走到、另一个符号一格都不碰。',
  alternation: '沿环走一圈，区域必须月亮、太阳交替。',
  empty: '还没有画出任何环线。',
};

// 条款的名字与顺序也只有一份：面板、README 的条款表、doctest 的对账都读这里。
// main.js 自己手抄一份 codes 数组的话，新增一条 checks() 就会既有红格、又有文案，
// 却在玩家那一栏里根本不存在——而少一行的面板看起来和满的一模一样。
export const CLAUSE_ORDER = ['degree', 'asym', 'disjoint', 'edge', 'cross', 'symbol', 'alternation', 'empty'];
export const CLAUSE_NAME = {
  degree: '每格两条线',
  asym: '两头都要接上',
  disjoint: '一条不许分段',
  edge: '不许出盘',
  cross: '每区穿两次',
  symbol: '区域的符号',
  alternation: '月日交替',
  empty: '空盘不算',
};

// ---- criterion 1 ----
// The node budget the shipping promise is written against: a board is only
// shippable if the exhaustive counter proves uniqueness inside it, and every
// tier in the size menu is measured against this same number.
export const CAP_WORK = 2000000;
export function countSolutions(bd, { cap = CAP_WORK, upTo = Infinity } = {}) {
  const P = prep(bd);
  const mask = new Int16Array(P.n);
  const par = new Int32Array(P.n);
  for (let i = 0; i < P.n; i++) par[i] = i;
  // no path compression: the DFS rolls back par[] entry by entry and a compressed
  // pointer would survive the rollback and report a cycle that is not there.
  const find = i => { while (par[i] !== i) i = par[i]; return i; };
  let nodes = 0, solutions = 0, stopped = false, first = null;
  let capped = false;                       // upTo reached: >= upTo solutions witnessed
  let closed = false;                       // a full cycle has already formed

  function feasible(k, cur) {
    let used = 0, poss = 0;
    for (const [i, j, d] of P.cross[k]) {
      if (i < cur) { if (((mask[i] >> d) & 1) === 1) used++; } else poss++;
    }
    if (used > 2 || used + poss < 2) return false;
    const mFeas = P.moons[k].every(i => !((mask[i] === 0) && i < cur)) && P.suns[k].every(i => pop(mask[i]) !== 2);
    const sFeas = P.suns[k].every(i => !((mask[i] === 0) && i < cur)) && P.moons[k].every(i => pop(mask[i]) !== 2);
    return mFeas || sFeas;
  }

  function dfs(cur) {
    if (stopped || capped) return;
    nodes++;
    if (nodes > cap) { stopped = true; return; }
    if (cur === P.n) {
      if (!satisfies(bd, mask, P).length) {
        solutions++;
        if (!first) first = Array.from(mask);
        if (solutions >= upTo) capped = true;
      }
      return;
    }
    const r = (cur / P.cols) | 0, c = cur % P.cols;
    let fixed = 0;
    if (r > 0 && ((mask[cur - P.cols] >> DOWN) & 1)) fixed |= bit(UP);
    if (c > 0 && ((mask[cur - 1] >> RIGHT) & 1)) fixed |= bit(LEFT);
    const cands = [];
    for (const m of OPTIONS) if ((m & (bit(UP) | bit(LEFT))) === fixed) cands.push(m);
    for (const m of cands) {
      if (closed && (m & ~fixed)) continue;   // no new link may start after the loop closed
      mask[cur] = m;
      const links = [], merges = [];
      let ok = true, nowClosed = false;
      for (const d of [RIGHT, DOWN]) {
        const j = P.nb[cur][d];
        if (j < 0 || !((m >> d) & 1)) continue;
        links.push([j, OPP[d]]);
        mask[j] |= bit(OPP[d]);
        const a = find(cur), b = find(j);
        if (a === b) { nowClosed = true; break; }
        par[a] = b; merges.push([a, b]);
        void j;
      }
      if (ok && !nowClosed) for (let k = 0; k < P.R; k++) if (!feasible(k, cur + 1)) { ok = false; break; }
      if (ok) {
        if (nowClosed) closed = true;
        dfs(cur + 1);
        if (nowClosed) closed = false;
      }
      for (const [j, d] of links) mask[j] &= ~bit(d);
      for (const [a] of merges) par[a] = a;
      mask[cur] = 0;
    }
  }
  dfs(0);
  return { solutions, nodes, stopped, capped, first, P };
}
