#!/usr/bin/env bash
# Synthetic Compose rehearsal only. Both original volumes are mounted read-only.
set -euo pipefail
[[ ${DEPLOYMENT_REHEARSAL:-} == disposable ]]
dst=/var/lib/postgresql/19/docker
if [[ $EUID == 0 ]]; then
  [[ -z $(ls -A /var/lib/postgresql) && -z $(ls -A /target-app) ]]
  [[ -s /source-app/.deployment/state.json ]]
  cp -a /source-app/. /target-app/
  src=/source/18/docker
  [[ -d $src ]] || src=/source/data
  [[ $(<"$src/PG_VERSION") == 18 && ! -e "$src/postmaster.pid" ]]
  install -d -o postgres -g postgres -m 0700 "$dst" /work
  cp -a "$src" /work/old
  exec gosu postgres bash /probe.sh
fi

cd /work
umask 077
export PGHOST=/work PGUSER=postgres
old=/usr/lib/postgresql/18/bin
new=/usr/lib/postgresql/19/bin
printf 'local all postgres peer\n' > isolated.hba
opts="-c hba_file=/work/isolated.hba -c listen_addresses='' -k /work"
sql() { "$new/psql" -XqAt -v ON_ERROR_STOP=1 -d postgres "$@"; }
"$old/pg_ctl" -D old -o "$opts" -l /work/old.log -w start
checksum=$(sql -c 'SHOW data_checksums')
case "$checksum" in
  on) flag=--data-checksums ;;
  off) flag=--no-data-checksums ;;
  *) exit 1 ;;
esac
locale=$(sql -c "SELECT datcollate FROM pg_database WHERE datname='template0' AND datlocprovider='c' AND datcollate=datctype")
[[ -n $locale ]]
"$new/initdb" -D "$dst" "$flag" --locale="$locale" --encoding=UTF8 --auth-local=peer --auth-host=scram-sha-256 >/dev/null
fenced="SELECT datname FROM pg_database WHERE NOT datallowconn AND datname<>'template0'"
sql -c "SELECT format('ALTER DATABASE %I ALLOW_CONNECTIONS false;',datname) FROM ($fenced) f" > refence.sql
[[ -s refence.sql ]] # Require an adopted/post-restore fixture.
sql -c "SELECT format('ALTER DATABASE %I ALLOW_CONNECTIONS true;',datname) FROM ($fenced) f" | sql
"$old/pg_ctl" -D old -m fast -w stop
args=(-b "$old" -B "$new" -d /work/old -D "$dst" --socketdir=/work -o "$opts" -O "$opts" --copy)
"$new/pg_upgrade" "${args[@]}" --check
"$new/pg_upgrade" "${args[@]}"
"$new/pg_ctl" -D "$dst" -o "$opts" -l /work/new.log -w start
sql -f refence.sql
"$new/pg_ctl" -D "$dst" -m fast -w stop
# Restore the managed SCRAM-only policy before connecting the application.
cp old/pg_hba.conf "$dst/pg_hba.conf"
