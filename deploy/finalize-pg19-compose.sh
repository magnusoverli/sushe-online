#!/usr/bin/env bash
# Run in the existing Compose Manager project after a successful two-volume
# cutover. Produce a validated base file for the next deployment; never start,
# stop or remove anything. Keep docker-compose.override.yml and .env in place.
# bash finalize-pg19-compose.sh PROJECT > docker-compose.pg19.next.yml
set -euo pipefail
umask 077
project=${1:?Specify the running Compose project name}
files=(-f docker-compose.yml)
[[ ! -f docker-compose.override.yml ]] || files+=(-f docker-compose.override.yml)
compose=(docker compose --project-directory "$PWD" -p "$project")
current=$("${compose[@]}" "${files[@]}" config --format json)
get() { jq -er "$1" <<<"$current"; }
id=$(get '.services["db-migrate-19"].environment.SOURCE_SYSTEM_ID')
[[ $id =~ ^[0-9]+$ ]]
image=ghcr.io/magnusoverli/sushe-online-postgres:19
db=$("${compose[@]}" "${files[@]}" ps -q db)
app=$("${compose[@]}" "${files[@]}" ps -q app)
verify_volume() {
  local logical=$1 target=$2 container=$3 expected actual
  expected=$(get ".volumes[\"$logical\"].name")
  actual=$(docker inspect "$container" | jq -er --arg target "$target" '.[0].Mounts[] | select(.Type == "volume" and .Destination == $target) | .Name')
  [[ $expected == "$actual" ]]
}
verify_volume postgres-data /var/lib/postgresql "$db"
verify_volume sushe-data /app/data "$app"
verify_volume postgres-socket /var/run/postgresql "$db"
verify_volume postgres-socket /var/run/postgresql "$app"
[[ $(docker exec "$db" cat /var/lib/postgresql/19/docker/.sushe-tower19-complete) == "$id" ]]
[[ $(docker exec "$app" cat /app/data/.deployment/.sushe-tower19-complete) == "$id" ]]

# Edit the original, unexpanded YAML so secrets, variable interpolation, and
# host overrides survive. Compare the entire resolved model before emitting it.
next=$(mktemp ./.pg19-next.XXXXXXXX)
trap 'rm -f "$next"' EXIT
awk -v id="$id" -v image="$image" '
  /^[^ #]/ { section=$1; block=""; key="" }
  /^  [^ ]/ { block=$1; key="" }
  /^    [^ ]/ { key=$1 }
  section=="services:" && block=="db-migrate-19:" { next }
  section=="volumes:" && (block=="source18:" || block=="sourceapp18:") { next }
  block=="db:" && (key=="entrypoint:" || key=="depends_on:") { next }
  block=="db:" && /:\/sushe-pg19-guard.sh:ro[[:space:]]*$/ { next }
  block=="db:" && key=="image:" { print "    image: " image; next }
  block=="app:" && /- PG_MAJOR=18[[:space:]]*$/ { print "      - PG_MAJOR=19"; next }
  { print }
  block=="app:" && /^    environment:$/ { print "      - SUSHE_PG19_CUTOVER_ID=" id }
  block=="db:" && /^    environment:$/ { print "      SUSHE_PG19_CUTOVER_ID: \"" id "\"" }
' docker-compose.yml > "$next"
files[1]=$next
actual=$("${compose[@]}" "${files[@]}" config --format json)
expected=$(jq -ce --arg id "$id" --arg image "$image" '
  select(.services.db.depends_on["db-migrate-19"].condition == "service_completed_successfully")
  | select(.services.db.entrypoint == ["/bin/bash","/sushe-pg19-guard.sh"])
  | select(.services.app.image == "ghcr.io/magnusoverli/sushe-online:latest")
  | del(.services["db-migrate-19"], .services.db.depends_on, .services.db.entrypoint, .volumes.source18, .volumes.sourceapp18)
  | .services.db.image=$image
  | .services.db.volumes |= map(select(.target != "/sushe-pg19-guard.sh"))
  | .services.db.environment.SUSHE_PG19_CUTOVER_ID=$id
  | .services.app.environment.SUSHE_PG19_CUTOVER_ID=$id
  | .services.app.environment.PG_MAJOR="19"
' <<<"$current")
# Compose versions differ on whether an unset entrypoint is omitted or null.
normalize='del(.services.db.entrypoint | select(. == null))'
[[ $(jq -Sc "$normalize" <<<"$actual") == "$(jq -Sc "$normalize" <<<"$expected")" ]] || {
  echo 'Unexpected Compose differences; no configuration emitted.' >&2; exit 1;
}
cat "$next"
