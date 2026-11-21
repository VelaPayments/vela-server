/**
 * Deterministic checks behind docs/change-review.md.
 *
 * Everything here is a pure function over file contents so it can run in unit
 * tests and in CI without a database, network access or git. The CLI in
 * review-changes.ts does the file reading.
 *
 * Findings come in two severities:
 * - `error`: the change breaks a repository rule and must be fixed.
 * - `warning`: the change is allowed but needs the matching item in the review
 *   guide answered in the pull request.
 */

export type FindingSeverity = 'error' | 'warning';

export interface ReviewFinding {
  severity: FindingSeverity;
  code: string;
  subject: string;
  message: string;
}

export type ChangeStatus =
  'added' | 'modified' | 'deleted' | 'renamed' | 'unknown';

export interface ChangedPath {
  path: string;
  status: ChangeStatus;
  previousPath?: string;
}

export const MIGRATIONS_DIR = 'prisma/migrations/';
const MIGRATION_LOCK_PATH = `${MIGRATIONS_DIR}migration_lock.toml`;
const MIGRATION_NAME_PATTERN = /^(\d{14})_[a-z0-9_]+$/;
const EXPECTED_DATABASE_PROVIDER = 'postgresql';

const DEPENDENCY_PATHS = new Set([
  'package.json',
  'package-lock.json',
  'npm-shrinkwrap.json',
  '.npmrc',
]);
const SCHEMA_PATHS = new Set(['prisma/schema.prisma', 'prisma/rls.sql']);

const TRUSTED_REGISTRY = 'https://registry.npmjs.org/';
const SUPPORTED_LOCKFILE_VERSION = 3;

/**
 * Packages whose install scripts a maintainer has already read. npm runs these
 * scripts on every `npm ci`, including in CI, so a new entry is a supply-chain
 * decision and must be added here deliberately, with the reason in the PR.
 */
export const REVIEWED_INSTALL_SCRIPTS: ReadonlySet<string> = new Set([
  '@prisma/client', // generates the client into node_modules
  '@prisma/engines', // downloads the query engine for the host platform
  '@scarf/scarf', // install analytics pulled in by swagger-ui-dist
  'fsevents', // macOS-only optional native watcher
  'prisma', // CLI engine preparation
  'unrs-resolver', // optional native resolver used by the Jest toolchain
]);

// npm runs `pre<x>`/`post<x>` around these commands even when no script named
// <x> exists, and runs the install hooks on every `npm ci`.
const NPM_LIFECYCLE_COMMANDS = [
  'install',
  'uninstall',
  'publish',
  'pack',
  'version',
  'test',
  'start',
  'stop',
  'restart',
  'shrinkwrap',
];
const ALWAYS_RUN_SCRIPTS = new Set([
  'preinstall',
  'install',
  'postinstall',
  'prepare',
  'prepublish',
  'prepublishOnly',
  'prepack',
  'postpack',
  'dependencies',
]);

// Exact versions, or caret/tilde ranges, resolved from the registry. Anything
// else (git URLs, tarballs, local paths, aliases, `*`, `latest`) bypasses the
// lockfile integrity and the dependency-review action's advisory lookup.
const REGISTRY_VERSION_SPEC = /^[~^]?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

export interface PackageManifest {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  overrides?: unknown;
  resolutions?: unknown;
}

interface LockfileEntry {
  resolved?: string;
  integrity?: string;
  link?: boolean;
  inBundle?: boolean;
  hasInstallScript?: boolean;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

export interface PackageLockfile {
  lockfileVersion?: number;
  packages?: Record<string, LockfileEntry>;
}

export interface MigrationDirectory {
  name: string;
  hasMigrationSql: boolean;
}

const INSTALLED_DEPENDENCY_FIELDS = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
] as const;

/**
 * Parses `git diff --name-only` or `git diff --name-status` output. Plain paths
 * get status `unknown`, which disables the checks that need to know whether a
 * file is new.
 */
export function parseChangedPaths(input: string): ChangedPath[] {
  const changes: ChangedPath[] = [];

  for (const rawLine of input.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '') continue;

    const fields = line.split('\t');
    const statusCode = /^([ACDMRTUX])\d*$/.exec(fields[0])?.[1];
    if (statusCode === undefined || fields.length < 2) {
      changes.push({ path: normalizePath(line), status: 'unknown' });
      continue;
    }

    if (statusCode === 'R' && fields.length >= 3) {
      changes.push({
        path: normalizePath(fields[2]),
        previousPath: normalizePath(fields[1]),
        status: 'renamed',
      });
      continue;
    }

    // A copy leaves the source untouched, so only the destination matters.
    const path = normalizePath(fields[fields.length - 1]);
    changes.push({ path, status: toChangeStatus(statusCode) });
  }

  return changes;
}

