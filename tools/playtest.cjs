// Minimal CDP driver for headless playtesting (Node 22+ global WebSocket/fetch).
//
// env: CDP_PORT (devtools port, default 9363), BASE_URL (page origin, default
//      http://127.0.0.1:5276/), WITNESS (json handed to the resume scenario)
//      GATE_SELFTEST=1 (makes every report plant one deliberately wrong expectation —
//      scenarios.js 那份和 node 侧的 leg/nav/reload 那份走的是同一条规矩)
//
//   node tools/playtest.cjs open <url>          fresh tab at <url>, prints boot logs
//   node tools/playtest.cjs eval '<expr>' [nonav]   evaluate, await promises, print result
//   node tools/playtest.cjs scenario <name>     inject tools/scenarios.js, run __ng.<name>()
//   node tools/playtest.cjs witness             read timeOrigin/doc/save BEFORE any navigation
//   node tools/playtest.cjs nav <url> same|fresh   navigate + assert whether it is a new document
//   node tools/playtest.cjs reload              real reload + assert the document actually died
//   node tools/playtest.cjs leg mouse|touch|keys   真事件（Input.dispatch*）驱动的输入腿
//   node tools/playtest.cjs shot <file.png> / logs
//
// Which page to attach to is decided by BASE_URL's origin, never by a hard-coded port:
// an `eval` that silently lands on an about:blank target reads like a broken deploy.
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.CDP_PORT || 9363);
const BASE = process.env.BASE_URL || 'http://127.0.0.1:5276/';
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
  // 文档身份：每个文档一个随机哨兵。片段导航不换文档所以它不变，真重载一定变。
  // 它由门禁自己种在 window 上——发布页里没有测试钩子，那条断言才不会被页面自己实现掉。
  const docInfo = () =>
    evaluate(`(()=>{const tag=window.__gateSentinel||(window.__gateSentinel='ms'+Math.floor(Math.random()*1e6));
      const m=window.moonsun;return {url:location.href,to:performance.timeOrigin,doc:tag,boot:!!(m&&m.state==='ready')};})()`)
      .catch((e) => ({ url: 'unknown', to: 0, doc: 'ERR:' + e.message, boot: false }));

  // ---------- in-page geometry: 先量 hit box，再谈"点得到" ----------

  const PREP = `(()=>{
    const m=window.moonsun, v=m.view, g=m.game;
    if(!g) throw new Error('no game on screen');
    const rect=v.canvas.getBoundingClientRect();
    const at=(x,y)=>{const e=document.elementFromPoint(x,y);return e?(e.id||e.tagName):'null';};
    const probe=(i)=>{const r=v.rectOf(i);const x=rect.left+r.cx,y=rect.top+r.cy;
      return {i,x,y,hit:at(x,y),row:(i/g.cols|0)+1,col:i%g.cols+1};};
    const o={rect:{l:rect.left,t:rect.top,w:rect.width,h:rect.height},iw:innerWidth,dpr:devicePixelRatio,
      seed:g.puzzle.seed,sizeKey:g.puzzle.sizeKey,rows:g.rows,cols:g.cols,cells:[],clue:null,border:null,btns:[],sweepTotal:g.n,sweepHits:0};
    let miss=0;
    for(let i=0;i<g.n;i++){const p=probe(i);if(p.hit==='board')o.sweepHits++;else miss++;}
    o.sweepMiss=miss;
    // 两种必须点得到的格子：带线索的格（符号画在上面但仍可落笔）、跨区边界旁边的格
    for(let i=0;i<g.n;i++){const s=g.sym[(i/g.cols)|0][i%g.cols];if(s==='M'||s==='S'){o.clue=probe(i);o.clue.sym=s;break;}}
    for(let i=0;i<g.n;i++){for(let d=0;d<4;d++){const j=g.nb(i,d);
      if(j>=0&&g.room[(i/g.cols)|0][i%g.cols]!==g.room[(j/g.cols)|0][j%g.cols]){o.border=probe(i);o.border.d=d;break;}}
      if(o.border)break;}
    for(let i=0;i<g.n&&o.cells.length<2;i++){if(g.st[i]===m.engine.UNDRAWN&&g.sym[(i/g.cols)|0][i%g.cols]==='.')o.cells.push(probe(i));}
    for(const id of ['btn-hint','btn-undo','btn-clear','btn-new','btn-motion']){const e=document.getElementById(id);const b=e.getBoundingClientRect();
      const x=b.left+b.width/2,y=b.top+b.height/2;
      o.btns.push({id,x,y,hit:at(x,y),w:Math.round(b.width),h:Math.round(b.height)});}
    return o;})()`;

  // 两条腿各自只发自己那一种真事件：mouse 腿发鼠标，touch 腿发触屏。脚本里成对写 tap，
  // 于是同一条断言在两种事件下各跑一次，而不会出现"鼠标腿其实也按了一遍触屏"的假证据。
  const mouse = async (x, y, button = 'left') => {
    if (arg === 'touch') return;
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }, sessionId);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, clickCount: 1 }, sessionId);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button, clickCount: 1 }, sessionId);
    await sleep(90);
  };
  const touch = async (x, y) => {
    if (arg !== 'touch') return;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, radiusX: 6, radiusY: 6, force: 1, id: 1 }] }, sessionId);
    await sleep(40);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }, sessionId);
    await sleep(90);
  };
  // 键盘：绝不给 nativeVirtualKeyCode。macOS 上 Chrome 把它当平台原生键码，于是同一只键会被
  // raw keyboard 路径反复补发（只带 windowsVirtualKeyCode 时一次派发正好一次 keydown）。
  const KEYMAP = {
    '0': ['Digit0', 48], '1': ['Digit1', 49], '2': ['Digit2', 50], '6': ['Digit6', 54],
    ' ': ['Space', 32], Backspace: ['Backspace', 8], ArrowRight: ['ArrowRight', 39], ArrowUp: ['ArrowUp', 38],
    ArrowLeft: ['ArrowLeft', 37],
    h: ['KeyH', 72], z: ['KeyZ', 90], c: ['KeyC', 67],
  };
  const key = async (k) => {
    const [code, wvk] = KEYMAP[k];
    const text = k.length === 1 ? k : undefined;
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, text, windowsVirtualKeyCode: wvk }, sessionId);
    if (text) await cdp.send('Input.dispatchKeyEvent', { type: 'char', text, key: k, code, windowsVirtualKeyCode: wvk }, sessionId);
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: wvk }, sessionId);
    await sleep(60);
  };
  // 到达计数由门禁在页面上自己挂一只监听器数——发布页里没有测试钩子，
  // 而"派发了一次 vs 到达了一次"这件事只有 window 自己说才作数。
  const COUNT_KEYS = `(()=>{if(!window.__keySeen){window.__keySeen={seen:0,repeat:0,by:{}};
    addEventListener('keydown',(e)=>{window.__keySeen.seen++;if(e.repeat)window.__keySeen.repeat++;
      window.__keySeen.by[e.key]=(window.__keySeen.by[e.key]||0)+1;},true);}window.__keySeen={seen:0,repeat:0,by:{}};return 1;})()`;
  // 交回一个**对象**而不是 JSON 文本：json() 自己会 stringify 一次，这里再 stringify 就成了
  // "字符串套字符串"，node 侧拿到的是 str，于是 ke.seen 是 undefined、差值全是 NaN——
  // 键真的到达了，读数却在说它没到达。
  const READ_KEYS = `(()=>{const k=window.__keySeen;return k?{seen:k.seen,repeat:k.repeat,by:Object.keys(k.by).join('+')}:null;})()`;

  const GAME = `(()=>{const m=window.moonsun,g=m.game;return {cursor:g.cursor,seed:g.puzzle.seed,sizeKey:g.puzzle.sizeKey,
    moves:g.moves.length,hints:g.hints,status:g.status,st:g.st[g.cursor],drawn:g.drawnCells,off:g.markedCells,touched:g.touchedCells,
    stubs:g.stubs().length,bad:g.report().filter(x=>x.level==='error').length,codes:g.report().map(x=>x.code).join(','),
    to:performance.timeOrigin};})()`;
  const DOMTXT = `(()=>{const t=s=>((document.querySelector(s)||{}).textContent||'').trim();
    return {seed:t('#stat-seed'),time:t('#stat-time'),rooms:t('#stat-rooms'),clues:t('#stat-clues'),drawn:t('#stat-drawn'),
    off:t('#stat-off'),open:t('#stat-open'),stubs:t('#stat-stubs'),bad:t('#stat-bad'),moves:t('#stat-moves'),
    verify:t('#stat-verify'),state:t('#state-line'),sr:t('#sr-cell'),
    veilShown:(()=>{const e=document.getElementById('win-veil');return e?getComputedStyle(e).display!=='none'&&e.getClientRects().length>0:false;})(),
    active:document.activeElement?(document.activeElement.id||document.activeElement.tagName):'null'};})()`;

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
    // 证人同时把"导航前盘面长什么样、存档里写了什么"抄一份下来——续局腿要比的是这一份，
    // 不是它自己重算的期望。
    const sent = await evaluate(`(()=>{const m=window.moonsun,g=m.game;window.__gateProbe='gp'+Math.floor(Math.random()*1e6);
      return window.__gateProbe+'|'+(g?g.moves.length:'')+'|'+(g?g.puzzle.seed:'');})()`);
    const snap = JSON.parse(await evaluate(`(()=>{const m=window.moonsun,g=m.game;
      const raw=JSON.parse(localStorage.getItem('moonsun.save.v1')||'null');
      return JSON.stringify({sizeKey:g?g.puzzle.sizeKey:'',seed:g?g.puzzle.seed:0,
        st:g?Array.from(g.st).join(','):'',cursor:g?g.cursor:-1,moves:g?g.moves.length:0,hints:g?g.hints:0,
        elapsed:m.elapsed,status:g?g.status:'',
        storedMs:raw?raw.elapsedMs:null,storedSeed:raw?raw.seed:null,storedSize:raw?raw.sizeKey:null,
        storedMoves:raw&&Array.isArray(raw.moves)?raw.moves.length:null,
        storedSt:raw&&Array.isArray(raw.st)?raw.st.join(','):'-',fp:raw?raw.fingerprint:null});})()`));
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
    ck(`${cmd} 之后应用又起来了（window.moonsun.state==='ready'）`, after.boot, after.doc);
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
      // 报告交回来必须**已经**是 JSON 文本：scenario 的 report() 自己 stringify 一次，
      // 这里再 stringify 就变成一份带引号的字符串，python 侧 json.loads 拿到 str，
      // 于是这一腿看起来跑了、断言却一行都解析不出来（曾经红在 TypeError 上）。
      let r;
      try {
        r = await window.__ng[${JSON.stringify(arg)}]();
      } catch (e) {
        // 半路抛了也要把已经记下的断言带回来：崩掉的 scenario 只报一条合成行，等于把
        // "跑到第几条时才崩"这件事整个藏起来，而这一轮红的就是因为它。
        const done = (window.__rows || []).slice();
        return JSON.stringify({ rows: done.concat([{ test: 'scenario ' + ${JSON.stringify(arg)} + ' 半路抛了', pass: false, detail: String(e && e.message || e) }]), fail: done.filter((x) => !x.pass).length + 1, crashed: true });
      }
      if (typeof r !== 'string') throw new Error('scenario ' + ${JSON.stringify(arg)} + ' 没交回字符串，而是 ' + typeof r);
      return r;
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
  } else if (cmd === 'logs') {
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
    await evaluate(COUNT_KEYS);
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
    evidence({ leg: arg, url: d0.url, timeOrigin: d0.to, doc: d0.doc, innerWidth: p.iw, dpr: p.dpr, seed: p.seed, sizeKey: p.sizeKey });
    eq('hit box：棋盘每一格中心都落在 canvas 上', p.sweepMiss, 0);
    eq('hit box：按钮中心都落在自己上', p.btns.filter((b) => b.hit !== b.id).map((b) => b.hit + '@' + b.id).join(','), '');
    ck('按钮都够点（>=34px 高）', p.btns.every((b) => b.h >= 34), JSON.stringify(p.btns.map((b) => b.h)));
    ck('题面里有线索格可点', !!p.clue, JSON.stringify(p.clue));
    ck('盘上有跨区边界可点', !!p.border, JSON.stringify(p.border));
    eq('两点可测：空白格找到了', p.cells.length, 2);
    if (arg === 'touch') {
      eq('移动覆写在位：innerWidth 读回 390', p.iw, 390);
      eq('移动覆写在位：devicePixelRatio 读回 3', p.dpr, 3);
      ck('窄屏下棋盘仍在视口里', p.rect.l >= 0 && p.rect.w <= p.iw + 1, JSON.stringify({ rect: p.rect, iw: p.iw }));
    }
    if (arg === 'touch' || arg === 'mouse') {
      eq(`hit box：空白格 ${p.cells[0].i} 的命中元素就是 canvas`, p.cells[0].hit, 'board');
      eq(`hit box：线索格 ${p.clue.i} 的命中元素就是 canvas`, p.clue.hit, 'board');

      // 左键一格 = 往前滚一档：没画 → 不在环上
      const before = await json(GAME);
      await mouse(p.cells[0].x, p.cells[0].y);
      await touch(p.cells[0].x, p.cells[0].y);
      const s1 = await json(GAME);
      eq(`${arg} 点击选中格 ${p.cells[0].i}`, s1.cursor, p.cells[0].i);
      const OFF = await json(`window.moonsun.engine.OFF`);
      eq('左键第一档钉成「不在环上」', s1.st, OFF);
      eq('落一笔进步数', s1.moves, before.moves + 1);

      // 右键 = 倒退一档：不在环上 → 没画（三个读数必须各自都能到达）
      await mouse(p.cells[0].x, p.cells[0].y, 'right');
      const s2 = await json(GAME);
      const UNDRAWN = await json(`window.moonsun.engine.UNDRAWN`);
      if (arg === 'mouse') eq('右键倒退一档擦回「没画」', s2.st, UNDRAWN);

      // 连点三下：没画 → 留空 → 竖穿 → 横穿，横穿就是两条线头
      for (let k = 0; k < 3; k++) { await mouse(p.cells[1].x, p.cells[1].y); await touch(p.cells[1].x, p.cells[1].y); }
      const s3 = await json(GAME);
      const dom3 = await json(DOMTXT);
      const pair2 = await json(`window.moonsun.engine.PAIRS[1]`);
      eq('连点滚到横穿（左|右两条线）', s3.st, pair2);
      eq('横穿算一格在环上', s3.drawn, 1);
      eq('两个头都还没接上', s3.stubs, 2);
      eq('线头那一格读的也是这个数', dom3.stubs, '2');
      eq('违规那一格不该因为线头而红', s3.bad, 0);
      ck('状态行念的是线头而不是区域条款', /没接上|不是两条|还没连成|还没画/.test(dom3.state), dom3.state);

      // 线索格照样能落笔（符号印在格上，不挡玩法）
      await mouse(p.clue.x, p.clue.y);
      await touch(p.clue.x, p.clue.y);
      const s4 = await json(GAME);
      eq(`线索格 ${p.clue.i} 点得动（cursor 落过去）`, s4.cursor, p.clue.i);
      eq('线索格也钉得成留空', s4.st, OFF);
      eq('线索不会被落笔抹掉', await json(`window.moonsun.game.sym[(${p.clue.i}/window.moonsun.game.cols)|0][${p.clue.i}%window.moonsun.game.cols]`), p.clue.sym);

      // 撤销按钮走真事件：退掉最后一步
      const bU = p.btns.find((b) => b.id === 'btn-undo');
      await mouse(bU.x, bU.y);
      await touch(bU.x, bU.y);
      const s5 = await json(GAME);
      const dom5 = await json(DOMTXT);
      eq('撤销退回了光标格', s5.cursor, p.clue.i);
      eq('撤销把线索格擦回没画', s5.st, UNDRAWN);
      eq('撤销一步退回一个动作', dom5.moves, String(s5.moves));

      // 全清按钮：所有 touched 归零，且清完不算违规红
      const bC = p.btns.find((b) => b.id === 'btn-clear');
      await mouse(bC.x, bC.y);
      await touch(bC.x, bC.y);
      const s6 = await json(GAME);
      const dom6 = await json(DOMTXT);
      eq('全清之后一格都没动过', s6.touched, 0);
      eq('全清之后「没动过」等于全盘', dom6.open, String(p.sweepTotal));

      // 提示按钮：真事件按一次，引擎的结论要印在状态行上
      const bH = p.btns.find((b) => b.id === 'btn-hint');
      await mouse(bH.x, bH.y);
      await touch(bH.x, bH.y);
      const dom7 = await json(DOMTXT);
      const s7 = await json(GAME);
      ck('提示给了一条被迫结论或明说推不动', /看第|推不动|都已经落笔/.test(dom7.state), dom7.state);
      eq('提示不替玩家落笔', s7.touched, 0);
      if (/看第/.test(dom7.state)) eq('按一次提示计一次 hint', s7.hints, 1);

      // 换一局：seed 必须换、页面必须把新 seed 印出来，而且默认 seed 不是按日期算的
      const sBefore = await json(`(()=>({seed:window.moonsun.game.puzzle.seed,sizeKey:window.moonsun.game.puzzle.sizeKey}))()`);
      const bN = p.btns.find((b) => b.id === 'btn-new');
      await mouse(bN.x, bN.y);
      await touch(bN.x, bN.y);
      await sleep(1200);
      const sAfter = await json(`(()=>({seed:window.moonsun.game.puzzle.seed,sizeKey:window.moonsun.game.puzzle.sizeKey}))()`);
      const domN = await json(DOMTXT);
      const draws = await json(`(()=>Array.from({length:20},()=>window.moonsun.mintSeed()))()`);
      ck('换一局换了盘（seed 变了）', sAfter.seed !== sBefore.seed, `${sBefore.seed} -> ${sAfter.seed}`);
      ck('默认 seed 每局都不同（按日期算的话 20 次都是同一个数）', new Set(draws).size >= 19, `${new Set(draws).size}/20 不同`);
      ck('seed 是引擎用得进来的非负整数', draws.every((x) => Number.isInteger(x) && x >= 0 && x < 0x80000000), String(draws[0]));
      ck('页面把新 seed 印出来了', domN.seed.includes(String(sAfter.seed)), domN.seed);
      eq('换一局回到没动过的盘', await json(`window.moonsun.game.touchedCells`), 0);
      ck('引擎说那一格读得到', domN.verify.length > 0, domN.verify);
    }
    if (arg === 'keys') {
      // 先把焦点真点上棋盘：键盘腿的所有期望都从 cursor=0 那一格出发
      await mouse(p.cells[0].x, p.cells[0].y);
      await touch(p.cells[0].x, p.cells[0].y);
      const act = await json(`(()=>({active:document.activeElement?document.activeElement.id:'null'}))()`);
      eq('焦点钉在棋盘上（先真点了一次）', act.active, 'board');
      const UNDRAWN = await json(`window.moonsun.engine.UNDRAWN`);
      const OFF = await json(`window.moonsun.engine.OFF`);
      const pair = await json(`[window.moonsun.engine.PAIRS[0],window.moonsun.engine.PAIRS[1]]`);
      // 计数器是门禁装的，不是页面装的：它没在位的话，下面每一条"到达一次"都只会读到 undefined，
      // 而 NaN≠1 看起来像"键没送到"，其实是我的尺子没尺。先让尺子自己作一次证。
      const gauge = await json(`(()=>({installed:!!window.__keySeen,scrollable:document.documentElement.scrollHeight>innerHeight,scrollY:Math.round(scrollY)}))()`);
      ck('门禁的键盘计数器在位（否则"到达一次"这条断言没有尺子）', gauge.installed, JSON.stringify(gauge));
      ck('这一页真的滚得动（否则"空格不滚页"是一条空话）', gauge.scrollable, JSON.stringify(gauge));
      const seq = [
        { k: '1', want: pair[0], why: '数字 1 落成竖穿' },
        { k: '2', want: pair[1], why: '数字 2 落成横穿' },
        { k: '0', want: OFF, why: '数字 0 钉成不在环上' },
        { k: ' ', want: await json(`window.moonsun.engine.SHAPE_CYCLE[1+window.moonsun.engine.SHAPE_CYCLE.indexOf(${OFF})]`), why: '空格滚到下一档' },
        { k: 'Backspace', want: UNDRAWN, why: '退格擦回没画' },
        { k: 'ArrowRight', want: null, why: '右箭头把光标移一格' },
        { k: 'ArrowUp', want: null, why: '上箭头在第 1 行被钉回第 1 格' },
        { k: 'h', want: null, why: 'H 要一条被迫结论' },
        { k: 'z', want: pair[0], why: 'Z 撤销退掉最后一笔（退回到 Backspace 之前的那一档）' },
        { k: 'c', want: null, why: 'C 全清' },
      ];
      const per = [];
      for (const step of seq) {
        if (step.k === 'ArrowRight' || step.k === 'ArrowUp') {
          // 先把光标钉回第 1 格：向左连按 cols+1 次一定停在 0（越界就 clamp 回 0）。
          // 不这么做的话，"右箭头 0->1" 这种绝对坐标期望其实是在赌开局点到的是哪一格。
          for (let t = 0; t < p.cols + 1; t++) await key('ArrowLeft');
          if (step.k === 'ArrowUp') await key('ArrowRight');  // 走开一格再按上：第 1 行按上才是"出盘被钉回"
          const a = await json(`(()=>({c:window.moonsun.game.cursor,m:window.moonsun.game.moves.length}))()`);
          await key(step.k);
          const b = await json(`(()=>({c:window.moonsun.game.cursor,m:window.moonsun.game.moves.length}))()`);
          per.push({ ...step, seen: 0, repeat: 0, note: `${a.c}->${b.c}`, moves: `${a.m}->${b.m}` });
          continue;
        }
        const ks = await json(READ_KEYS);
        await key(step.k);
        // 滚动动画是补间的：按下之后 60ms 就读 scrollY，读到的是"滚到一半"那个数——
        // 这一条要断言的是"根本没滚"，所以先把动画跑完再读。
        if (step.k === ' ') await sleep(450);
        const ke = await json(READ_KEYS);
        const st = await json(`(()=>{const g=window.moonsun.game;return {st:g.st[g.cursor],moves:g.moves.length,hints:g.hints,
          touched:g.touchedCells,scrollY:Math.round(scrollY),
          line:((document.getElementById('state-line')||{}).textContent||'').trim()}})()`);
        per.push({ ...step, seen: ke.seen - ks.seen, repeat: ke.repeat - ks.repeat, got: st.st, moves: st.moves, hints: st.hints, touched: st.touched, line: st.line, scrollY: st.scrollY });
      }
      const dom = await json(DOMTXT);
      for (const q of per.filter((x) => x.k !== 'ArrowRight' && x.k !== 'ArrowUp')) {
        eq(`按键 ${q.k} 到达游戏一次`, `${q.seen} seen/${q.repeat} repeat`, '1 seen/0 repeat');
      }
      for (const q of per.filter((x) => x.want !== null)) eq(`${q.why}`, q.got, q.want);
      const ar = per.find((q) => q.k === 'ArrowRight');
      eq('右箭头把光标从第 1 格移到第 2 格', ar.note, '0->1');
      const au = per.find((q) => q.k === 'ArrowUp');
      eq('第 1 行按上箭头不出盘（钉回第 1 格）', au.note, '1->0');
      const hrow = per.find((q) => q.k === 'h');
      eq('H 键给了一次提示（hints 计数）', hrow.hints, 1);
      // 提示那句话要在**按下 H 的那一刻**读：整串键走完之后状态行早被后面的 C 全清盖掉了，
      // 那时读到的是"还没画"，而它既不能证明 H 说过话，也不能证明它说的是引擎的结论。
      ck('提示那句话是引擎的结论', /看第|推不动|都已经落笔/.test(hrow.line), hrow.line);
      const zrow = per.find((q) => q.k === 'z');
      eq('Z 撤销退掉一笔', zrow.moves, String(Number(hrow.moves) - 1));
      const crow = per.find((q) => q.k === 'c');
      eq('C 全清之后没动过等于全盘', crow.touched, 0);
      // 空格键不许滚页：判据是"按下它的那一下 scrollY 不动"，不是"scrollY 等于 0"——
      // 焦点钉上棋盘时页面本来就可能滚过一段，那一段不是空格的锅。
      const sp = per.find((q) => q.k === ' ');
      const prev = per[per.indexOf(sp) - 1];
      // eq() 的 detail 只有 got/want 两个数；这一条要的是"哪一步之后页面滚了"，所以点名整条 trace。
      ck('空格键是"下一档"不是滚动页面（键前后 scrollY 一格没动）', sp.scrollY - prev.scrollY === 0,
        `动了 ${sp.scrollY - prev.scrollY}px · 各步之后的 scrollY：${per.map((q) => `${q.k}=${q.scrollY}`).join(' ')}`);
      // 焦点坐在控件上时，键盘归控件：同一个空格键此刻不许再替玩家改盘面。
      // 先让计数器证明这一键真的到达了（不然"盘面没动"可以是"键根本没送到"的假绿）。
      const kb0 = await json(READ_KEYS);
      const ctl0 = await json(`(()=>({hints:window.moonsun.game.hints,touched:window.moonsun.game.touchedCells}))()`);
      await evaluate(`document.getElementById('btn-hint').focus()`);
      await key(' ');
      await sleep(300);
      const kb1 = await json(READ_KEYS);
      const ctl1 = await json(`(()=>({hints:window.moonsun.game.hints,touched:window.moonsun.game.touchedCells,active:document.activeElement.id}))()`);
      eq('控件聚焦那一次空格也到达了窗口', kb1.seen - kb0.seen, 1);
      eq('焦点在按钮上时空格不写盘面（键盘归控件）', ctl1.touched, ctl0.touched);
      eq('焦点在按钮上时空格滚到了按钮（按钮收到点击）', ctl1.hints - ctl0.hints, 1);
      eq('游戏没把焦点从按钮上抢走', ctl1.active, 'btn-hint');
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
  // RESULT 一律走 stdout：崩掉的那一份也不例外。它要是留在 stderr，verify.sh 在 stdout 里
  // 就 grep 不到 RESULT 行，一条"跑挂了但已经记了 30 条断言"的腿会被当成"这一腿没说话"放过去。
  const r = rows.length ? result({ crashed: true })
    : { rows: [{ test: `${cmd} ${arg || ''} 整条腿跑挂了`, pass: false, detail: String(err.message || err) }], fail: 1, crashed: true };
  console.log('RESULT ' + JSON.stringify(r));
  if (logs.length) console.error(logs.slice(-12).join('\n'));
  process.exit(1);
});
