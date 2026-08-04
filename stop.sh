#!/bin/bash

PID_FILE=".pid"

if [ ! -f "$PID_FILE" ]; then
  echo "실행 중인 서버가 없습니다"
  exit 0
fi

PID=$(cat "$PID_FILE")
if kill -0 "$PID" 2>/dev/null; then
  kill "$PID"
  rm "$PID_FILE"
  echo "서버 종료 (PID: $PID)"
else
  rm "$PID_FILE"
  echo "서버가 이미 종료되어 있습니다"
fi
