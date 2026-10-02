# DESIGN · 蛇莓 Hebi-Ichigo

这份文档只做一件事：把「页面上说出口的每一句话」对上「哪条闸在什么命令下守它」。
所有数字都是本轮实测（`npm test` / `npm run check` / `npm run balance` / `npm run doctest` / `bash tools/verify.sh` /
`GATE_SELFTEST=1 bash tools/verify.sh`），括号里是打印或断言它的那行代码。
没有闸守的话就写进最后的**不承诺**，不写成成就。

## 来源与取证

规则文本逐字抄在两处，本仓不自创条款：

- Nikoli（英文页）四条：蛇按 `1(头)→5(尾)` 顺序连、蛇与蛇不能共边、从 `2→1` 方向看（蛇的视线）
  到下一个黑格或盘边之间不能有别的蛇、黑格里的数字是箭头方向上第一个数字（0 = 一路到黑格/边界都没有）。
- Cross+A：蛇眼在**头格**朝向「背离身体那一侧」的边上。

两份来源单读文字在「箭头是谁的」上有歧义（黑格自带箭头，还是蛇眼投过来的视线），
按官方规则图钉死成前者：箭头与数字都印在黑格里、是题面给的，蛇眼只管第 3 条
（`js/engine/hebi.js:14`）。逐字原文与链接就写在 `js/engine/hebi.js:2`–`js/engine/hebi.js:16`。
题面**不给**蛇的条数、也**不要求**白格填满（`js/engine/hebi.js:16`）——这两句是判据形状的前提。

## 两条互相不认识的路

一张盘出货前必须同时点头两次：

1. **铅笔** `solvePencil()`：只用命名规则 `P0-区 / P1-链 / P1-弧 / P2-邻 / P2-围 / P3-眼 /
   P4-零 / P4-挡 / P4-独 / P4-尽`（名字逐条列在 `js/engine/pencil.js:3`–`js/engine/pencil.js:12`），
   从空盘推。推不满就退货。
2. **穷举计数器** `countSolutions()`：不含任何推理规则，逐格枚举。它必须**恰好数出一个解**
   且不越界；`bounded`（节点预算花完）或 `viol`（计数器与判据 R1–R4 打架）都退货
   （`js/engine/generate.js:129`、`js/engine/generate.js:130`）。默认预算 `cap 2000000`
   （`js/engine/generate.js:112`）。

两条路互不复用代码，所以「唯一且零猜测」不是同一件事说两遍。官方 5×5 例题上它们会合：
穷举 `1 解 · 76 节点 · 候选蛇 84`，铅笔 `0 猜推满 · 20/20 白格 · 6 轮`，
**两个解逐格相同**（`tools/engine-test.mjs:78` 计数器对官方解、`tools/engine-test.mjs:83` 铅笔对官方解）。
浏览器里跑的是同一份模块图，不是测试专用副本（`tools/scenarios.js:12` 段落说明）。

判据 `check()` 返回的每条违反都以 `R1`–`R4` 开头（`js/engine/hebi.js:62`），
因为「被自己那一条抓到」是断言的一部分：`tools/engine-test.mjs` 的反例要求 R2/R3/R4 各归各位，
浏览器腿也断言屏幕上第一个词是条款号（`tools/scenarios.js:250`）。

## 难度：只有量出来的那一种说法

菜单三档（`js/ui/game.js:23`）的尺寸/蛇条数是设计，**难度轴是实测推理步数**
（`difficulty() = stats.pencilSteps`，`js/engine/generate.js` 的 `difficulty`），并且这句话本身就是断言
（`tools/scenarios.js:147`：难度分就是实测推理步数）。本轮 `npm run balance`（CI 用 `SAMPLES=20`，
本机同样是 20 张/档——这个 env 现在是接上的，见下面「闸的地图」里 `D7` 那一行）实测：

| 档 | 尺寸 | K | 出货 | 线索 med | 推理步 med / p95 | 每张 med / p95 ms | 唯一性节点 max |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 初 | 5×5 | 2 | 20/20 | 6 | 32 / 42 | 13 / 33 | 358 |
| 中 | 6×6 | 3 | 20/20 | 8 | 49 / 55 | 39 / 52 | 6556 |
| 高 | 8×8 | 5 | 20/20 | 15 | 86 / 103 | 254 / 342 | 2115 |

（同一张表由 `tools/balance.mjs` 里每档那行 `console.log` 打印；`npm test` 用 12 个 seed 独立量到
`31 / 49 / 88` 步、节点 max `309 / 507 / 10822`，`tools/engine-test.mjs:110`。）