function toChangeStatus(code: string): ChangeStatus {
  switch (code) {
    case 'A':
    case 'C':
      return 'added';
    case 'D':
      return 'deleted';
    case 'M':
    case 'T':
      return 'modified';
    default:
      return 'unknown';
  }
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '');
}

export function isDependencyPath(path: string): boolean {
  return DEPENDENCY_PATHS.has(path);
}

export function isSchemaPath(path: string): boolean {
  return SCHEMA_PATHS.has(path) || path.startsWith(MIGRATIONS_DIR);
}

/**
 * Returns the migration directory name for `prisma/migrations/<name>/...`, or
 * undefined for paths directly inside (or outside) the migrations directory.
 */
export function migrationNameOf(path: string): string | undefined {
  if (!path.startsWith(MIGRATIONS_DIR)) return undefined;
  const rest = path.slice(MIGRATIONS_DIR.length);
  const separator = rest.indexOf('/');
  return separator > 0 ? rest.slice(0, separator) : undefined;
}

/** Checks scripts and dependency specifiers in package.json. */
export function checkManifest(manifest: PackageManifest): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  const scripts = manifest.scripts ?? {};
  const scriptNames = new Set(Object.keys(scripts));

  for (const name of scriptNames) {
    if (isLifecycleHook(name, scriptNames)) {
      findings.push({
        severity: 'error',
        code: 'LIFECYCLE_SCRIPT',
        subject: `scripts.${name}`,
        message:
          'npm runs this hook implicitly. Fold the step into an explicitly invoked script instead.',
      });
    }
  }

  const specFields = [
    ...INSTALLED_DEPENDENCY_FIELDS,
    'peerDependencies',
  ] as const;
  for (const field of specFields) {
    for (const [name, spec] of Object.entries(manifest[field] ?? {})) {
      if (!REGISTRY_VERSION_SPEC.test(spec)) {
        findings.push({
          severity: 'error',
          code: 'NON_REGISTRY_SPEC',
          subject: `${field}.${name}`,
          message: `"${spec}" is not an exact, ^ or ~ registry version.`,
        });
      }
    }
  }

  for (const field of ['overrides', 'resolutions'] as const) {
    if (manifest[field] !== undefined) {
      findings.push({
        severity: 'warning',
        code: 'VERSION_OVERRIDE',
        subject: field,
        message:
          'Overrides change transitive versions without appearing in the dependency lists; explain each one in the PR.',
      });
    }
  }

  return findings;
}

function isLifecycleHook(name: string, scriptNames: Set<string>): boolean {
  if (ALWAYS_RUN_SCRIPTS.has(name)) return true;

  const hooked = /^(?:pre|post)(.+)$/.exec(name)?.[1];
  if (hooked === undefined) return false;
  return scriptNames.has(hooked) || NPM_LIFECYCLE_COMMANDS.includes(hooked);
}

/**
 * Checks that package-lock.json matches the manifest, resolves only from the
 * public registry with sha512 integrity, and adds no unreviewed install script.
 */
export function checkLockfile(
  lockfile: PackageLockfile,
  manifest: PackageManifest,
): ReviewFinding[] {
  if (lockfile.lockfileVersion !== SUPPORTED_LOCKFILE_VERSION) {
    return [
      {
        severity: 'error',
        code: 'LOCKFILE_VERSION',
        subject: 'package-lock.json',
        message: `Expected lockfileVersion ${SUPPORTED_LOCKFILE_VERSION}; regenerate it with the npm bundled with Node 20.`,
      },
    ];
  }

  const packages = lockfile.packages ?? {};
  const root = packages[''];
  if (root === undefined) {
    return [
      {
        severity: 'error',
        code: 'LOCKFILE_OUT_OF_SYNC',
        subject: 'package-lock.json',
        message: 'The lockfile has no root package entry.',
      },
    ];
  }

  const findings: ReviewFinding[] = [];

  for (const field of INSTALLED_DEPENDENCY_FIELDS) {
    for (const name of differingKeys(manifest[field], root[field])) {
      findings.push({
        severity: 'error',
        code: 'LOCKFILE_OUT_OF_SYNC',
        subject: `${field}.${name}`,
        message:
          'package.json and package-lock.json disagree; run npm install and commit both files.',
      });
    }
  }

  for (const [location, entry] of Object.entries(packages)) {
    // Workspace links and bundled packages have no tarball of their own.
    if (location === '' || entry.link || entry.inBundle) continue;

    const name = packageNameAt(location);
    if (!entry.resolved?.startsWith(TRUSTED_REGISTRY)) {
      findings.push({
        severity: 'error',
        code: 'LOCKFILE_SOURCE',
        subject: name,
        message: `Resolves outside ${TRUSTED_REGISTRY}.`,
      });
    }
    if (!entry.integrity?.startsWith('sha512-')) {
      findings.push({
        severity: 'error',
        code: 'LOCKFILE_INTEGRITY',
        subject: name,
        message: 'Missing a sha512 integrity hash.',
      });
    }
    if (entry.hasInstallScript && !REVIEWED_INSTALL_SCRIPTS.has(name)) {
      findings.push({
        severity: 'error',
        code: 'INSTALL_SCRIPT_UNREVIEWED',
        subject: name,
        message:
          'Runs an install script on npm ci. Read it, then add the package to REVIEWED_INSTALL_SCRIPTS with a reason.',
      });
    }
  }

  return findings;
}

