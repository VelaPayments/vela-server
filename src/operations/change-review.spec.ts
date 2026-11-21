import {
  checkLockfile,
  checkManifest,
  checkMigrationHistory,
  inspectMigrationSql,
  PackageLockfile,
  PackageManifest,
  parseChangedPaths,
  reviewChangeSet,
  ReviewFinding,
} from './change-review';

const LOCK = '# Prisma\nprovider = "postgresql"\n';
const REGISTRY_ENTRY = {
  resolved: 'https://registry.npmjs.org/left-pad/-/left-pad-1.3.0.tgz',
  integrity: 'sha512-AAAA',
};

function codes(findings: ReviewFinding[]): string[] {
  return findings.map((finding) => finding.code);
}

function lockfileFor(
  manifest: PackageManifest,
  packages: PackageLockfile['packages'] = {},
): PackageLockfile {
  return {
    lockfileVersion: 3,
    packages: {
      '': {
        dependencies: manifest.dependencies,
        devDependencies: manifest.devDependencies,
      },
      ...packages,
    },
  };
}

describe('parseChangedPaths', () => {
  it('reads name-status output, including renames and copies', () => {
    expect(
      parseChangedPaths(
        [
          'A\tprisma/migrations/20261201000000_add_x/migration.sql',
          'M\tpackage.json',
          'R087\tdocs/old.md\tdocs/new.md',
          'C100\tsrc/a.ts\tsrc/b.ts',
          '',
        ].join('\r\n'),
      ),
    ).toEqual([
      {
        path: 'prisma/migrations/20261201000000_add_x/migration.sql',
        status: 'added',
      },
      { path: 'package.json', status: 'modified' },
      { path: 'docs/new.md', previousPath: 'docs/old.md', status: 'renamed' },
      { path: 'src/b.ts', status: 'added' },
    ]);
  });

  it('treats name-only output as unknown status and normalizes separators', () => {
    expect(parseChangedPaths('.\\prisma\\schema.prisma\nM\n')).toEqual([
      { path: 'prisma/schema.prisma', status: 'unknown' },
      { path: 'M', status: 'unknown' },
    ]);
  });
});

describe('checkManifest', () => {
  it('accepts exact, caret and tilde registry versions with explicit scripts', () => {
    expect(
      checkManifest({
        scripts: { build: 'nest build', preview: 'node preview.js' },
        dependencies: { a: '^1.2.3', b: '~0.5.1', c: '2.0.0-rc.1' },
        devDependencies: { d: '30.0.0' },
      }),
    ).toEqual([]);
  });

  it.each([
    'postinstall',
    'prepare',
    'prebuild',
    'poststart',
    'pretest',
    'dependencies',
  ])('rejects the implicit %s hook', (hook) => {
    const findings = checkManifest({
      scripts: { build: 'nest build', [hook]: 'node api.js' },
    });
    expect(findings).toEqual([
      expect.objectContaining({
        severity: 'error',
        code: 'LIFECYCLE_SCRIPT',
        subject: `scripts.${hook}`,
      }),
    ]);
  });

  it.each([
    'latest',
    '*',
    '^1',
    '>=1.0.0',
    'github:user/repo',
    'git+https://example.com/repo.git',
    'https://example.com/pkg.tgz',
    'file:../pkg',
    'npm:other-package@^1.0.0',
  ])('rejects the %s specifier', (spec) => {
    expect(codes(checkManifest({ devDependencies: { pkg: spec } }))).toEqual([
      'NON_REGISTRY_SPEC',
    ]);
  });

  it('warns about overrides', () => {
    expect(checkManifest({ overrides: { semver: '7.6.0' } })).toEqual([
      expect.objectContaining({
        severity: 'warning',
        code: 'VERSION_OVERRIDE',
      }),
    ]);
  });
});

