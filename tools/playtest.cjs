// Minimal CDP driver for headless playtesting (Node 22+ global WebSocket/fetch).
//
// env: CDP_PORT (devtools port, default 9362), BASE_URL (page origin, default
//      http://127.0.0.1:5262/), WITNESS (json handed to the resume scenario)
//      GATE_SELFTEST=1 (makes every report plant one deliberately wrong expectation —
//      scenarios.js 那份和 node 侧的 leg/nav/reload 那份走的是同一条规矩)
//
//   node tools/playtest.cjs open <url>          fresh tab at <url>, prints boot logs
//   node tools/playtest.cjs eval '<expr>' [nonav]   evaluate, await promises, print result
//   node tools/playtest.cjs scenario <name>     inject tools/scenarios.js, run __ng.<name>()
//   node tools/playtest.cjs witness             read timeOrigin/doc BEFORE any navigation
//   node tools/playtest.cjs nav <url> same|fresh   navigate + assert whether it is a new document
//   node tools/playtest.cjs reload              real reload + assert the document actually died
//   node tools/playtest.cjs leg mouse|touch|keys   真事件（Input.dispatch*）驱动的输入腿
//   node tools/playtest.cjs shot <file.png> / logs
//
// Which page to attach to is decided by BASE_URL's origin, never by a hard-coded port:
// an `eval` that silently lands on an about:blank target reads like a broken deploy.
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.CDP_PORT || 9362);
const BASE = process.env.BASE_URL || 'http://127.0.0.1:5262/';
const ORIGIN = new URL(BASE).origin;
const SELFTEST = process.env.GATE_SELFTEST === '1';
const cmd = process.argv[2];
const arg = process.argv[3];
const rest = process.argv[4];
const isOurs = (u) => typeof u === 'string' && u.startsWith(ORIGIN);

const logs = [];
const rows = [];
const ck = (test, cond, detail) => rows.push({ test, pass: !!cond, detail: cond ? '' : String(detail === undefined ? '' : detail) });
const eq = (test, got, want) => ck(test, String(got) === String(want), `got ${got} / want ${want}`);
const result = (extra) => {
  // 阴性自证要覆盖 node 侧的腿：真事件（leg mouse/touch/keys）与 nav/reload 的报告不经过
  // scenarios.js 的 report()，不在这里也种一条的话，这五条腿就永远是"没能红过的绿"。
  if (SELFTEST) rows.push({ test: 'GATE_SELFTEST 种下的错期望（1 应当等于 2）', pass: 1 === 2, detail: 'planted red' });
  return { rows: rows.slice(), fail: rows.filter((r) => !r.pass).length, ...extra };
};
const out = (extra) => {
  const r = result(extra);
  if (logs.length) console.error(logs.slice(-40).join('\n'));
  // Console noise first, machine-readable line last: the parser in verify.sh takes the final
  // RESULT line, so a stray '{' in a log cannot hijack the report.
  console.log('RESULT ' + JSON.stringify(r));
};
const evidence = (o) => console.log('EVIDENCE ' + Object.entries(o).map(([k, v]) => `${k}=${v}`).join(' '));

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { res, rej } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
      } else if (msg.method) this.consume(msg);
    });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.pending.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }
  consume(m) {
    if (m.method === 'Runtime.consoleAPICalled') {
      logs.push(`[${m.params.type}] ` + m.params.args.map((a) => (a.value !== undefined ? String(a.value) : a.description || a.type)).join(' '));
    } else if (m.method === 'Runtime.exceptionThrown') {
      const e = m.params.exceptionDetails;
      logs.push(`[EXCEPTION] ${e.exception?.description || e.text}\n  at ${e.url}:${e.lineNumber}`);
    } else if (m.method === 'Log.entryAdded') {
      const e = m.params.entry;
      if (e.level === 'error') logs.push(`[log:error] ${e.text} ${e.url || ''}`);
    }
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForDevTools(timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (res.ok) return res.json();
    } catch {
      /* not bound yet */
    }
    if (Date.now() > deadline) throw new Error(`devtools never bound on :${PORT}`);
    await sleep(250);
  }
}

