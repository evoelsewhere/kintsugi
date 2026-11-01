#!/usr/bin/env sh
# Checks that a job process cannot read the worker's secrets on this host (ADR-0093): starts the worker image with
# docker-compose.isolated.yml and a random marker secret, runs a script step and a shell child as the job user the way
# jobs run, and fails if either can read the worker's environment.
# Exit codes: 0 isolated, 1 exposed, 2 Docker is not available here, 3 not verified (worker not set up, probe did not run).
set -u
cd "$(dirname "$0")" || exit 2

if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  echo "probe: Docker with the compose plugin is not available on this host: job isolation is NOT verified" >&2
  exit 2
fi

secret=$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')
log=$(mktemp)
trap 'rm -f "$log"' EXIT
docker compose -f docker-compose.yml -f docker-compose.isolated.yml run --rm --no-deps -T \
  -e KINTSUGI_PROBE_SECRET="$secret" worker node services/runtime/dist/bin/probe-job-isolation.js 2>&1 | tee "$log"

# The verdict is the probe's own last line: a compose or image error is "not verified", never "exposed".
case $(tail -n 1 "$log") in
  "probe: isolated") echo "probe: PASSED: job processes cannot read the worker's secrets on this host"; exit 0 ;;
  "probe: exposed") echo "probe: FAILED: a job process can read the worker's secrets; do not run untrusted code here" >&2; exit 1 ;;
  "probe: unsupported") echo "probe: NOT VERIFIED: the worker is not set up for job isolation (see the lines above)" >&2; exit 3 ;;
  *) echo "probe: NOT VERIFIED: the probe did not run (see the lines above)" >&2; exit 3 ;;
esac
