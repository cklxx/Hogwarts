#!/bin/bash
# life.sh with a tolerant end-of-day marker (第4天 / 第 4 天 / 第四天). SKIP=1: day A is already running, only wait.
# usage: life2.sh <session> <dir> <log file> <first day> <last day>
S="$1"; D="$2"; LOG="$3"; A="$4"; B="$5"
ZH=(〇 一 二 三 四 五 六 七 八 九 十)
cd "$D" || exit 1
for N in $(seq "$A" "$B"); do                      # capped: B-A+1 days
  if [ "$N" != "$A" ] || [ "${SKIP:-0}" != 1 ]; then
    sed "s/{N}/$N/g" prompt_day.md > prompt_cur.md
    tmux send-keys -t "$S" 'claude-db "$(cat prompt_cur.md)"' Enter
    echo "$(date '+%F %T') day $N start" >> life.log
  fi
  D2="第 ?($N|${ZH[$N]}) ?天"; M="$D2 ?总结"; [ "$LOG" = notes.md ] && M="^#+ *$D2"
  for i in $(seq 1 240); do grep -qE "$M" "$LOG" 2>/dev/null && break; sleep 30; done   # at most 2 h a day
  sleep 120
  echo "$(date '+%F %T') day $N end ($(grep -cE "$M" "$LOG" 2>/dev/null) marker)" >> life.log
  tmux send-keys -t "$S" C-c; sleep 2; tmux send-keys -t "$S" C-c; sleep 2; tmux send-keys -t "$S" '/exit' Enter; sleep 10
done
echo "$(date '+%F %T') life over" >> life.log