describe('checkLockfile', () => {
  const manifest: PackageManifest = { dependencies: { 'left-pad': '^1.3.0' } };

  it('accepts a synced lockfile resolved from the public registry', () => {
    expect(
      checkLockfile(
        lockfileFor(manifest, {
          'node_modules/left-pad': REGISTRY_ENTRY,
          'node_modules/@prisma/engines': {
            ...REGISTRY_ENTRY,
            hasInstallScript: true,
          },
          'node_modules/workspace-pkg': { link: true },
        }),
        manifest,
      ),
    ).toEqual([]);
  });

  it('rejects other lockfile versions without inspecting entries', () => {
    expect(
      codes(checkLockfile({ lockfileVersion: 2, packages: {} }, manifest)),
    ).toEqual(['LOCKFILE_VERSION']);
  });

  it('reports dependencies missing from or added to the lockfile root', () => {
    const findings = checkLockfile(
      lockfileFor({ dependencies: { 'left-pad': '^1.2.0', extra: '^1.0.0' } }),
      manifest,
    );
    expect(findings.map((finding) => finding.subject)).toEqual([
      'dependencies.extra',
      'dependencies.left-pad',
    ]);
    expect(new Set(codes(findings))).toEqual(new Set(['LOCKFILE_OUT_OF_SYNC']));
  });

  it('rejects non-registry sources, weak integrity and unreviewed install scripts', () => {
    const findings = checkLockfile(
      lockfileFor(manifest, {
        'node_modules/left-pad': {
          resolved: 'https://packages.example.com/left-pad-1.3.0.tgz',
          integrity: 'sha1-AAAA',
        },
        'node_modules/a/node_modules/sneaky': {
          ...REGISTRY_ENTRY,
          hasInstallScript: true,
        },
      }),
      manifest,
    );
    expect(findings.map(({ code, subject }) => [code, subject])).toEqual([
      ['LOCKFILE_SOURCE', 'left-pad'],
      ['LOCKFILE_INTEGRITY', 'left-pad'],
      ['INSTALL_SCRIPT_UNREVIEWED', 'sneaky'],
    ]);
  });
});

describe('checkMigrationHistory', () => {
  it('accepts well-formed, uniquely timestamped migrations', () => {
    expect(
      checkMigrationHistory(
        [
          { name: '20260718215932_ding', hasMigrationSql: true },
          {
            name: '20261107090000_payment_intent_fields',
            hasMigrationSql: true,
          },
        ],
        LOCK,
      ),
    ).toEqual([]);
  });

  it('reports naming, timestamp, duplicate and missing-file problems', () => {
    const findings = checkMigrationHistory(
      [
        { name: 'add_users', hasMigrationSql: true },
        { name: '20260230120000_feb_30th', hasMigrationSql: true },
        { name: '20261107090000_first', hasMigrationSql: true },
        { name: '20261107090000_second', hasMigrationSql: false },
      ],
      LOCK,
    );
    expect(findings.map(({ code, subject }) => [code, subject])).toEqual([
      ['MIGRATION_NAME', 'add_users'],
      ['MIGRATION_TIMESTAMP', '20260230120000_feb_30th'],
      ['MIGRATION_DUPLICATE_TIMESTAMP', '20261107090000_second'],
      ['MIGRATION_SQL_MISSING', '20261107090000_second'],
    ]);
  });

  it.each([['provider = "sqlite"'], ['']])(
    'rejects the migration lock %j',
    (lock) => {
      expect(codes(checkMigrationHistory([], lock))).toEqual([
        'MIGRATION_LOCK_PROVIDER',
      ]);
    },
  );
});

describe('reviewChangeSet', () => {
  const committed = [
    '20260718215932_ding',
    '20261107100000_transaction_history_index',
  ];

  it('requires no checklist for unrelated changes', () => {
    expect(
      reviewChangeSet(parseChangedPaths('M\tsrc/main.ts'), committed),
    ).toEqual({
      dependencyReview: false,
      schemaReview: false,
      addedMigrations: [],
      findings: [],
    });
  });

  it('accepts a new migration that sorts after the existing history', () => {
    const review = reviewChangeSet(
      parseChangedPaths(
        [
          'M\tpackage-lock.json',
          'M\tprisma/schema.prisma',
          'A\tprisma/migrations/20261201000000_add_receipts/migration.sql',
        ].join('\n'),
      ),
      [...committed, '20261201000000_add_receipts'],
    );
    expect(review).toEqual({
      dependencyReview: true,
      schemaReview: true,
      addedMigrations: ['20261201000000_add_receipts'],
      findings: [],
    });
  });

  it.each([
    ['M\tprisma/migrations/20260718215932_ding/migration.sql'],
    ['D\tprisma/migrations/20260718215932_ding/migration.sql'],
    [
      'R100\tprisma/migrations/20260718215932_ding/migration.sql\tprisma/migrations/20261201000000_ding/migration.sql',
    ],
  ])('rejects rewriting applied history: %s', (diff) => {
    expect(
      codes(reviewChangeSet(parseChangedPaths(diff), committed).findings),
    ).toContain('MIGRATION_EDITED');
  });

  it('rejects changes to the provider lock', () => {
    expect(
      codes(
        reviewChangeSet(
          parseChangedPaths('M\tprisma/migrations/migration_lock.toml'),
          committed,
        ).findings,
      ),
    ).toEqual(['MIGRATION_LOCK_CHANGED']);
  });

  it('rejects a new migration that would apply before existing ones', () => {
    const review = reviewChangeSet(
      parseChangedPaths(
        'A\tprisma/migrations/20261101000000_backdated/migration.sql',
      ),
      [...committed, '20261101000000_backdated'],
    );
    expect(review.findings).toEqual([
      expect.objectContaining({
        severity: 'error',
        code: 'MIGRATION_OUT_OF_ORDER',
        subject: '20261101000000_backdated',
      }),
    ]);
  });

  it('warns when statuses are unknown or the schema changed alone', () => {
    expect(
      codes(
        reviewChangeSet(parseChangedPaths('prisma/schema.prisma'), committed)
          .findings,
      ),
    ).toEqual(['CHANGE_STATUS_UNKNOWN', 'SCHEMA_WITHOUT_MIGRATION']);
  });
});