守这条阶梯的红线（`tools/balance.mjs`，破了就 `exit 1`）：

- **B1 成本**：每档 p95 出题耗时 ≤ `400 / 900 / 3000 ms`（`tools/balance.mjs` 的 `B1` 那一行）。
- **B2 出货率** ≥ 20%（`tools/balance.mjs` 的 `B2`）：低于两成意味着按一下要等好几张退货。
- **B3 单调**：`32 < 49 < 86`（`tools/balance.mjs` 的 `B3`）。
- **B3b 首末两档区间不重叠**：`5x5 p95 42 < 8x8 p10 75`（`tools/balance.mjs` 的 `B3b`）——
  相邻两档允许重叠，「初比高便宜」才是要守的那句话。
- **B4 铅笔不说谎**：拿和生产同一把刀、提前收手造出的**多解盘**去问铅笔，
  它一次都不许说「推满」（`tools/balance.mjs` 的 `B4`，本轮 `样本 15 · 见证多解盘 15 · 被推满 0`）。
  配套的 `B4 的样本真的含多解盘`（就在 `B4` 下一行）防的是这条红线空转成永远绿的灯。
- **B5 菜单那句「实测」是承诺**：选档页把 `TIERS.med` 原样印给玩家（`js/main.js:369`），所以
  本轮实测的推理步 med 必须逐档等于表里的数（`tools/balance.mjs` 的 `B5`，`菜单 32/49/86 vs 实测 32/49/86`）。
  ms 不进等式——那是机器速度，只卡方向（`B5b`，`13 < 40 < 257`）。
- **B6 注释里写「实测」也得对上**：`js/engine/generate.js:147` 那句话自称实测单调，红线把它写的
  三档步数钉在同一把尺子上（`tools/balance.mjs` 的 `B6`）。配套的「读到了注释里的步数」
  （`B6` 上面那一行）防的是措辞一改、红线读不到数字就永远绿。
  阴性自证（本轮实跑）：把注释改回历史值 `45/82` → `**RED** B6 … 注释 32/45/82 vs 实测 32/49/86`、
  `合计红线 1 条破口`、rc=1。

浏览器侧另有一把独立的小尺子：`gen` 腿在真页面里每档各出 3 张（`tools/scenarios.js:172`），
本轮步数 med `41 / 46 / 87`、8×8 med `350–352 ms`，并断言
`高一档的 min(87) > 初档的 max(41)`（`tools/scenarios.js:191`）与 med 单调（`tools/scenarios.js:192`）。

### 困难档怎么描述：以出货与预算为准，不以形容词为准

**能进菜单的尺寸就是 5×5 / 6×6 / 8×8**（`js/ui/game.js:24`–`js/ui/game.js:26`），
因为 8×8 上穷举计数仍远没花完预算就被断言「恰好 1 解」（节点 max 本轮 10822 / 2115，上限 2000000），
且 8×8 在 900×900 视口里每一格都点得中：64/64 命中、`cell 62px`（`tools/scenarios.js:500`、
`tools/scenarios.js:488`）。

10×10 K=8 **故意出局，并且出局理由印在选档页上**（`js/ui/game.js:31`–`js/ui/game.js:36`）；
页面上有没有这段话是断言（`tools/scenarios.js:262`，另见 `tools/scenarios.js:193`；
元素本身由 `js/main.js:374` 现造）。
它的实测依据是 `tools/balance.mjs` 标着「观测：10x10 K=8（不在菜单里）」的那一段，
本轮 `出货 0/6 · 墙钟 6730 ms`（同段那句 `出货 ${ship}/6`）。这一段**故意不设红线**（脚本头三行注释写明）：铅笔哪天推得满 10×10
是进步，不该让闸变红。所以关于 10×10 的正确说法只到「本轮 6 次尝试 0 次出货、因此不给承诺」为止，
再往上（「所有大尺寸都不行」）没有东西守着。

## 闸的地图

