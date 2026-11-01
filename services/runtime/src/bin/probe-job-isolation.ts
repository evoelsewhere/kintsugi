// Checks on this host that job processes cannot read the worker's secrets (ADR-0093). Run in the worker container by
// deploy/compose/probe-job-isolation.sh, which starts it with a random KINTSUGI_PROBE_SECRET. Exit codes: 0 isolated,
// 1 exposed, 3 cannot be checked here (not Linux, job user not set, worker not root, no probe secret).

import { probeJobIsolation } from "../launcher/isolation-probe.js";
import { interpretersFromEnv } from "../launcher/script.js";

const EXIT = { isolated: 0, exposed: 1, unsupported: 3 } as const;

probeJobIsolation({ interpreters: interpretersFromEnv() }).then(
  (result) => {
    for (const line of result.lines) console.log(`probe: ${line}`);
    console.log(`probe: ${result.status}`);
    process.exitCode = EXIT[result.status];
  },
  (error: unknown) => {
    console.error(`probe: could not run: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 3;
  },
);
