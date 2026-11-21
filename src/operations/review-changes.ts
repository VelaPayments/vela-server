/**
 * Contributor entry point for the dependency and migration review checks.
 *
 *   git diff --name-status origin/main...HEAD | npm run review:changes
 *
 * Reads only local files and stdin: no git invocation, network or database.
 * See docs/change-review.md for what each finding means.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { EXIT_FAILED, EXIT_USAGE, runChangeReview } from './review-repository';

const USAGE = `Usage: git diff --name-status <base>...HEAD | npm run review:changes

Checks package.json, package-lock.json and prisma/migrations against the rules
in docs/change-review.md and lists which review checklists the change needs.

Options:
  --help    Show this message`;

function main(): number {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log(USAGE);
    return 0;
  }
  if (args.length > 0) {
    console.error(`Unknown option: ${args[0]}\n\n${USAGE}`);
    return EXIT_USAGE;
  }
  // Without a pipe, reading stdin would wait for keyboard input forever.
  if (process.stdin.isTTY) {
    console.error(`Pipe a git diff into this command.\n\n${USAGE}`);
    return EXIT_USAGE;
  }

  const root = resolve(__dirname, '..', '..');
  const { exitCode, report } = runChangeReview(root, readFileSync(0, 'utf8'));
  console.log(report);
  return exitCode;
}

try {
  process.exitCode = main();
} catch (error: unknown) {
  // Only local file errors reach here (missing or malformed package files).
  console.error(
    `Change review aborted: ${error instanceof Error ? error.message : 'unknown error'}`,
  );
  process.exitCode = EXIT_FAILED;
}
