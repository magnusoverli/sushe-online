#!/usr/bin/env bash
# Only the official PG19 layout is supported. Never initialize a replacement
# if an existing cluster is at an unexpected path.
set -euo pipefail
shopt -s nullglob dotglob

refuse() {
  echo "PostgreSQL startup refused: $1. Inspect the volume offline." >&2
  exit 1
}

root=/var/lib/postgresql
version=$(postgres --version)
[[ $version =~ PostgreSQL\)\ 19\. ]] || refuse 'PostgreSQL 19 is required'
standard="$root/19/docker"
[[ ${PGDATA:-$standard} == "$standard" ]] || refuse 'unexpected configured data directory'

for entry in "$root"/*; do
  [[ -d "$entry" && ! -L "$entry" ]] || refuse 'unexpected volume entry'
  case "$entry" in
    "$root/lost+found") continue ;;
    "$root/19")
      for child in "$entry"/*; do
        [[ $child == "$standard" && -d "$child" && ! -L "$child" ]] ||
          refuse 'unexpected entry in versioned directory'
      done
      ;;
    *) refuse 'different major or unrecognized volume layout' ;;
  esac
done
children=("$standard"/*)
if ((${#children[@]})); then
  [[ -f "$standard/PG_VERSION" && ! -L "$standard/PG_VERSION" &&
     $(<"$standard/PG_VERSION") == 19 &&
     -f "$standard/global/pg_control" ]] || refuse 'incomplete or incompatible cluster'
fi

# Completed copy-based cutovers must never initialize an empty replacement.
if [[ -n ${SUSHE_PG19_CUTOVER_ID:-} ]]; then
  receipt="$standard/.sushe-tower19-complete"
  [[ $SUSHE_PG19_CUTOVER_ID =~ ^[0-9]+$ &&
     -s "$standard/global/pg_control" && -f "$receipt" && ! -L "$receipt" &&
     $(<"$receipt") == "$SUSHE_PG19_CUTOVER_ID" ]] || refuse 'expected completed PostgreSQL 19 cutover'
fi

export PGDATA=$standard
exec /usr/local/bin/docker-entrypoint.sh "$@"
