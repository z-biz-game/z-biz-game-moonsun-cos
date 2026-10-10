#!/usr/bin/env bash
# One-shot browser verification: real Chrome, real DOM, real input events, scripted scenarios.
#
#   ./tools/verify.sh                 # 两条 URL 形态（根 / 与 Pages 的 /z-biz-game-moonsun-cos/）各跑一遍全量腿
#   LEGS="play" ./tools/verify.sh     # 只跑一条腿（调试用；阴性自证的对数表跟着 LEGS 走）
#   BASE_URL=https://z-biz-game.github.io/z-biz-game-moonsun-cos/ ./tools/verify.sh   # 追加已部署站点这一形态
#   GATE_SELFTEST=1 ./tools/verify.sh # 阴性自证：种一条注定错的期望，必须点名变红并且 rc 非 0
#
# 这个仓的规矩，改之前先读：
#  * server.cjs 把 URL 路径**直接**映射到根目录，不替前缀兜底（那是给被测对象打补丁，然后
#    由门禁来给补丁做见证）。所以前缀形态靠换根实现：临时目录里只放一条指回本仓的符号链接，
#    页面里但凡有一个写死的 "/css/game.css"，这一形态就会像线上一样 404。换根不换端口。
#  * 每一腿一个自己的 --user-data-dir（mktemp -d 在 _tmp-verify 里），写完档的腿自己清档；
#    共用 profile 会让"续局"那条腿读到自己上一腿留下的档，看起来像绿其实什么都没测。
#  * 指针断言走 CDP Input.dispatch*（真事件），并且断言点击之前先断言 hit box：
#    getBoundingClientRect() 的中心要与 document.elementFromPoint() 对得上。display:grid 会盖掉
#    UA 的 [hidden]，所以"这一块藏起来了"必须由几何作证，不能假设。
#  * 片段导航不算重载：续局腿的证人（timeOrigin + 文档哨兵 + 存档读数）由 node 在派发导航之前取走。
#  * 不要加 --use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader：软件光栅会占满
#    每一个核，而且在没有 CDP 客户端 attached 时 Chrome 根本不会自己退。
#  * macOS 没有 timeout：看门狗用后台子 shell + trap（下面的 WD）。日志一律落在 $TMPD 里，
#    不落 /tmp（会话中途会被清掉，证据就没了）。
set -u
export HERE=$(cd "$(dirname "$0")/.." && pwd)
PORT=${CDP_PORT:-9363}
# 5276 是本仓在端口表里占的号（server.cjs 的 DEFAULT_PORT、package.json 的 dev、这里，
# 三处必须同一个数）。别的 agent 同时在跑各自仓的 verify.sh，端口撞了就会拿到"另一个仓"的
# index.html，那种绿比红更糟。
HTTP=${HTTP_PORT:-5276}
export SELF=${GATE_SELFTEST:-0}
TMPD="$HERE/_tmp-verify"
rm -rf "$TMPD"; mkdir -p "$TMPD"
CHROME=${CHROME_BIN:-}
if [ -z "$CHROME" ]; then
  for c in "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
           "/Applications/Chromium.app/Contents/MacOS/Chromium" \
           google-chrome chromium chromium-browser; do
    if command -v "$c" >/dev/null 2>&1 || [ -x "$c" ]; then CHROME=$c; break; fi
  done
fi
[ -x "$CHROME" ] || { echo "no Chrome found; set CHROME_BIN" >&2; exit 2; }

# 开工之前先确认这两个端口是**空的**。上一轮跑挂留下的 Chrome 还占着 CDP 端口时，playtest.cjs
# 会 attach 到那只浏览器继续跑——腿看起来是新的，profile 与 tab 却是旧的；端口上坐着别的仓的
# server 时更糟：门禁在人家 DOM 上变绿。这一条比"跑完之后红"便宜得多。
port_busy() { lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; }
if command -v lsof >/dev/null 2>&1; then
  port_busy "$HTTP" && { echo "  RED :$HTTP 上已经有监听进程了（本仓的 HTTP 端口号是 5276）：先查 lsof -nP -iTCP:$HTTP -sTCP:LISTEN" >&2; exit 2; }
  port_busy "$PORT" && { echo "  RED :${PORT}（CDP）上已经有监听进程了：那是别人（或上一轮自己）留下的 Chrome，这一腿会 attach 上去" >&2; exit 2; }
  echo "ports: :$HTTP 与 :$PORT 都空着"