| 承诺 | 守它的东西 |
| --- | --- |
| 语法能过 | `npm run check`（`package.json:11`）+ CI 逐文件 `node --check`（`.github/workflows/ci.yml:26`） |
| 唯一解 / 零猜测 / 同 seed 可复现 | `npm test` 127 条（`tools/engine-test.mjs:105` 唯一性证完、`tools/engine-test.mjs:121` seed 确定性） |
| 阶梯与耗时预算 | `npm run balance` B1–B6（`ci.yml` 的 `Difficulty ladder is still measured` 一步设 `SAMPLES: "20"`，`balance.mjs` 末尾 `process.exit(red ? 1 : 0)`） |
| 状态读数、留空、黑格不可改、胜利三条件 | 浏览器 `play/hint/win` 腿（`tools/scenarios.js:200`、`tools/scenarios.js:312`） |
| 「填满但不等于唯一解」不算赢 | `tools/scenarios.js:320`–`tools/scenarios.js:324`（本轮 win 腿 24 条断言） |
| 纪录先比提示数、撤销不退还提示计数 | `tools/scenarios.js:349`–`tools/scenarios.js:355` 往 `Store` 灌三条对照局（慢而零提示 / 快而求过一次 / 同提示同步数但更快）看谁顶掉谁，再读回选档页纪录栏（`tools/scenarios.js:361`）；`tools/scenarios.js:288`–`tools/scenarios.js:291` 撤销掉提示那一格之后回读屏幕计数 |
| 画面真的画出来了（三种底色、留空 vs 未定、不泄露答案） | 画布像素断言 `tools/scenarios.js:478`–`tools/scenarios.js:518` |
| 真输入事件（鼠标/触屏/键盘） | `tools/playtest.cjs:328` 的 `Input.dispatch*`，键盘焦点先真点一次钉住（`tools/playtest.cjs:407`）、逐键到达数（`tools/playtest.cjs:421`） |
| 存档不含解、续局接得上计时 | `tools/scenarios.js:388`（存档里没有解）、`tools/scenarios.js:432`（计时从存档接着走）；证人由 node 在派发导航之前抄走（`tools/verify.sh:198`） |
| 片段导航不算重载 | `tools/verify.sh:202`，本轮 4 条断言：`timeOrigin` 与文档身份都不许变 |
| 坏档 = 没有存档，不是白屏 | `tools/scenarios.js:447`–`tools/scenarios.js:453`（本轮 corrupt 腿 9 条） |
| 两种 URL 形态都算数 | `tools/verify.sh:47`（前缀形态由 `server.cjs:12` 实现，不是为测试另写一个服务）；preflight 先证明端口上的字节是本仓的（`tools/verify.sh:53`–`tools/verify.sh:60`） |
| 闸自己会红——而且是**每一份报告**都会红 | 场景腿由 `tools/scenarios.js:29` 种一条 1==2，node 侧的真事件腿与 nav/reload 由 `tools/playtest.cjs:38` 的 `result()` 种同一条；分母从 `LEGS` 现算（`tools/verify.sh:236-245`），哪一份没种上就点名哪一份（`tools/verify.sh:128`）。CI 要求 `rc≠0` **且**日志点名 `FAIL`（`.github/workflows/ci.yml:81`、`.github/workflows/ci.yml:82`） |
| 什么都没断言的腿不算绿 | `tools/verify.sh:113`（没有 RESULT 行）、`tools/verify.sh:121`（NO CHECKS RUN） |
| 写错的腿名不能变成空跑 | `tools/verify.sh:218`–`tools/verify.sh:224`：`LEGS` 只认七个腿名，认不出的直接 `RED` + `FAILED=1`。这一格是本轮补的——`LEGS=hint`（`hint` 是 play 腿里的一条 scenario，不是腿名）曾经一声不响地跑出 `=== ALL GREEN ===` 而一份报告都没有；对数表那一侧同样有 `tools/verify.sh:242` 兜着。补闸台架的 H13 在这一格里咬出了第二个 bug：没有 `LANG` 的环境里 `$leg（` 会把全角括号的首字节算进变量名，红是红了却不点名腿名，所以现在写 `${leg}（` |
| **文档印的数就是代码/脚本里的现值** | `node tools/doctest.mjs`（本轮新建）：`D1` 三档表对 `TIERS`、`D2` 十条规则名对 `pencil.js` 且每条在非注释行里出现（`D2b` 数的是剥掉注释行之后的正文——整份文件一起数会被注释凑够次数）、`D3` 腿/形态/报告数对 `verify.sh` 的现值、`D4` 端口对四处定义、`D5` 节点预算对 `opts.cap` 且读数真的小于它、`D6` CI 覆盖表与 `ci.yml` 的 job 双向核对、`D7` `SAMPLES` 用子进程探针、`D8` 逐报告条数与两个总数自洽、`D9` 每条 `path:NN` 引用都在真实行数内、`D10` 红线标签双向 |
`SAMPLES` 那一格是本轮补闸时挖出来的：`ci.yml` 的 `Difficulty ladder` 一步一直设 `SAMPLES: "20"`，
而 `balance.mjs` 只读 `argv[2]`——那行 env 是**装饰**，文档里「`SAMPLES=20 npm run balance` 实测」
说的是一个不存在的机制。接线补上（`argv` 优先，其次 env，其次默认 20），`D7` 再拿子进程验一次：
`SAMPLES=3` 必须真的打印「菜单三档 × 3 张」。
`D2b` 那一格也是同一轮里被**自己的刀**逼出来的：它原来数整份 `pencil.js`，而 `P0-区` 光注释就出现
三次，所以"每条规则名都不只活在注释里"这句标签在它自己的刀下兑现不了——改成数正文之后，
README 台账的 H4（把正文那次出现改名）才真的红。逐把刀的记录在 README 的**破坏试验台账**一节。

