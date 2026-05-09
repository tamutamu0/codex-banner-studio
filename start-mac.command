#!/bin/zsh
set -e

cd "$(dirname "$0")"

mkdir -p public/data
STARTUP_LOG="public/data/startup-log.txt"
{
  echo "===== Banner Tool startup $(date '+%Y-%m-%d %H:%M:%S') ====="
  echo "cwd=$(pwd)"
  echo "starter=start-mac.command"
  echo "uname=$(uname -a)"
  echo "user=$(whoami)"
  echo "path=$PATH"
} >> "$STARTUP_LOG"
export BANNER_TOOL_STARTER="start-mac.command"

echo "========================================"
echo "Banner Tool - start"
echo "========================================"
echo ""

if ! command -v node >/dev/null 2>&1; then
  echo "node=not-found" >> "$STARTUP_LOG"
  echo "Node.js was not found."
  echo "Install Node.js LTS first:"
  echo "https://nodejs.org/"
  echo ""
  echo "Press any key to close."
  read -k 1
  exit 1
fi
echo "node=$(node --version 2>/dev/null)" >> "$STARTUP_LOG"

if ! command -v npm >/dev/null 2>&1; then
  echo "npm=not-found" >> "$STARTUP_LOG"
  echo "npm was not found. Please reinstall Node.js LTS."
  echo ""
  echo "Press any key to close."
  read -k 1
  exit 1
fi
echo "npm=$(npm --version 2>/dev/null)" >> "$STARTUP_LOG"

if ! command -v codex >/dev/null 2>&1 && [ -x "/Applications/Codex.app/Contents/Resources/codex" ]; then
  export CODEX_BIN="/Applications/Codex.app/Contents/Resources/codex"
  alias codex="$CODEX_BIN"
  echo "codexPath=$CODEX_BIN" >> "$STARTUP_LOG"
fi

if ! command -v codex >/dev/null 2>&1; then
  echo "codex=not-found" >> "$STARTUP_LOG"
  echo "Notice: Codex CLI was not found."
  echo "The screen can open, but image generation requires Codex CLI setup and login."
  echo ""
else
  echo "codexPath=$(command -v codex)" >> "$STARTUP_LOG"
  echo "codexVersion=$(codex --version 2>&1)" >> "$STARTUP_LOG"
  if ! codex login status >> "$STARTUP_LOG" 2>&1; then
    echo "codexLogin=failed" >> "$STARTUP_LOG"
    echo "Codex CLI is installed, but it looks like you are not logged in."
    echo ""
    echo "Run Codex login now?"
    echo "Press y to start login, or any other key to skip."
    read -k 1 answer
    echo ""
    if [ "$answer" = "y" ] || [ "$answer" = "Y" ]; then
      codex login >> "$STARTUP_LOG" 2>&1
      echo ""
      echo "After login finishes, this app will continue starting."
      echo ""
    else
      echo "Skipping Codex login. Image generation will not work until you run: codex login"
      echo ""
    fi
  else
    echo "codexLogin=ok" >> "$STARTUP_LOG"
  fi
fi

if [ ! -d "node_modules" ]; then
  echo "npmInstall=start" >> "$STARTUP_LOG"
  echo "First setup is running. Please wait..."
  npm install >> "$STARTUP_LOG" 2>&1
  echo "npmInstall=ok" >> "$STARTUP_LOG"
  echo ""
fi

echo "Opening browser: http://127.0.0.1:3000"
(sleep 4; open "http://127.0.0.1:3000") &

echo ""
echo "Server is running."
echo "To stop: press Control + C in this window."
echo ""

echo "npmRunDev=start" >> "$STARTUP_LOG"
npm run dev -- --hostname 127.0.0.1 --port 3000
echo "npmRunDev=ended exit=$?" >> "$STARTUP_LOG"
