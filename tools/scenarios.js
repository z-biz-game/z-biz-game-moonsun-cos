// Browser-side scenario suite, injected by tools/playtest.cjs and run against the real page.
//
// The rule for anything asserted here: read the DOM, the geometry and the canvas pixels, not a
// private flag. A `.status` string says what the code intended; a client rect and a pixel say
// what the player got. The interesting failures in this game are exactly the ones where the
// state is right and the picture is wrong — a moon painted where a sun is, a "留空" that paints
// identically to "还没画", a loop band that reads as a room border.
//
// 真事件（鼠标/触屏/键盘）不在这条腿里：那三条腿由 tools/playtest.cjs 的 `leg` 命令用 CDP
// Input.dispatch* 驱动。这里写格子走的是 moonsun.writeCell，也就是点击之后落到的同一个状态机。
//
// window.moonsun.engine is the shipped module graph, so a scenario that passes here has passed
// on the same counter and pencil the player's hints come from — not a second copy kept for tests.
//
// ck(name, condition, detail) is truthiness; eq(name, got, want) is equality. Every row name is
// printed on red, so a red line is never just `undefined`.

((w) => {
  const rows = [];
  // 交出去是为了"半路抛异常时也把已记的断言带回来"：上一版 scenario 一崩，整份报告只剩
  // node 侧那一条合成行，已经跑过的 20 多条（包括红的）全丢了，红点不出是哪一条。
  w.__rows = rows;
  const ck = (test, cond, detail) => {
    rows.push({ test, pass: !!cond, detail: cond ? '' : String(detail === undefined ? '' : detail) });
  };
  const eq = (test, got, want) => ck(test, String(got) === String(want), `got ${got} / want ${want}`);
  const report = (extra) => {
    // 阴性自证：GATE_SELFTEST=1 时每一份报告都多一条注定错的期望。没有这一段，
    // "闸全绿"这句话没有任何东西支撑——写了但从没能红的闸，和坏掉的闸长得一样。
    if (w.__selftest) rows.push({ test: 'GATE_SELFTEST 种下的错期望（1 应当等于 2）', pass: 1 === 2, detail: 'planted red' });
    const out = { rows: rows.slice(), fail: rows.filter((r) => !r.pass).length, ...extra };
    rows.length = 0;
    return JSON.stringify(out);
  };

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const mmss = (ms) => {
    const s = Math.floor(ms / 1000);
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  };
  const bootErrors = [];
  w.addEventListener('error', (e) => bootErrors.push(String(e.message || e)));
  w.addEventListener('unhandledrejection', (e) => bootErrors.push('promise: ' + String(e.reason)));

  const A = () => w.moonsun;
  const E = () => w.moonsun.engine;
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
  const near = (p, c, tol = 12) => p.length === 3 && c.length === 3 && p.every((v, k) => Math.abs(v - c[k]) <= tol);
  function pixel(x, y) {
    const v = A().view;
    const d = v.geo.dpr;
    const p = v.ctx.getImageData(Math.round(x * d), Math.round(y * d), 1, 1).data;
    return [p[0], p[1], p[2]];
  }
  // 整张位图里有多少像素是这个颜色：脉冲框这种"只在一处出现"的令牌，用它证明
  // 画面真的动了——比读一个私有标志强，因为私有标志说不了玩家看见了什么。
  function countNear(color, tol = 12) {
    const v = A().view;
    const img = v.ctx.getImageData(0, 0, v.canvas.width, v.canvas.height).data;
    const c = hex(color);
    let k = 0;
    for (let p = 0; p < img.length; p += 4) {
      if (Math.abs(img[p] - c[0]) <= tol && Math.abs(img[p + 1] - c[1]) <= tol && Math.abs(img[p + 2] - c[2]) <= tol) k++;
    }
    return k;
  }
  const at = (i, kind, d = null) => {
    const p = A().view.point(i, kind, d);
    return pixel(p.x, p.y);
  };
  // 同一批令牌之间的最小逐通道距离：任何一对贴到 25 以内，"这一格画的是什么"就开始靠猜。
  const separable = (names) => {
    const P = A().palette;
    let worst = { pair: '', d: 1e9 };
    for (let a = 0; a < names.length; a++) for (let b = a + 1; b < names.length; b++) {
      const x = hex(P[names[a]]), y = hex(P[names[b]]);
      const d = Math.min(...x.map((v, k) => Math.abs(v - y[k])));
      if (d < worst.d) worst = { pair: `${names[a]}/${names[b]}`, d };
    }
    return worst;
  };
  const beginFresh = async (sizeKey, seed) => {
    const g = await A().newGame({ sizeKey, seed });
    await wait(60);
    return g;
  };

  // 官方 5×5 例题（Nikoli 规则页逐格抄）——这份拷贝由 tools/doctest.mjs 的 D11 与
  // tools/fixtures.mjs 逐字节对账，所以"两处各抄一遍"不会漂成两个题面。
  const OFFICIAL = {
    rows: 5, cols: 5,
    room: [[0, 0, 1, 2, 2], [0, 1, 1, 2, 2], [3, 3, 4, 4, 5], [3, 3, 4, 5, 5], [3, 3, 3, 3, 3]],
    sym: [['.', 'M', '.', 'S', 'S'], ['M', 'M', 'S', '.', '.'], ['.', 'M', 'M', '.', '.'], ['.', 'S', '.', 'S', 'M'], ['M', '.', '.', '.', '.']],
    loop: ['DR', 'LR', 'DL', 'DR', 'DL', 'DU', '', 'DU', 'DU', 'DU', 'DU', '', 'RU', 'LU', 'DU', 'RU', 'DL', '', '', 'DU', '', 'RU', 'LR', 'LR', 'LU'],
  };
  const officialMask = () => {
    const { UP, RIGHT, DOWN, LEFT, bit } = E();
    const D = { U: UP, R: RIGHT, D: DOWN, L: LEFT };
    return OFFICIAL.loop.map((s) => [...s].reduce((a, ch) => a | bit(D[ch]), 0));
  };

  // ---------- engine：两道判据在真 Chrome 里跑的是发布的那份模块 ----------
  const engine = async () => {
    const en = E();
    eq('window.moonsun 起来了', A().state, 'ready');
    eq('引擎里就是同一份 RULE_ORDER', en.RULE_ORDER.length, Object.keys(en.RULE_TEXT).length);
    const off = { rows: OFFICIAL.rows, cols: OFFICIAL.cols, room: OFFICIAL.room, sym: OFFICIAL.sym };
    const printed = officialMask();
    eq('官方例题的抄件合法（checks 一条都不报）', en.checks(off, printed).length, 0);
    const cnt = en.countSolutions(off, { cap: en.CAP_WORK });
    eq('判据 1 在 Chrome 里：官方例题 1 解', cnt.solutions, 1);
    ck('判据 1 没撞预算', !cnt.stopped, `${cnt.nodes} 节点 / 预算 ${en.CAP_WORK}`);
    const pen = en.solve(off);
    ck('判据 2 在 Chrome 里：铅笔 0 猜推满', pen.done && !pen.contradiction, pen.contradiction || `剩 ${pen.undetermined.length} 格`);
    eq('两条路推出来的逐格相同', pen.mask.every((v, i) => v === cnt.first[i]), true);
    eq('铅笔推出来的就是官方解答', pen.mask.every((v, i) => v === printed[i]), true);
    // 同 seed 同盘：存档只记 seed 的前提
    const a = await en.makePuzzle('5x5', 4242), b = await en.makePuzzle('5x5', 4242);
    ck('makePuzzle 出了盘', !a.fail, a.fail || '');
    eq('同一个 seed 两次画同一张题面', JSON.stringify([a.sym, a.room]) === JSON.stringify([b.sym, b.room]), true);
    eq('同一个 seed 两次同一份答案', a.answer.join(',') === b.answer.join(','), true);
    eq('答案盘在 checks 下一条都不报', en.checks(en.toView(a), a.answer).length, 0);
    return report({ nodes: cnt.nodes, steps: pen.steps, fired: [...pen.fired].map(([n, c]) => `${n}x${c}`), seed: a.seed });
  };

  // ---------- core：DOM、像素、颜色可分性、条款与规则面板 ----------
  const core = async () => {
    const g = await beginFresh('5x5', 777);
    const en = E();
    ck('canvas 有非零盒', rectOf('#board').width > 100 && rectOf('#board').height > 100, JSON.stringify(rectOf('#board')));
    ck('canvas 位图按 dpr 放大', A().view.canvas.width >= Math.round(rectOf('#board').width), JSON.stringify(A().view.geo));
    eq('选尺寸项等于 SIZES', [...$('#size-select').options].map((o) => o.value).join(','), en.SIZES.join(','));
    // 面板与页脚的理由都必须**逐字等于**引擎自己格式化的那一条。行数对得上只证明"有 N 行"，
    // 证明不了这一行说的是这一档——文案在页面里另抄一份，正是改引擎不红的那种说谎。
    const lis = (sel) => [...document.querySelectorAll(sel + ' li')].map((li) => li.textContent.trim());
    const rules = lis('#rule-list');
    eq('规则面板行数等于 RULE_ORDER', rules.length, en.RULE_ORDER.length);
    eq('规则面板逐条等于 RULE_TEXT（页面上没有第二份文案）',
      rules.map((t, k) => (t === `${en.RULE_ORDER[k]}：${en.RULE_TEXT[en.RULE_ORDER[k]]}` ? '' : `#${k}`)).filter(Boolean).join(','), '');
    const clauses = lis('#clause-list');
    eq('条款面板行数等于 CLAUSE_ORDER', clauses.length, en.CLAUSE_ORDER.length);
    eq('条款面板逐条等于 CLAUSE_NAME + CLAUSE_TEXT',
      clauses.map((t, k) => {
        const c = en.CLAUSE_ORDER[k];
        return t === `${en.CLAUSE_NAME[c]}：${en.CLAUSE_TEXT[c]}` ? '' : `${c}->${t.slice(0, 24)}`;
      }).filter(Boolean).join(','), '');
    const notes = lis('#size-note');
    eq('淘汰档各有一条理由印在页上（条数等于 ELIMINATED）', notes.length, en.ELIMINATED.length);
    eq('每一条理由都逐字等于 eliminatedLine（分母、中位、最坏、退货都在里面）',
      notes.map((t, k) => (t === en.eliminatedLine(en.ELIMINATED[k]) ? '' : `${en.ELIMINATED[k].rows}×${en.ELIMINATED[k].cols}`)).filter(Boolean).join(','), '');
    ck('理由里印着分母与读数（不是只有"太大"这种话）',
      en.ELIMINATED.every((e) => /单试 \d+ 张出货 \d+ 张 · 唯一性计数节点中位 [\d,]+（预算 [\d,]+ 的 \d+%）· 最坏 [\d,]+（\d+%）/.test(en.eliminatedLine(e))),
      en.ELIMINATED.map((e) => en.eliminatedLine(e).slice(0, 46)).join(' | '));
    ck('形态图例把每一档都写出来', [...document.querySelectorAll('#shape-legend span')].length === en.SHAPE_CYCLE.length);
    // 前缀就是键位：'没画' 只能由 ⌫ 回到，其余七档由 0–6 直接点。上一版这里印的是
    // 「0: 没画 / 1: 不在环上」，而按下 0 写进去的是「不在环上」——图例自己教错键。
    eq('图例每一档的前缀等于它的键位',
      [...document.querySelectorAll('#shape-legend span')].map((s) => s.textContent.split(':')[0].trim()).join(','),
      ['⌫', ...en.SHAPE_CYCLE.slice(1).map((_, i) => String(i))].join(','));
    eq('开局时胜利幕布真的不占位', shown('#win-veil'), false);
    eq('引擎说那一格读得到', text('#stat-verify') !== '', true);
    eq('seed 那一格印的是这一局的 seed', text('#stat-seed').includes(String(g.puzzle.seed)), true);
    eq('区域数等于引擎给的房间数', text('#stat-rooms'), String(g.roomCount));
    eq('线索数等于题面上的符号格', text('#stat-clues'), `${g.clueCount}/${g.n}`);

    const P = A().palette;
    for (const name of ['field', 'gridLine', 'roomBorder', 'loop', 'cap', 'offMark', 'cursor', 'hint', 'moon', 'sun', 'error']) {
      ck(`令牌 ${name} 是实色 #rrggbb（取样要和它比）`, /^#[0-9a-f]{6}$/i.test(P[name]), String(P[name]));
    }
    // 可分性是**按取样位**要求的，不是把整张调色板两两比一遍：moon #7B5CFF 与 cap #C8B4FF 的
    // 蓝道都是 FF，但它们从不出现在同一个像素上（一个在符号位、一个在线头位），把它们放进同
    // 一批就是要求一个画面永远给不出的东西。要钉住的是「同一个像素上可能出现的那几种读法，
    // 两两逐通道相距 ≥25」——这条才是「画错了」和「还没画」能否分开的定义。
    const SITES = {
      symbol: ['field', 'moon', 'sun'],
      center: ['field', 'loop', 'error'],
      off: ['field', 'offMark'],
      cap: ['field', 'loop', 'cap', 'error'],
      frame: ['field', 'cursor', 'hint'],
      // 边上不存在"什么都没有"这一读法：网格线铺满整张盘，区域粗边盖在它上面。所以这个位
      // 置上若量到盘底，那就是有人把线擦掉了（符号的盘底垫块越过格界就会造出这一幕）。
      dash: ['gridLine', 'roomBorder', 'error'],
    };
    let worstSite = { site: '', pair: '', d: 1e9 };
    for (const [site, names] of Object.entries(SITES)) {
      const s = separable(names);
      ck(`${site} 位的 ${names.length} 种读法两两可分（最小逐通道距离 ≥ 25）`, s.d >= 25, `最坏一对 ${s.pair} 相距 ${s.d}`);
      if (s.d < worstSite.d) worstSite = { site, pair: s.pair, d: s.d };
    }
    eq('取样位表覆盖了盘面上每一个会被取样的令牌',
      [...new Set(Object.values(SITES).flat())].sort().join(','),
      ['cap', 'cursor', 'error', 'field', 'gridLine', 'hint', 'loop', 'moon', 'offMark', 'roomBorder', 'sun'].join(','));

    // 样式表里每一个 var(--x) 都必须取得到值：引用了谁都没写的名字，那条声明整条废掉
    // （缺 `line` 时九处 border 一起没边，而画面只"淡了一点"）。
    // 写这些名字有两个正当的地方——js/theme.js 的 applyThemeVars() 写在 <html> 的 inline 上，
    // 而 safe-area 那一组是样式表自己在 `:root` 里声明的（env() 的值 JS 无从代笔）。
    // 所以读**计算值**：inline 只认前一种，会把后一种当成缺（本轮就是这么红的：sal/sar/sat/sab
    // 四个都在 css/game.css:105-110 的 :root 里，计算值实测是 0px，可 documentElement.style 读不到）。
    const used = new Set();
    for (const sheet of document.styleSheets) {
      let rules;
      try { rules = sheet.cssRules; } catch { rules = null; }
      if (!rules) continue;
      for (const r of rules) {
        if (!r.style) continue;
        for (const m of r.style.cssText.matchAll(/var\(--([A-Za-z0-9-]+)\)/g)) used.add(m[1]);
      }
    }
    const rootCS = getComputedStyle(document.documentElement);
    ck('样式表里能数出 var() 令牌（否则这条断言空转）', used.size >= 15, `${used.size} 个`);
    const missing = [...used].filter((name) => !rootCS.getPropertyValue('--' + name).trim());
    eq('css 引用的每一个 --名字 都取得到值（applyThemeVars 的 inline 或样式表自己的 :root）', missing.join(','), '');

    // 像素：空格（没画）读作盘底，钉成留空读作留空点，符号读作符号
    const symbols = [];
    for (let i = 0; i < g.n; i++) {
      const s = g.sym[(i / g.cols) | 0][i % g.cols];
      if (s !== '.') symbols.push([i, s]);
    }
    ck('题面确实有符号格可测', symbols.length > 0, `${symbols.length} 格`);
    eq('符号格的符号点画的是那个颜色', near(at(symbols[0][0], 'symbol'), hex(P[symbols[0][1] === 'M' ? 'moon' : 'sun'])), true);
    const wrong = symbols.filter(([i, s]) => !near(at(i, 'symbol'), hex(P[s === 'M' ? 'moon' : 'sun'])));
    eq('每一颗符号都没画反', wrong.length, 0);
    // 没有符号的格：symbol 取样位应该是盘底（不是任一符号色）
    const plainCell = (() => { for (let i = 0; i < g.n; i++) if (g.sym[(i / g.cols) | 0][i % g.cols] === '.') return i; return -1; })();
    ck('无符号格的符号位是盘底，不是偷偷画了点什么', near(at(plainCell, 'symbol'), hex(P.field), 16), JSON.stringify(at(plainCell, 'symbol')));
    ck('没动过的格中心是盘底', near(at(0, 'center'), hex(P.field), 16), JSON.stringify(at(0, 'center')));
    g.write(0, en.OFF); A().render();
    ck('钉成留空之后，中心不再是盘底（留空点画得出来）', !near(at(0, 'center'), hex(P.field), 8) || near(at(0, 'off'), hex(P.offMark)), JSON.stringify({ c: at(0, 'center'), o: at(0, 'off') }));
    ck('留空点画在它自己的取样位上', near(at(0, 'off'), hex(P.offMark)), JSON.stringify(at(0, 'off')));
    g.write(0, en.UNDRAWN); A().render();
    eq('擦回没画之后留空点消失', near(at(0, 'off'), hex(P.field), 16), true);

    // 区域粗边 vs 细网格线：同一个取样位（沿边挪开 0.3 格，环带到不了那里）必须
    // 跨区读到粗边、同区读到网格线。两种边都必须在盘上真实出现，否则这条断言是空转。
    let crossEdges = 0, innerEdges = 0, crossGood = 0, innerGood = 0, mixed = [];
    for (let i = 0; i < g.n; i++) for (const d of [0, 1, 2, 3]) {
      const j = g.nb(i, d);
      if (j < 0) continue;
      const ri = g.room[(i / g.cols) | 0][i % g.cols], rj = g.room[(j / g.cols) | 0][j % g.cols];
      const p = at(i, 'dash', d);
      const isBorder = near(p, hex(P.roomBorder), 12), isGrid = near(p, hex(P.gridLine), 12);
      if (ri !== rj) { crossEdges++; if (isBorder && !isGrid) crossGood++; else mixed.push(`cross ${i}>${d} ${JSON.stringify(p)}`); }
      else { innerEdges++; if (isGrid && !isBorder) innerGood++; else mixed.push(`inner ${i}>${d} ${JSON.stringify(p)}`); }
    }
    ck('盘上真有跨区边可测（否则粗边那条断言空转）', crossEdges >= 4, `${crossEdges} 条`);
    ck('盘上真有同区内部边可测（否则网格线那条断言空转）', innerEdges >= 4, `${innerEdges} 条`);
    eq(`跨区边读成区域粗边（${crossEdges} 条里 ${crossGood} 条命中）`, crossGood, crossEdges);
    eq(`同区内部边读成细网格线（${innerEdges} 条里 ${innerGood} 条命中）`, innerGood, innerEdges);
    ck('粗边/网格线没有串位', mixed.length === 0, mixed.slice(0, 3).join(' | '));

    // 违规：把一条边的两头接反，红必须画在错的那一格上
    g.clearMarks();
    const ans = g.puzzle.answer;
    for (let i = 0; i < g.n; i++) g.write(i, ans[i] === 0 ? en.UNDRAWN : ans[i]);
    g.write(1, en.PAIRS[0]); A().render();
    ck('画错一处就有红', g.report().length > 0, JSON.stringify(g.report().map((x) => x.code)));
    const bad = g.badCells();
    ck('红格集合非空', bad.size > 0, [...bad].join(','));
    eq('引擎说那一格跟着改', text('#stat-bad'), String(g.report().filter((x) => x.level === 'error').length));
    g.undo(); A().render();
    eq('撤销之后没有红了', g.report().length, 0);
    return report({ cells: g.n, symbolCells: symbols.length, worstSite: `${worstSite.site}/${worstSite.pair}:${worstSite.d}`, dpr: A().view.geo.dpr });
  };

  // ---------- gen：浏览器里逐张出题，判据一条都不能松 ----------
  const gen = async () => {
    const en = E();
    for (const t of en.TIERS) {
      const p = await en.makePuzzle(t.key, 5000);
      ck(`${t.key} 出了货`, !p.fail, p.fail || '');
      if (p.fail) continue;
      eq(`${t.key} 的答案合法`, en.checks(en.toView(p), p.answer).length, 0);
      const c = en.countSolutions(en.toView(p), { cap: en.CAP_WORK });
      eq(`${t.key} 判据 1：1 解`, c.solutions, 1);
      ck(`${t.key} 判据 1 没撞预算`, !c.stopped, `${c.nodes} 节点`);
      const pen = en.solve(en.toView(p));
      ck(`${t.key} 判据 2：铅笔推满、0 猜`, pen.done && !pen.contradiction, pen.contradiction || `剩 ${pen.undetermined.length} 格`);
      eq(`${t.key} 铅笔与答案逐格相同`, pen.mask.every((v, i) => v === p.answer[i]), true);
      ck(`${t.key} 区域号连续`, Math.max(...p.room.flat()) === p.rooms - 1 && Math.min(...p.room.flat()) === 0, String(p.rooms));
      ck(`${t.key} 线索挖剩下的确比铺满少`, p.clues < p.rows * p.cols, `${p.clues}/${p.rows * p.cols}`);
    }
    // 淘汰档必须真的在菜单外，而且理由里的数是有结构的（不是散文里编出来的）
    for (const e of en.ELIMINATED) {
      ck(`${e.key} 不在菜单里`, !en.SIZES.includes(`${e.rows}x${e.cols}`), en.SIZES.join(','));
      eq(`${e.key} 的理由带分母`, typeof e.ship === 'number' && typeof e.samples === 'number' && e.ship <= e.samples, true);
      ck(`${e.key} 的节点读数没越预算`, e.nodesMed <= en.CAP_WORK && e.nodesMax <= en.CAP_WORK, `${e.nodesMed}/${e.nodesMax}`);
    }
    return report({ sizes: en.SIZES.join(',') });
  };

  // ---------- play：状态机、计数、撤销、留空、光标 ----------
  const play = async () => {
    const g = await beginFresh('5x5', 909);
    const en = E();
    eq('开局全盘没动过', [...g.st].every((v) => v === en.UNDRAWN), true);
    eq('未接头等于没动过的格数', text('#stat-open'), String(g.n));
    const cyc = [];
    for (let k = 0; k < en.SHAPE_CYCLE.length; k++) { A().writeCell(0, 1); cyc.push(g.st[0]); }
    eq('点一格就是把这条环往前滚', cyc[0], en.SHAPE_CYCLE[1]);
    eq('滚一整圈回到没画', g.st[0], en.UNDRAWN);
    A().writeCell(2, -1);
    eq('反向一格落在上一个形状上', g.st[2], en.SHAPE_CYCLE[en.SHAPE_CYCLE.length - 1]);
    g.clearMarks(); A().render();
    eq('全清之后留空计数归零', g.markedCells, 0);
    for (const i of [0, 1, 2]) { g.write(i, en.OFF); }
    A().render();
    eq('钉三格留空，计数读到三', g.markedCells, 3);
    eq('没动过的格少了三', g.touchedCells, 3);
    eq('已画环段仍是零', g.drawnCells, 0);
    const before = g.moves.length;
    g.write(5, en.PAIRS[2]); A().render();
    eq('落一笔进 history', g.moves.length, before + 1);
    g.undo(); A().render();
    eq('撤销退回去', g.st[5], en.UNDRAWN);
    eq('撤销也记在步数上', text('#stat-moves'), String(g.moves.length));
    const shape = g.puzzle.answer[7];
    g.write(7, shape === 0 ? en.PAIRS[0] : shape); A().render();
    ck('画一条不该画的线会被点数条款抓到', g.report().some((v) => v.code === 'degree' || v.code === 'asym' || v.code === 'disjoint'),
      JSON.stringify(g.report().map((v) => v.code)));
    eq('违规格集合与红格数一致', g.badCells().size > 0, g.report().length > 0);
    g.clearMarks(); A().render();
    // 键盘光标与无障碍播报同一条读数
    A().writeCell(g.cursor, 1); A().render();
    ck('sr-cell 念的是光标格的形状', text('#sr-cell').includes('光标'), text('#sr-cell'));
    ck('sr-cell 报的形状名在名单里', Object.values(en.SHAPE_NAME).some((n) => text('#sr-cell').includes(n)), text('#sr-cell'));
    return report({ moves: g.moves.length, cycle: cyc.join('>') });
  };

  // ---------- hint：提示只给被迫的结论，且它指的那一格与铅笔一致 ----------
  const hint = async () => {
    const g = await beginFresh('5x5', 1515);
    const en = E();
    const pen = en.solve(en.toView(g.puzzle));
    ck('这盘铅笔推得满（判据 2）', pen.done, pen.contradiction || '');
    const P = A().palette;
    eq('提示之前画布上没有提示色', countNear(P.hint), 0);
    A().hint();
    await wait(40);
    let line = text('#state-line');
    let m = line.match(/看第 (\d+) 行第 (\d+) 格/);
    ck('提示念出了一格（或明说了推不动/已落满）', !!m || /推不动|都已经落笔/.test(line), line);
    if (m) {
      eq('提示之后画布上出现了提示色的脉冲框', countNear(P.hint) > 0, true);
      // 闸自己从引擎重算"玩家还没落笔的第一格"，再和界面念出的行列对照：
      // 提示必须是引擎结论的回读，不是 UI 自己挑的一格。
      const plain = g.plain();
      let want = -1;
      for (let i = 0; i < g.n; i++) {
        if (plain[i] === pen.mask[i]) continue;
        if (g.st[i] === en.UNDRAWN && en.pop(pen.mask[i]) === 0) continue;
        want = i; break;
      }
      ck('闸自己也算得出一格（否则这条断言空转）', want >= 0, String(want));
      eq('界面念的行列 == 引擎算出的那一格', (Number(m[1]) - 1) * g.cols + Number(m[2]) - 1, want);
      ck('那一格玩家确实还没落笔', g.st[want] !== pen.mask[want], `st ${g.st[want]} / mask ${pen.mask[want]}`);
      const words = /环一定不经过/.test(line) ? '不在环上' : /环一定经过/.test(line) ? '在环上' : '';
      ck('那句话只说"一定（不）在环上"，不说画成什么形状', words !== '' && !/竖穿|横穿|左上拐|右下拐|下左拐|上右拐/.test(line), line);
      ck('话与铅笔的掩码一致', words === (en.pop(pen.mask[want]) === 2 ? '在环上' : '不在环上'), `${words} / mask ${pen.mask[want]}`);
    }
    // 提示不替玩家落笔：盘面必须一个字节都没变
    eq('提示之后盘面没被改', [...g.st].every((v) => v === en.UNDRAWN), true);
    eq('提示之后步数仍是零', g.moves.length, 0);
    const first = (m && Number(m[1]) - 1) * g.cols + Number(m[2]) - 1;
    const i = pen.mask.findIndex((v) => en.pop(v) === 2);
    g.write(i, pen.mask[i]); A().render();
    A().hint(); await wait(30);
    line = text('#state-line');
    m = line.match(/看第 (\d+) 行第 (\d+) 格/);
    ck('落了一笔之后再要提示，它还在给结论', !!m || /都已经落笔|推不动/.test(line), line);
    if (m && first >= 0) {
      const again = (Number(m[1]) - 1) * g.cols + Number(m[2]) - 1;
      ck('再要的提示不是原地重复同一格', again !== first || en.pop(pen.mask[again]) === 0, `again ${again} first ${first}`);
    }
    return report({ first, line: line.slice(0, 40) });
  };

  // ---------- win：判胜只由引擎说了算 ----------
  const win = async () => {
    const g = await beginFresh('5x5', 2222);
    const en = E();
    const ans = g.puzzle.answer;
    // 差一条边的"几乎对了"：判胜必须不认
    for (let i = 0; i < g.n; i++) g.write(i, ans[i] === 0 ? en.OFF : ans[i]);
    const flip = ans.findIndex((v, i) => v !== 0 && g.nb(i, en.UP) >= 0 && (v & en.bit(en.UP)));
    if (flip >= 0) { g.write(flip, en.PAIRS[1]); g.write(g.nb(flip, en.UP), en.PAIRS[1]); }
    A().afterMove(); A().render(); await wait(40);
    ck('差一点盘的 report 不空', g.report().length > 0, JSON.stringify(g.report().map((x) => x.code)));
    eq('差一点盘不算赢', A().won, false);
    eq('胜利幕布此时不占位', shown('#win-veil'), false);
    // 照解写完
    g.clearMarks();
    for (let i = 0; i < g.n; i++) g.write(i, ans[i] === 0 ? en.UNDRAWN : ans[i]);
    A().afterMove(); A().render(); await wait(60);
    eq('照解写完就赢', A().won, true);
    ck('判胜那一格写的是引擎的话', text('#stat-verify') === '合法', text('#stat-verify'));
    ck('胜利幕布真的占位', shown('#win-veil'), `display=${getComputedStyle($('#win-veil')).display} rects=${$('#win-veil').getClientRects().length}`);
    ck('胜利卡落在盘面盒内', (() => {
      const c = rectOf('.win-card'), b = rectOf('#board-wrap');
      return c && b && c.left >= b.left - 1 && c.right <= b.right + 1 && c.top >= b.top - 1 && c.bottom <= b.bottom + 1;
    })(), JSON.stringify(rectOf('.win-card')));
    ck('胜利卡印的是尺寸、区域数、耗时与步数',
      new RegExp(g.puzzle.sizeKey).test(text('#win-meta')) && /个区域/.test(text('#win-meta'))
        && /\d\d:\d\d/.test(text('#win-meta')) && new RegExp(`${g.moves.length} 步`).test(text('#win-meta')),
      text('#win-meta'));
    eq('胜利卡上的区域数就是引擎数出来的', text('#win-meta').match(/(\d+) 个区域/)[1], String(g.roomCount));
    $('#btn-close-veil').click(); await wait(40);
    eq('「就看不动」把幕布收掉', shown('#win-veil'), false);
    eq('收掉幕布不改变胜负', A().won, true);
    // 环没闭合之前不评判区域：warn 在场时区域条款必须闭嘴
    const g2 = await beginFresh('5x5', 3333);
    for (let i = 0; i < g2.n; i++) g2.write(i, en.OFF);
    g2.write(0, en.bit(en.RIGHT)); A().render();
    const v = g2.report();
    ck('半条线在场时只报线头', v.length > 0 && v.every((x) => x.level === 'warn'), JSON.stringify(v.map((x) => `${x.code}:${x.level}`)));
    eq('这时引擎说不判区域的胜负', g2.wonNow(), false);
    return report({});
  };

  // ---------- layout：尺寸、命中反查、取样位不越盒 ----------
  const layout = async () => {
    const g = await beginFresh('6x6', 4141);
    const en = E();
    const v = A().view, geo = v.geo;
    ck('格子尺寸落在令牌区间内', geo.cell >= 24 && geo.cell <= 96, String(geo.cell));
    eq('盘面盒宽 == 列数 × 格 + 内边距 × 2', Math.round(v.canvas.getBoundingClientRect().width),
      Math.round(g.cols * geo.cell + geo.x * 2));
    let hit = 0;
    for (let i = 0; i < g.n; i++) {
      const r = v.rectOf(i);
      if (v.hitCell(r.cx + rectOf('#board').left, r.cy + rectOf('#board').top) === i) hit++;
    }
    eq('每一格中心的命中反查都回到自己', hit, g.n);
    // point() 交回的是 **canvas 内部的 CSS 像素**（原点在画布左上角，含 geo.x/geo.y 内边距），
    // 而 getBoundingClientRect() 是视口坐标。拿视口盒子去量画布局部坐标，每一格都会"跑到盒子外"，
    // 于是这条断言永远红、且红得看不出几何真的漂了。比的是 geo.w/h，也就是位图自己的盒子。
    const K = [['center', null], ['symbol', null], ['off', null], ['frame', null],
      ['stroke', 0], ['cap', 0], ['border', 0], ['dash', 0]];
    let sampled = 0;
    const outside = (() => {
      for (let i = 0; i < g.n; i++) for (const [kind, d0] of K) {
        for (const d of (d0 === null ? [null] : [0, 1, 2, 3])) {
          sampled++;
          const p = v.point(i, kind, d);
          if (!(p.x >= -1 && p.y >= -1 && p.x <= geo.w + 1 && p.y <= geo.h + 1)) return `${kind}/d=${d}@格${i} → (${p.x.toFixed(1)}, ${p.y.toFixed(1)})`;
        }
      }
      return '';
    })();
    ck('取样位都落在 canvas 位图的盒内（八种取样位 × 四个方向全数）', outside === '' && sampled === g.n * 20,
      `出界的第一个：${outside || '无'} · 盒子 ${geo.w}×${geo.h} · 数了 ${sampled} 个取样位`);
    ck('stroke/cap 取样位沿方向落在两格之间', (() => {
      for (let i = 0; i < g.n; i++) for (const d of [0, 1, 2, 3]) {
        const j = g.nb(i, d);
        if (j < 0) continue;
        const p = v.point(i, 'stroke', d), q = v.point(j, 'stroke', en.OPP[d]);
        if (Math.hypot(p.x - q.x, p.y - q.y) > geo.cell * 0.5) return false;
      }
      return true;
    })(), '同一条边的两个取样位离得太远');
    // 换一档尺寸：几何要重算，光标与盘面不能留下上一张盘的字节
    const g2 = await beginFresh('5x5', 5151);
    eq('换档之后 n 跟着变', g2.n, 25);
    eq('换档之后全盘没动过', [...g2.st].every((x) => x === en.UNDRAWN), true);
    // 只判"此刻真的摆在版面上"的按钮：#win-veil 藏起来时它肚子里的按钮高度是 0，那不是一个
    // 点不动的按钮，而是这一屏根本不存在的按钮。跳过了谁、跳过几个都要印出来——不然这条断言
    // 会静悄悄地只剩两条，而读者以为它数了整页。
    const btns = [...document.querySelectorAll('button')];
    const live = btns.filter((b) => { const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
    const small = live.filter((b) => b.getBoundingClientRect().height < 28)
      .map((b) => `${b.id || b.textContent.trim()}=${Math.round(b.getBoundingClientRect().height)}`);
    ck('版面上每一个按钮的点击盒都够手指', small.length === 0 && live.length >= 5,
      `太小的 ${small.join(',') || '无'} · 数了 ${live.length}/${btns.length} 个（不占位的 ${btns.length - live.length} 个：${btns.filter((b) => !live.includes(b)).map((b) => b.id || '?').join(',')}）`);
    ck('幕布藏起来的时候不吃点击', (() => {
      const e = $('#win-veil');
      const r = e.getBoundingClientRect();
      return getComputedStyle(e).display === 'none' || e.getClientRects().length === 0 || r.width === 0;
    })(), getComputedStyle($('#win-veil')).display);
    return report({ cell: geo.cell, dpr: geo.dpr, iw: innerWidth });
  };

  // ---------- save：档里只有 seed + 手迹 + 指纹，且这份档真的读得回来 ----------
  const save = async () => {
    const g = await beginFresh('5x5', 6161);
    const en = E();
    const ans = g.puzzle.answer;
    const onLoop = [];
    for (let i = 0; i < g.n; i++) if (en.pop(ans[i]) === 2) onLoop.push(i);
    ck('这盘的环够长，能只画一半（否则下面的"还没赢"是空话）', onLoop.length >= 6, String(onLoop.length));
    // 画半条环（不到判胜）：档里存的必须是"进行中"的局，不是已经赢了的局
    for (const i of onLoop.slice(0, onLoop.length >> 1)) g.write(i, ans[i]);
    A().render();
    await wait(700);                                   // 让时钟自己走几格，档里的 elapsedMs 才不是恒 0
    A().writeCell(onLoop[(onLoop.length >> 1) + 1], 1); // 走真实点击路径：负责 persist() 的是它，不是 afterMove()
    eq('这一局还没赢', A().won, false);
    const raw = JSON.parse(localStorage.getItem('moonsun.save.v1') || 'null');
    ck('localStorage 里有档', !!raw, Object.keys(localStorage).join(','));
    if (!raw) return report({});
    ck('档里没写答案（只有 seed 与手迹）', !('answer' in raw) && !('sym' in raw) && !('room' in raw), Object.keys(raw).join(','));
    eq('档里记的就是这一局的 seed', raw.seed, g.puzzle.seed);
    eq('档里记的是这一档尺寸', raw.sizeKey, g.puzzle.sizeKey);
    eq('档的版本号是 1', raw.version, 1);
    eq('手迹逐格写进了档', raw.st.join(','), [...g.st].join(','));
    eq('光标也写进了档', raw.cursor, g.cursor);
    eq('撤销栈整条写进了档（不是只记一个数）', Array.isArray(raw.moves) && raw.moves.length, g.moves.length);
    eq('moveCount 与手迹步数一致', raw.moveCount, g.moves.length);
    ck('时钟写进了档且不为零', typeof raw.elapsedMs === 'number' && raw.elapsedMs >= 250, String(raw.elapsedMs));
    // 指纹由闸自己重算一遍：存档认的不是"有没有这个字段"，而是字段里那个数对不对
    const fp = [g.rows, g.cols, g.room.flat().join(''), g.sym.flat().join('')].join('|');
    eq('指纹 == 尺寸|区域编号|符号行（闸自己算的）', raw.fingerprint, fp);

    // 真回读：另起一局同 seed 的盘，把档里的笔迹搬回来。
    // beginFresh 里 newGame() 收尾会 persist()，也就是**用新开那局的空盘覆写掉档**——
    // 所以先把刚写好的那份档在手里留一份，回读之前放回去；不这么做的话，pendingResume
    // 读到的是空盘（撤销栈长度 0），而 undo 断言就崩在 null.i 上。
    const keep = JSON.stringify(raw);
    const stWrote = raw.st.join(',');
    const g2 = await beginFresh('5x5', 6161);
    localStorage.setItem('moonsun.save.v1', keep);
    const d2 = A().store.pendingResume();
    ck('pendingResume 认得这份档', !!d2, JSON.stringify(d2 && Object.keys(d2)));
    const r2 = A().store.resume(g2.puzzle);
    ck('指纹对得上才让恢复', r2 === d2, JSON.stringify(r2));
    ck('这份档里确有可退的一步（否则下面的 undo 断言是空话）', Array.isArray(r2 && r2.moves) && r2.moves.length > 0, JSON.stringify(r2 && r2.moves && r2.moves.length));
    ck('restore 把笔迹搬回来了', g2.restore(r2), JSON.stringify(r2 && { st: r2.st.slice(0, 4), moves: r2.moves.length }));
    eq('重开之后手迹逐格相同', [...g2.st].join(','), stWrote);
    eq('重开之后光标也回来了', g2.cursor, raw.cursor);
    eq('重开之后撤销栈也回来了', g2.moves.length, raw.moves.length);
    const last = raw.moves[raw.moves.length - 1];
    const back = g2.undo();
    eq('续局之后撤销退的是导航前那一步', back ? JSON.stringify([back.i, back.to]) : 'null', JSON.stringify([last.i, last.to]));
    eq('撤销之后那一格退回它原来的样子', back ? g2.st[last.i] : 'null', last.from);

    // 拒绝路径：seed 变了就不能把旧笔迹盖在新盘上
    const g3 = await beginFresh('5x5', 6363);
    localStorage.setItem('moonsun.save.v1', keep);
    A().store.pendingResume();
    eq('seed 对不上时 resume 返回 null', A().store.resume(g3.puzzle), null);
    localStorage.setItem('moonsun.save.v1', JSON.stringify({ ...raw, fingerprint: fp.slice(0, -2) + 'zz' }));
    A().store.pendingResume();
    eq('指纹对不上时 resume 返回 null', A().store.resume(g3.puzzle), null);
    // 收尾：把导航前要续的那份档放回 localStorage，并把屏幕上也开成那一局。
    // 顺序照 boot 来：先 pendingResume()（它把档读进 Store.data），再 newGame(resumeFrom)
    // ——resume() 拿的是 data，不是重新读一遍 localStorage，跳过第一步就等于拿上一份脏档去对账。
    localStorage.setItem('moonsun.save.v1', keep);
    A().store.pendingResume();
    await A().newGame({ sizeKey: '5x5', seed: raw.seed, resumeFrom: raw });
    eq('把档交回 boot 路径也能续上（手迹逐格相同）', [...A().game.st].join(','), stWrote);
    return report({ keys: Object.keys(raw).join(','), moves: g.moves.length, wrote: onLoop.length });
  };

  // ---------- resume：真导航之后接着同一局，手迹一条不少 ----------
  const resume = async () => {
    const wit = w.__witness;
    const en = E();
    ck('node 侧把证人递过来了', !!wit, JSON.stringify(wit));
    const g = A().game;
    ck('导航之后应用起来了', !!g && A().state === 'ready', A().state);
    if (!g || !wit) return report({});
    // 分母先行：证人那份档要是空的，下面每一条"接着了"都是在比两张空盘，一定绿。
    ck('证人那份档里确有笔迹与步数（续局断言比的不是空盘）',
      Number(wit.storedMoves) > 0 && String(wit.st).split(',').some((v) => v !== '-1' && v !== ''),
      JSON.stringify({ storedMoves: wit.storedMoves, storedMs: wit.storedMs, st: String(wit.st).slice(0, 30) }));
    eq('续的还是 seed 里那一局', g.puzzle.seed, wit.seed);
    eq('续的还是那一档尺寸', g.puzzle.sizeKey, wit.sizeKey);
    ck('手迹一条不差', g.st.join(',') === wit.st, `${g.st.join(',').slice(0, 40)} vs ${String(wit.st).slice(0, 40)}`);
    eq('光标也接着', g.cursor, wit.cursor);
    eq('撤销栈也接着（步数与导航前存档里那条一致）', g.moves.length, wit.storedMoves);
    eq('hint 计数也接着', g.hints, wit.hints);
    eq('引擎说那一格读得到', text('#stat-verify') !== '', true);
    ck('时钟从存档接着走，不是从 00:00 重数', Number(wit.storedMs) > 0 && A().elapsed >= Number(wit.storedMs), `${A().elapsed} vs ${wit.storedMs}`);
    eq('页面印的时间与内部时钟同一份读数', text('#stat-time'), mmss(A().elapsed));
    ck('文档真的换了（timeOrigin 是证人那份之外的新值）', Number(wit.to) !== Number(performance.timeOrigin), `${wit.to} -> ${performance.timeOrigin}`);
    ck('证人那份哨兵不在新文档里（不是同一文档跳 hash）', w.__gateSentinel !== wit.doc, `${w.__gateSentinel} vs ${wit.doc}`);
    // 续上的这一局必须还能判胜：把环上那些"还没画对"的格补齐。
    // 只看 UNDRAWN 是不够的——导航前那一步是真实点击路径写的，它把一个**环上格**滚成了
    // 「不在环上」，那一格既不是没画也不该被跳过，补完时得按答案改回来。
    for (let i = 0; i < g.n; i++) if (en.pop(g.puzzle.answer[i]) === 2 && g.st[i] !== g.puzzle.answer[i]) g.write(i, g.puzzle.answer[i]);
    A().afterMove(); A().render();
    await wait(60);
    ck('续局之后照样判胜', A().won, JSON.stringify({ status: g.status, drawn: g.drawnCells, bad: g.report().filter((x) => x.level === 'error').length, codes: g.report().map((x) => x.code) }));
    eq('判胜那一格写的是合法', text('#stat-verify'), '合法');
    eq('续局之后幕布也占位了', shown('#win-veil'), true);
    return report({ seed: g.puzzle.seed, moves: g.moves.length, ms: A().elapsed });
  };

  // ---------- corrupt：坏档必须被拒掉，而且要说它被拒了 ----------
  const corrupt = async () => {
    const KEY = 'moonsun.save.v1';
    const en = E();
    const line = () => text('#state-line');
    // A. 由 verify.sh 在重载之前种下的"形状齐全但盘面对不上"的档：boot 一定走到作废那一支。
    ck('开机读到的档被判掉了（状态行说了为什么）', /对不上|作废/.test(line()), line());
    eq('作废之后没有崩', bootErrors.length, 0);
    ck('作废之后照样有得玩', !!A().game && A().game.n === 25, String(A().game && A().game.n));
    // 作废不能只是"不看它"：boot 末尾存下去的那一份必须是重画出来的盘的，
    // 否则下一次开机又拿到这份对不上的档。
    const now = JSON.parse(localStorage.getItem(KEY) || 'null');
    ck('作废之后档被换成当前盘的（不留一份坏档给下一次开机）', !!now && now.seed === A().game.puzzle.seed, localStorage.getItem(KEY));
    const gNow = A().game;
    eq('新档的指纹就是当前盘面', now && now.fingerprint,
      [gNow.rows, gNow.cols, gNow.room.flat().join(''), gNow.sym.flat().join('')].join('|'));
    bootErrors.length = 0;

    // B. 每一种坏法都要被点掉，而且要报它是在哪一道被判的（读档判 or 对账判）。
    const good = () => {
      const g = A().game;
      return { version: 1, sizeKey: g.puzzle.sizeKey, seed: g.puzzle.seed, st: [...g.st], cursor: g.cursor,
        moves: g.moves.slice(), moveCount: g.moves.length, elapsedMs: 1000,
        fingerprint: [g.rows, g.cols, g.room.flat().join(''), g.sym.flat().join('')].join('|'), savedAt: 1, won: false };
    };
    const base = good();
    const cases = [
      ['st 不是数组', { ...base, st: 'not-an-array' }, 'readRaw'],
      ['少一个字段', (() => { const x = { ...base }; delete x.fingerprint; return x; })(), 'readRaw'],
      ['版本不认识', { ...base, version: 2 }, 'readRaw'],
      ['压根不是 json', '{{{ 不是 json', 'readRaw'],
      ['手迹长度对不上盘面', { ...base, st: base.st.slice(0, 9) }, 'resume'],
      ['seed 是字符串', { ...base, seed: String(base.seed) }, 'resume'],
    ];
    let rejected = 0, replayed = 0;
    for (const [name, payload, stage] of cases) {
      localStorage.setItem(KEY, typeof payload === 'string' ? payload : JSON.stringify(payload));
      bootErrors.length = 0;
      const pending = A().store.pendingResume();
      const puzzle = A().game.puzzle;
      // readRaw 那一档：形状就不认；resume 那一档：形状齐，但对不上当前这张盘
      const judged = stage === 'readRaw' ? pending === null : pending !== null && A().store.resume(puzzle) === null;
      ck(`坏档「${name}」在 ${stage} 这一道被判掉`, judged,
        `pending=${pending === null ? 'null' : Object.keys(pending).length + ' fields'} resume=${pending ? JSON.stringify(A().store.resume(puzzle)) : 'n/a'}`);
      if (judged) rejected++;
      eq(`坏档「${name}」没把应用弄崩`, bootErrors.length, 0);
      await A().newGame({ sizeKey: '5x5', seed: puzzle.seed });
      replayed++;
      eq(`坏档「${name}」之后重开的盘面是干净的`, [...A().game.st].every((v) => v === en.UNDRAWN), true);
    }
    eq(`${cases.length} 种坏法都点了名`, rejected, cases.length);
    eq(`每种坏法都重开过一次（不是只读了一遍档）`, replayed, cases.length);

    // C. 好档不该被误判：同一份合法的档必须原样认下来。
    localStorage.setItem(KEY, JSON.stringify(good()));
    const pend = A().store.pendingResume();
    ck('合法档被认下了（pendingResume 不返回 null）', !!pend, String(pend));
    ck('合法档能续到自己这张盘上', A().store.resume(A().game.puzzle) === pend, String(A().store.resume(A().game.puzzle)));

    // D. 「清空存档」按钮：旧手迹不能留在屏上，档里也不能留着上一局的手迹。
    A().writeCell(0, 1);
    const beforeSeed = A().game.puzzle.seed;
    $('#btn-reset').click();
    await wait(1500);
    const after = JSON.parse(localStorage.getItem(KEY) || 'null');
    ck('清空存档之后档里是全新的一局（手迹一格没有）', !!after && after.st.every((v) => v === en.UNDRAWN), JSON.stringify(after && after.st));
    ck('清空存档换了 seed', A().game.puzzle.seed !== beforeSeed, `${beforeSeed} -> ${A().game.puzzle.seed}`);
    return report({ cases: cases.length, rejected, stageB: cases.filter((c) => c[2] === 'resume').length });
  };

  // ---------- 阴性自证：这条腿必须能被证明会红 ----------
  const selftest = async () => {
    eq('种一条注定错的期望（2 不等于 1）', 2, 1);
    ck('这条腿本来就该红（GATE_SELFTEST）', false, 'planted red expectation');
    return report({ planted: 2 });
  };

  w.__ng = { engine, gen, core, play, hint, win, save, resume, corrupt, layout, selftest };
})(window);
