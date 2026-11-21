import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  EXIT_FAILED,
  EXIT_PASSED,
  readRepositoryState,
  runChangeReview,
} from './review-repository';

const REPO_ROOT = join(__dirname, '..', '..');

describe('change review against this repository', () => {
  // This is the regression guard: it fails as soon as main gains a lifecycle
  // hook, a non-registry dependency, an unreviewed install script or a
  // malformed migration, even if nobody runs the CLI.
  it('reports no errors for the committed dependency and migration state', () => {
    const { exitCode, report } = runChangeReview(REPO_ROOT, '');

    expect(report).not.toContain('Errors (');
    expect(report).toContain('Result: passed.');
    expect(exitCode).toBe(EXIT_PASSED);
  });

  it('keeps the historical migration IDs', () => {
    const names = readRepositoryState(REPO_ROOT).migrations.map(
      (migration) => migration.name,
    );
    expect(names.slice(0, 3)).toEqual([
      '20260718215932_ding',
      '20261107090000_payment_intent_fields',
      '20261107100000_transaction_history_index',
    ]);
  });

  it('fails when an applied migration is edited', () => {
    const { exitCode, report } = runChangeReview(
      REPO_ROOT,
      'M\tprisma/migrations/20261107090000_payment_intent_fields/migration.sql\n',
    );

    expect(exitCode).toBe(EXIT_FAILED);
    expect(report).toContain('MIGRATION_EDITED');
    expect(report).toContain('Schema/migration review:  required');
  });
});

describe('runChangeReview on a fixture checkout', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'vela-change-review-'));
    const manifest = { dependencies: { 'left-pad': '^1.3.0' } };
    writeFileSync(join(root, 'package.json'), JSON.stringify(manifest));
    writeFileSync(
      join(root, 'package-lock.json'),
      JSON.stringify({
        lockfileVersion: 3,
        packages: {
          '': manifest,
          'node_modules/left-pad': {
            resolved:
              'https://registry.npmjs.org/left-pad/-/left-pad-1.3.0.tgz',
            integrity: 'sha512-AAAA',
          },
        },
      }),
    );
    writeMigration('20260718215932_ding', 'CREATE TABLE "a" ("id" TEXT);');
    writeFileSync(
      join(root, 'prisma', 'migrations', 'migration_lock.toml'),
      'provider = "postgresql"\n',
    );
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function writeMigration(name: string, sql: string): void {
    const directory = join(root, 'prisma', 'migrations', name);
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, 'migration.sql'), sql);
  }

  it('inspects the SQL of an added migration and passes with warnings', () => {
    writeMigration(
      '20261201000000_drop_a',
      'ALTER TABLE "a" ADD COLUMN "b" TEXT NOT NULL;\nDROP TABLE "a";',
    );

    const { exitCode, report } = runChangeReview(
      root,
      'A\tprisma/migrations/20261201000000_drop_a/migration.sql',
    );

    expect(exitCode).toBe(EXIT_PASSED);
    expect(report).toContain('New migrations inspected: 20261201000000_drop_a');
    expect(report).toContain(
      'NOT_NULL_WITHOUT_DEFAULT  20261201000000_drop_a statement 1',
    );
    expect(report).toContain(
      'DESTRUCTIVE_DROP  20261201000000_drop_a statement 2',
    );
    expect(report).toContain('Result: passed with warnings.');
  });

  it('does not read a migration path that is not a directory on disk', () => {
    const { exitCode, report } = runChangeReview(
      root,
      'A\tprisma/migrations/../../../etc/migration.sql',
    );

    expect(exitCode).toBe(EXIT_FAILED);
    expect(report).toContain('MIGRATION_NOT_INSPECTED  ..');
    expect(report).not.toContain('statement 1');
  });

  it('fails on an implicit install hook added to package.json', () => {
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({
        scripts: { postinstall: 'node api.js' },
        dependencies: { 'left-pad': '^1.3.0' },
      }),
    );

    const { exitCode, report } = runChangeReview(root, 'M\tpackage.json');

    expect(exitCode).toBe(EXIT_FAILED);
    expect(report).toContain('Dependency review:        required');
    expect(report).toContain('LIFECYCLE_SCRIPT  scripts.postinstall');
  });
});