describe('inspectMigrationSql', () => {
  it('passes additive, defaulted columns and plain indexes', () => {
    expect(
      inspectMigrationSql(
        'm',
        `-- Prisma may DROP TABLE things in comments; that is not a statement.
        ALTER TABLE "payments"
          ADD COLUMN "memo" VARCHAR(280),
          ADD COLUMN "network" "StellarNetwork" NOT NULL DEFAULT 'TESTNET';
        /* DELETE FROM payments; */
        CREATE INDEX "payments_status_idx" ON "payments"("status");`,
      ),
    ).toEqual([]);
  });

  it('ignores keywords inside string literals', () => {
    expect(
      inspectMigrationSql(
        'm',
        `ALTER TABLE "t" ADD COLUMN "note" TEXT NOT NULL DEFAULT 'it''s; DROP TABLE x -- no';`,
      ),
    ).toEqual([]);
  });

  it.each([
    ['DROP TABLE "wallets";', 'DESTRUCTIVE_DROP'],
    ['ALTER TABLE "payments" DROP COLUMN "memo";', 'DESTRUCTIVE_DROP'],
    ['DROP INDEX "payments_stellarTxHash_key";', 'INDEX_DROPPED'],
    ['DELETE FROM "used_request_ids";', 'DATA_REWRITE'],
    ['UPDATE "payments" SET "status" = \'FAILED\';', 'DATA_REWRITE'],
    ['ALTER TABLE "users" RENAME COLUMN "email" TO "mail";', 'RENAME'],
    [
      'ALTER TABLE "payments" ALTER COLUMN "amount" SET DATA TYPE DECIMAL(10,2);',
      'COLUMN_TYPE_CHANGE',
    ],
    [
      'ALTER TABLE "payments" ALTER COLUMN "memo" SET NOT NULL;',
      'NOT_NULL_ADDED',
    ],
    [
      'CREATE UNIQUE INDEX "x_key" ON "transactions"("userId", "stellarTxHash");',
      'UNIQUE_CONSTRAINT',
    ],
    [
      'ALTER TABLE "t" ADD CONSTRAINT "t_pkey" PRIMARY KEY ("id");',
      'UNIQUE_CONSTRAINT',
    ],
    ['ALTER TYPE "PaymentStatus" ADD VALUE \'REFUNDED\';', 'ENUM_VALUE_ADDED'],
    ['ALTER TABLE "payments" DISABLE ROW LEVEL SECURITY;', 'ACCESS_CONTROL'],
    ['GRANT SELECT ON "payments" TO anon;', 'ACCESS_CONTROL'],
    [
      'ALTER TABLE "payments" ADD COLUMN "fee" DECIMAL(20,7) NOT NULL, ADD COLUMN "x" TEXT;',
      'NOT_NULL_WITHOUT_DEFAULT',
    ],
  ])('flags %s', (sql, code) => {
    expect(inspectMigrationSql('20261201000000_change', sql)).toEqual([
      expect.objectContaining({
        severity: 'warning',
        code,
        subject: '20261201000000_change statement 1',
      }),
    ]);
  });

  it('numbers findings by statement', () => {
    const findings = inspectMigrationSql(
      'm',
      'CREATE TABLE "a" ("id" TEXT NOT NULL);\nDROP TABLE "b";',
    );
    expect(findings.map((finding) => finding.subject)).toEqual([
      'm statement 2',
    ]);
  });
});
