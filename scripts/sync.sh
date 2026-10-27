#!/usr/bin/env bash
# Приводит набор плагинов bb на этой машине к списку из репозитория.
#
# - Свой плагин из plugins/<id>, которого нет на машине, ставится из git (ветка main).
# - Свой плагин, установленный из git, обновляется, когда в main появился новый коммит.
# - Плагин, установленный с локального пути (path:), не трогается: это рабочая копия для разработки.
# - Сторонние плагины из external-plugins.txt ставятся, если их нет, и обновляются в пределах своего диапазона.
#
# Печатает только то, что изменил, поэтому прогоны без изменений в автоматизации считаются тихими.
set -euo pipefail

REPO_URL="${BB_PLUGINS_REPO:-https://github.com/toolstik/bb-plugins.git}"
BRANCH="${BB_PLUGINS_BRANCH:-main}"
BB="${BB_CLI:-bb}"

repo=$(cd "$(dirname "$0")/.." && pwd)

list=$("$BB" plugin list --json)
outdated=$("$BB" plugin outdated --json | jq -r '.[] | select(.outcome == "available") | .id')
failed=0

run() {
  local id=$1 action=$2; shift 2
  local out
  if out=$("$BB" plugin "$action" "$@" --yes 2>&1); then
    echo "$action $id"
  else
    echo "$action $id failed:"
    echo "$out"
    failed=1
  fi
}

ensure() {
  local id=$1 src=$2; shift 2
  local cur
  cur=$(jq -r --arg id "$id" '.plugins[] | select(.id == $id) | .source' <<<"$list")
  if [ -z "$cur" ]; then
    run "$id" install "$src" "$@"
  elif [[ $cur != path:* ]] && grep -qx "$id" <<<"$outdated"; then
    run "$id" update "$id"
  fi
}

for dir in "$repo"/plugins/*/; do
  id=$(basename "$dir")
  ensure "$id" "git:$REPO_URL@$BRANCH" --subdirectory "plugins/$id"
done

while read -r id src; do
  if [ -z "$id" ] || [[ $id == \#* ]]; then continue; fi
  ensure "$id" "$src"
done <"$repo/external-plugins.txt"

exit $failed
