#!/usr/bin/env bash
#
# Oh My Captain — 빌드 & 실행 스크립트
# Usage:
#   ./build.sh                  # 전체 빌드 후 IntelliJ 실행 (기본값)
#   ./build.sh build            # Core + Webview 빌드만
#   ./build.sh run              # 실행만 (이전 빌드 결과 사용)
#   ./build.sh core             # Core만 빌드
#   ./build.sh webview          # Webview만 빌드
#   ./build.sh dist             # 배포용 플러그인 zip 생성
#   ./build.sh clean            # 빌드 산출물 정리
#   ./build.sh help             # 사용법 출력
#

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
INTELLIJ_DIR="$ROOT_DIR/hosts/intellij"

# ── 단계 카운터 ──
CURRENT_STEP=0
TOTAL_STEPS=0

# ── 환경 설정 (nvm / Homebrew) ──
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [[ -s "/opt/homebrew/opt/nvm/nvm.sh" ]]; then
    source "/opt/homebrew/opt/nvm/nvm.sh"
elif [[ -s "$NVM_DIR/nvm.sh" ]]; then
    source "$NVM_DIR/nvm.sh"
fi

if [[ -d "/opt/homebrew/bin" ]]; then
    export PATH="/opt/homebrew/bin:$PATH"
fi

export PATH="$HOME/.local/bin:$PATH"

# ── 색상 ──
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

log()   { echo -e "${CYAN}▸${NC} $*"; }
ok()    { echo -e "${GREEN}✔${NC} $*"; }
warn()  { echo -e "${YELLOW}⚠${NC} $*"; }
err()   { echo -e "${RED}✘${NC} $*" >&2; }

# gradle.properties에서 속성 값 읽기
get_gradle_property() {
    local key="$1"
    grep "^${key}=" "$INTELLIJ_DIR/gradle.properties" 2>/dev/null | cut -d'=' -f2 || echo ""
}

# 단계 증가
step_increment() {
    CURRENT_STEP=$((CURRENT_STEP + 1))
}

# 향상된 헤더
header() {
    echo ""
    if [[ $TOTAL_STEPS -gt 0 && $CURRENT_STEP -gt 0 ]]; then
        echo -e "${BLUE}─────────────────────────────────────────────────${NC}"
        echo -e "${BLUE}│${NC} ${MAGENTA}[${CURRENT_STEP}/${TOTAL_STEPS}]${NC} ${BOLD}$*${NC}"
        echo -e "${BLUE}─────────────────────────────────────────────────${NC}"
    else
        echo -e "${BLUE}─────────────────────────────────────────────────${NC}"
        echo -e "${BLUE}│${NC} ${BOLD}$*${NC}"
        echo -e "${BLUE}─────────────────────────────────────────────────${NC}"
    fi
    echo ""
}

# 단계 시작 시간 기록
step_start() {
    STEP_START_TIME=$(date +%s)
}

# 단계 종료 및 소요 시간 출력
step_end() {
    local step_name="$1"
    local end_time=$(date +%s)
    local duration_s=$((end_time - STEP_START_TIME))
    ok "$step_name  ${DIM}(${duration_s}s)${NC}"
}

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

    ok "필수 도구 확인 완료"
    log "  Node.js: $(node -v)"
    log "  pnpm: $(pnpm -v)"
    log "  Java: $(java -version 2>&1 | head -1 || true)"
}

# ── pnpm install ──
install_deps() {
    step_increment
    header "의존성 설치"
    step_start
    log "pnpm install ..."
    (cd "$ROOT_DIR" && pnpm install --frozen-lockfile 2>/dev/null || pnpm install)
    step_end "의존성 설치 완료"
}

# ── Core 번들 ──
build_core() {
    step_increment
    header "Core 번들 (esbuild)"
    step_start
    log "packages/core → hosts/intellij/src/main/resources/core"
    (cd "$ROOT_DIR/packages/core" && pnpm run bundle 2>&1 | grep -v "npm warn")
    step_end "Core 번들 완료"
}

