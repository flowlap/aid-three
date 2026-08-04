#!/bin/bash
set -e

PID_FILE=".pid"
LOG_FILE="dev.log"

if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  echo "이미 실행 중입니다 (PID: $(cat "$PID_FILE"))"
  exit 0
fi

npm run dev > "$LOG_FILE" 2>&1 &
echo $! > "$PID_FILE"
echo "서버 시작 (PID: $!, 포트: 9625)"
echo "로그: $LOG_FILE"
