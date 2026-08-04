#!/bin/bash
set -e

MODE="${1:-dev}"
APP_NAME="aid-three"
LOG_FILE="dev.log"

if npx pm2 describe "$APP_NAME" > /dev/null 2>&1; then
  echo "이미 실행 중입니다 (pm2 프로세스: $APP_NAME)"
  exit 0
fi

if [ "$MODE" = "prod" ]; then
  npm run build
  npx pm2 start npm --name "$APP_NAME" --log "$LOG_FILE" -- run start
else
  npx pm2 start npm --name "$APP_NAME" --log "$LOG_FILE" -- run dev
fi

echo "서버 시작 (모드: $MODE, pm2 프로세스명: $APP_NAME, 포트: 9625)"
echo "로그: $LOG_FILE (또는 npx pm2 logs $APP_NAME)"
