// 把破坏台账的真实读数钉回 README：台账每行的「实跑」那一格 + 三处「逼红 N · 未逼红 M」合计。
//
// 为什么这段要单独成一个模块、而不是住在 sabotage.mjs 里：它是**写文档的那只手**，而这只手
// 曾经犯过一宗只有它能自己发现的错——第一版的钉法是对整个 README 做全局 replace，于是把
// 「第一轮的读数在 _tmp-moonsun-sab-r1.log：那一轮 逼红 19 · 未逼红 2」那句**历史**也一起
// 改成了本轮的数。文档从此指着那份日志说一件日志里没有的事，而当时没有任何一条闸读得到它。
// 所以钉法改成锚点式，并由 tools/doctest.mjs 的 D19 拿合成文本现测这个函数本身。
const RX = /逼红 \d+ · 未逼红 \d+/g;
// 三处本轮读数：台账末尾那句、门禁清单那一格、承诺表那一行。锚点是**行首**，
// 因为历史那两句也在同一文件里，只有行首能把它和它们分开。
const ANCHORS = [/^定稿后整轮重跑：/, /^\| `node tools\/sabotage\.mjs` \|/, /^\| doctest 自己不是空转 \|/];
// 历史那一处必须点名它自己的那一轮日志，否则它就不是"某一轮的读数"而是"漂在文档里的旧数"。
const HIST = /_tmp-moonsun-sab-r\d+\.log/;

export function pinReadme(rm, results, summary) {
  const fail = [];
  let text = rm;
  for (const r of results) {
    // 允许任意个空格：上一轮的自钉把行重写成 `|  K1 | ...`，而匹配只认 `| K1 |`，
    // 于是第二轮"找不到行"——写者和读者对同一个形状各写了一份，就得让写者用读者的宽松式，
    // 并且重写出单一形状（下面 join 时统一成单空格），第三轮才幂等。
    const lineRe = new RegExp(`^\\|\\s+${r.id}\\s+\\|[^\\n]*$`, 'm');
    const line = text.match(lineRe);
    if (!line) { fail.push(`README 台账里没有 ${r.id} 这一行（表改了形状，读数没人收）`); continue; }
    const cells = line[0].split('|').slice(1, -1);
    cells[3] = r.error ? `ERROR ${r.error}` : r.verdict;
    text = text.replace(lineRe, `| ${cells.map((c) => c.trim()).join(' | ')} |`);
  }
  const lines = text.split('\n');
  let nailed = 0;
  const orphans = [];
  for (let i = 0; i < lines.length; i++) {
    if (!RX.test(lines[i])) { RX.lastIndex = 0; continue; }
    RX.lastIndex = 0;
    if (ANCHORS.some((re) => re.test(lines[i]))) {
      lines[i] = lines[i].replace(RX, summary);
      nailed += 1;
    } else if (!HIST.test(lines[i])) {
      orphans.push(lines[i].slice(0, 46));
    }
  }
  if (nailed !== ANCHORS.length) {
    fail.push(`只钉到 ${nailed}/${ANCHORS.length} 处本轮读数（锚点：${ANCHORS.length} 处；少一处就有一句话一直抄着上一轮的数）`);
  }
  if (orphans.length) {
    fail.push(`有 ${orphans.length} 处「逼红 N · 未逼红 M」既不在锚点上、也没点名自己那一轮的日志：${orphans.join(' ∥ ')}`);
  }
  return { text: lines.join('\n'), nailed, orphans, fail };
}