else
  echo "  NOTE 这个环境没有 lsof：端口独占检查没做，端口上坐着谁只能靠 preflight 的字节标记兜" >&2
fi

SPID=0
PROOT=$(mktemp -d "$TMPD/proot.XXXXXX")
ln -s "$HERE" "$PROOT/z-biz-game-moonsun-cos"
LOCAL=1

# start_server <served root> <探活的 URL> <日志名>
start_server() {
  if [ "$SPID" != 0 ]; then kill $SPID 2>/dev/null; wait $SPID 2>/dev/null; SPID=0; fi
  node "$HERE/server.cjs" "$HTTP" "$1" >"$TMPD/server-$3.log" 2>&1 &
  SPID=$!
  for _k in $(seq 1 60); do
    curl -fsS -m 1 "$2" >/dev/null 2>&1 && break
    sleep 0.25
  done
}

# 形态表：一条 "URL|站点根"。竖线右边是 '-' 表示这一形态不在本地（已部署站点），不换根。
SHAPES=("http://127.0.0.1:$HTTP/|$HERE" "http://127.0.0.1:$HTTP/z-biz-game-moonsun-cos/|$PROOT")
if [ -n "${BASE_URL:-}" ]; then
  SHAPES+=("${BASE_URL}|-")
  case "$BASE_URL" in "http://127.0.0.1:$HTTP"*) ;; *) LOCAL=0 ;; esac
fi

# Pre-flight: prove the bytes we are about to test are this app's, not some other repo's
# index.html served on the same port. 两种形态都要过——前缀形态挂了就是 404，那正是
# 页面里有写死绝对路径时的症状。
preflight() {   # $1 = base url, $2 = root（'-' = 远端）, $3 = 形态序号
  local base=$1 root=$2
  if [ "$root" != "-" ]; then start_server "$root" "$base" "shape$3"; fi
  local served
  served=$(curl -fsS -m 5 "$base" 2>/dev/null || true)
  case "$served" in *js/main.js*) ;; *) echo "nothing served at ${base}（本地形态见 $TMPD/server-shape$3.log）" >&2; return 1 ;; esac
  echo "$served" | grep -qi moonsun || { echo "$base 不是 moonsun：端口上坐着别的仓" >&2; return 1; }
  echo "$served" | grep -q 月之日 || { echo "$base 的 HTML 里没有 月之日" >&2; return 1; }
  curl -fsS -m 5 "${base}js/engine/rules.js" >/dev/null || { echo "$base 下取不到 js/engine/rules.js" >&2; return 1; }
  curl -fsS -m 5 "${base}css/game.css" >/dev/null || { echo "$base 下取不到 css/game.css（绝对路径写死的话就是这里红）" >&2; return 1; }
  echo "  preflight shape$3 ok: ${base}（served 且带 moonsun/月之日 标记，css 与引擎模块都取到）"
}

CPID=0
UDD=""
cleanup() {
  [ "$SPID" != 0 ] && kill $SPID 2>/dev/null
  [ "$CPID" != 0 ] && kill -9 $CPID 2>/dev/null
  [ -n "$UDD" ] && rm -rf "$UDD"
  rm -f "$PROOT/z-biz-game-moonsun-cos"
}
trap cleanup EXIT
( sleep ${WD_TIMEOUT:-1200}; cleanup ) </dev/null >/dev/null 2>&1 & WD=$!

FAILED=0
REPORTS="$TMPD/reports.txt"; : >"$REPORTS"; export REPORTS
# 逐形态的条数账：一行 "形态序号 报告名 条数"。文档里那句「两种形态逐条相同」以前只是散文，
# 现在由末尾那段比对兑现——同一套场景在前缀形态上少跑了几条，以前是没人发现的。
TALLY="$TMPD/tally.txt"; : >"$TALLY"; export TALLY

# 一张表两条用途：dispatch 按它跑，对数表按它数。写两张就会漂（曾经 LEGS=core 的期望是 2 份
# 报告而实际跑 3 条 scenario，于是阴性自证红在"报告数对不上"上，而不是红在那条真断言上）。
# '@' 打头的是不产出报告的取证步骤（witness）或带参数的 node 腿；其余一个词就是一个 scenario 名。
scenarios_for() {
  case $1 in
    core)  echo "engine gen core" ;;
    play)  echo "play hint" ;;
    win)   echo "win layout" ;;
    mouse) echo "@legmouse" ;;
    touch) echo "@legtouch" ;;
    keys)  echo "@legkeys" ;;
    # 顺序是有讲究的：save 写下档 → witness 在派发任何导航之前把 timeOrigin/哨兵/存档读数抄走
    # → 片段导航（同一文档，用来对照）→ resume（自己做一次真重载）→ reload + 种坏档 → corrupt。
    save)  echo "save @witness @frag @resume @reload corrupt" ;;
    *)     return 1 ;;
  esac
}
LEGS=${LEGS:-core play win mouse touch keys save}

