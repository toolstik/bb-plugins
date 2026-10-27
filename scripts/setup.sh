#!/usr/bin/env bash
# Первичная настройка машины: ставит плагины и создаёт автоматизацию, которая раз в час их синхронизирует.
# Повторный запуск безопасен: существующая автоматизация не дублируется.
set -euo pipefail

NAME="Sync bb plugins"
PROJECT=proj_personal
BB="${BB_CLI:-bb}"

here=$(cd "$(dirname "$0")" && pwd)

"$here/sync.sh"

# Настройки машины, которые нужны плагинам (см. plugins/new-chat-personal/README.md).
"$BB" settings keyboard set thread.new disabled >/dev/null
"$BB" settings keyboard set plugin:new-chat-personal/new-chat Mod+Shift+O >/dev/null

if "$BB" automation list --project "$PROJECT" --json | jq -e --arg n "$NAME" 'any(.[]; .name == $n)' >/dev/null; then
  echo "Automation \"$NAME\" already exists"
  exit 0
fi

tz=$(readlink /etc/localtime | sed 's#.*/zoneinfo/##')
"$BB" automation create --project "$PROJECT" --name "$NAME" \
  --cron "17 * * * *" --timezone "${tz:-UTC}" \
  --script-file "$here/automation.sh" --interpreter bash --timeout 15m
