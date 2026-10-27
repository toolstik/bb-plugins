#!/usr/bin/env bash
# Тело автоматизации "Sync bb plugins": берёт свежую версию репозитория и запускает из неё sync.sh,
# поэтому правки sync.sh доходят до всех машин без пересоздания автоматизации.
set -euo pipefail

REPO_URL="${BB_PLUGINS_REPO:-https://github.com/toolstik/bb-plugins.git}"
BRANCH="${BB_PLUGINS_BRANCH:-main}"

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
git clone --quiet --depth 1 --branch "$BRANCH" "$REPO_URL" "$work/repo"
"$work/repo/scripts/sync.sh"
