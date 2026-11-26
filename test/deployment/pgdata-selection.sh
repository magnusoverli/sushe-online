#!/usr/bin/env bash
# Run only in a disposable container with /var/lib/postgresql on tmpfs.
set -euo pipefail
root=/var/lib/postgresql
[[ $(stat -f -c %T "$root") == tmpfs && -z $(ls -A "$root") ]]
wrapper=/usr/local/bin/docker-entrypoint-upgrade.sh
select_dir() { bash "$wrapper" sh -c 'printf "%s" "$PGDATA"'; }
refused() {
  if select_dir >/dev/null 2>&1; then
    echo "Expected startup refusal: $1" >&2; exit 1
  fi
}
marker() {
  mkdir -p "$1/global"
  echo "$2" > "$1/PG_VERSION"
  touch "$1/global/pg_control"
}
current="$root/$PG_MAJOR/docker"
[[ $(select_dir) == "$current" ]]
export SUSHE_PG19_CUTOVER_ID=123456
refused empty-cutover-target
unset SUSHE_PG19_CUTOVER_ID
marker "$root/data" "$PG_MAJOR"
refused nonstandard-layout
marker "$current" "$PG_MAJOR"
refused ambiguous
mv "$root/data" /tmp/retained
[[ $(select_dir) == "$current" ]]
export SUSHE_PG19_CUTOVER_ID=123456
printf x > "$current/global/pg_control"
refused missing-cutover-receipt
echo 999 > "$current/.sushe-tower19-complete"
refused mismatched-cutover-receipt
echo 123456 > "$current/.sushe-tower19-complete"
[[ $(select_dir) == "$current" ]]
unset SUSHE_PG19_CUTOVER_ID
mv "$current/PG_VERSION" "$current/saved"
refused incomplete
mv "$current/saved" "$current/PG_VERSION"
echo 17 > "$current/PG_VERSION"
refused incompatible
[[ $(<"$current/PG_VERSION") == 17 && -e "$current/global/pg_control" ]]
mv "$root/$PG_MAJOR" /tmp/other
mkdir "$root/17"
refused old-major-directory
echo 'PGDATA selection and refusal checks passed'
