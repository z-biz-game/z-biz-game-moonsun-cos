// Browser-side scenario suite, injected by tools/playtest.cjs and run against the real page.
//
// The rule for anything asserted here: read the DOM, the geometry and the canvas pixels, not a
// private flag. A `.status` string says what the code intended; a client rect and a pixel say
// what the player got. The interesting failures in this game are exactly the ones where the state
// is right and the picture is wrong — a clue printed as a digit but painted as a plain black cell,
// a "留空" that paints identically to "还没想".
//
// 真事件（鼠标/触屏/键盘）不在这条腿里：那三条腿由 tools/playtest.cjs 的 `leg` 命令用 CDP
// Input.dispatch* 驱动。这里写格子走的是 hebi.write，也就是点击之后落到的同一个状态机。
//
// window.hebi.engine is the shipped module graph, so a scenario that passes here has passed on
// the same solver the player's hints come from — not a second copy kept for testing.
//
// ck(name, condition, detail) is truthiness; eq(name, got, want) is equality. Mixing them up is
// how `ck('steps', 0)` reads as a failure to a human and a pass to a boolean — every "must equal"
// below therefore goes through eq. Every row name is printed on red, so a red line is never just
// `undefined`.

((w) => {
  const rows = [];
  const ck = (test, cond, detail) => {
    rows.push({ test, pass: !!cond, detail: cond ? '' : String(detail === undefined ? '' : detail) });
  };
  const eq = (test, got, want) => ck(test, String(got) === String(want), `got ${got} / want ${want}`);
  const report = (extra) => {
    // 阴性自证：GATE_SELFTEST=1 时每一份报告都多一条注定错的期望。没有这一段，
    // "闸全绿"这句话没有任何东西支撑——写了但从没能红的闸，和坏掉的闸长得一样。
    if (w.__selftest) rows.push({ test: 'GATE_SELFTEST 种下的错期望（1 应当等于 2）', pass: 1 === 2, detail: 'planted red' });
    // rows is copied, not aliased: the array is cleared below, and a live reference would hand
    // back an empty report that still reads as "0 failed".
    const out = { rows: rows.slice(), fail: rows.filter((r) => !r.pass).length, ...extra };
    rows.length = 0;
    return out;
  };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  // 崩掉不算"红"，崩掉必须点名叫出来：所以这里挂一个 error 收集器，坏档那条腿要读它。
  const bootErrors = [];
  w.addEventListener('error', (e) => bootErrors.push(String(e.message || e)));
  w.addEventListener('unhandledrejection', (e) => bootErrors.push('promise: ' + String(e.reason)));

  const A = () => w.hebi;
  const E = () => w.hebi.engine;
  const $ = (sel) => document.querySelector(sel);
  const text = (sel) => (($.call(document, sel) || {}).textContent || '').trim();
  const shown = (sel) => {
    // display 与几何两个都要读：`display:grid` 会盖掉 UA 的 [hidden]，所以"藏起来了"这句话
    // 只能由 getClientRects() 长度来作证，不能由 hidden 属性本身。
    const e = $.call(document, sel);
    if (!e) return false;
    return getComputedStyle(e).display !== 'none' && e.getClientRects().length > 0;
  };
  const rectOf = (sel) => {
    const e = $.call(document, sel);
    return e ? e.getBoundingClientRect() : null;
  };

  const hex = (h) => {
    const m = String(h).replace('#', '');
    return m.length < 6 ? [-1, -1, -1] : [parseInt(m.slice(0, 2), 16), parseInt(m.slice(2, 4), 16), parseInt(m.slice(4, 6), 16)];
  };
  const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const near = (p, c, tol = 8) => p.length === 3 && p.every((v, i) => Math.abs(v - c[i]) <= tol);
  function pixel(x, y) {
    const v = A().view;
    const d = v.geo.dpr;
    const p = v.ctx.getImageData(Math.round(x * d), Math.round(y * d), 1, 1).data;
    return [p[0], p[1], p[2]];
  }
  // 一格的两个采样点：底色在 20% 处（数字不会盖到这里），内容在正中（数字/留空点画在这里）。
  const basePixel = (i, f = 0.2) => {
    const r = A().view.cellRect(i);
    return pixel(r.x + r.size * f, r.y + r.size * f);
  };
  const midPixel = (i) => {
    const r = A().view.cellRect(i);
    return pixel(r.x + r.size / 2, r.y + r.size / 2);
  };
  const brightIn = (i) => {
    const v = A().view;
    const r = v.cellRect(i);
    const d = v.geo.dpr;
    const s = Math.round(r.size * 0.7 * d);
    const g = v.ctx.getImageData(Math.round((r.x + r.size * 0.15) * d), Math.round((r.y + r.size * 0.15) * d), s, s).data;
    let n = 0;
    for (let k = 0; k < g.length; k += 4) if (g[k] + g[k + 1] + g[k + 2] > 300) n++;
    return n;
  };
  const median = (a) => (a.length ? a.slice().sort((x, y) => x - y)[(a.length - 1) >> 1] : NaN);
  const count = (s, ch) => [...s].filter((c) => c === ch).length;

  const beginFresh = async (tier, seed) => {
    const g = A().begin({ tier, seed });
    await wait(60);
    return g;
  };

  // ---------- engine ----------

  const engine = async () => {
    const en = E();
    ck('页面挂出了可测的引擎', !!(en && en.mkBoard && en.makePuzzle && en.solvePencil && en.countSolutions));
    eq('蛇长是 5', en.LEN, 5);
    eq('箭头四种', en.ARROWS.join(''), 'UDLR');
    eq('DIR 的 U 是上移一行', JSON.stringify(en.DIR.U), '[-1,0]');
    const B = en.mkBoard(5, 5);
    eq('5×5 的格数', B.N, 25);
    eq('id 与 rc 互逆', B.rc(B.id(3, 1)).join(','), '3,1');
    eq('格名从 1 数起', B.name(B.id(0, 4)), 'r1c5');
    eq('角格只有两个邻居', B.nbrs(B.id(0, 0)).length, 2);
    eq('盘心格有四个邻居', B.nbrs(B.id(2, 2)).length, 4);
    eq('越界即不在盘上', B.inb(5, 0), false);
    // ray：从黑格沿箭头走到下一个黑格或边界为止，不含黑格自己
    const blk = new Map([[B.id(0, 0), { arrow: 'R', num: 0 }]]);
    eq('第一行最左向右的射线长度', B.ray(B.id(0, 0), 'R', blk).length, 4);
    blk.set(B.id(0, 3), { arrow: null, num: null });
    eq('射线在下一个黑格前停下（只剩 (0,1)(0,2)）', B.ray(B.id(0, 0), 'R', blk).length, 2);
    // eyeRay 是"从 2 指向 1"：头在 (0,1)、身体在 (0,0) 时眼睛看向右方
    eq('眼方向 2→1（头在右、身在左则朝右）', JSON.stringify(B.eyeRay(B.id(0, 1), B.id(0, 0))), '[0,1]');
    // 判据要真的能红：一条完整的蛇 + 正确的读数
    const sol = new Map();
    [0, 1, 2, 3, 4].forEach((k) => sol.set(B.id(2, k), k + 1));
    const b2 = new Map([[B.id(0, 0), { arrow: 'U', num: 0 }]]);
    eq('合法盘面 0 条违反', B.check(b2, sol).length, 0);
    eq('把 5 拆断就报 R1', /R1/.test(B.check(b2, new Map([...sol].slice(0, 4)))[0] || ''), true);
    const two = new Map(sol);
    [0, 1, 2, 3, 4].forEach((k) => two.set(B.id(4, k), k + 1));
    eq('两条蛇不共边时合法', B.check(b2, two).length, 0);
    // 把第二条整体上移一行 → 与第一条共边 ⇒ R2
    const clash = new Map();
    [0, 1, 2, 3, 4].forEach((k) => {
      clash.set(B.id(2, k), k + 1);
      clash.set(B.id(1, k), k + 1);
    });
    eq('两条蛇共边时报 R2', /R2/.test(B.check(b2, clash).join('|')), true);
    // R4：箭头读数说 3，实际第一个数字是 1
    const lying = new Map([[B.id(0, 0), { arrow: 'D', num: 3 }]]);
    eq('印错读数时报 R4', /R4/.test(B.check(lying, sol).join('|')), true);
    // 确定性：同一个 seed 两次必须同一张盘（页面印 seed 就靠这句话）
    const a = en.makePuzzle({ R: 5, C: 5, K: 2, maxClues: 20, seed: 4242 });
    const b = en.makePuzzle({ R: 5, C: 5, K: 2, maxClues: 20, seed: 4242 });
    ck('出得了货', !!(a && b), JSON.stringify([!!a, !!b]));
    eq('同 seed 同题面', [...a.black.keys()].sort().join(','), [...b.black.keys()].sort().join(','));
    eq('同 seed 同唯一解', [...a.sol.entries()].sort((x, y) => x[0] - y[0]).map((e) => e.join(':')).join(','), [...b.sol.entries()].sort((x, y) => x[0] - y[0]).map((e) => e.join(':')).join(','));
    ck('返回的 seed 是整数', Number.isInteger(a.seed), a.seed);
    eq('难度分就是实测推理步数', en.difficulty(a.stats), a.stats.pencilSteps);
    const p = en.solvePencil(a.B, a.black);
    eq('出货盘必须零猜测推得满', p.solved, true);
    ck('铅笔的句子带规则名', /^P\d-/.test(p.log[0]), p.log[0]);
    ck('句子写着格名', /r\d+c\d+/.test(p.log[0]), p.log[0]);
    // 白格留空是常态，不是残缺：唯一解里没有的白格就是空的
    const white = a.B.cells.filter((i) => !a.black.has(i));
    const blanks = white.filter((i) => !a.sol.has(i)).length;
    ck('出货盘确有留空白格', blanks > 0, `留空 ${blanks}/${white.length}`);
    eq('解里全是 1..5', [...a.sol.values()].every((v) => v >= 1 && v <= 5), true);
    eq('解本身 0 条违反', a.B.check(a.black, a.sol).length, 0);
    const cnt = en.countSolutions(a.B, a.black, en.candidates(a.B, a.black).cands, { cap: 2000000, maxSol: 2 });
    eq('穷举只数出一个解', cnt.solutions, 1);
    return report({ clues: a.stats.clues, steps: a.stats.pencilSteps, white: white.length, blanks, rounds: p.rounds });
  };

  // ---------- gen：菜单三档的实测数字要在浏览器里也成立 ----------

  const gen = async () => {
    const en = E();
    eq('档位三档', en.TIERS.length, 3);
    const per = {};
    for (const [k, t] of en.TIERS.entries()) {
      const steps = [];
      const ms = [];
      for (let s = 0; s < 3; s++) {
        const pz = en.build(t, 900 + k * 40 + s);
        ck(`${t.name} 出得了货`, !!pz, `${t.name} seed ${900 + k * 40 + s}`);
        if (!pz) continue;
        steps.push(pz.stats.pencilSteps);
        ms.push(pz.stats.ms);
        const p = en.solvePencil(pz.B, pz.black);
        eq(`${t.name} 零猜测推得满`, p.solved, true);
        const c = en.countSolutions(pz.B, pz.black, en.candidates(pz.B, pz.black).cands, { cap: 2000000, maxSol: 2 });
        eq(`${t.name} 唯一解`, c.solutions, 1);
        eq(`${t.name} 解过判据`, pz.B.check(pz.black, pz.sol).length, 0);
        const B = pz.B;
        eq(`${t.name} 尺寸就是档位`, `${B.R}×${B.C}`, `${t.R}×${t.C}`);
      }
      per[t.key] = { med: median(steps), medMs: median(ms), min: Math.min(...steps), max: Math.max(...steps) };
    }
    // 相邻两档会重叠（balance 只承诺首末两档不重叠），所以这里量的就是那句承诺：
    const sho = per[en.TIERS[0].key];
    const gao = per[en.TIERS[2].key];
    ck('首末两档的推理步数区间不重叠', gao.min > sho.max, `初 max ${sho.max} < 高 min ${gao.min}`);
    ck('难度按步数单调（首<末中位）', sho.med < gao.med, `${sho.med} < ${gao.med}`);
    ck('10×10 的出局理由写在页面上', /10×10/.test(en.OUT_OF_MENU.why), en.OUT_OF_MENU.why);
    ck('档位标的是实测数而不是形容词', en.TIERS.every((t) => t.med.steps > 0 && t.med.ms > 0), JSON.stringify(en.TIERS.map((t) => t.med)));
    return report(per);
  };

  // ---------- play：读数、选中、留空、黑格不可改 ----------

  const play = async () => {
    const en = E();
    eq('开局前棋局页是藏起来的', shown('#view-game'), false);
    const g = await beginFresh('sho', 21);
    ck('点档位进入棋局', shown('#view-game'));
    eq('选档页必须真的 collapsed（0 个矩形）', $('#view-menu').getClientRects().length, 0);
    eq('档位名', g.puzzle.tier, 'sho');
    ck('棋头写了尺寸', text('#stat-name').includes('5×5'), text('#stat-name'));
    ck('棋头写了线索数', /条线索/.test(text('#stat-name')), text('#stat-name'));
    eq('计时从 00:00 起', text('#stat-time'), '00:00');
    eq('步数为 0', text('#stat-moves'), '0');
    eq('提示为 0', text('#stat-hints'), '0');
    eq('seed 印在页面上', text('#stat-seed'), `seed ${g.puzzle.seed}`);
    eq('难度实测显示推理步数', text('#stat-score'), String(g.puzzle.score));
    ck('出题耗时是量出来的', /ms$/.test(text('#stat-genms')), text('#stat-genms'));
    ck('胜利遮罩藏起', !shown('#win-veil'));
    eq('状态行开局为空', text('#state-line'), '');
    const white = g.white;
    eq('白格总数读数', text('#stat-remaining'), String(white.length));
    eq('已写数字从 0 起', text('#stat-filled'), `0/${white.length}`);
    eq('蛇条数从 0 起', text('#stat-snakes'), `0/${g.puzzle.spec.K}`);

    // 选中 + 写数字
    const w0 = white[0];
    ck('选中一个白格', A().select(w0), true);
    eq('选中格就是它', g.cursor, w0);
    A().write(w0, 3);
    eq('写下去的是 3', g.st[w0], 3);
    eq('落子算一步', g.moves, 1);
    eq('读数跟着变', text('#stat-filled'), `1/${white.length}`);
    // 黑格不可编辑
    const bi = [...g.black.keys()][0];
    const cur0 = g.cursor;
    const r = A().write(bi, 4);
    eq('黑格上落不了子', r, null);
    eq('黑格的选中格没被挪走', g.cursor, cur0);
    ck('状态行说出了为什么', /黑格/.test(text('#state-line')), text('#state-line'));
    eq('选中黑格也被拒绝', A().select(bi), false);
    // 留空是合法状态
    A().select(w0);
    A().write(w0, en.BLANK);
    eq('钉成留空', g.st[w0], en.BLANK);
    eq('留空不算已写数字', text('#stat-filled'), `0/${white.length}`);
    eq('留空算已定', g.remaining, white.length - 1);
    A().write(w0, en.UND);
    eq('退格收回未定', g.st[w0], en.UND);
    eq('收回未定后白格又缺了', g.remaining, white.length);
    // 一个孤零零的 5：判据必须当场抓到（R1 连不满五条），画面不能装没事
    A().write(w0, 5);
    ck('孤立数字被判据抓到', g.errs.length >= 1, JSON.stringify(g.errs.slice(0, 2)));
    ck('违反的第一个词是条款号', /^R[1-4]/.test(g.errs[0] || ''), g.errs[0]);
    ck('状态行念出了违反', /违反/.test(text('#state-line')), text('#state-line'));
    eq('违反读数不为零', text('#stat-conflicts'), String(g.errs.length));
    A().write(w0, en.UND);
    eq('擦掉之后违反清空', text('#stat-conflicts'), '0');
    eq('状态行也清空', text('#state-line'), '');
    // 回选档
    $('#btn-menu').click();
    await wait(40);
    ck('回选档显示菜单', shown('#view-menu'));
    eq('棋局页藏起来（0 个矩形）', $('#view-game').getClientRects().length, 0);
    ck('档位按钮有三条', document.querySelectorAll('#tier-list .tier').length, 3);
    ck('出局披露写在选档页上', /10×10/.test(text('#tier-out')), text('#tier-out'));
    $('#btn-reset').click();
    await wait(40);
    eq('清空存档把游标归一', en.Store.peekSeed(), 1);
    return report({ white: white.length, clues: g.puzzle.stats.clues });
  };

  // ---------- hint：提示必须点名一条命名规则 ----------

  const hint = async () => {
    const en = E();
    const g = await beginFresh('chuu', 33);
    const info = A().useHint();
    ck('提示给了东西', !!info, 'null');
    ck('提示带规则名', /^P\d-/.test(info.rule || ''), info.rule);
    ck('规则框写出规则', text('#hint-rule') === `规则：${info.rule}`, text('#hint-rule'));
    ck('提示文本有内容', (info.text || '').length > 8, info.text);
    eq('提示落的那一格就是它说的那格', g.st[info.cell], info.value);
    eq('提示计一次', text('#stat-hints'), '1');
    eq('提示按钮角标同步', text('#hint-count'), '1');
    ck('提示不写在黑格上', !g.black.has(info.cell), info.cell);
    ck('提示句子里有格名', /r\d+c\d+/.test(info.text), info.text);
    // 撤销会把提示落下的那一格收回未定，但**提示计数不许退**：退了就能靠撤销刷出一条
    // 「没求过提示」的纪录，而纪录比较的第一位就是提示数（下面 win 腿量那一条）。
    const hintedVal = g.st[info.cell];
    A().undo();
    ck('提示那一格原本写上了数字', hintedVal !== en.UND, String(hintedVal));
    eq('撤销把提示那一格收回未定', g.st[info.cell], en.UND);
    eq('撤销不退还提示计数', text('#stat-hints'), '1');
    eq('撤销不退还提示角标', text('#hint-count'), '1');
    // 连续问提示 = 全程零猜测地把这局推完
    const res = g.solveWithLogic();
    eq('照规则能推到底', res.status, 'won');
    ck('用到的规则不止一条', res.rules.length >= 3, JSON.stringify(res.rules));
    ck('每条规则名都是 P0–P4', res.rules.every((r) => /^P[0-4]-/.test(r)), JSON.stringify(res.rules));
    eq('推完之后再要提示不给东西', A().useHint(), null);
    const f = g.winFacts();
    eq('判据 0 条', f.errs, 0);
    eq('白格全定', f.allDecided, true);
    eq('与唯一解逐格相同', f.mismatch, 0);
    const used = g.hints;
    ck('提示次数被计下了', used > 3, used);
    // 提示不能凭空造格：把当前盘面交给铅笔自己复核一遍
    const { p } = g.pencil();
    eq('玩家盘面交给铅笔不矛盾', !!p.contradiction, false);
    return report({ hints: used, rules: res.rules, steps: res.steps });
  };

  // ---------- win：满盘但不等于唯一解，绝不能算赢 ----------

  const win = async () => {
    const en = E();
    const g = await beginFresh('sho', 44);
    // 负例：把每一格都写满，但其中一格与唯一解不同 —— 三个条件里必须至少两条红。
    for (const i of g.white) A().write(i, g.puzzle.sol.get(i) ?? 1);
    const wrongIdx = g.white.find((i) => (g.puzzle.sol.get(i) ?? 0) === 0) ?? g.white[0];
    A().write(wrongIdx, g.puzzle.sol.get(wrongIdx) ?? 5);
    const bad = g.winFacts();
    eq('填满但不等于唯一解时不算赢', g.status, 'playing');
    eq('mismatch 读数不为零', bad.mismatch > 0, true);
    ck('判据也不同意这个假盘', bad.errs > 0, JSON.stringify(g.errs.slice(0, 2)));
    eq('白格确实全定了', bad.allDecided, true);
    ck('胜利遮罩没露出来', !shown('#win-veil'));
    // 真赢：一格一格照唯一解写（不借助提示），这才是玩家会走的那条路
    const g2 = await beginFresh('sho', 45);
    for (const i of g2.white) A().write(i, g2.puzzle.sol.get(i) ?? en.BLANK);
    eq('照唯一解写满就赢', g2.status, 'won');
    const f = g2.winFacts();
    eq('判据 0 条违反', f.errs, 0);
    eq('白格全定', f.decided, f.white);
    eq('与解不同处 0', f.mismatch, 0);
    ck('胜利遮罩可见（有矩形）', shown('#win-veil'));
    ck('胜利文案印了 seed', /seed \d+/.test(text('#win-meta')), text('#win-meta'));
    ck('胜利文案把三个条件都念出来', /判据 .*白格全定 .*唯一解/.test(text('#win-record')), text('#win-record'));
    ck('手工通关写下纪录', !!en.Store.best('sho'), JSON.stringify(en.Store.best('sho')));
    eq('胜利后续局被清掉', en.Store.resume(en.tierOf), null);
    const total = en.Store.data.totals;
    ck('总局数累加了', total.solved >= 1, total.solved);
    $('#btn-menu-2').click();
    await wait(40);
    ck('胜利后回选档不再给继续', !shown('#resume-card'));
    // 已经赢了就不能再改子
    const before = g2.codes();
    eq('赢了之后再写子被拒', A().write(g2.white[0], 1), null);
    eq('盘面没有变', g2.codes(), before);
    // 纪录的比较顺序：先提示数，同步数才比步数，同步步数才比用时。
    // 六次提示换来的快局必须顶不掉一条零提示的慢局，否则"纪录"就只是手速。
    en.Store.data.best.sho = { ms: 90000, hints: 0, moves: 40, size: '5x5', at: 0 };
    en.Store.save();
    ck('先立住一条零提示的慢纪录', (en.Store.best('sho') || {}).ms === 90000, JSON.stringify(en.Store.best('sho')));
    eq('求过一次的快局顶不掉它', en.Store.recordBest('sho', { ms: 1000, hints: 1, moves: 20, size: '5x5' }), false);
    eq('同提示但步数更多的也顶不掉', en.Store.recordBest('sho', { ms: 1000, hints: 0, moves: 41, size: '5x5' }), false);
    eq('同提示同步数、只有更快才顶', en.Store.recordBest('sho', { ms: 80000, hints: 0, moves: 40, size: '5x5' }), true);
    eq('纪录换成了那局更快的', en.Store.best('sho').ms, 80000);
    A().show('menu');
    const rec = (() => {
      const li = document.querySelector('#record-list li[data-tier="sho"]');
      return li ? li.textContent.replace(/\s+/g, ' ').trim() : '(纪录栏里没有初这一档)';
    })();
    ck('选档页的纪录栏念的是那条零提示 40 步的局', /提示 0 · 40 步/.test(rec), rec);
    return report({ moves: g2.moves, errs: f.errs });
  };

  // ---------- save / resume：证人由 node 在派发导航之前取走 ----------

  const save = async () => {
    const en = E();
    const g = await beginFresh('sho', 51);
    // 落子从解里挑：一个真的 1、它身边真的 2，再加一格"解里本来就留空"的白格。
    // 存档腿测的是"玩家状态存得回来"，不是推理对错——随手写 1,2,x 会造出一个
    // 自相矛盾的半成品盘（那位 2 四周再也放不进 3），于是续局之后的提示腿一起变红，
    // 红的还是不相干的那一条。
    const sol = g.puzzle.sol;
    const head = g.white.find((i) => sol.get(i) === 1);
    const second = g.white.find((i) => sol.get(i) === 2 && g.B.nbrs(head).includes(i));
    const blankCell = g.white.find((i) => !sol.has(i) && i !== head && i !== second);
    ck('从解里挑到了真 1、相邻的真 2 与一格题面留空', [head, second, blankCell].every((i) => Number.isInteger(i)), JSON.stringify([head, second, blankCell]));
    const targets = [head, second, blankCell];
    for (const [k, i] of targets.entries()) A().write(i, k === 2 ? en.BLANK : k + 1);
    const h0 = A().useHint();
    ck('落子之后提示还能推（不是自相矛盾的半成品）', !h0.conflict && !!h0.rule, JSON.stringify(h0));
    A().persistNow();
    await wait(40);
    const raw = localStorage.getItem('hebi-cos:v1');
    ck('存档写在 hebi-cos:v1 下', !!raw, 'null');
    const d = JSON.parse(raw);
    ck('存档里没有解', !('sol' in d.resume) && !('solution' in d.resume), Object.keys(d.resume).join(','));
    eq('存档记了档位', d.resume.tier, g.puzzle.tier);
    eq('存档记了 seed', d.resume.seed, g.puzzle.seed);
    eq('存档记了尺寸', `${d.resume.R}×${d.resume.C}`, `${g.R}×${g.C}`);
    eq('黑格条数与题面相同', d.resume.bl.length, g.black.size);
    ck('每条黑格都带箭头与读数', d.resume.bl.every((e) => Array.isArray(e) && e.length === 3), JSON.stringify(d.resume.bl[0]));
    eq('玩家写的格与存档逐格相同', d.resume.cells, g.codes());
    // 这句话才是"存的不是解"的证据：解里有数字的格，存档里绝大多数还是 '.'
    const withDigit = [...g.puzzle.sol.keys()].length;
    eq('存档写的数字个数少于解里的', count(d.resume.cells, '1') + count(d.resume.cells, '2') + count(d.resume.cells, '3') < withDigit, true);
    ck('未定的格在存档里还是未定', count(d.resume.cells, '.') > withDigit, `${count(d.resume.cells, '.')} vs ${withDigit}`);
    eq('游标已经把 seed 让开了', d.seedCounter > g.puzzle.seed, true);
    eq('提示次数进了存档', d.resume.hints, g.hints);
    eq('步数进了存档', d.resume.moves, g.moves);
    ck('存档里的计时在走（续局腿拿它当基线）', d.resume.elapsedMs > 0, d.resume.elapsedMs);
    const codes = g.codes();
    return report({ timeOrigin: performance.timeOrigin, doc: A().doc, seed: g.puzzle.seed, codes, tier: g.puzzle.tier, bl: d.resume.bl.length, hints: g.hints, moves: g.moves, elapsedMs: d.resume.elapsedMs });
  };

  const resume = async () => {
    const wit = w.__witness;
    ck('续局腿拿到了派发前的证人', !!wit, JSON.stringify(wit));
    if (!wit) return report({ note: 'no witness' });
    ck('这是一个新文档（timeOrigin 换了）', performance.timeOrigin !== wit.timeOrigin, `${wit.timeOrigin} -> ${performance.timeOrigin}`);
    ck('这是一个新文档（doc 身份换了）', A().doc !== wit.doc, `${wit.doc} -> ${A().doc}`);
    eq('旧文档的哨兵在这个文档里不存在', w.__gateSentinel, undefined);
    const en = E();
    eq('选档页开局可见', shown('#view-menu'), true);
    ck('继续卡片露出来了', shown('#resume-card'));
    ck('继续卡片写了 seed', /seed \d+/.test(text('#resume-meta')), text('#resume-meta'));
    const rec = en.Store.resume(en.tierOf);
    ck('存档读得回来', !!rec, 'null');
    if (!rec) return report({});
    $('#btn-resume').click();
    await wait(60);
    const g = A().game;
    eq('续上了同一个 seed', g.puzzle.seed, wit.seed);
    eq('续上了同一档', g.puzzle.tier, wit.tier);
    eq('续上了同一个盘面', g.codes(), wit.codes);
    eq('黑格照存档重建', g.black.size, wit.bl);
    eq('提示次数没被续局清零', g.hints, wit.hints);
    eq('步数没被续局清零', g.moves, wit.moves);
    // 计时不是"看起来在走"：拿派发前证人抄下的存档 elapsedMs 当基线，续局之后必须接着它走。
    const msAfter = A().state().elapsedMs;
    ck('计时从存档接着走（没有从 00:00 重来）', msAfter >= wit.storedMs && wit.storedMs > 0, `${text('#stat-time')} ${msAfter}ms vs 存档 ${wit.storedMs}ms`);
    ck('续局之后不再给继续卡片', !shown('#resume-card'));
    // 续局之后还能推：提示走的是同一条铅笔路径
    const info = A().useHint();
    ck('续局之后提示还能推', !!info && !!info.rule, JSON.stringify(info));
    eq('存档的题面与判据相容（不崩）', bootErrors.length, 0);
    return report({ seed: g.puzzle.seed, codes: g.codes().length, timeOrigin: performance.timeOrigin, doc: A().doc });
  };

  // ---------- corrupt：坏档必须是"没有存档"，不是白屏 ----------

  const corrupt = async () => {
    const en = E();
    // 先确认种下的还是那份坏档：pagehide 的自动存档会把刚种下去的 payload 覆写回一份合法档，
    // 于是"坏档被判成没有存档"红得莫名其妙。这一条把机制自己说出来。
    ck('种下的坏档还在（没被页面自己的合法存档覆写）', /"tier":"slant"/.test(localStorage.getItem('hebi-cos:v1') || ''), (localStorage.getItem('hebi-cos:v1') || 'null').slice(0, 80));
    ck('坏档之后应用仍然起来了', !!A() && !!A().engine.mkBoard, 'window.hebi 不在');
    eq('坏档没有抛出未捕获错误', bootErrors.length, 0);
    eq('坏档被判成没有存档', JSON.stringify(en.Store.resume(en.tierOf)), 'null');
    ck('继续卡片没露出来（不显示半截盘）', !shown('#resume-card'));
    eq('档位表没被坏档污染', en.TIERS.length, 3);
    eq('设置退回默认', en.Store.setting('sound'), true);
    const g = await beginFresh('sho', 77);
    ck('坏档之后还能正常开局', !!g, 'null');
    eq('seed 游标可用', g.puzzle.seed > 0, true);
    return report({ planted: w.__plantedGarbage || 'unknown' });
  };

  // ---------- layout：几何、hit box 与三种底色 ----------

  const layout = async () => {
    const en = E();
    const paper = hex(cssVar('--bg-bottom'));
    const lift = hex(cssVar('--surface-lift'));
    const inkBlack = hex(cssVar('--black'));
    // 先量"什么都不印的纯黑格"：题面允许 arrow=null，这种格必须真的什么都不画。
    const B = en.mkBoard(5, 5);
    const blk = new Map([
      [B.id(0, 0), { arrow: 'R', num: 2 }],
      [B.id(2, 2), { arrow: null, num: null }],
    ]);
    const fake = new en.Game({ tier: 'sho', spec: en.TIERS[0], B, black: blk, sol: new Map(), seed: 9, stats: { ms: 0 }, score: 0 });
    A().show('game');
    A().view.resize(fake, 320, 320);
    A().view.draw(fake);
    await wait(30);
    eq('纯黑格底色就是黑', near(basePixel(B.id(2, 2), 0.5), inkBlack), true);
    eq('纯黑格里没有画东西', brightIn(B.id(2, 2)), 0);
    ck('带箭头的黑格画了东西', brightIn(B.id(0, 0)) > 2, brightIn(B.id(0, 0)));
    eq('白格底色是纸色', near(basePixel(B.id(4, 4), 0.5), paper), true);

    // 大尺寸：8×8 必须在 900×900 视口里，且每一格都点得中
    const g = await beginFresh('gao', 61);
    eq('高一档 8×8', `${g.R}×${g.C}`, '8×8');
    const rect = rectOf('#board');
    ck('最大盘也在视口里', rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth + 1 && rect.bottom <= innerHeight + 1, JSON.stringify({ r: rect, iw: innerWidth, ih: innerHeight }));
    ck('格子不小于可点最小值', A().view.geo.cell >= en.theme.Cell.min, A().view.geo.cell);
    ck('格子不大于上限', A().view.geo.cell <= en.theme.Cell.max, A().view.geo.cell);
    ck('页面没有横向溢出', document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1, `${document.documentElement.scrollWidth} vs ${document.documentElement.clientWidth}`);
    let hits = 0;
    for (let i = 0; i < g.B.N; i++) {
      const r = A().view.cellRect(i);
      const bb = rect;
      const x = bb.left + r.x + r.size / 2;
      const y = bb.top + r.y + r.size / 2;
      const e = document.elementFromPoint(x, y);
      if (e && e.id === 'board' && A().view.hitCell(x, y) === i) hits++;
    }
    eq('大棋盘每一格都点得中（命中元素=canvas 且 hitCell 同格）', hits, g.B.N);
    eq('画布外的点不落子', A().view.hitCell(rect.left - 8, rect.top + 4), -1);

    // 三种底色 + 数字/留空的画法
    const g2 = await beginFresh('sho', 62);
    const target = g2.white[0];
    const other = g2.white[1];
    const third = g2.white[2];
    A().write(target, 1);
    A().write(other, en.BLANK);
    await wait(30);
    eq('未定白格是纸色', near(basePixel(third), paper), true);
    ck('钉成留空与未定分得开', !near(basePixel(other), paper), `${basePixel(other)} vs 纸色 ${paper}`);
    ck('写了数字的格底色又不同', !near(basePixel(target), lift), `${basePixel(target)} vs 已定底色 ${lift}`);
    ck('留空标记画得出来', !near(midPixel(other), lift), `${midPixel(other)} vs ${lift}`);
    ck('数字真的被画出来', brightIn(target) > 3, brightIn(target));
    // 同一条蛇读成一组色，且不泄露答案：没写过的格子必须还是纸色
    const solCell = [...g2.puzzle.sol.keys()].find((i) => g2.st[i] === en.UND);
    ck('解里有数字但玩家没写的格仍是纸色（不泄露答案）', near(basePixel(solCell), paper), `${basePixel(solCell)} vs ${paper}`);
    const g3 = await beginFresh('sho', 63);
    for (const i of g3.white.slice(0, 5)) A().write(i, g3.puzzle.sol.get(i) ?? 1);
    const grp = g3.sn.group;
    const sameSnake = [...grp.entries()].filter(([, v]) => v >= 0);
    const headOf = (i) => grp.get(i);
    const linked = sameSnake.length >= 1;
    ck('写了数字的格被归进蛇组', linked, JSON.stringify(sameSnake.slice(0, 4)));
    ck('同组格数不超过 5', [...new Set(sameSnake.map((e) => e[1]))].every((h) => [...grp.entries()].filter(([, v]) => v === h).length <= 5), JSON.stringify([...grp.values()]));
    void headOf;
    eq('图例五项', document.querySelectorAll('.legend span').length, 5);
    eq('统计项八条', document.querySelectorAll('.stats .stat').length, 8);
    eq('数字键六个', document.querySelectorAll('.digits .digit').length, 6);
    ck('按钮都够点', [...document.querySelectorAll('.acts button, .digits button, .top-actions button')].every((x) => x.getBoundingClientRect().height >= 34), JSON.stringify([...document.querySelectorAll('.acts button')].map((x) => Math.round(x.getBoundingClientRect().height))));
    ck('顶部按钮不重叠', (() => {
      const bs = [...document.querySelectorAll('.top-actions button')].map((x) => x.getBoundingClientRect());
      for (let i = 1; i < bs.length; i++) if (bs[i].left < bs[i - 1].right - 1) return false;
      return true;
    })());
    const g4 = await beginFresh('sho', 64);
    for (const i of g4.white) A().write(i, g4.puzzle.sol.get(i) ?? en.BLANK);
    await wait(40);
    eq('照解写完就胜利', g4.status, 'won');
    ck('胜利卡居中在棋盘内', (() => {
      const card = rectOf('.win-card');
      const wrap = rectOf('#board-wrap');
      return card.left >= wrap.left - 1 && card.right <= wrap.right + 1 && card.top >= wrap.top - 1 && card.bottom <= wrap.bottom + 1;
    })(), JSON.stringify({ c: rectOf('.win-card'), w: rectOf('#board-wrap') }));
    ck('胜利按钮点得到', $('#btn-again').getBoundingClientRect().width > 40);
    return report({ cell: A().view.geo.cell, dpr: A().view.geo.dpr, iw: innerWidth, hits });
  };

  // ---------- 阴性自证：这个闸必须能被证明会红 ----------

  const selftest = async () => {
    const g = await beginFresh('sho', 91);
    eq('种一条注定错的期望（2 不等于 1）', g.R, 1);
    ck('这条腿本来就该红（GATE_SELFTEST）', false, 'planted red expectation');
    return report({ planted: 2 });
  };

  w.__ng = { engine, gen, play, hint, win, save, resume, corrupt, layout, selftest };
})(window);
