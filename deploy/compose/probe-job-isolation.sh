#!/usr/bin/env sh
# Checks that a job process cannot read the worker's secrets on this host (ADR-0093). It runs the probe twice in the
# worker image, each time with a random marker secret in the worker's environment and a script step and a shell child
# started the way jobs start:
#   1. with docker-compose.isolated.yml, as the job user: the children must NOT be able to read the marker;
#   2. the control, without the override, as the worker's own user: the children MUST be able to read it, or the probe
#      cannot see exposure on this host and its first answer proves nothing.
# Exit codes: 0 isolated (and the control saw exposure), 1 exposed, 2 Docker is not available here,
# 3 not verified (the worker is not set up for it, the probe did not run, or the control saw no exposure).
set -u
cd "$(dirname "$0")" || exit 2

if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  echo "probe: Docker with the compose plugin is not available on this host: job isolation is NOT verified" >&2
  exit 2
fi

log=$(mktemp)
trap 'rm -f "$log"' EXIT

# Runs the probe with the compose files given; prints its lines and leaves its verdict (its last line) in $verdict.
probe() {
  secret=$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')
  docker compose "$@" run --rm --no-deps -T -e KINTSUGI_PROBE_SECRET="$secret" worker \
    node services/runtime/dist/bin/probe-job-isolation.js ${control:-} 2>&1 | tee "$log"
  verdict=$(tail -n 1 "$log")
}

echo "probe: 1/2 with docker-compose.isolated.yml (jobs as the job user)"
control=""
probe -f docker-compose.yml -f docker-compose.isolated.yml
main=$verdict
# The verdict is the probe's own last line: a compose or image error is "not verified", never "exposed".
case $main in
  "probe: isolated") ;;
  "probe: exposed") echo "probe: FAILED: a job process can read the worker's secrets; do not run untrusted code here" >&2; exit 1 ;;
  "probe: unsupported") echo "probe: NOT VERIFIED: the worker is not set up for job isolation (see the lines above)" >&2; exit 3 ;;
  *) echo "probe: NOT VERIFIED: the probe did not run (see the lines above)" >&2; exit 3 ;;
esac

echo "probe: 2/2 control without the override (jobs as the worker's user)"
control="--control"
probe -f docker-compose.yml
case $verdict in
  "probe: exposed") echo "probe: PASSED: job processes cannot read the worker's secrets on this host (isolated: $main; control without the override: $verdict)"; exit 0 ;;
  "probe: isolated") echo "probe: NOT VERIFIED: the probe cannot detect exposure on this host (the control without the override was not exposed)" >&2; exit 3 ;;
  *) echo "probe: NOT VERIFIED: the control run did not run (see the lines above)" >&2; exit 3 ;;
esac