# ── Webview 빌드 ──
build_webview() {
    step_increment
    header "Webview 빌드 (Vite)"
    step_start
    log "packages/webview → hosts/intellij/src/main/resources/webview"
    (cd "$ROOT_DIR/packages/webview" && pnpm run build)
    step_end "Webview 빌드 완료"
}

# ── Gradle buildPlugin (배포 zip) ──
build_dist() {
    step_increment
    header "IntelliJ 플러그인 배포 파일 생성"
    step_start
    log "Gradle buildPlugin 실행 중..."
    (cd "$INTELLIJ_DIR" && ./gradlew buildPlugin)
    local dist_dir="$INTELLIJ_DIR/build/distributions"
    if ls "$dist_dir"/*.zip &>/dev/null; then
        step_end "배포 파일 생성 완료"
        log "생성된 파일:"
        ls -lh "$dist_dir"/*.zip | awk '{print "  └ " $9 "  (" $5 ")"}'
    else
        err "배포 파일을 찾을 수 없습니다: $dist_dir"
        exit 1
    fi
}

# ── Gradle runIde ──
run_ide() {
    step_increment
    header "IntelliJ 플러그인 실행"

    local plugin_name=$(get_gradle_property "pluginName")
    local plugin_version=$(get_gradle_property "pluginVersion")
    local platform_version=$(get_gradle_property "platformVersion")
    local platform_type=$(get_gradle_property "platformType")

    local platform_name="IntelliJ IDEA"
    if [[ "$platform_type" == "IC" ]]; then
        platform_name="IntelliJ IDEA Community"
    fi

    echo -e "${BOLD}플러그인 정보:${NC}"
    log "이름: ${plugin_name}"
    log "버전: ${plugin_version}"
    echo ""
    echo -e "${BOLD}플랫폼 정보:${NC}"
    log "IDE: ${platform_name}"
    log "버전: ${platform_version}"
    echo ""
    log "Gradle runIde 시작"
    log "${DIM}(최초 실행 시 IDE 다운로드로 시간이 걸릴 수 있습니다)${NC}"
    echo ""
    (cd "$INTELLIJ_DIR" && ./gradlew runIde)
}

# ── Clean ──
clean() {
    step_increment
    header "빌드 산출물 정리"
    step_start
    log "hosts/intellij/build 삭제"
    rm -rf "$INTELLIJ_DIR/build"
    log "hosts/intellij/src/main/resources/core 삭제"
    rm -rf "$INTELLIJ_DIR/src/main/resources/core"
    log "hosts/intellij/src/main/resources/webview 삭제"
    rm -rf "$INTELLIJ_DIR/src/main/resources/webview"
    step_end "정리 완료"
}

# ── Logo ──
show_logo() {
    echo -e "${CYAN}"
    cat << 'EOF'
   ____  _       __  __          _____            _        _
  / __ \| |     |  \/  |        / ____|          | |      (_)
 | |  | | |__   | \  / |_   _  | |     __ _ _ __ | |_ __ _ _ _ __
 | |  | | '_ \  | |\/| | | | | | |    / _` | '_ \| __/ _` | | '_ \
 | |__| | | | | | |  | | |_| | | |___| (_| | |_) | || (_| | | | | |
  \____/|_| |_| |_|  |_|\__, |  \_____\__,_| .__/ \__\__,_|_|_| |_|
                         __/ |             | |
                        |___/              |_|
EOF
    echo -e "${NC}"
}

# ── Help ──
show_help() {
    echo -e "${BOLD}Oh My Captain — 빌드 & 실행 스크립트${NC}"
    echo ""
    echo -e "${BOLD}사용법:${NC}"
    echo -e "  ${CYAN}./build.sh${NC}              전체 빌드 후 IntelliJ 실행 (기본값)"
    echo -e "  ${CYAN}./build.sh dev${NC}          개발 모드 (Vite Dev Server + Core Watch + HMR)"
    echo -e "  ${CYAN}./build.sh build${NC}        Core + Webview 빌드만"
    echo -e "  ${CYAN}./build.sh run${NC}          실행만 (이전 빌드 결과 사용)"
    echo -e "  ${CYAN}./build.sh core${NC}         Core만 빌드"
    echo -e "  ${CYAN}./build.sh webview${NC}      Webview만 빌드"
    echo -e "  ${CYAN}./build.sh dist${NC}         배포용 플러그인 zip 생성"
    echo -e "  ${CYAN}./build.sh clean${NC}        빌드 산출물 정리"
    echo -e "  ${CYAN}./build.sh help${NC}         사용법 출력"
    echo ""
    echo -e "${BOLD}사전 요구사항:${NC}"
    echo "  • Node.js"
    echo "  • pnpm"
    echo "  • Java"
    echo ""
    echo -e "${BOLD}배포 파일 위치:${NC}"
    echo "  hosts/intellij/build/distributions/"
    echo ""
}

# ── 빌드 완료 요약 ──
print_summary() {
    echo ""
    echo -e "${GREEN}╔════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║${NC}        ✨ 빌드 완료! 🎉                   ${GREEN}║${NC}"
    echo -e "${GREEN}╠════════════════════════════════════════════╣${NC}"
    echo -e "${GREEN}║${NC}  모든 단계가 성공적으로 완료되었습니다   ${GREEN}║${NC}"
    echo -e "${GREEN}╚════════════════════════════════════════════╝${NC}"
    echo ""
}

# ── 전체 빌드 ──
build_all() {
    TOTAL_STEPS=3
    CURRENT_STEP=0
    check_prerequisites
    install_deps
    build_core
    build_webview
    print_summary
}

# ── 메인 ──
show_logo
echo ""

CMD="${1:-all}"

case "$CMD" in
    build)
        TOTAL_STEPS=3
        CURRENT_STEP=0
        build_all
        ;;
    run)
        TOTAL_STEPS=1
        CURRENT_STEP=0
        check_prerequisites
        run_ide
        ;;
    dev)
        TOTAL_STEPS=2
        CURRENT_STEP=0
        check_prerequisites
        install_deps

        header "개발 모드 시작 (Vite Dev + Core Watch + Run IDE)"
        
        log "1. 초기 Core 빌드 (NPM Install 포함) - Race Condition 방지..."
        build_core

        log "2. Vite Dev 서버 고아 프로세스 정리 (포트 5173)..."
        lsof -ti:5173 | xargs kill -9 2>/dev/null || true

        log "3. Vite Dev 서버 시작..."
        (cd "$ROOT_DIR/packages/webview" && pnpm run dev) &
        VITE_PID=$!

        log "4. Core esbuild Watch 시작..."
        (cd "$ROOT_DIR/packages/core" && SKIP_CORE_NPM_INSTALL=1 node scripts/bundle.mjs --watch) &
        CORE_PID=$!

        log "5. IntelliJ 플러그인 실행..."
        # 종료 시 백그라운드 프로세스 확실한 정리 (SIGINT 포함)
        trap "kill -TERM $VITE_PID $CORE_PID 2>/dev/null" EXIT INT TERM
        
        (cd "$INTELLIJ_DIR" && ./gradlew runIde -Domc.dev=true)
        ;;
    core)
        TOTAL_STEPS=1
        CURRENT_STEP=0
        check_prerequisites
        install_deps
        build_core
        ;;
    webview)
        TOTAL_STEPS=1
        CURRENT_STEP=0
        check_prerequisites
        install_deps
        build_webview
        ;;
    dist)
        TOTAL_STEPS=4
        CURRENT_STEP=0
        check_prerequisites
        install_deps
        build_core
        build_webview
        build_dist
        print_summary
        ;;
    clean)
        TOTAL_STEPS=1
        CURRENT_STEP=0
        clean
        ;;
    help|--help|-h)
        show_help
        ;;
    all|"")
        TOTAL_STEPS=4
        CURRENT_STEP=0
        check_prerequisites
        install_deps
        build_core
        build_webview
        print_summary
        echo ""
        run_ide
        ;;
    *)
        err "알 수 없는 명령어: $CMD"
        echo ""
        show_help
        exit 1
        ;;
esac
