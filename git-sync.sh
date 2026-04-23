#!/usr/bin/env bash

# Oh My Captain - Git Sync Script
# Usage: ./git-sync.sh "your commit message"

set -e # 오류 발생 시 즉시 중단

# 색상 정의
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# 인자 확인
if [ -z "$1" ]; then
    echo -e "${RED}✘ 오류: 커밋 메시지를 입력해주세요.${NC}"
    echo -e "사용법: $0 \"커밋 메시지\""
    exit 1
fi

COMMIT_MSG="$1"

echo -e "${YELLOW}▸ Step 1: git add .${NC}"
git add .

echo -e "${YELLOW}▸ Step 2: git commit -m \"$COMMIT_MSG\"${NC}"
git commit -m "$COMMIT_MSG"

echo -e "${YELLOW}▸ Step 3: git push${NC}"
# 현재 브랜치 이름을 가져와서 push (기본값 main/master 대응)
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
git push origin "$CURRENT_BRANCH"

echo -e "${GREEN}✔ 성공: 모든 변경 사항이 $CURRENT_BRANCH 브랜치에 반영되었습니다!${NC}"