leg_start() {   # $1 = leg name
  UDD=$(mktemp -d "$TMPD/udd-$1.XXXXXX")
  "$CHROME" --headless=new --remote-debugging-port=$PORT --user-data-dir="$UDD" \
    --window-size=900,900 --no-first-run --no-default-browser-check about:blank >"$TMPD/chrome-$1.log" 2>&1 &
  CPID=$!
  # A fresh --user-data-dir binds DevTools later than a warm profile: wait on the endpoint.
  for _k in $(seq 1 120); do
    curl -fsS -m 1 "http://127.0.0.1:$PORT/json/version" >/dev/null 2>&1 && break
    sleep 0.25
  done
  curl -fsS -m 2 "http://127.0.0.1:$PORT/json/version" >/dev/null 2>&1 || {
    echo "  RED devtools never bound on :$PORT (leg $1)" >&2; FAILED=1; return 1; }
  export CDP_PORT=$PORT
  echo "--- leg $1 @ $BASE_URL (profile $UDD)"
}
leg_stop() {   # 每条腿自己收自己的尸：profile 一定要删，写完的档不能留给下一条腿
  [ "$CPID" != 0 ] && kill -9 $CPID 2>/dev/null
  wait $CPID 2>/dev/null
  [ -n "$UDD" ] && rm -rf "$UDD"
  CPID=0; UDD=""
}

parse() {   # $1 = 报告名（跑挂了没断言时也要能点出是谁）
  python3 -c "
import sys, json, os
leg, selfmode = sys.argv[1], sys.argv[2] == '1'
path = os.environ['RESULT_FILE']
raw = ''
try:
    with open(path) as f:
        for line in f:
            if line.startswith('RESULT '): raw = line[7:].strip()
except FileNotFoundError:
    pass
if not raw:
    print('  RED %s：没有 RESULT 行（这一腿一条断言都没跑到）' % leg); sys.exit(1)
try:
    d = json.loads(raw)
except Exception:
    print('  UNPARSED:', raw[:300]); sys.exit(1)
for r in d['rows']:
    if not r['pass']: print('  FAIL %-58s %s' % (r['test'], r['detail']))
if not d['rows']:
    print('  RED %s：NO CHECKS RUN — a leg that asserts nothing cannot be green' % leg); sys.exit(1)
open(os.environ['TALLY'], 'a').write('%s %s %d\\n' % (os.environ.get('SHAPE_ID', '0'), leg, len(d['rows'])))
planted = sum(1 for r in d['rows'] if r['test'].startswith('GATE_SELFTEST') and not r['pass'])
if selfmode:
    # 先记账再判：把没种上的报告也写进对数表，末尾那句「实到几份 / 点名几份」才是有分母的数，
    # 而不是"只有种上的才被数到"的自比较。
    open(os.environ['REPORTS'], 'a').write('%s %d\n' % (leg, planted))
    if planted == 0:
        print('  RED %s：这一份报告里没有种下的错期望（这条腿证明不了自己能红）' % leg); sys.exit(1)
extra = {k: v for k, v in d.items() if k not in ('rows', 'fail')}
print('  %d checks, %d failed  %s' % (len(d['rows']), d['fail'], extra if extra else ''))
sys.exit(1 if d['fail'] else 0)
" "$1" "${SELF:-0}" || FAILED=1
}

run_scenario() {   # $1 scenario 名, $2 腿名
  export RESULT_FILE="$TMPD/$2-$1.out"
  node tools/playtest.cjs scenario "$1" >"$TMPD/$2-$1.out" 2>"$TMPD/$2-$1.console.log"
  sed -n 's/^EVIDENCE /  EVID /p' "$TMPD/$2-$1.out"
  parse "$2/$1"
  if [ -s "$TMPD/$2-$1.console.log" ]; then
    echo "  --- console ($2/$1) ---"
    sed 's/^/  /' "$TMPD/$2-$1.console.log" | tail -12
  fi
}