function differingKeys(
  expected: Record<string, string> = {},
  actual: Record<string, string> = {},
): string[] {
  const names = new Set([...Object.keys(expected), ...Object.keys(actual)]);
  return [...names].filter((name) => expected[name] !== actual[name]).sort();
}

function packageNameAt(location: string): string {
  const marker = 'node_modules/';
  const index = location.lastIndexOf(marker);
  return index === -1 ? location : location.slice(index + marker.length);
}

/**
 * Checks the whole committed migration history: naming, ordering keys, a
 * migration.sql per directory and the Postgres provider lock.
 */
export function checkMigrationHistory(
  directories: readonly MigrationDirectory[],
  migrationLock: string,
): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  const provider = /^\s*provider\s*=\s*"([^"]*)"/m.exec(migrationLock)?.[1];
  if (provider !== EXPECTED_DATABASE_PROVIDER) {
    findings.push({
      severity: 'error',
      code: 'MIGRATION_LOCK_PROVIDER',
      subject: MIGRATION_LOCK_PATH,
      message: `Expected provider "${EXPECTED_DATABASE_PROVIDER}", found ${provider === undefined ? 'none' : `"${provider}"`}.`,
    });
  }

  const seenTimestamps = new Map<string, string>();
  for (const { name, hasMigrationSql } of directories) {
    const timestamp = MIGRATION_NAME_PATTERN.exec(name)?.[1];
    if (timestamp === undefined) {
      findings.push({
        severity: 'error',
        code: 'MIGRATION_NAME',
        subject: name,
        message:
          'Use the YYYYMMDDHHMMSS_snake_case_name format that prisma migrate dev generates.',
      });
    } else if (!isValidUtcTimestamp(timestamp)) {
      findings.push({
        severity: 'error',
        code: 'MIGRATION_TIMESTAMP',
        subject: name,
        message: `${timestamp} is not a real UTC date and time.`,
      });
    } else {
      const earlier = seenTimestamps.get(timestamp);
      if (earlier !== undefined) {
        findings.push({
          severity: 'error',
          code: 'MIGRATION_DUPLICATE_TIMESTAMP',
          subject: name,
          message: `Shares its timestamp with ${earlier}, so apply order depends on the name.`,
        });
      }
      seenTimestamps.set(timestamp, name);
    }

    if (!hasMigrationSql) {
      findings.push({
        severity: 'error',
        code: 'MIGRATION_SQL_MISSING',
        subject: name,
        message: 'The directory has no migration.sql.',
      });
    }
  }

  return findings;
}

function isValidUtcTimestamp(timestamp: string): boolean {
  const [year, month, day, hour, minute, second] = [0, 4, 6, 8, 10, 12].map(
    (start, index) =>
      Number(timestamp.slice(start, start + (index === 0 ? 4 : 2))),
  );
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  // Date.UTC rolls 2026-02-30 over to March, so compare the parts back.
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day &&
    date.getUTCHours() === hour &&
    date.getUTCMinutes() === minute &&
    date.getUTCSeconds() === second
  );
}

export interface ChangeSetReview {
  dependencyReview: boolean;
  schemaReview: boolean;
  /** Migrations added by the change set, oldest first, for SQL inspection. */
  addedMigrations: string[];
  findings: ReviewFinding[];
}

/**
 * Decides which review checklists a change set needs and enforces the rules
 * that depend on the diff itself: applied migrations and the provider lock are
 * immutable, and new migrations must sort after every existing one.
 */
