#!/usr/bin/env bash
# Rehearsal image only: model the first boot after Compose replaces the DB.
set -euo pipefail
[[ ${DEPLOYMENT_REHEARSAL:-} == disposable ]]
dst=/var/lib/postgresql/19/docker
done_file="$dst/.sushe-rehearsal-upgraded"
if [[ ! -f $done_file ]]; then
  # The copy worker requires empty destinations and a stopped source.
  # An interrupted copy must fail closed on restart, never run initdb on it.
  bash /probe.sh
  [[ $(<"$dst/PG_VERSION") == 19 && -s "$dst/global/pg_control" ]]
  sync -f "$dst"
  sync -f /target-app
  touch "$done_file"
  sync -f "$dst"
fi
[[ $(<"$dst/PG_VERSION") == 19 && -s "$dst/global/pg_control" && -s /target-app/.deployment/state.json ]]
export PGDATA="$dst"
exec /usr/local/bin/docker-entrypoint.sh "$@"