run_cmd() {   # $1 = tag（文件名安全的报告名）, 其余 = playtest 参数
  local tag="$1"; shift
  export RESULT_FILE="$TMPD/$tag.cmd.out"
  node tools/playtest.cjs "$@" >"$TMPD/$tag.cmd.out" 2>"$TMPD/$tag.cmd.console.log"
  sed -n 's/^EVIDENCE /  EVID /p' "$TMPD/$tag.cmd.out"
  # 交不出 RESULT 行的腿必须点名变红。上一版写的是 `grep -q '^RESULT ' && parse`：node 侧一崩
  # （崩掉的 RESULT 曾经只落在 stderr），这一腿就"什么都没记"地绿过去了，整轮 rc=0。
  if grep -q '^RESULT ' "$TMPD/$tag.cmd.out"; then
    parse "$tag"
  else
    echo "  RED ${tag}：这一腿没交出 RESULT 行（跑挂了，见 $TMPD/$tag.cmd.console.log）" >&2
    sed 's/^/    /' "$TMPD/$tag.cmd.console.log" | tail -6
    FAILED=1
  fi
  if [ -s "$TMPD/$tag.cmd.console.log" ]; then
    echo "  --- console ($tag) ---"
    sed 's/^/  /' "$TMPD/$tag.cmd.console.log" | tail -6
  fi
  return 0
}

i=0
# 形态序号叫 i，而 start_server / leg_start 里的等待循环叫 _k：bash 的 for 变量不是局部的，
# 上一版它们在同一个名字上打架，于是第二轮形态打印自己叫"shape3"——序号是说谎的读数，
# 挂在它上面的日志名与对数就都跟着漂。
for shape in "${SHAPES[@]}"; do
  i=$((i + 1))
  export SHAPE_ID=$i
  base=${shape%|*}
  root=${shape##*|}
  echo
  echo "########## URL 形态 ${i}：$base ##########"
  preflight "$base" "$root" "$i" || { FAILED=1; continue; }
  export BASE_URL="$base"
  for leg in $LEGS; do
    steps=$(scenarios_for "$leg") || {
      # 未知腿名必须红，不能"匹配不到就算跑完了"：LEGS=hint 曾经一声不响地跑出
      # === ALL GREEN === 而一份报告都没有（hint 是 play 腿里的一条 scenario，不是腿名）。
      # ${leg} 的花括号不是装饰：没有 LANG 的环境里裸写 `$leg（` 会把全角括号的首字节算进
      # 变量名，报 unbound variable——红是红了，但点不出是哪个腿名。
      echo "  RED 未知的腿：${leg}（只认 core play win mouse touch keys save）" >&2
      FAILED=1; continue; }
    leg_start "$leg" || continue
    if [ "$leg" = core ]; then
      node tools/playtest.cjs open "$base" | head -2
      BOOT=""
      for _ in $(seq 1 60); do
        BOOT=$(node tools/playtest.cjs eval "window.moonsun?window.moonsun.version:'nope'" nonav 2>/dev/null | tr -d '\n" ')
        case "$BOOT" in *nope*|"") sleep 0.5 ;; *) break ;; esac
      done
      case "$BOOT" in *nope*|"") echo "  RED 应用没起来（window.moonsun 一直读不到）@ $base" >&2; FAILED=1 ;; esac
      echo "  boot: moonsun $BOOT @ $base"
    fi
    for step in $steps; do
      case $step in
        @witness)
          # 证人必须在派发导航之前拿到：node 先把 timeOrigin/文档哨兵/存档读数抄回来。
          W=$(node tools/playtest.cjs witness | tail -1)
          echo "  WITNESS $W"
          case "$W" in *'"storedMs"'*) export WITNESS="$W" ;; *) echo "  RED witness 没抄到存档读数：$W" >&2; FAILED=1 ;; esac ;;
        @frag)
          # 对照腿：只差一个 hash 的 URL 是 same-document navigation，timeOrigin 与文档身份都不许变。
          # 正因为如此，续局那条腿不能靠"跳个 hash"来换文档——它必须走真重载。
          run_cmd nav nav "${base}#gate-fragment-nav" same ;;
        @resume)
          # 续局腿：scenario 自己会做一次真导航，所以这里拿到的一定是新文档。
          run_scenario resume "$leg" ;;
        @reload)
          # 坏档前的顺序很重要。先真重载拿到一个干净的文档，再把坏 payload 种下去——
          # 反过来做的话，重载那一下的 pagehide 会让这个文档把它自己那局合法存档写回去，
          # 刚种下的坏档在 scenario 读到它之前就被覆写了。store.save 一并摘掉（这一个文档只读不写，
          # 补丁随它一起死），再把 URL 上的 hash 抹掉（replaceState 是同一文档，不触发 unload）：
          # 这一页没有深链，hash 本来就是惰性的，抹掉只是让下一个文档的 URL 与被测形态一字不差。
          run_cmd reload reload
          node tools/playtest.cjs eval "window.__plantedGarbage='shape-complete, board-mismatched';
            history.replaceState(null,'',location.pathname+location.search);
            window.moonsun.store.save=function(){return this.data;};
            localStorage.setItem('moonsun.save.v1', JSON.stringify({version:1,sizeKey:'5x5',seed:919191,
              st:new Array(25).fill(0),cursor:0,moves:[],moveCount:0,elapsedMs:1234,
              fingerprint:'5|5|'+'0'.repeat(25)+'|'+'.'.repeat(25),savedAt:1,won:false}));
            'PLANTED-' + (JSON.parse(localStorage.getItem('moonsun.save.v1')).fingerprint)" nonav >"$TMPD/plant.log" 2>&1
          grep -q 'PLANTED-5|5|' "$TMPD/plant.log" || { echo "  RED 坏档没种下去（看 $TMPD/plant.log）" >&2; FAILED=1; } ;;
        @legmouse) run_cmd mouse leg mouse ;;
        @legtouch) run_cmd touch leg touch ;;
        @legkeys)  run_cmd keys leg keys ;;
        *) run_scenario "$step" "$leg" ;;
      esac
    done
    leg_stop
  done
