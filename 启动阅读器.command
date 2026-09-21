#!/bin/sh
# This launcher can be double-clicked in macOS Finder.
PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
export PATH
NOVEL_APP_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if ! command -v node >/dev/null 2>&1; then
  printf '\n需要 Node.js 20 或更新版本。请先从 https://nodejs.org 安装。\n按回车关闭。\n'
  read -r NOVEL_REPLY
  exit 1
fi
exec node "$NOVEL_APP_DIR/bin/novel-code.js" "$@"
