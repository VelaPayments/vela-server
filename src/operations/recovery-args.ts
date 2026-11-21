import { RECOVERY_MAX_LIMIT } from '../modules/payments/payment-recovery.service';

export const DEFAULT_OLDER_THAN_MINUTES = 30;
export const DEFAULT_RECOVERY_LIMIT = 50;
// One year. Anything larger is almost certainly a typo, and very large values
// would push the cutoff outside the range a JavaScript Date can represent.
const MAX_OLDER_THAN_MINUTES = 525_600;

export const RECOVERY_USAGE = `Usage: npm run recover:payments -- [options]

Finds payments stuck in CREATED, AUTHORIZED or SUBMITTED and reports what
recovery would do. Nothing is written unless --apply is passed.

Options:
  --apply                    Write state changes (default: dry run)
  --older-than-minutes <n>   Only consider payments created at least n minutes
                             ago (default: ${DEFAULT_OLDER_THAN_MINUTES})
  --limit <n>                Maximum payments to inspect, 1-${RECOVERY_MAX_LIMIT} (default: ${DEFAULT_RECOVERY_LIMIT})
  --help                     Show this message`;

export interface RecoveryCliOptions {
  apply: boolean;
  olderThanMs: number;
  limit: number;
}

export type ParsedRecoveryArgs =
  | { kind: 'run'; options: RecoveryCliOptions }
  | { kind: 'help' }
  | { kind: 'error'; message: string };

/**
 * Parses operator CLI arguments. Accepts `--flag value` and `--flag=value`, and
 * rejects anything unrecognised so a mistyped `--aply` can never silently
 * become a dry run the operator believes was applied (or vice versa).
 */
export function parseRecoveryArgs(argv: readonly string[]): ParsedRecoveryArgs {
  let apply = false;
  let olderThanMinutes = DEFAULT_OLDER_THAN_MINUTES;
  let limit = DEFAULT_RECOVERY_LIMIT;

  for (let index = 0; index < argv.length; index += 1) {
    const [flag, inlineValue] = splitFlag(argv[index]);

    if (flag === '--help' || flag === '-h') return { kind: 'help' };

    if (flag === '--apply') {
      if (inlineValue !== undefined) {
        return { kind: 'error', message: '--apply does not take a value.' };
      }
      apply = true;
      continue;
    }

    if (flag !== '--older-than-minutes' && flag !== '--limit') {
      return { kind: 'error', message: `Unknown option: ${flag}` };
    }

    let rawValue = inlineValue;
    if (rawValue === undefined) {
      index += 1;
      rawValue = argv[index];
    }
    const max =
      flag === '--limit' ? RECOVERY_MAX_LIMIT : MAX_OLDER_THAN_MINUTES;
    const value = parseBoundedInteger(rawValue, max);
    if (value === undefined) {
      return {
        kind: 'error',
        message: `${flag} must be an integer between 1 and ${max}.`,
      };
    }

    if (flag === '--limit') limit = value;
    else olderThanMinutes = value;
  }

  return {
    kind: 'run',
    options: { apply, olderThanMs: olderThanMinutes * 60_000, limit },
  };
}

function splitFlag(arg: string): [flag: string, value: string | undefined] {
  const separator = arg.indexOf('=');
  return separator === -1
    ? [arg, undefined]
    : [arg.slice(0, separator), arg.slice(separator + 1)];
}

function parseBoundedInteger(
  raw: string | undefined,
  max: number,
): number | undefined {
  // Digits only: Number() would otherwise accept "1e3", "0x10" or " 5 ".
  if (raw === undefined || !/^\d+$/.test(raw)) return undefined;
  const value = Number(raw);
  return value >= 1 && value <= max ? value : undefined;
}