done

# 跨形态对数。文档里那句「两种形态逐条相同」以前只是散文：同一套场景若在前缀形态上少跑
# 几条（腿里某一步在子路径下早退），两边各自都绿，合起来却是一句谎话。
# 分母不另抄一份——由 scenarios_for 现场算，和阴性自证用的是同一个数。
echo
echo "=== 跨形态逐报告条数比对 ==="
PER_SHAPE=0
for leg in $LEGS; do
  steps=$(scenarios_for "$leg") || { echo "  RED 未知的腿：${leg}（对数表里没有它）" >&2; FAILED=1; continue; }
  for step in $steps; do case $step in @witness) ;; *) PER_SHAPE=$((PER_SHAPE + 1)) ;; esac; done
done
export PER_SHAPE
python3 -c "
import os, sys, re, collections
rows = [l.split() for l in open(os.environ['TALLY']) if l.strip()]
per = collections.defaultdict(dict)
for shape, tag, n in rows: per[tag][shape] = int(n)
shapes = sorted({r[0] for r in rows})
want = int(os.environ['PER_SHAPE'])
tot = sum(int(n) for _, _, n in rows)
per_shape_total = sum(per[t].get(shapes[0], 0) for t in per) if shapes else 0
print('  形态 %d 个 · 报告 tag %d 个 · scenarios_for 现场算的每形态 %d 份' % (len(shapes), len(per), want))
if len(per) != want:
    print('  RED 记到账的报告数 %d ≠ 对数表算出的每形态 %d 份（有腿没跑，或多跑了没在表上的）' % (len(per), want)); sys.exit(1)
half = [t for t, d in per.items() if len(d) != len(shapes)]
if half:
    print('  RED 这些报告不是每个形态都记到了：' + ' '.join(half)); sys.exit(1)
diff = [t for t, d in per.items() if len(set(d.values())) > 1]
if diff:
    for t in diff: print('  RED %s 两种形态条数不同：%s' % (t, dict(per[t])))
    sys.exit(1)
print('  ok 两种形态逐报告条数相同（每形态 %d 条 · 合计 %d 条）' % (per_shape_total, tot))
# 文档那一列此前只被 doctest 的 D8 做过"自己加自己"的自洽检查：抄错的数只要两处一致就照样绿。
# 这里把它接到活的数量上——README 印的每一份报告的条数、每形态与合计，都必须等于本轮真实读数。
# 阴性自证模式下跳过：那一轮每份报告都被塞了一条注定错的期望，条数天然比文档多 1。
if os.environ.get('SELF') == '1':
    print('  -- 自证模式跳过与 README 的比对（每份报告多一条种下的红）')
