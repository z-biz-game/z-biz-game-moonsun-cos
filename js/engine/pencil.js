// Moonsun pencil solver: named rules only, never branches.
// State per cell: `used`/`free` bitmasks over the four link directions.
export const UP = 0, RIGHT = 1, DOWN = 2, LEFT = 3;
export const bit = d => 1 << d;
export const OPP = [DOWN, LEFT, UP, RIGHT];
export const DR = [-1, 0, 1, 0], DC = [0, 1, 0, -1];
export const pop = m => (m & 1) + ((m >> 1) & 1) + ((m >> 2) & 1) + ((m >> 3) & 1);

// The named rules this solver is allowed to use — the whole point of 判据 2 is
// that the board comes out of *these* clauses and nothing else, so the list is
// published (README's rule table and the in-game 提示 panel both read it) and
// tools/engine-test.mjs asserts every rule here exists in solve() and that the
// fired-report names are a subset of it. A rule that never fires anywhere gets
// deleted, not kept as decoration.
export const RULE_TEXT = {
  N0_有边即在环: '有一条线连进这格，这格就在环上。',
  N1_符号定标: '区域里一旦走到过某个符号，这个区域就是那个符号：同符号的格全要走，另一个符号一格都不碰。',
  N2_两越定边: '一个区域已经穿够两条边界，它剩下的边界就都不许再穿。',
  N3_度数满: '这格已经接了两条线，其余方向一律不能再接。',
  N4_唯一出路: '已定的那条线只剩一个方向还能接，就把它钉上。',
  N5_度数缺口: '在环上的格还差两条而只剩两个空方向 → 都接上；已确定不在环上的格一条线都不许接。',
  N7_房间必进: '每个区域都要被穿两次；能穿的那条边界只剩一条时，必走它。',
  N8_不成小环: '接上就会闭合成圈、而盘上还有没安排完的格或区域，这条线不能接。',
  N9_环序平衡: '月亮区与太阳区沿环交替，数量各占一半；一侧已经凑满，剩下的区域就全是另一侧。',
  N11_房内路径: '环在一个区域里是一整条路：两个穿越口是它的两端，必须走的格要能串成这条路。',
  N12_路径不达: '区域内一条还活着的路线都经过不了的格，不在环上。',
  N13_路径必达: '每条还活着的路线都绕不开的格，一定在环上。',
  N14_邻室交替: '所有活路都紧跟着进入的同一个区域，取与本区相反的符号。',
};
// 名单是**手写**的，不是 Object.keys(RULE_TEXT)：写成派生的话，`RULE_ORDER` 与
// `RULE_TEXT` 同集合那条断言（engine-test 的 A0）永远为真，删掉一行规则文本它照绿——
// 自我比较证明不了任何事。手写之后它是一份独立的陈述，两边各漂一半都会红。
export const RULE_ORDER = ['N0_有边即在环', 'N1_符号定标', 'N2_两越定边', 'N3_度数满', 'N4_唯一出路',
  'N5_度数缺口', 'N7_房间必进', 'N8_不成小环', 'N9_环序平衡', 'N11_房内路径',
  'N12_路径不达', 'N13_路径必达', 'N14_邻室交替'];

