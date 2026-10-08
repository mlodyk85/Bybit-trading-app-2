#!/bin/zsh
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLIST="$HOME/Library/LaunchAgents/com.bybit.ai-engine.plist"
LOG_DIR="$SCRIPT_DIR/logs"
mkdir -p "$HOME/Library/LaunchAgents" "$LOG_DIR"

NODE_PATH="$(command -v node || true)"
if [ -z "$NODE_PATH" ]; then
  echo "Node.js not found. Install Node.js 20+ first."
  exit 1
fi

if [ ! -f "$SCRIPT_DIR/.env" ]; then
  echo "Missing $SCRIPT_DIR/.env"
  echo "Copy .env.example to .env and fill BYBIT_API_KEY, BYBIT_API_SECRET and PRO_ENGINE_TOKEN."
  exit 1
fi

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.bybit.ai-engine</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string>
    <string>$SCRIPT_DIR/run-macos.sh</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$SCRIPT_DIR</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>StandardOutPath</key>
  <string>$LOG_DIR/ai-engine.out.log</string>
  <key>StandardErrorPath</key>
  <string>$LOG_DIR/ai-engine.err.log</string>
</dict>
</plist>
EOF

launchctl bootout "gui/$(id -u)" "$PLIST" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
launchctl enable "gui/$(id -u)/com.bybit.ai-engine"
launchctl kickstart -k "gui/$(id -u)/com.bybit.ai-engine"

echo "AI Engine installed as a macOS LaunchAgent."
echo "It will start automatically after login and restart if the process exits."
echo "Logs: $LOG_DIR"
