#!/usr/bin/env bash
#
# Oh My Captain — 빌드 & 실행 스크립트
# Usage:
#   ./build-and-run.sh          # 전체 빌드 후 IntelliJ 실행
#   ./build-and-run.sh build    # 빌드만
#   ./build-and-run.sh run      # 실행만 (이전 빌드 결과 사용)
#   ./build-and-run.sh core     # Core만 빌드
#   ./build-and-run.sh webview  # Webview만 빌드
#   ./build-and-run.sh clean    # 빌드 산출물 정리
#

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
INTELLIJ_DIR="$ROOT_DIR/hosts/intellij"

# ── 환경 설정 (nvm / Homebrew) ──
# non-interactive shell에서 node, pnpm 등을 찾기 위해 nvm을 로드합니다.
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [[ -s "/opt/homebrew/opt/nvm/nvm.sh" ]]; then
    source "/opt/homebrew/opt/nvm/nvm.sh"
elif [[ -s "$NVM_DIR/nvm.sh" ]]; then
    source "$NVM_DIR/nvm.sh"
fi

# Homebrew 바이너리 경로
if [[ -d "/opt/homebrew/bin" ]]; then
    export PATH="/opt/homebrew/bin:$PATH"
fi

# pnpm, 사용자 로컬 바이너리
export PATH="$HOME/.local/bin:$PATH"

# ── 색상 ──
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'   # No Color

log()   { echo -e "${CYAN}▸${NC} $*"; }
ok()    { echo -e "${GREEN}✔${NC} $*"; }
warn()  { echo -e "${YELLOW}⚠${NC} $*"; }
err()   { echo -e "${RED}✘${NC} $*" >&2; }
header(){ echo -e "\n${BOLD}═══ $* ═══${NC}\n"; }

# ── 사전 검사 ──
check_prerequisites() {
    local missing=0

    if ! command -v node &>/dev/null; then
        err "node가 설치되어 있지 않습니다."
        missing=1
    fi

    if ! command -v pnpm &>/dev/null; then
        err "pnpm이 설치되어 있지 않습니다. (npm i -g pnpm)"
        missing=1
    fi

    if ! command -v java &>/dev/null; then
        err "java가 설치되어 있지 않습니다."
        missing=1
    fi

    if [[ $missing -eq 1 ]]; then
        exit 1
    fi

    ok "필수 도구 확인 완료  (node $(node -v), pnpm $(pnpm -v), java $(java -version 2>&1 | head -1))"
}

# ── pnpm install ──
install_deps() {
    header "의존성 설치"
    log "pnpm install ..."
    (cd "$ROOT_DIR" && pnpm install --frozen-lockfile 2>/dev/null || pnpm install)
    ok "의존성 설치 완료"
}

# ── Core 번들 ──
build_core() {
    header "Core 번들 (esbuild)"
    log "packages/core → hosts/intellij/src/main/resources/core"
    (cd "$ROOT_DIR/packages/core" && pnpm run bundle)
    ok "Core 번들 완료"
}

# ── Webview 빌드 ──
build_webview() {
    header "Webview 빌드 (Vite)"
    log "packages/webview → hosts/intellij/src/main/resources/webview"
    (cd "$ROOT_DIR/packages/webview" && pnpm run build)
    ok "Webview 빌드 완료"
}

# ── Gradle runIde ──
run_ide() {
    header "IntelliJ 플러그인 실행"
    log "Gradle runIde 시작 (최초 실행 시 IDE 다운로드로 시간이 걸릴 수 있습니다)"
    (cd "$INTELLIJ_DIR" && ./gradlew runIde)
}

# ── Clean ──
clean() {
    header "빌드 산출물 정리"
    log "hosts/intellij/build 삭제"
    rm -rf "$INTELLIJ_DIR/build"
    log "hosts/intellij/src/main/resources/core 삭제"
    rm -rf "$INTELLIJ_DIR/src/main/resources/core"
    log "hosts/intellij/src/main/resources/webview 삭제"
    rm -rf "$INTELLIJ_DIR/src/main/resources/webview"
    ok "정리 완료"
}

# ── 전체 빌드 ──
build_all() {
    check_prerequisites
    install_deps
    build_core
    build_webview
    ok "전체 빌드 완료! 🎉"
}

# ── 메인 ──
CMD="${1:-all}"

case "$CMD" in
    build)
        build_all
        ;;
    run)
        check_prerequisites
        run_ide
        ;;
    core)
        check_prerequisites
        install_deps
        build_core
        ;;
    webview)
        check_prerequisites
        install_deps
        build_webview
        ;;
    clean)
        clean
        ;;
    all|"")
        build_all
        echo ""
        run_ide
        ;;
    *)
        echo "Usage: $0 {build|run|core|webview|clean|all}"
        echo ""
        echo "  build    전체 빌드만 (Core + Webview)"
        echo "  run      빌드 없이 IntelliJ 실행만"
        echo "  core     Core만 빌드"
        echo "  webview  Webview만 빌드"
        echo "  clean    빌드 산출물 정리"
        echo "  all      전체 빌드 + IntelliJ 실행 (기본값)"
        exit 1
        ;;
esac
