import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  checkLockfile,
  checkManifest,
  checkMigrationHistory,
  inspectMigrationSql,
  MIGRATIONS_DIR,
  MigrationDirectory,
  PackageLockfile,
  PackageManifest,
  parseChangedPaths,
  reviewChangeSet,
  ReviewFinding,
} from './change-review';

export const EXIT_PASSED = 0;
export const EXIT_FAILED = 1;
export const EXIT_USAGE = 2;

const GUIDE = 'docs/change-review.md';

export interface RepositoryState {
  manifest: PackageManifest;
  lockfile: PackageLockfile;
  migrations: MigrationDirectory[];
  migrationLock: string;
}

export interface ChangeReviewResult {
  exitCode: number;
  report: string;
}

/** Reads the files the review needs. Throws if any of them is missing. */
export function readRepositoryState(root: string): RepositoryState {
  const migrationsPath = join(root, MIGRATIONS_DIR);
  const migrations = readdirSync(migrationsPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      name: entry.name,
      hasMigrationSql: existsSync(
        join(migrationsPath, entry.name, 'migration.sql'),
      ),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));

  return {
    manifest: readJson<PackageManifest>(join(root, 'package.json')),
    lockfile: readJson<PackageLockfile>(join(root, 'package-lock.json')),
    migrations,
    migrationLock: readFileSync(
      join(migrationsPath, 'migration_lock.toml'),
      'utf8',
    ),
  };
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

/**
 * Runs every check against the checkout at `root` for the change set described
 * by `diffText` (git diff --name-status output). Repository-wide checks run
 * even for an empty diff, so the command is also a plain health check.
 */
export function runChangeReview(
  root: string,
  diffText: string,
): ChangeReviewResult {
  const state = readRepositoryState(root);
  const committed = state.migrations.map((migration) => migration.name);
  const changeSet = reviewChangeSet(parseChangedPaths(diffText), committed);

  const findings: ReviewFinding[] = [
    ...checkManifest(state.manifest),
    ...checkLockfile(state.lockfile, state.manifest),
    ...checkMigrationHistory(state.migrations, state.migrationLock),
    ...changeSet.findings,
  ];

  for (const name of changeSet.addedMigrations) {
    // Only names found on disk are read, so a crafted diff line cannot point
    // the reader outside prisma/migrations.
    const directory = state.migrations.find(
      (migration) => migration.name === name,
    );
    if (directory?.hasMigrationSql) {
      const sql = readFileSync(
        join(root, MIGRATIONS_DIR, name, 'migration.sql'),
        'utf8',
      );
      findings.push(...inspectMigrationSql(name, sql));
    } else {
      findings.push({
        severity: 'warning',
        code: 'MIGRATION_NOT_INSPECTED',
        subject: name,
        message:
          'Listed in the diff but not present in this checkout; run the review on the PR branch.',
      });
    }
  }

  const errors = findings.filter((finding) => finding.severity === 'error');
  const warnings = findings.filter((finding) => finding.severity === 'warning');

  const lines = [
    `Change review (see ${GUIDE})`,
    '',
    `Dependency review:        ${requirement(changeSet.dependencyReview)}`,
    `Schema/migration review:  ${requirement(changeSet.schemaReview)}`,
    `New migrations inspected: ${changeSet.addedMigrations.join(', ') || 'none'}`,
    ...formatSection('Errors', errors),
    ...formatSection('Warnings', warnings),
    '',
    errors.length > 0
      ? 'Result: failed. Fix the errors above.'
      : warnings.length > 0
        ? 'Result: passed with warnings. Answer each warning in the pull request.'
        : 'Result: passed.',
  ];

  return {
    exitCode: errors.length > 0 ? EXIT_FAILED : EXIT_PASSED,
    report: lines.join('\n'),
  };
}

function requirement(required: boolean): string {
  return required ? 'required' : 'not required';
}

function formatSection(title: string, findings: ReviewFinding[]): string[] {
  if (findings.length === 0) return [];
  return [
    '',
    `${title} (${findings.length})`,
    ...findings.flatMap((finding) => [
      `  ${finding.code}  ${finding.subject}`,
      `    ${finding.message}`,
    ]),
  ];
}
