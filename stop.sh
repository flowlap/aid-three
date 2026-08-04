#!/bin/bash

APP_NAME="aid-three"

if ! npx pm2 describe "$APP_NAME" > /dev/null 2>&1; then
  echo "실행 중인 서버가 없습니다"
  exit 0
fi

npx pm2 delete "$APP_NAME" > /dev/null
echo "서버 종료 (pm2 프로세스: $APP_NAME)"
