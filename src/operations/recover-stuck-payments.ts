/**
 * Operator entry point for recovering stuck payments.
 *
 * Runs with the server's own environment (database and Horizon access) instead
 * of an HTTP endpoint, so recovery adds no new remotely reachable privilege.
 * See docs/operator-recovery.md for when and how to use it.
 */
import { parseRecoveryArgs, RECOVERY_USAGE } from './recovery-args';

type RunnerModule = typeof import('./recovery-runner');

// Kept in sync with EXIT_USAGE in recovery-runner; duplicated so this file
// never has to load the runner just to report a usage error.
const EXIT_USAGE = 2;

async function main(): Promise<number> {
  const parsed = parseRecoveryArgs(process.argv.slice(2));
  if (parsed.kind === 'help') {
    console.log(RECOVERY_USAGE);
    return 0;
  }
  if (parsed.kind === 'error') {
    console.error(`${parsed.message}\n\n${RECOVERY_USAGE}`);
    return EXIT_USAGE;
  }

  // Loaded only once arguments are valid: importing AppModule validates the
  // full server environment, which --help and usage errors should not need.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { runRecovery } = require('./recovery-runner') as RunnerModule;
  return runRecovery(parsed.options);
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    // Config validation and connection errors name variables and hosts, not
    // secret values, so the message is safe and is what an operator needs.
    console.error(
      `Payment recovery aborted: ${error instanceof Error ? error.message : 'unknown error'}`,
    );
    process.exitCode = 1;
  });
