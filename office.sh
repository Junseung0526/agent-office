#!/usr/bin/env bash
# ==============================================================================
# 에이전트 오피스 (Agent Office) 제어 스크립트
# 사용법: ./office.sh {start|stop|restart|status|open|logs|make-app|install-autostart|uninstall-autostart}
# ==============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
RUN_DIR="$SCRIPT_DIR/.run"
PID_FILE="$RUN_DIR/office.pid"
LOG_FILE="$RUN_DIR/server.log"
PORT="${PORT:-3456}"
HOST="127.0.0.1"
URL="http://$HOST:$PORT"

# 출력 헬퍼 (TTY일 때만 색상 적용, NO_COLOR 지원)
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  C_RESET=$'\033[0m'; C_DIM=$'\033[2m'; C_BOLD=$'\033[1m'
  C_RED=$'\033[31m'; C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'; C_CYAN=$'\033[36m'
else
  C_RESET=''; C_DIM=''; C_BOLD=''; C_RED=''; C_GREEN=''; C_YELLOW=''; C_CYAN=''
fi

info()  { printf '%s\n' "${C_CYAN}•${C_RESET} $*"; }
ok()    { printf '%s\n' "${C_GREEN}✓${C_RESET} $*"; }
warn()  { printf '%s\n' "${C_YELLOW}!${C_RESET} $*" >&2; }
fail()  { printf '%s\n' "${C_RED}✗${C_RESET} $*" >&2; }
kv()    { printf '  %s%-9s%s %s\n' "$C_DIM" "$1" "$C_RESET" "$2"; }

# Node.js 바이너리 탐색
find_node() {
  local node_bin
  node_bin="$(command -v node 2>/dev/null || true)"
  if [ -z "$node_bin" ] && [ -s "$HOME/.nvm/nvm.sh" ]; then
    # nvm 환경 시도
    export NVM_DIR="$HOME/.nvm"
    [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
    node_bin="$(command -v node 2>/dev/null || true)"
  fi
  if [ -z "$node_bin" ]; then
    fail "Node.js를 찾을 수 없습니다. v18 이상을 설치하거나 PATH를 확인하세요."
    kv "download" "https://nodejs.org/" >&2
    exit 1
  fi
  echo "$node_bin"
}

# 실행 중인 프로세스 검사 (PID 및 /api/health 검사)
get_running_pid() {
  if [ -f "$PID_FILE" ]; then
    local pid
    pid="$(cat "$PID_FILE" 2>/dev/null || true)"
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      echo "$pid"
      return 0
    fi
  fi
  return 1
}

# 로그 로테이션 (1MB 초과 시 .1로 교체)
rotate_logs() {
  if [ -f "$LOG_FILE" ]; then
    local size
    size=$(wc -c < "$LOG_FILE" 2>/dev/null || echo 0)
    if [ "$size" -gt 1048576 ]; then
      mv -f "$LOG_FILE" "$RUN_DIR/server.log.1"
    fi
  fi
}

# 서버 상태 확인 (/api/health)
check_health() {
  local health
  health=$(curl -s -m 2 -H "Host: $HOST:$PORT" "$URL/api/health" 2>/dev/null || true)
  if echo "$health" | grep -q '"app":"agent-office"'; then
    return 0
  fi
  return 1
}

cmd_start() {
  local NODE_BIN
  NODE_BIN="$(find_node)"
  mkdir -p "$RUN_DIR"

  # 이미 실행 중인지 확인
  if get_running_pid >/dev/null; then
    local cur_pid
    cur_pid="$(get_running_pid)"
    info "이미 실행 중입니다"
    kv "pid" "$cur_pid"
    kv "url" "$URL"
    if [ "$1" = "--open" ]; then
      cmd_open
    fi
    return 0
  fi

  # Stale PID 파일 정리
  if [ -f "$PID_FILE" ]; then
    info "이전 비정상 종료로 남은 PID 파일을 정리했습니다"
    rm -f "$PID_FILE"
  fi

  rotate_logs

  info "서버를 시작합니다..."
  nohup "$NODE_BIN" "$SCRIPT_DIR/server.js" >> "$LOG_FILE" 2>&1 &
  local new_pid=$!
  echo "$new_pid" > "$PID_FILE"

  # /api/health 응답 대기 (최대 5초)
  local elapsed=0
  local started=0
  while [ $elapsed -lt 10 ]; do
    sleep 0.5
    elapsed=$((elapsed + 1))
    if check_health; then
      started=1
      break
    fi
    if ! kill -0 "$new_pid" 2>/dev/null; then
      fail "서버 시작 실패 ($LOG_FILE)"
      tail -n 15 "$LOG_FILE"
      rm -f "$PID_FILE"
      return 1
    fi
  done

  if [ $started -eq 1 ]; then
    ok "서버가 시작되었습니다"
    kv "pid" "$new_pid"
    kv "url" "${C_BOLD}$URL${C_RESET}"
    kv "log" "$LOG_FILE"
    if [ "$1" = "--open" ]; then
      cmd_open
    fi
  else
    warn "서버 응답 대기 시간을 초과했습니다. '$0 status'로 확인하세요."
  fi
}

cmd_stop() {
  if [ ! -f "$PID_FILE" ]; then
    info "실행 중인 서버가 없습니다"
    return 0
  fi

  local pid
  pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    info "서버를 종료합니다 (pid $pid)..."
    kill "$pid" 2>/dev/null || true

    local wait_count=0
    while kill -0 "$pid" 2>/dev/null && [ $wait_count -lt 10 ]; do
      sleep 0.5
      wait_count=$((wait_count + 1))
    done

    if kill -0 "$pid" 2>/dev/null; then
      warn "정상 종료되지 않아 SIGKILL로 강제 종료합니다"
      kill -9 "$pid" 2>/dev/null || true
    fi
    ok "서버가 종료되었습니다"
  else
    info "서버 프로세스가 이미 종료되어 있습니다"
  fi

  rm -f "$PID_FILE"
}

cmd_restart() {
  cmd_stop
  sleep 1
  cmd_start "$@"
}

cmd_status() {
  if get_running_pid >/dev/null; then
    local pid
    pid="$(get_running_pid)"
    local health
    health=$(curl -s -m 2 -H "Host: $HOST:$PORT" "$URL/api/health" 2>/dev/null || true)
    if [ -n "$health" ]; then
      printf '%s\n' "${C_GREEN}●${C_RESET} ${C_BOLD}running${C_RESET}"
      kv "pid" "$pid"
      kv "url" "$URL"
      kv "health" "$health"
    else
      printf '%s\n' "${C_YELLOW}●${C_RESET} ${C_BOLD}unresponsive${C_RESET}  프로세스는 살아있으나 HTTP 응답이 없습니다"
      kv "pid" "$pid"
    fi
  else
    if [ -f "$PID_FILE" ]; then
      printf '%s\n' "${C_RED}●${C_RESET} ${C_BOLD}crashed${C_RESET}  PID 파일은 있으나 프로세스가 없습니다 (stale pid)"
      [ -f "$LOG_FILE" ] && kv "last log" "$(tail -n 1 "$LOG_FILE")"
    else
      printf '%s\n' "${C_DIM}●${C_RESET} ${C_BOLD}stopped${C_RESET}"
    fi
  fi
}

cmd_open() {
  if ! check_health; then
    info "서버가 꺼져 있어 먼저 시작합니다"
    cmd_start
  fi
  info "브라우저에서 대시보드를 엽니다: $URL"
  if command -v open >/dev/null 2>&1; then
    open "$URL"
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$URL"
  fi
}

cmd_logs() {
  if [ -f "$LOG_FILE" ]; then
    info "$LOG_FILE ${C_DIM}(Ctrl+C로 종료)${C_RESET}"
    tail -n 50 -f "$LOG_FILE"
  else
    info "아직 로그 파일이 없습니다"
  fi
}

cmd_make_app() {
  if ! command -v osacompile >/dev/null 2>&1; then
    fail "osacompile을 찾을 수 없습니다 (macOS 전용)"
    return 1
  fi

  local app_path="$SCRIPT_DIR/AgentOffice.app"
  info "AgentOffice.app 생성 중..."
  rm -rf "$app_path"

  osacompile -o "$app_path" -e "
    set scriptDir to \"$SCRIPT_DIR\"
    do shell script quoted form of (scriptDir & \"/office.sh\") & \" start --open\"
  "

  ok "AgentOffice.app을 생성했습니다"
  kv "path" "$app_path"
  kv "usage" "Finder에서 더블클릭하거나 Dock에 드래그하세요"
}

cmd_install_autostart() {
  local NODE_BIN
  NODE_BIN="$(find_node)"
  local plist_dir="$HOME/Library/LaunchAgents"
  local plist_file="$plist_dir/com.agent-office.plist"
  mkdir -p "$plist_dir"

  cat <<EOF

==============================================================================
LaunchAgent 설정 (로그인 시 자동 실행)
생성될 파일 경로: $plist_file
내용:
==============================================================================
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.agent-office</string>
    <key>ProgramArguments</key>
    <array>
        <string>$NODE_BIN</string>
        <string>$SCRIPT_DIR/server.js</string>
    </array>
    <key>WorkingDirectory</key>
    <string>$SCRIPT_DIR</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <dict>
        <key>SuccessfulExit</key>
        <false/>
    </dict>
    <key>ThrottleInterval</key>
    <integer>10</integer>
    <key>StandardOutPath</key>
    <string>$RUN_DIR/server.log</string>
    <key>StandardErrorPath</key>
    <string>$RUN_DIR/server.log</string>
</dict>
</plist>
==============================================================================
EOF

  if [ "$1" = "--dry-run" ]; then
    info "--dry-run: 실제로 설치하지 않았습니다"
    return 0
  fi

  printf "위 내용으로 LaunchAgent를 생성하고 등록하시겠습니까? (y/N): "
  read -r reply
  if [ "$reply" != "y" ] && [ "$reply" != "Y" ]; then
    info "설치를 취소했습니다"
    return 0
  fi

  cat <<EOF > "$plist_file"
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.agent-office</string>
    <key>ProgramArguments</key>
    <array>
        <string>$NODE_BIN</string>
        <string>$SCRIPT_DIR/server.js</string>
    </array>
    <key>WorkingDirectory</key>
    <string>$SCRIPT_DIR</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <dict>
        <key>SuccessfulExit</key>
        <false/>
    </dict>
    <key>ThrottleInterval</key>
    <integer>10</integer>
    <key>StandardOutPath</key>
    <string>$RUN_DIR/server.log</string>
    <key>StandardErrorPath</key>
    <string>$RUN_DIR/server.log</string>
</dict>
</plist>
EOF

  local uid
  uid=$(id -u)
  launchctl bootstrap "gui/$uid" "$plist_file" 2>/dev/null || launchctl load "$plist_file" 2>/dev/null || true
  ok "로그인 시 자동 실행을 등록했습니다"
}

cmd_uninstall_autostart() {
  local plist_file="$HOME/Library/LaunchAgents/com.agent-office.plist"
  local uid
  uid=$(id -u)
  launchctl bootout "gui/$uid" "$plist_file" 2>/dev/null || launchctl unload "$plist_file" 2>/dev/null || true
  if [ -f "$plist_file" ]; then
    rm -f "$plist_file"
    ok "자동 실행 등록을 해제했습니다 (com.agent-office.plist)"
  else
    info "등록된 자동 실행 설정이 없습니다"
  fi
  printf '%s\n' "${C_DIM}  nvm 등으로 Node.js 경로가 바뀌면 다시 설치해야 합니다.${C_RESET}"
}

case "$1" in
  start)
    shift
    cmd_start "$@"
    ;;
  stop)
    cmd_stop
    ;;
  restart)
    shift
    cmd_restart "$@"
    ;;
  status)
    cmd_status
    ;;
  open)
    cmd_open
    ;;
  logs)
    cmd_logs
    ;;
  make-app)
    cmd_make_app
    ;;
  install-autostart)
    shift
    cmd_install_autostart "$@"
    ;;
  uninstall-autostart)
    cmd_uninstall_autostart
    ;;
  *)
    printf '%s\n\n' "${C_BOLD}Agent Office${C_RESET} 제어 스크립트"
    echo "사용법: $0 <command> [options]"
    echo ""
    echo "Commands:"
    echo "  start [--open]        : 백그라운드 서버 실행 (브라우저 자동 열기 옵션)"
    echo "  stop                  : 백그라운드 서버 종료"
    echo "  restart [--open]      : 서버 재시작"
    echo "  status                : 서버 상태 확인 (/api/health)"
    echo "  open                  : 브라우저에서 대시보드 열기"
    echo "  logs                  : 실시간 서버 로그 보기"
    echo "  make-app              : macOS 전용 AgentOffice.app 생성 (Dock 등록용)"
    echo "  install-autostart     : 로그인 시 백그라운드 자동 실행 등록 (LaunchAgent)"
    echo "  uninstall-autostart   : 자동 실행 등록 해제"
    exit 1
    ;;
esac