else:
    doc = open(os.path.join(os.environ['HERE'], 'README.md'), encoding='utf8').read()
    drift = []
    # tag 有两种形状：浏览器 scenario 记成「腿/场景」（core/engine），node 腿直接记腿名（mouse）。
    # 文档那一列用的是场景名，所以取最后一段；两个 tag 撞成同一个名字必须红——
    # 否则"少了一份报告"会被另多出来的一份悄悄补上数。
    names = {}
    for t in per:
        nm = t.split('/')[-1]
        if nm in names:
            print('  RED 报告名 %s 被两个 tag 共用（%s 与 %s）——条数会被数重复' % (nm, names[nm], t))
            sys.exit(1)
        names[nm] = t
    for nm in sorted(names):
        want = per[names[nm]][shapes[0]]
        got = [int(x) for x in re.findall(r'\b%s (\d+)' % nm, doc)]
        if not got:
            drift.append('%s：README 里没印它的条数（闸数到的没人抄走）' % nm)
        elif [g for g in got if g != want]:
            drift.append('%s：README %s vs 本轮 %d' % (nm, got, want))
    tot_doc = re.findall(r'每形态 (\d+) 条 · 合计 (\d+) 条', doc)
    if len(tot_doc) != 1:
        drift.append('README 里「每形态 N 条 · 合计 M 条」那句解析到 %d 处（应为 1 处）' % len(tot_doc))
    elif [int(x) for x in tot_doc[0]] != [per_shape_total, tot]:
        drift.append('README 写每形态 %s · 合计 %s，本轮真实是 %d · %d' % (tot_doc[0][0], tot_doc[0][1], per_shape_total, tot))
    if drift:
        for d in drift: print('  RED ' + d)
        sys.exit(1)
    print('  ok README 抄的逐报告条数与两个总数，逐处等于本轮真实读数（%d 份 + 两个合计）' % len(per))
" || FAILED=1

if [ "$SELF" = 1 ]; then
  echo
  echo "=== GATE_SELFTEST：种下的期望必须点名变红 ==="
  echo "  planted rows: scenarios.js 在 __selftest 为真时给每一份报告加一条 1==2，"
  echo "                node 侧的腿（真事件 / nav / reload）由 playtest.cjs 的 result() 加同一条"
  # 对数：一份报告对应一条种下的红。少一份＝那条腿这一轮根本没跑（或种期望的代码漂了），
  # 光看 rc≠0 是分不清这两件事的。分母就是上面那段跨形态比对从 scenarios_for 现场算的那个 PER_SHAPE，
  # 这里不再数第二遍——两份分母会在同一轮里各自漂。
  EXPECTED=$((PER_SHAPE * ${#SHAPES[@]}))
  GOT=$(wc -l <"$REPORTS" | tr -d ' ')
  HIT=$(awk '$2 > 0' "$REPORTS" | wc -l | tr -d ' ')
  echo "  应有 $EXPECTED 份报告，实到 $GOT 份，其中 $HIT 份点名吃下了种下的错"
  if [ "$GOT" != "$EXPECTED" ]; then
    echo "  RED 阴性自证的报告数对不上：$GOT ≠ ${EXPECTED}（有腿没跑，或对数表漂了）" >&2
    FAILED=1
  fi
  if [ "$FAILED" = 0 ]; then
    echo "  RED 阴性自证失败：闸没能把种下的错期望跑红（这个闸证明不了自己会红）" >&2
    FAILED=1
  elif [ "$HIT" != "$EXPECTED" ]; then
    echo "  RED 阴性自证只被 $HIT/$EXPECTED 份报告点名（差的那些腿从没红过＝没被证明会红）" >&2
    FAILED=1
  else
    echo "  ok 闸确实会红，且 rc 非 0"
  fi
fi

kill $WD 2>/dev/null
# 部署集闸：ci.yml 跑这两步、本地整闸以前一次都不跑。缺这一步就是「本地全绿、线上 404 自己的
# manifest / sw.js / 图标」这一整类坏法。它不碰 Chrome，也不读页面，纯查产物。
echo "=== deploy-set ==="
node tools/deploy-set.mjs || FAILED=1
node tools/deploy-set-selftest.mjs || FAILED=1
[ $FAILED -eq 0 ] && echo "=== ALL GREEN ===" || echo "=== FAILURES ABOVE (rc=$FAILED) ==="
exit $FAILED