async function main() {
  const info = await waitForDevTools();
  const ws = new WebSocket(info.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res);
    ws.addEventListener('error', rej);
  });
  const cdp = new CDP(ws);

  let list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
  if (cmd === 'open') {
    for (const t of list) {
      if (t.type === 'page' && isOurs(t.url)) {
        try {
          await cdp.send('Target.closeTarget', { targetId: t.id || t.targetId });
        } catch { /* already gone */ }
      }
    }
    await sleep(300);
    list = [];
  }
  const existing = cmd === 'open' ? null : list.find((t) => t.type === 'page' && isOurs(t.url));
  let sessionId;
  if (existing) {
    ({ sessionId } = await cdp.send('Target.attachToTarget', { targetId: existing.id || existing.targetId, flatten: true }));
  } else {
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    ({ sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true }));
  }

  await cdp.send('Runtime.enable', {}, sessionId);
  await cdp.send('Log.enable', {}, sessionId);
  await cdp.send('Page.enable', {}, sessionId);

  const evaluate = async (expression) => {
    const r = await cdp.send(
      'Runtime.evaluate',
      { expression, returnByValue: true, awaitPromise: true, timeout: 900000 },
      sessionId
    );
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  const json = async (expression) => JSON.parse(await evaluate(`JSON.stringify((${expression}))`));

  const ready = async () => {
    for (let i = 0; i < 160; i++) {
      const s = await evaluate('document.readyState').catch(() => 'loading');
      if (s === 'complete') return;
      await sleep(100);
    }
  };
  const navigate = async (url) => {
    await cdp.send('Page.navigate', { url }, sessionId);
    await ready();
    await sleep(200);
  };
  // 只差一个 hash 的 URL 是 same-document navigation：Page.navigate 过去并不会换文档。
  // 所以"这一腿必须落在新文档里"的走 Page.reload，URL 真的不同才用 navigate。
  const gotoFresh = async (url = BASE) => {
    const cur = String(await evaluate('location.href').catch(() => ''));
    const cut = (u) => u.split('#')[0];
    if (cur && cut(cur) === cut(url)) {
      await cdp.send('Page.reload', { ignoreCache: true }, sessionId);
      await ready();
      await sleep(200);
    } else {
      await navigate(url);
    }
  };
  // 文档身份：每个文档一个随机 doc 号。片段导航不换文档所以它不变，真重载一定变。
  const docInfo = () =>
    evaluate(`(()=>{const h=window.hebi;return {url:location.href,to:performance.timeOrigin,doc:h?h.doc:'(no window.hebi)',boot:!!h};})()`).catch((e) => ({ url: 'unknown', to: 0, doc: 'ERR:' + e.message, boot: false }));

  // ---------- in-page geometry: 先量 hit box，再谈"点得到" ----------

  const PREP = `(()=>{
    const h=window.hebi, v=h.view, g=h.game;
    if(!g) throw new Error('no game on screen');
    const rect=v.canvas.getBoundingClientRect();
    const at=(x,y)=>{const e=document.elementFromPoint(x,y);return e?(e.id||e.tagName):'null';};
    const o={rect:{l:rect.left,t:rect.top,w:rect.width,h:rect.height},iw:innerWidth,dpr:devicePixelRatio,
      seed:g.puzzle.seed,tier:g.puzzle.tier,cells:[],btns:[],sweepTotal:g.B.N,sweepHits:0};
    let miss=0;
    for(let i=0;i<g.B.N;i++){const r=v.cellRect(i);const x=rect.left+r.x+r.size/2,y=rect.top+r.y+r.size/2;
      if(at(x,y)==='board')o.sweepHits++;else miss++;}
    o.sweepMiss=miss;
    const w=g.white;
    for(const i of [w[0],w[Math.min(4,w.length-1)]]){const r=v.cellRect(i);
      o.cells.push({i,x:rect.left+r.x+r.size/2,y:rect.top+r.y+r.size/2,hit:at(rect.left+r.x+r.size/2,rect.top+r.y+r.size/2)});}
    for(const [i,b] of g.black){const r=v.cellRect(i);
      o.black={i,arrow:b.arrow,num:b.num,x:rect.left+r.x+r.size/2,y:rect.top+r.y+r.size/2,hit:at(rect.left+r.x+r.size/2,rect.top+r.y+r.size/2)};break;}
    for(const id of ['btn-d0','btn-d3','btn-hint','btn-new','btn-undo']){const e=document.getElementById(id);const b=e.getBoundingClientRect();
      const x=b.left+b.width/2,y=b.top+b.height/2;
      o.btns.push({id,x,y,hit:at(x,y),w:Math.round(b.width),h:Math.round(b.height)});}
    return o;})()`;

  // 两条腿各自只发自己那一种真事件：mouse 腿发鼠标，touch 腿发触屏。脚本里成对写 tap，
  // 于是同一条断言在两种事件下各跑一次，而不会出现"鼠标腿其实也按了一遍触屏"的假证据。
  const mouse = async (x, y) => {
    if (arg === 'touch') return;
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }, sessionId);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 }, sessionId);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 }, sessionId);
    await sleep(90);
  };
  const key = async (k) => {
    const map = { '0': 'Digit0', '1': 'Digit1', '2': 'Digit2', '3': 'Digit3', '4': 'Digit4', '5': 'Digit5', Backspace: 'Backspace', ArrowRight: 'ArrowRight', ArrowUp: 'ArrowUp', h: 'KeyH' };
    const vk = { '0': 48, '1': 49, '2': 50, '3': 51, '4': 52, '5': 53, Backspace: 8, ArrowRight: 39, ArrowUp: 38, h: 72 };
    const text = k.length === 1 ? k : undefined;
    // 绝不给 nativeVirtualKeyCode：在 macOS 上 Chrome 把它当平台原生键码，于是这只键被
    // raw keyboard 路径反复补发。实测（_tmp-keyprobe 量出来的，跑完即删）：
    //   带 nativeVirtualKeyCode:520ms 内到达 3664 次 keydown；只带 windowsVirtualKeyCode:1 次。
    // 让 Chrome 自己从 wvk 推原生键码，一次派发就正好是一次按键。
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code: map[k], text, windowsVirtualKeyCode: vk[k] }, sessionId);
    if (text) await cdp.send('Input.dispatchKeyEvent', { type: 'char', text, key: k, code: map[k], windowsVirtualKeyCode: vk[k] }, sessionId);
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: map[k], windowsVirtualKeyCode: vk[k] }, sessionId);
    await sleep(60);
  };
  const touch = async (x, y) => {
    if (arg !== 'touch') return;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, radiusX: 6, radiusY: 6, force: 1, id: 1 }] }, sessionId);
    await sleep(40);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }, sessionId);
    await sleep(90);
  };

  const GAME = `(()=>{const g=window.hebi.game;return {cursor:g.cursor,seed:g.puzzle.seed,moves:g.moves,hints:g.hints,status:g.status,codes:g.codes(),errs:g.errs.length,doc:window.hebi.doc,to:performance.timeOrigin};})()`;
  const DOMTXT = `(()=>{const t=s=>(document.querySelector(s)||{}).textContent||'';
    return {name:t('#stat-name'),seed:t('#stat-seed'),moves:t('#stat-moves'),hints:t('#stat-hints'),
    filled:t('#stat-filled'),remaining:t('#stat-remaining'),conflicts:t('#stat-conflicts'),snakes:t('#stat-snakes'),
    state:t('#state-line'),hintRule:t('#hint-rule'),hintLine:t('#hint-line'),
    veilShown:(()=>{const e=document.getElementById('win-veil');return e?getComputedStyle(e).display!=='none'&&e.getClientRects().length>0:false;})(),
    active:document.activeElement?(document.activeElement.id||document.activeElement.tagName):'null',
    pressed:[...document.querySelectorAll('.digits .digit')].map(b=>b.id+'='+b.getAttribute('aria-pressed')).join(','),
    gen:t('#stat-genms'),score:t('#stat-score'),savedAt:t('#stat-name')};})()`;

  // ---------- commands ----------

  if (cmd === 'open') {
    await navigate(arg || BASE);
    const d = await docInfo();
    evidence({ url: d.url, timeOrigin: d.to, doc: d.doc, innerWidth: await evaluate('innerWidth'), dpr: await evaluate('devicePixelRatio') });
    console.log('opened ' + (arg || BASE) + '\n' + (logs.join('\n') || '(no console output)'));
  } else if (cmd === 'eval') {
    if (rest !== 'nonav') await navigate(BASE);
    const v = await evaluate(arg);
    console.log(typeof v === 'string' ? v : JSON.stringify(v));
  } else if (cmd === 'witness') {
    const d = await docInfo();
    // 派发导航之先，证人已经在 node 手里了：续局那条腿要证明的是"新文档"，不是"我按了一次刷新"。
    // 证人同时把"导航前盘面长什么样"抄一份下来——续局腿要比的是这一份，不是它自己重算的期望。
    const sent = await evaluate(`(()=>{const g=window.hebi.game;window.__gateSentinel='sn'+Math.floor(Math.random()*1e6);return window.__gateSentinel+'|'+(g?g.codes():'')+'|'+(g?g.puzzle.seed:'');})()`);
    const snap = JSON.parse(await evaluate(`(()=>{const g=window.hebi.game,S=window.hebi.engine.Store,r=S.resume(window.hebi.engine.tierOf);
      return JSON.stringify({tier:g?g.puzzle.tier:'',seed:g?g.puzzle.seed:0,codes:g?g.codes():'',bl:g?g.black.size:0,
        hints:g?g.hints:0,moves:g?g.moves:0,ms:g?window.hebi.state().elapsedMs:0,storedMs:r?r.elapsedMs:0,storedSeed:r?r.seed:0});})()`));
    evidence({ url: d.url, timeOrigin: d.to, doc: d.doc, sentinel: sent, innerWidth: await evaluate('innerWidth'), dpr: await evaluate('devicePixelRatio'), ...snap });
    console.log(JSON.stringify({ timeOrigin: d.to, doc: d.doc, url: d.url, sentinel: sent, ...snap }));
  } else if (cmd === 'nav' || cmd === 'reload') {
    const before = await docInfo();
    const expect = cmd === 'reload' ? 'fresh' : rest;
    const url = cmd === 'reload' ? before.url.split('#')[0] : arg;
    if (cmd === 'reload') await cdp.send('Page.reload', { ignoreCache: true }, sessionId);
    else await cdp.send('Page.navigate', { url: url || BASE }, sessionId);
    await sleep(expect === 'fresh' ? 500 : 350);
    await ready();
    if (expect === 'fresh') {
      for (let i = 0; i < 60; i++) {
        const d = await docInfo();
        if (d.boot && d.doc !== before.doc) break;
        await sleep(150);
      }
    }
    const after = await docInfo();
    evidence({ leg: cmd, expect, urlBefore: before.url, urlAfter: after.url, timeOriginBefore: before.to, timeOriginAfter: after.to, docBefore: before.doc, docAfter: after.doc, innerWidth: await evaluate('innerWidth'), dpr: await evaluate('devicePixelRatio') });
    eq(`${cmd} 之后页面还在同一个 URL 形态`, new URL(after.url).pathname, new URL(url || before.url).pathname);
    ck(`${cmd} 之后应用又起来了（window.hebi 在）`, after.boot, after.doc);
    if (expect === 'same') {
      eq('片段导航不算重载：timeOrigin 必须没变', after.to, before.to);
      eq('片段导航不算重载：文档身份必须没变', after.doc, before.doc);
    } else {
      ck('真重载：timeOrigin 必须换了（新文档）', after.to !== before.to, `${before.to} -> ${after.to}`);
      ck('真重载：文档身份必须换了', after.doc !== before.doc, `${before.doc} -> ${after.doc}`);
    }
    out({ before, after, expect });
  } else if (cmd === 'scenario') {
    const src = fs.readFileSync(path.join(__dirname, 'scenarios.js'), 'utf8');
    const { identifier } = await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: src }, sessionId);
    await gotoFresh(BASE);
    await evaluate(`window.__witness=${process.env.WITNESS || 'null'};window.__selftest=${SELFTEST};'ok'`);
    // Headless reports the page as hidden, and the render loop is allowed to skip frames when
    // hidden — so a scenario that waits on animation would time out against a browser that is
    // only pretending to be in the background.
    await evaluate(`Object.defineProperty(document,'hidden',{get:()=>false,configurable:true});
      Object.defineProperty(document,'visibilityState',{get:()=>'visible',configurable:true});'ok'`);
    const d = await docInfo();
    evidence({ scenario: arg, url: d.url, timeOrigin: d.to, doc: d.doc, innerWidth: await evaluate('innerWidth'), dpr: await evaluate('devicePixelRatio') });
    const res = await evaluate(`(async()=>{
      if (!window.__ng) throw new Error('scenarios.js never installed');
      // 报告必须是字符串：把对象交给 returnByValue 只会打印出 "[object Object]"，
      // 于是这一腿看起来跑了、verify.sh 却一行断言都解析不到。
      return JSON.stringify(await window.__ng[${JSON.stringify(arg)}]());
    })()`);
    // 每一次注入都在文档上留一份，用完就撤：否则同一个文档里会有第 N 份 scenarios.js 在跑。
    await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier }, sessionId).catch(() => {});
    if (logs.length) console.error(logs.slice(-40).join('\n'));
    console.log('RESULT ' + res);
  } else if (cmd === 'leg') {
    await leg();
  } else if (cmd === 'shot') {
    await cdp.send('Page.bringToFront', {}, sessionId);
    await sleep(250);
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' }, sessionId);
    fs.mkdirSync(path.dirname(arg), { recursive: true });
    fs.writeFileSync(arg, Buffer.from(data, 'base64'));
    console.log('wrote ' + arg);
  } else if (cmd === 'logs' || cmd === 'reload-logs') {
    if (cmd === 'reload-logs') await navigate(BASE);
    console.log(logs.join('\n') || '(clean)');
  } else {
    console.error('unknown command: ' + cmd);
    process.exit(64);
  }
  ws.close();
  process.exit(0);

  // ---------- 真事件腿：鼠标 / 触屏 / 键盘（都走 CDP Input.*，不是页内 new Event） ----------

  async function leg() {
    await gotoFresh(BASE);
    await evaluate(`(()=>{ if(!window.hebi.game) window.hebi.begin({tier:'sho'}); return 1; })()`);
    await sleep(150);
    if (arg === 'touch') {
      // 覆写必须写在腿自己的调用里，并且腿要能读回证人：另起进程设 Emulation 等于把桌面断言
      // 重跑一遍。所以这里读回 innerWidth/dpr 并把它命名成"覆写在位"，不命名成"这是手机"。
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true }, sessionId);
      await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 }, sessionId);
      await sleep(400);
    }
    const p = await json(PREP);
    const d0 = await docInfo();
    evidence({ leg: arg, url: d0.url, timeOrigin: d0.to, doc: d0.doc, innerWidth: p.iw, dpr: p.dpr, seed: p.seed });
    eq('hit box：棋盘每一格中心都落在 canvas 上', p.sweepMiss, 0);
    eq('hit box：数字按钮中心都落在自己上', p.btns.filter((b) => b.hit !== b.id).map((b) => b.hit + '@' + b.id).join(','), '');
    ck('按钮都够点（>=34px 高）', p.btns.every((b) => b.h >= 34), JSON.stringify(p.btns.map((b) => b.h)));
    if (arg === 'touch') {
      eq('移动覆写在位：innerWidth 读回 390', p.iw, 390);
      eq('移动覆写在位：devicePixelRatio 读回 3', p.dpr, 3);
      ck('窄屏下棋盘仍在视口里', p.rect.l >= 0 && p.rect.w <= p.iw + 1, JSON.stringify({ rect: p.rect, iw: p.iw }));
    }
    if (arg === 'touch' || arg === 'mouse') {
      eq(`hit box：白格 ${p.cells[0].i} 的命中元素就是 canvas`, p.cells[0].hit, 'board');
      eq(`hit box：黑格 ${p.black.i} 的命中元素就是 canvas`, p.black.hit, 'board');
      const before = await json(GAME);
      await mouse(p.cells[0].x, p.cells[0].y);
      await touch(p.cells[0].x, p.cells[0].y);
      const afterSel = await json(GAME);
      eq(`${arg} 点击选中白格 ${p.cells[0].i}`, afterSel.cursor, p.cells[0].i);

      // 数字按钮：真事件按下 3，DOM 与引擎两边都要读到 3。
      const b3 = p.btns.find((b) => b.id === 'btn-d3');
      await mouse(b3.x, b3.y);
      await touch(b3.x, b3.y);
      const dom = await json(DOMTXT);
      const st3 = await json(`(()=>({v:window.hebi.game.st[window.hebi.game.cursor],doc:window.hebi.doc}))()`);
      eq('写下去的就是 3', st3.v, 3);
      ck('数字键亮起来（aria-pressed）', /btn-d3=true/.test(dom.pressed), dom.pressed);
      eq('步数读到 1', dom.moves, '1');

      // 黑格改不了：题面是印上去的
      await mouse(p.black.x, p.black.y);
      await touch(p.black.x, p.black.y);
      const afterBlack = await json(GAME);
      const domB = await json(DOMTXT);
      eq('黑格点不着：选中格没动', afterBlack.cursor, p.cells[0].i);
      ck('状态行说出了为什么', /黑格/.test(domB.state), domB.state);
      const b0 = p.btns.find((b) => b.id === 'btn-d0');
      await mouse(b0.x, b0.y);
      await touch(b0.x, b0.y);
      const stBlank = await json(`(()=>({v:window.hebi.game.st[window.hebi.game.cursor],ch:window.hebi.game.codes()[window.hebi.game.cursor],blank:window.hebi.engine.BLANK}))()`);
      eq('按 空 把这一格钉成留空', stBlank.v, stBlank.blank);
      eq('盘面串上这一格记成 x（不是 .）', stBlank.ch, 'x');
      await mouse(p.cells[1].x, p.cells[1].y);
      await touch(p.cells[1].x, p.cells[1].y);
      const bU = p.btns.find((b) => b.id === 'btn-undo');
      await mouse(bU.x, bU.y);
      await touch(bU.x, bU.y);
      const domU = await json(DOMTXT);
      const undoRead = await json(`(()=>({v:window.hebi.game.st[${p.cells[0].i}],rem:window.hebi.game.remaining}))()`);
      eq('撤销退掉最后一步（留空退回 3）', undoRead.v, 3);
      eq('撤销一步退回一个动作', domU.moves, '1');

      // 换一局：seed 必须来自存档里的自增游标，而不是日期/时间
      const sBefore = await json(`(()=>({seed:window.hebi.game.puzzle.seed,cur:window.hebi.engine.Store.peekSeed()}))()`);
      const bn = p.btns.find((b) => b.id === 'btn-new');
      await mouse(bn.x, bn.y);
      await touch(bn.x, bn.y);
      const sAfter = await json(`(()=>({seed:window.hebi.game.puzzle.seed,cur:window.hebi.engine.Store.peekSeed(),tier:window.hebi.game.puzzle.tier}))()`);
      const domN = await json(DOMTXT);
      ck('换一局换了盘（seed 变了）', sAfter.seed !== sBefore.seed, `${sBefore.seed} -> ${sAfter.seed}`);
      ck('seed 是小整数自增号，不是日期/时间戳', sAfter.seed >= 1 && sAfter.seed < 1e6 && Number.isInteger(sAfter.seed), sAfter.seed);
      ck('游标推到了 seed 之后（下一局不会撞同一张）', sAfter.cur > sAfter.seed, `${sAfter.seed} / ${sAfter.cur}`);
      ck('页面把 seed 印出来了', domN.seed.includes(String(sAfter.seed)), domN.seed);
    }
    if (arg === 'keys') {
      await mouse(p.cells[0].x, p.cells[0].y);
      const act = await json(`(()=>({active:document.activeElement?document.activeElement.id:'null'}))()`);
      eq('焦点钉在棋盘上（先真点了一次）', act.active, 'board');
      const seq = ['3', '0', 'Backspace', 'ArrowRight', 'ArrowUp', 'h'];
      // 逐个按键各取一次快照：整段求差只会打印出一个大数，说不清是哪一只键被重复送达。
      const per = [];
      for (const k of seq) {
        const a = await json(`window.hebi.keyHits()`);
        await key(k);
        const b = await json(`window.hebi.keyHits()`);
        per.push({ k, seen: b.seen - a.seen, handled: b.handled - a.handled, rep: b.repeated - a.repeated, n: b.by[k] || 0 });
      }
      const dom = await json(DOMTXT);
      const st = await json(`(()=>{const g=window.hebi.game;return {v:g.st[g.cursor],cursor:g.cursor,moves:g.moves,hints:g.hints}})()`);
      // 仓里 known flake：同一个键盘计数在同样的跑法里读到 0/2/7。所以这里报的是"到达数"，
      // 派发数与实际到达数不等就红，红的那条写着到达数、处理数和自动重复数。
      for (const q of per) eq(`按键 ${q.k} 到达游戏一次`, `${q.seen} seen/${q.handled} handled/${q.rep} repeat/${q.n} total`, `1 seen/1 handled/0 repeat/1 total`);
      const sum = per.reduce((a, q) => a + q.seen, 0);
      eq(`派发了 ${seq.length} 个按键：到达游戏的 keydown 总数`, sum, seq.length);
      ck('退格把这一格收回未定（数字键不该亮着）', !/btn-d3=true/.test(dom.pressed), dom.pressed);
      eq('H 键给了一次提示', dom.hints, '1');
      ck('提示说出了规则名', /^规则：P\d/.test(dom.hintRule), dom.hintRule);
      ck('提示不是空话', dom.hintLine.length > 8, dom.hintLine);
    }
    if (arg === 'touch') {
      await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false }, sessionId).catch(() => {});
      await cdp.send('Emulation.clearDeviceMetricsOverride', {}, sessionId).catch(() => {});
    }
    out({ leg: arg, cells: p.cells.length, buttons: p.btns.length });
  }
}

main().catch((err) => {
  console.error('ERROR ' + (err.message || err));
  if (rows.length) console.error('RESULT ' + JSON.stringify(result({ crashed: true })));
  else console.error('RESULT ' + JSON.stringify({ rows: [{ test: `${cmd} ${arg || ''} 整条腿跑挂了`, pass: false, detail: String(err.message || err) }], fail: 1, crashed: true }));
  if (logs.length) console.error(logs.slice(-12).join('\n'));
  process.exit(1);
});
