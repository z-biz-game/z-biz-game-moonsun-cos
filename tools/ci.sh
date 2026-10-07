#!/usr/bin/env bash
# 本地一条命令跑齐 ci.yml 的两个 job。这张清单不是手抄的权威：tools/doctest.mjs 的 D20a 拿
# ci.yml 现读出来的每一个 `tools/*` 门禁来比对，这里漏一步就是那一条红。它补的是"本地没有入口"
# 这一格——每一条命令（含 npm run sabotage）本来就挂在 package.json 上，但本地得按顺序敲十条，
# 跳过任何一条就得等 CI 才第一次说话，而 CI 红的时候本地已经又提交了两刀。
#
# 台账为什么不放进 tools/verify.sh 而是排在它之前：K9 那把刀改的就是 verify.sh 的默认 LEGS，
# 而 bash 是边读边执行的——让一个还在跑的脚本被自己的台架原地改写，红不红就取决于解析偏移，
# 那种绿不能用。
set -u
cd "$(cd "$(dirname "$0")/.." && pwd)" || exit 1
LOG=${1:-../_tmp-moonsun-ci.log}
FAILED=0
: >"$LOG"
run() {
  name=$1
  shift
  echo "=== $name ==="
  "$@" >>"$LOG" 2>&1
  step_rc=$?
  echo "${name}_RC=$step_rc" >>"$LOG"
  if [ "$step_rc" = 0 ]; then
    echo "  ok $name"
  else
    echo "  RED $name rc=$step_rc（那一步的读数在 $LOG）"
    FAILED=1
  fi
}
run syntax npm run syntax
run wiring node tools/wiring.mjs
run engine-test node tools/engine-test.mjs
run doctest node tools/doctest.mjs
run balance node tools/balance.mjs
run sabotage node tools/sabotage.mjs
run site-shape sh -c "test -f index.html && grep -q '<canvas' index.html && grep -q 'js/main.js' index.html && grep -q 'moonsun' index.html"
run deploy-set node tools/deploy-set.mjs
run deploy-set-selftest node tools/deploy-set-selftest.mjs
run verify bash tools/verify.sh
if [ "$FAILED" = 0 ]; then
  echo "=== 全绿（逐步 rc 写在自己那份日志末尾：$LOG）"
else
  echo "=== 有步骤红，上面点名的就是它（逐条读数在 $LOG）"
fi
exit $FAILED