export function reviewChangeSet(
  changes: readonly ChangedPath[],
  committedMigrations: readonly string[],
): ChangeSetReview {
  const findings: ReviewFinding[] = [];
  const added = new Set<string>();
  let statusUnknown = false;
  let schemaFileChanged = false;

  for (const change of changes) {
    if (!isSchemaPath(change.path)) continue;
    if (change.path === 'prisma/schema.prisma') schemaFileChanged = true;

    if (change.status === 'unknown') statusUnknown = true;

    const touched = [change.path, change.previousPath].filter(
      (path): path is string => path !== undefined,
    );
    const rewritesHistory =
      change.status === 'modified' ||
      change.status === 'deleted' ||
      change.status === 'renamed';

    for (const path of touched) {
      if (rewritesHistory && path === MIGRATION_LOCK_PATH) {
        findings.push({
          severity: 'error',
          code: 'MIGRATION_LOCK_CHANGED',
          subject: path,
          message:
            'Changing the provider lock invalidates every applied migration.',
        });
      } else if (rewritesHistory && migrationNameOf(path) !== undefined) {
        findings.push({
          severity: 'error',
          code: 'MIGRATION_EDITED',
          subject: path,
          message:
            'Applied migrations are immutable; add a new migration instead.',
        });
      }
    }

    const migration = migrationNameOf(change.path);
    if (
      migration !== undefined &&
      change.path.endsWith('/migration.sql') &&
      (change.status === 'added' || change.status === 'unknown')
    ) {
      added.add(migration);
    }
  }

  if (statusUnknown) {
    findings.push({
      severity: 'warning',
      code: 'CHANGE_STATUS_UNKNOWN',
      subject: MIGRATIONS_DIR,
      message:
        'Pipe git diff --name-status so edited and deleted migrations can be detected.',
    });
  }

  if (schemaFileChanged && added.size === 0) {
    findings.push({
      severity: 'warning',
      code: 'SCHEMA_WITHOUT_MIGRATION',
      subject: 'prisma/schema.prisma',
      message:
        'The schema changed without a new migration; confirm the change is not structural.',
    });
  }

  const latestExisting = committedMigrations
    .filter((name) => !added.has(name))
    .sort()
    .at(-1);
  const addedMigrations = [...added].sort();
  if (latestExisting !== undefined) {
    for (const name of addedMigrations) {
      if (name <= latestExisting) {
        findings.push({
          severity: 'error',
          code: 'MIGRATION_OUT_OF_ORDER',
          subject: name,
          message: `Sorts before ${latestExisting}; regenerate it so it applies after existing migrations.`,
        });
      }
    }
  }

  return {
    dependencyReview: changes.some(
      (change) =>
        isDependencyPath(change.path) ||
        (change.previousPath !== undefined &&
          isDependencyPath(change.previousPath)),
    ),
    schemaReview: changes.some(
      (change) =>
        isSchemaPath(change.path) ||
        (change.previousPath !== undefined &&
          isSchemaPath(change.previousPath)),
    ),
    addedMigrations,
    findings,
  };
}

interface StatementRule {
  code: string;
  pattern: RegExp;
  message: string;
}

const STATEMENT_RULES: readonly StatementRule[] = [
  {
    code: 'DESTRUCTIVE_DROP',
    pattern:
      /^DROP\s+(?:TABLE|TYPE|SCHEMA|VIEW|FUNCTION)\b|\bDROP\s+(?:COLUMN|CONSTRAINT)\b/i,
    message:
      'Drops data or a constraint. State whether a running server still reads it and how it would be restored.',
  },
  {
    code: 'INDEX_DROPPED',
    pattern: /^DROP\s+INDEX\b/i,
    message:
      'Dropping an index can remove a uniqueness guarantee the payment flow relies on, such as one row per Stellar hash.',
  },
  {
    code: 'DATA_REWRITE',
    pattern: /^(?:TRUNCATE|DELETE\s+FROM|UPDATE)\b/i,
    message:
      'Rewrites rows in every environment it reaches. Describe the rows affected and confirm it is idempotent.',
  },
  {
    code: 'RENAME',
    pattern: /\bRENAME\b/i,
    message:
      'The old name disappears while the previous server build may still be running. Prefer add, backfill, then drop.',
  },
  {
    code: 'COLUMN_TYPE_CHANGE',
    pattern: /\bALTER\s+COLUMN\s+\S+\s+(?:SET\s+DATA\s+)?TYPE\b/i,
    message:
      'Changes a column type, which can rewrite the table or lose precision (amounts are DECIMAL(20,7)).',
  },
  {
    code: 'NOT_NULL_ADDED',
    pattern: /\bSET\s+NOT\s+NULL\b/i,
    message: 'Fails on any environment that already has NULLs in the column.',
  },
  {
    code: 'UNIQUE_CONSTRAINT',
    pattern:
      /^CREATE\s+UNIQUE\s+INDEX\b|\bADD\s+CONSTRAINT\s+\S+\s+(?:UNIQUE|PRIMARY\s+KEY)\b/i,
    message:
      'Fails if existing rows already contain duplicates. Check each environment before deploying.',
  },
  {
    code: 'ENUM_VALUE_ADDED',
    pattern: /^ALTER\s+TYPE\s+\S+\s+ADD\s+VALUE\b/i,
    message:
      'New enum values reach API responses. Coordinate the client change in VelaPayments/vela-payments first.',
  },
  {
    code: 'ACCESS_CONTROL',
    pattern:
      /\b(?:DISABLE\s+ROW\s+LEVEL\s+SECURITY|(?:CREATE|ALTER|DROP)\s+POLICY|GRANT|REVOKE)\b/i,
    message:
      'Changes row-level security or grants. Keep it consistent with prisma/rls.sql and request a security review.',
  },
];