export function solve(bd, { maxSteps = 500, audit = null } = {}) {
  const { rows, cols } = bd;
  const n = rows * cols;
  const nb = [], rid = [], sym = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const a = [-1, -1, -1, -1];
    for (let d = 0; d < 4; d++) {
      const rr = r + DR[d], cc = c + DC[d];
      if (rr >= 0 && rr < rows && cc >= 0 && cc < cols) a[d] = rr * cols + cc;
    }
    nb.push(a); rid.push(bd.room[r][c]);
    sym.push(bd.sym[r][c] === 'M' ? 1 : bd.sym[r][c] === 'S' ? 2 : 0);
  }
  const R = Math.max(...rid) + 1;
  const cells = [], moons = [], suns = [], cross = [];
  for (let k = 0; k < R; k++) { cells[k] = []; moons[k] = []; suns[k] = []; cross[k] = []; }
  for (let i = 0; i < n; i++) {
    cells[rid[i]].push(i);
    if (sym[i] === 1) moons[rid[i]].push(i); else if (sym[i] === 2) suns[rid[i]].push(i);
  }
  for (let i = 0; i < n; i++) for (let d = 0; d < 4; d++) {
    const j = nb[i][d];
    if (j > i && rid[i] !== rid[j]) { cross[rid[i]].push([i, j, d]); cross[rid[j]].push([i, j, d]); }
  }
  const used = new Int16Array(n), unk = new Int16Array(n);
  for (let i = 0; i < n; i++) for (let d = 0; d < 4; d++) if (nb[i][d] >= 0) unk[i] |= bit(d);
  const onCell = new Int8Array(n).fill(-1);     // -1 unknown, 1 on the loop, 0 off
  const label = new Int8Array(R).fill(0);       // 0 unknown, 1 moon room, 2 sun room
  const labelBy = new Array(R).fill('');       // which named rule fixed each label
  const fired = new Map();
  const log = name => fired.set(name, (fired.get(name) || 0) + 1);
  // audit.truth: the board's known solution. Any decision that contradicts it is a bug
  // in the rule that made it, so the stack is printed at the first mismatch.
  let audited = false;
  function check(kind, i, d, v) {
    if (!audit || audited) return;
    const t = audit.truth;
    const wrong = kind === 'link' ? (((t[i] >> d) & 1) !== (v ? 1 : 0)) : (pop(t[i]) === 2) !== (v === 'on');
    if (!wrong) return;
    audited = true;
    console.log(`AUDIT ${kind} cell ${i} d${d}=${v} truth ${(t[i] >> d) & 1} (shape ${t[i]})`);
    console.log(new Error('rule blamed').stack.split('\n').slice(1, 6).join('\n'));
  }

  const pending = [];
  function setLink(i, d, v) {
    if (!(unk[i] & bit(d))) return false;
    check('link', i, d, v);
    const j = nb[i][d];
    unk[i] &= ~bit(d); used[i] |= v ? bit(d) : 0;
    if (j >= 0) { unk[j] &= ~bit(OPP[d]); if (v) { used[j] |= bit(OPP[d]); pending.push(j); } }
    if (v) pending.push(i);
    return true;
  }
  function flushPending() {
    let any = false;
    while (pending.length) { const i = pending.pop(); if (onCell[i] === -1) { onCell[i] = 1; any = true; } else if (onCell[i] === 0) { contradictionRef = `used link on off cell ${i}`; } }
    if (any) log('N0_有边即在环');
    return any;
  }
  function markOn(i) {
    check('cell', i, -1, 'on');
    if (onCell[i] === 1) return true;
    if (onCell[i] === 0) return false;
    onCell[i] = 1; return true;
  }
  function markOff(i) {
    check('cell', i, -1, 'off');
    if (onCell[i] === 0) return true;
    if (onCell[i] === 1) return false;
    onCell[i] = 0;
    for (let d = 0; d < 4; d++) if (unk[i] & bit(d)) setLink(i, d, false);
    return true;
  }
  const isOn = i => onCell[i] === 1 || pop(used[i]) === 2;
  const isOff = i => onCell[i] === 0 || (unk[i] === 0 && pop(used[i]) === 0);
  const usedCross = k => cross[k].filter(([i, , d]) => (used[i] >> d) & 1).length;
  const freeCross = k => cross[k].filter(([i, , d]) => (unk[i] >> d) & 1).length;
  const strict = bd.strictLabel !== false;

  function labelPossible(k, L) {
    if (label[k] && label[k] !== L) return false;
    const want = L === 1 ? moons[k] : suns[k], avoid = L === 1 ? suns[k] : moons[k];
    if (strict && !want.length) return false;   // STRICT: the label must occur in the room
    for (const i of want) if (onCell[i] === 0) return false;
    for (const i of avoid) if (onCell[i] === 1) return false;
    return true;
  }
  function requiredCells(k, L) {
    const set = new Set(L === 1 ? moons[k] : suns[k]);
    for (const i of cells[k]) if (isOn(i)) set.add(i);
    return set;
  }
  // Is there one simple path inside room k from ea to eb that visits every cell the
  // room must visit (plus `extra`)? Giving up on the budget answers "yes" so a choice
  // is never cut on an unfinished search.
  function pathExists(k, ea, eb, L, extra = -1, avoid = -1) {
    const req = requiredCells(k, L);
    if (extra >= 0) req.add(extra);
    // a room visited as label L touches no cell of the opposite symbol, so those cells
    // can never be part of its path.
    const allowed = new Set(cells[k].filter(i => onCell[i] !== 0 && sym[i] !== 3 - L && i !== avoid));
    if (!allowed.has(ea) || !allowed.has(eb)) return false;
    for (const i of req) if (!allowed.has(i)) return false;
    if (ea === eb) return [...req].every(i => i === ea);
    let budget = 20000, hit = false;
    const seen = new Set([ea]);
    const dfs = y => {
      if (hit) return;
      if (!budget--) { hit = true; return; }
      if (y === eb) { if ([...req].every(i => seen.has(i))) hit = true; return; }
      for (let d = 0; d < 4; d++) {
        const z = nb[y][d];
        if (z < 0 || rid[z] !== k || seen.has(z) || !allowed.has(z)) continue;
        if (z === eb && ![...req].every(i => i === z || seen.has(i))) continue;
        seen.add(z); dfs(z); seen.delete(z);
      }
    };
    dfs(ea);
    return hit;
  }
  // the room's surviving choices: crossing pair + label that can still cover the room
  function roomChoices(k) {
    const links = [];
    for (const [i, j, d] of cross[k]) {
      const ins = rid[i] === k ? i : j, dir = rid[i] === k ? d : OPP[d], out = rid[i] === k ? j : i;
      const free = (unk[ins] >> dir) & 1, on = (used[ins] >> dir) & 1;
      if (free || on) links.push({ cell: ins, dir, out });
    }
    const usedLinks = links.filter(L => (used[L.cell] >> L.dir) & 1);
    if (usedLinks.length > 2) return { links, bad: `N11 room ${k} crossings` };
    const ok = [];
    for (let a = 0; a < links.length; a++) for (let b = a + 1; b < links.length; b++) {
      const pair = [links[a], links[b]];
      // the loop leaves and re-enters each room once, so its two crossings of a room
      // go into two different rooms
      if (rid[pair[0].out] === rid[pair[1].out]) continue;
      if (!usedLinks.every(L => pair.some(P => P.cell === L.cell && P.dir === L.dir))) continue;
      for (const L of (label[k] ? [label[k]] : [1, 2])) {
        if (!labelPossible(k, L)) continue;
        if (!pathExists(k, pair[0].cell, pair[1].cell, L)) continue;
        ok.push({ pair, label: L });
      }
    }
    return { links, ok };
  }
  function setLabel(k, want, name) {
    if (label[k] === want) return false;
    if (label[k]) { contradictionRef = `${name} room ${k} label`; return false; }
    label[k] = want; labelBy[k] = name; log(name);
    for (const i of (want === 1 ? moons[k] : suns[k])) if (onCell[i] !== 1 && !markOn(i)) contradictionRef = `${name} room ${k}`;
    for (const i of (want === 1 ? suns[k] : moons[k])) if (onCell[i] !== 0 && !markOff(i)) contradictionRef = `${name} room ${k}`;
    return true;
  }

  let steps = 0, changed = true, contradiction = null, contradictionRef = null;
  while (changed && steps++ < maxSteps) {
    changed = false;
    // N1_符号定标: only one label left for the room -> its symbol cells are all on, the other's off
    for (let k = 0; k < R; k++) {
      const mOk = moons[k].length > 0 && moons[k].every(i => !isOff(i)) && suns[k].every(i => !isOn(i));
      const sOk = suns[k].length > 0 && suns[k].every(i => !isOff(i)) && moons[k].every(i => !isOn(i));
      let want = 0;
      if (mOk && !sOk) want = 1;
      if (sOk && !mOk) want = 2;
      if (!mOk && !sOk) { contradiction = `N1 room ${k}`; break; }
      if (want && setLabel(k, want, 'N1_符号定标')) changed = true;
    }
    if (contradiction) break;
    // N6_交替 删了：它要在"已用的穿越边"上定邻区符号，而那条边一被用上，两个区域的符号
    // 早就被 N1（环走到了符号）或 N14（活路只剩一个符号）定完了。tools/engine-test.mjs 的
    // A5 在官方例题 + 36 张出货盘上数到它开火 0 次 —— 从不开火的规则是装饰，不是保险。
    // 交替这件事本身没有松：穷举侧 rules.js 的 alternation 条款照旧逐格复核。
    // N2_两越定边: room already crossed twice -> every other crossing link is cut
    for (let k = 0; k < R; k++) {
      const u = usedCross(k), f = freeCross(k);
      if (u === 2 && f > 0) {
        for (const [i, j, d] of cross[k]) if ((unk[i] >> d) & 1) { setLink(i, d, false); log('N2_两越定边'); changed = true; }
      }
      if (u + f < 2) { contradiction = `N2 room ${k}`; break; }
      // N4_唯一出路: one crossing left to give and exactly one free crossing link
      if (u === 1 && f === 1) {
        for (const [i, j, d] of cross[k]) if ((unk[i] >> d) & 1) { setLink(i, d, true); log('N4_唯一出路'); changed = true; }
      }
    }
    if (contradiction) break;
    for (let i = 0; i < n; i++) {
      const deg = pop(used[i]), free = pop(unk[i]);
      if (deg > 2) { contradiction = `N3 cell ${i}`; break; }
      // N3_度数满: two links already used, everything else is cut
      if (deg === 2 && free) {
        for (let d = 0; d < 4; d++) if ((unk[i] >> d) & 1) { setLink(i, d, false); log('N3_度数满'); changed = true; }
        continue;
      }
      // N5_度数缺口: a cell that must be on the loop with the last links left
      if (isOn(i)) {
        if (free === 0 && deg !== 2) { contradiction = `N5 cell ${i}`; break; }
        if (deg === 1 && free === 1) {
          for (let d = 0; d < 4; d++) if ((unk[i] >> d) & 1) { setLink(i, d, true); log('N5_度数缺口'); changed = true; }
        }
        if (deg === 0 && free === 2) {
          for (let d = 0; d < 4; d++) if ((unk[i] >> d) & 1) { setLink(i, d, true); log('N5_度数缺口'); changed = true; }
        }
        if (deg === 0 && free === 1) { contradiction = `N5 cell ${i}`; break; }
      }
      if (deg === 0 && free === 0 && onCell[i] === -1) { if (!markOff(i)) { contradiction = `N5 cell ${i}`; break; } log('N5_度数缺口'); changed = true; }
    }
    if (contradiction) break;
    // N7_房间必进: only one cell of the room can still be on the loop
    for (let k = 0; k < R; k++) {
      const cand = cells[k].filter(i => !isOff(i));
      if (cand.length === 0) { contradiction = `N7 room ${k}`; break; }
      if (cand.length === 1 && usedCross(k) === 0) {
        if (!markOn(cand[0])) { contradiction = `N7 room ${k}`; break; }
        log('N7_房间必进'); changed = true;
      }
    }
    if (flushPending()) changed = true;
    if (contradictionRef) { contradiction = contradictionRef; break; }
    // N9_环序平衡: the loop visits every room once and labels alternate, so exactly
    // half of the rooms are moon rooms and half are sun rooms. Once one side reaches
    // R/2 every room still without a label must take the other side.
    {
      const km = label.filter(v => v === 1).length, ks = label.filter(v => v === 2).length;
      const unknown = [];
      for (let k = 0; k < R; k++) if (!label[k]) unknown.push(k);
      if (R % 2) { contradiction = `N9 odd room count ${R}`; break; }
      if (km > R / 2 || ks > R / 2) { contradiction = `N9 balance ${km}/${ks} of ${R}`; break; }
      if (unknown.length) {
        if (km === R / 2 && ks < R / 2) for (const k of unknown) if (setLabel(k, 2, 'N9_环序平衡')) changed = true;
        else if (ks === R / 2 && km < R / 2) for (const k of unknown) if (setLabel(k, 1, 'N9_环序平衡')) changed = true;
      }
    }
    if (contradiction) break;
    if (contradictionRef) { contradiction = contradictionRef; break; }
    // N11_房内路径 / N12_路径不达: enumerate each room's surviving choices (crossing
    // pair + label with a covering path inside the room). A crossing link in no choice
    // is cut, a pair shared by the only choice is pinned, a room whose choices all take
    // one label takes that label, and a cell no choice can reach is off the loop.
    {
      for (let k = 0; k < R; k++) {
        const { links, ok, bad } = roomChoices(k);
        if (bad) { contradiction = bad; break; }
        if (!ok.length) { contradiction = `N11 room ${k}`; break; }
        const union = new Set(), every = ok.length === 1 ? new Set(ok[0].pair.map(L => L.cell + ':' + L.dir)) : null;
        const labels = [];
        for (const o of ok) {
          if (!labels.includes(o.label)) labels.push(o.label);
          for (const L of o.pair) union.add(L.cell + ':' + L.dir);
        }
        if (!label[k] && labels.length === 1) { if (setLabel(k, labels[0], 'N11_房内路径')) changed = true; continue; }
        for (const L of links) {
          const key = L.cell + ':' + L.dir, isUsed = (used[L.cell] >> L.dir) & 1;
          if (!union.has(key)) {
            if (isUsed) { contradiction = `N11 room ${k}`; break; }
            setLink(L.cell, L.dir, false); log('N11_房内路径'); changed = true;
          } else if (every && every.has(key) && !isUsed) { setLink(L.cell, L.dir, true); log('N11_房内路径'); changed = true; }
        }
        for (const i of cells[k]) {
          if (onCell[i] !== -1) continue;
          if (ok.some(o => pathExists(k, o.pair[0].cell, o.pair[1].cell, o.label, i))) continue;
          if (markOff(i)) { log('N12_路径不达'); changed = true; }
          else { contradiction = `N12 cell ${i}`; break; }
        }
        // N13_路径必达: a cell no surviving room path can avoid is on the loop.
        for (const i of cells[k]) {
          if (onCell[i] !== -1) continue;
          if (ok.some(o => pathExists(k, o.pair[0].cell, o.pair[1].cell, o.label, -1, i))) continue;
          if (markOn(i)) { log('N13_路径必达'); changed = true; }
          else { contradiction = `N13 cell ${i}`; break; }
        }
        // N14_邻室交替: a room the loop must enter straight after k takes the opposite
        // label — k's neighbour rooms shared by every surviving choice.
        if (label[k]) {
          const rooms = ok.map(o => [rid[o.pair[0].out], rid[o.pair[1].out]]);
          for (const m of new Set(rooms[0])) {
            if (m === k) continue;
            if (rooms.every(r => r.includes(m))) {
              const opp = 3 - label[k];
              if (label[m] && label[m] !== opp) { contradiction = `N14 room ${k}/${m}`; break; }
              if (setLabel(m, opp, 'N14_邻室交替')) changed = true;
            }
          }
        }
      }
      if (contradiction) break;
      if (contradictionRef) { contradiction = contradictionRef; break; }
    }
    // N8_不成小环: a free link that would close a cycle while cells are still undecided
    if (steps > 1) {
      const open = [];
      for (let i = 0; i < n; i++) if (onCell[i] !== 0 && pop(used[i]) !== 2) open.push(i);
      if (open.length) {
        for (let i = 0; i < n; i++) for (let d = 0; d < 4; d++) {
          if (!((unk[i] >> d) & 1)) continue;
          const j = nb[i][d];
          if (j < 0) continue;
          if (wouldClose(i, j) && stillNeeded(i, j)) { setLink(i, d, false); log('N8_不成小环'); changed = true; }
        }
      }
    }
    if (contradiction) break;
  }
  function parent(x, seen) {
    // walk the used links from x, return the set of cells in its component
    const comp = new Set([x]), q = [x];
    while (q.length) { const y = q.pop(); for (let d = 0; d < 4; d++) if (((used[y] >> d) & 1) && nb[y][d] >= 0) { const z = nb[y][d]; if (!comp.has(z)) { comp.add(z); q.push(z); } } }
    void seen; return comp;
  }
  function wouldClose(i, j) { return pop(used[i]) === 1 && pop(used[j]) === 1 && parent(i).has(j); }
  // Would closing the cycle here leave work undone? The link being added is itself a
  // crossing of both rooms it joins, and every cell already known ON has to sit on it.
  function stillNeeded(i, j) {
    const comp = parent(i);
    const joins = rid[i] !== rid[j];
    for (let k = 0; k < R; k++) if (usedCross(k) + (joins && (k === rid[i] || k === rid[j]) ? 1 : 0) < 2) return true;
    for (let t = 0; t < n; t++) if (onCell[t] === 1 && !comp.has(t)) return true;
    return false;
  }

  const undetermined = [];
  for (let i = 0; i < n; i++) {
    for (let d = 0; d < 4; d++) if ((unk[i] >> d) & 1) undetermined.push(`${i}d${d}`);
    if (onCell[i] === -1 && pop(unk[i]) !== 0) undetermined.push(`cell${i}?`);
  }
  const mask = new Int16Array(n);
  for (let i = 0; i < n; i++) mask[i] = used[i];
  return { done: undetermined.length === 0 && !contradiction, contradiction, fired, steps, mask, unk: Array.from(unk), used: Array.from(used), onCell: Array.from(onCell), label: Array.from(label), labelBy, undetermined };
}
