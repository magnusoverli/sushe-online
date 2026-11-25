#!/usr/bin/env bash
# Published Compose mounts the parent volume. Older revisions of this wrapper
# exported /data even on PG18; fresh official images use <major>/docker.
# A server restart must never migrate, delete, or silently replace a cluster.
set -euo pipefail
shopt -s nullglob dotglob

refuse() {
  echo "PostgreSQL startup refused: $1. Inspect the volume offline." >&2
  exit 1
}

root=/var/lib/postgresql
version=$(postgres --version)
[[ $version =~ PostgreSQL\)\ (18|19)\. ]] || refuse 'unsupported server major'
major=${BASH_REMATCH[1]}
standard="$root/$major/docker"
legacy="$root/data"
case "${PGDATA:-$standard}" in
  "$standard"|"$legacy") ;;
  *) refuse 'unexpected configured data directory' ;;
esac

selected=''
for entry in "$root"/*; do
  [[ -d "$entry" && ! -L "$entry" ]] || refuse 'unexpected volume entry'
  case "$entry" in
    "$root/lost+found") continue ;;
    "$legacy") candidate=$legacy ;;
    "$root/$major")
      for child in "$entry"/*; do
        [[ $child == "$standard" && -d "$child" && ! -L "$child" ]] ||
          refuse 'unexpected entry in versioned directory'
      done
      candidate=$standard ;;
    *) refuse 'different major or unrecognized volume layout' ;;
  esac
  children=("$candidate"/*)
  ((${#children[@]})) || continue
  [[ -f "$candidate/PG_VERSION" && ! -L "$candidate/PG_VERSION" &&
     $(<"$candidate/PG_VERSION") == "$major" &&
     -f "$candidate/global/pg_control" ]] || refuse 'incomplete or incompatible cluster'
  [[ -z $selected ]] || refuse 'multiple clusters on the same volume'
  selected=$candidate
done

# Completed copy-based cutovers must never initialize an empty replacement.
if [[ -n ${SUSHE_PG19_CUTOVER_ID:-} ]]; then
  receipt="$standard/.sushe-tower19-complete"
  [[ $SUSHE_PG19_CUTOVER_ID =~ ^[0-9]+$ && $major == 19 && $selected == "$standard" &&
     -s "$standard/global/pg_control" && -f "$receipt" && ! -L "$receipt" &&
     $(<"$receipt") == "$SUSHE_PG19_CUTOVER_ID" ]] || refuse 'expected completed PostgreSQL 19 cutover'
fi

export PGDATA=${selected:-${PGDATA:-$standard}}
exec /usr/local/bin/docker-entrypoint.sh "$@"
