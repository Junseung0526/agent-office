#!/usr/bin/env bash
# ==============================================================================
# 🏢 에이전트 오피스 (Agent Office) 제어 스크립트
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
    echo "❌ Node.js를 찾을 수 없습니다."
    echo "   Node.js (v18 이상)를 설치하거나 터미널 PATH를 확인해주세요."
    echo "   👉 공식 다운로드: https://nodejs.org/"
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
    echo "🏢 에이전트 오피스가 이미 실행 중입니다. (PID: $cur_pid, $URL)"
    if [ "$1" = "--open" ]; then
      cmd_open
    fi
    return 0
  fi

  # Stale PID 파일 정리
  if [ -f "$PID_FILE" ]; then
    echo "🧹 이전 비정상 종료된 PID 파일을 정리합니다."
    rm -f "$PID_FILE"
  fi

  rotate_logs

  echo "🚀 에이전트 오피스 서버를 시작합니다..."
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
      echo "❌ 서버 시작 실패: 로그를 확인하세요 ($LOG_FILE)"
      tail -n 15 "$LOG_FILE"
      rm -f "$PID_FILE"
      return 1
    fi
  done

  if [ $started -eq 1 ]; then
    echo "✅ 에이전트 오피스 서버가 성공적으로 시작되었습니다! (PID: $new_pid)"
    echo "👉 대시보드: $URL"
    if [ "$1" = "--open" ]; then
      cmd_open
    fi
  else
    echo "⚠️  서버 응답 대기 시간 초과: 상태를 확인하세요 ($URL)"
  fi
}

cmd_stop() {
  if [ ! -f "$PID_FILE" ]; then
    echo "ℹ️  실행 중인 에이전트 오피스 서버가 없습니다."
    return 0
  fi

  local pid
  pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    echo "🛑 에이전트 오피스 서버(PID: $pid)를 종료합니다..."
    kill "$pid" 2>/dev/null || true

    local wait_count=0
    while kill -0 "$pid" 2>/dev/null && [ $wait_count -lt 10 ]; do
      sleep 0.5
      wait_count=$((wait_count + 1))
    done

    if kill -0 "$pid" 2>/dev/null; then
      echo "⚠️  정상 종료되지 않아 강제 종료(SIGKILL)합니다..."
      kill -9 "$pid" 2>/dev/null || true
    fi
    echo "✅ 에이전트 오피스 서버가 완전히 종료되었습니다."
  else
    echo "ℹ️  서버 프로세스가 이미 종료되어 있습니다."
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
      echo "🟢 [실행 중] 에이전트 오피스 정상 가동 중"
      echo "   - PID: $pid"
      echo "   - 주소: $URL"
      echo "   - 상태: $health"
    else
      echo "🟡 [응답 대기] 프로세스는 살아있으나 HTTP 응답이 없습니다 (PID: $pid)"
    fi
  else
    if [ -f "$PID_FILE" ]; then
      echo "🔴 [중단] PID 파일은 존재하나 프로세스가 죽어 있습니다 (Stale PID)"
    else
      echo "⚪ [정지] 에이전트 오피스 서버가 정지 상태입니다."
    fi
  fi
}

cmd_open() {
  if ! check_health; then
    echo "⚠️  서버가 아직 켜져 있지 않습니다. 먼저 시작합니다..."
    cmd_start
  fi
  echo "🌐 브라우저에서 대시보드를 엽니다: $URL"
  if command -v open >/dev/null 2>&1; then
    open "$URL"
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$URL"
  fi
}

cmd_logs() {
  if [ -f "$LOG_FILE" ]; then
    echo "📄 최근 로그 보기 (Ctrl+C 로 종료):"
    tail -n 50 -f "$LOG_FILE"
  else
    echo "ℹ️  아직 로그 파일이 없습니다."
  fi
}

cmd_make_app() {
  if ! command -v osacompile >/dev/null 2>&1; then
    echo "❌ osacompile 명령어를 찾을 수 없습니다 (macOS 전용)."
    return 1
  fi

  local app_path="$SCRIPT_DIR/AgentOffice.app"
  echo "🔨 AgentOffice.app 생성 중..."
  rm -rf "$app_path"

  osacompile -o "$app_path" -e "
    set scriptDir to \"$SCRIPT_DIR\"
    do shell script quoted form of (scriptDir & \"/office.sh\") & \" start --open\"
  "

  echo "🎉 AgentOffice.app 생성이 완료되었습니다!"
  echo "   위치: $app_path"
  echo "   👉 Finder에서 더블클릭하거나 macOS Dock에 드래그하여 바로 실행할 수 있습니다."
}

cmd_install_autostart() {
  local NODE_BIN
  NODE_BIN="$(find_node)"
  local plist_dir="$HOME/Library/LaunchAgents"
  local plist_file="$plist_dir/com.agent-office.plist"
  mkdir -p "$plist_dir"

  cat <<EOF

==============================================================================
📋 [로그인 시 자동 실행 LaunchAgent 설정 안내]
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
    echo "ℹ️  --dry-run 모드: 실제 설치를 진행하지 않습니다."
    return 0
  fi

  printf "위 내용으로 LaunchAgent를 생성하고 등록하시겠습니까? (y/N): "
  read -r reply
  if [ "$reply" != "y" ] && [ "$reply" != "Y" ]; then
    echo "설치를 취소했습니다."
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
  echo "✅ 로그인 시 자동 실행 등록이 완료되었습니다."
}

cmd_uninstall_autostart() {
  local plist_file="$HOME/Library/LaunchAgents/com.agent-office.plist"
  local uid
  uid=$(id -u)
  launchctl bootout "gui/$uid" "$plist_file" 2>/dev/null || launchctl unload "$plist_file" 2>/dev/null || true
  if [ -f "$plist_file" ]; then
    rm -f "$plist_file"
    echo "✅ com.agent-office.plist 자동 실행이 제거되었습니다."
  else
    echo "ℹ️  등록된 자동 실행 설정이 없습니다."
  fi
  echo "📌 참고: nvm 등으로 Node.js 바이너리 경로가 변경된 경우 재설치가 필요합니다."
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
    echo "사용법: $0 {start|stop|restart|status|open|logs|make-app|install-autostart|uninstall-autostart}"
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