本轮合计：`npm test` 127/0；`npm run check` OK；`npm run doctest` `rows: 36 fail: 0`；
`npm run balance` 红线 0 条破口；
`bash tools/verify.sh` 604 条断言 / 0 失败（14 份报告 × 2 形态）、`=== ALL GREEN ===`、`rc=0`；
`GATE_SELFTEST=1` `rc=1`、28 行具名红（632 条断言里 28 条失败，对数表读出「应有 28 份报告，实到 28 份，
其中 28 份点名吃下了种下的错」）。

## 不承诺

以下说法**没有任何闸守住**，因此本仓的文档与页面都不主张它们（写了就是拿文案冒充测量）：

- **音效没有证据。** `js/audio/synth.js` 被 `js/main.js:9` import，可是全仓唯一与声音有关的断言是
  `设置退回默认`（`tools/scenarios.js:453`）读到的 `sound: true`。没有任何闸观察到一次发声。
  因此「音效由 WebAudio 合成」不写进 README。
- **「零美术/零资产文件」没有计数闸。** CI 的 `Entry files exist` 只查 `index.html` 里有
  `<canvas`、`js/main.js`、`hebi` 三个记号（`.github/workflows/ci.yml:49`）；
  Pages 只上传 `index.html`、`css`、`js`（`.github/workflows/pages.yml:29`、
  `.github/workflows/pages.yml:30`）。本轮 `find` 没找到 png/mp3/wav/svg/woff，但这是**一次人工观察**。
- **10 条铅笔规则是否每条都真的会开火，没量。** `js/engine/pencil.js:14` 把「8x8 以上推不完」
  归因到 `P0-区` 这条禁用，并指名要 DESIGN 写「不承诺」——这条**归因**没有任何闸量过。
  实测到的只有：`hint` 腿本轮用完一局 6×6 只开了 4 条
  （`P1-链 / P4-零 / P4-独 / P2-围`，`tools/scenarios.js:295` 把它们随断言一起打出来），
  且每条名字都过 `/^P[0-4]-/`（`tools/scenarios.js:296`）；
  页面「你会用到的几条」列的是 4 个规则族（`index.html:61`–`index.html:66`），
  没有闸检查这份清单与 `js/engine/pencil.js:3`–`js/engine/pencil.js:12` 的实现集是否一致。
- **`generate.js` 头部注释里的历史对照数**（`js/engine/generate.js:2`–`js/engine/generate.js:5` 的
  `2/60`、`396 次计数 ≈ 19 s`、`20/30 · 19 ms`，`js/engine/generate.js:25` 的 `0/3`，
  `js/engine/generate.js:78` 的 `74/77`）是**写代码时的判断记录**，没有任何闸读它们，本轮也不复现。
  它们留在原处当注释，不搬进文档。同一文件 `js/engine/generate.js:147` 那句**自称实测**的步数阶梯
  不在此列——它归 B6 管，本轮改成 `32 → 49 → 86` 就是为了对上。
- **移动端只证到「几何没坏」。** `touch` 腿在 390×844 / dpr 3 覆写下发真触屏事件并读回覆写在位
  （`tools/playtest.cjs:335`、`tools/playtest.cjs:346`），但没有 iOS/Android 真机、
  也没有任何闸量过移动端帧率或手感。
- **计时类断言只保证方向，不保证快。** 计时腿断言的是「续局后 `elapsedMs` 不小于存档基线」
  （`tools/scenarios.js:432`），本轮读到 `149 ms` 起步的续局；没有任何闸承诺某一档多少毫秒内推完。