const ADD_COLUMN_CLAUSE =
  /\bADD\s+(?!(?:CONSTRAINT|PRIMARY|UNIQUE|FOREIGN|CHECK|EXCLUDE)\b)/i;

/**
 * Flags statements in a new migration that need an explicit rollout note.
 * These are warnings: Prisma generates several of them for ordinary schema
 * work, and the reviewer decides whether the note is adequate.
 */
export function inspectMigrationSql(
  migrationName: string,
  sql: string,
): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  const statements = splitStatements(sql);

  statements.forEach((statement, index) => {
    const subject = `${migrationName} statement ${index + 1}`;

    for (const rule of STATEMENT_RULES) {
      if (rule.pattern.test(statement)) {
        findings.push({
          severity: 'warning',
          code: rule.code,
          subject,
          message: rule.message,
        });
      }
    }

    if (/^ALTER\s+TABLE\b/i.test(statement)) {
      const unsafeAdd = splitTopLevel(statement).some(
        (clause) =>
          ADD_COLUMN_CLAUSE.test(clause) &&
          /\bNOT\s+NULL\b/i.test(clause) &&
          !/\b(?:DEFAULT|GENERATED)\b/i.test(clause),
      );
      if (unsafeAdd) {
        findings.push({
          severity: 'warning',
          code: 'NOT_NULL_WITHOUT_DEFAULT',
          subject,
          message:
            'Adds a required column without a default, which fails on tables that already have rows.',
        });
      }
    }
  });

  return findings;
}

/**
 * Splits SQL into statements after removing comments and the contents of
 * string literals, so `DEFAULT 'a;b'` or a commented-out DROP cannot change
 * the result. Dollar-quoted bodies are not handled; Prisma does not emit them.
 */
function splitStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let index = 0;

  while (index < sql.length) {
    const char = sql[index];
    const next = sql[index + 1];

    if (char === '-' && next === '-') {
      const end = sql.indexOf('\n', index);
      index = end === -1 ? sql.length : end;
      current += ' ';
    } else if (char === '/' && next === '*') {
      const end = sql.indexOf('*/', index + 2);
      index = end === -1 ? sql.length : end + 2;
      current += ' ';
    } else if (char === "'" || char === '"') {
      // '' and "" are the escaped forms of the quote inside a literal.
      let end = index + 1;
      while (end < sql.length) {
        if (sql[end] === char && sql[end + 1] === char) end += 2;
        else if (sql[end] === char) break;
        else end += 1;
      }
      // Identifiers are kept (rules mention column names); literal text is not.
      current += char === '"' ? sql.slice(index, end + 1) : "''";
      index = end + 1;
    } else if (char === ';') {
      statements.push(current);
      current = '';
      index += 1;
    } else {
      current += char;
      index += 1;
    }
  }
  statements.push(current);

  return statements
    .map((statement) => statement.replace(/\s+/g, ' ').trim())
    .filter((statement) => statement !== '');
}

/** Splits on commas outside parentheses, e.g. the clauses of an ALTER TABLE. */
function splitTopLevel(statement: string): string[] {
  const clauses: string[] = [];
  let depth = 0;
  let start = 0;

  for (let index = 0; index < statement.length; index += 1) {
    const char = statement[index];
    if (char === '(') depth += 1;
    else if (char === ')') depth = Math.max(0, depth - 1);
    else if (char === ',' && depth === 0) {
      clauses.push(statement.slice(start, index));
      start = index + 1;
    }
  }
  clauses.push(statement.slice(start));
  return clauses;
}
