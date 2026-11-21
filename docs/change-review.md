# Dependency and migration review

Use this guide for any pull request that changes npm dependencies or the
database schema. Both run with more privilege than ordinary code: npm install
scripts run on every contributor machine and CI runner, and a migration runs
against every database that deploys it, including ones holding real testnet
payment history.

Vela is a Stellar **testnet** prototype. Nothing here covers mainnet, and the
checks never connect to a database, Horizon or the npm registry.

## Which changes need review

| Changed files                                                                   | Review needed                       |
| ------------------------------------------------------------------------------- | ----------------------------------- |
| `package.json`, `package-lock.json`, `npm-shrinkwrap.json`, `.npmrc`            | [Dependency review](#dependency-review) |
| `prisma/schema.prisma`, `prisma/migrations/**`, `prisma/rls.sql`                | [Migration review](#migration-review)   |

## Run the automated check

From a checkout of the PR branch:

```sh
git fetch origin main
git diff --name-status origin/main...HEAD | npm run review:changes
```

The command reads the diff from stdin and the files in the checkout. It does
not run git, install packages or touch a database. Use `--name-status` rather
than `--name-only`, or the check cannot tell an edited migration from a new one
and reports `CHANGE_STATUS_UNKNOWN`.

The report states which reviews the diff needs, then lists findings:

- **Errors** break a repository rule. The command exits `1`; fix them.
- **Warnings** are allowed but need an answer in the PR description. The
  command exits `0`.

Exit code `2` means a usage error, for example running it without piping a
diff. Repository-wide rules run even for an empty diff, and the same checks run
on the committed state in `npm test`, so `main` cannot drift out of policy
without a failing test.

Paste the report into the PR description, or write `N/A` in the template's
dependency and migration sections if neither review is required.

## Dependency review

### Automated rules

| Code                        | Severity | Rule                                                                                                 |
| --------------------------- | -------- | ---------------------------------------------------------------------------------------------------- |
| `LIFECYCLE_SCRIPT`          | error    | No implicit npm hooks (`preinstall`, `postinstall`, `prepare`, `pre<script>`, `post<script>`, ...)    |
| `NON_REGISTRY_SPEC`         | error    | Dependencies use an exact, `^` or `~` version from the registry; no git, URL, file, alias, `*` or `latest` |
| `VERSION_OVERRIDE`          | warning  | `overrides`/`resolutions` exist; explain each one                                                    |
| `LOCKFILE_VERSION`          | error    | `package-lock.json` uses lockfile version 3                                                          |
| `LOCKFILE_OUT_OF_SYNC`      | error    | The lockfile root lists the same dependencies as `package.json`                                      |
| `LOCKFILE_SOURCE`           | error    | Every package resolves from `https://registry.npmjs.org/`                                            |
| `LOCKFILE_INTEGRITY`        | error    | Every package has a `sha512` integrity hash                                                          |
| `INSTALL_SCRIPT_UNREVIEWED` | error    | A package with an install script is not in `REVIEWED_INSTALL_SCRIPTS`                                |

The lifecycle rule exists because this repository previously shipped a hidden
`api.js` pre-hook that ran on build and start (see
[Wave preparation](wave-readiness.md)). Put every step in a script that is
invoked by name.

Packages that currently run install scripts, and why they are accepted, are
listed in `REVIEWED_INSTALL_SCRIPTS` in `src/operations/change-review.ts`:
`@prisma/client`, `@prisma/engines`, `prisma`, `@scarf/scarf` (via
`swagger-ui-dist`), `fsevents` and `unrs-resolver` (both via Jest). To accept a
new one, read the script in the published tarball, then add the package with a
one-line reason in the same PR. That keeps the decision visible in the diff.

### What CI already covers

- The **PR Safety Gate** runs `actions/dependency-review-action` and fails on
  known vulnerabilities of `high` severity or above. It does not judge whether
  a package is needed or maintained.
- `npm ci` fails when the lockfile and `package.json` disagree, and verifies
  each tarball against its integrity hash.

### Reviewer checklist

Answer these in the PR for each added or upgraded direct dependency:

- [ ] **Need.** What it does that existing dependencies or a few lines of code
      cannot. Prefer no new dependency.
- [ ] **Placement.** Runtime packages go in `dependencies`; build, test and
      lint tooling goes in `devDependencies`.
- [ ] **Provenance.** Exact package name (no typosquats), repository link,
      license compatible with MIT, maintained in the last year.
- [ ] **Footprint.** Number of new transitive packages, from the lockfile diff.
      Any new install script has been read and added to
      `REVIEWED_INSTALL_SCRIPTS`.
- [ ] **Major upgrades.** Changelog read; behavior changes named. For
      `@stellar/stellar-sdk`, state whether XDR building, network passphrases
      or Horizon response parsing changed, and run the Stellar unit tests.
      For `@simplewebauthn/server`, `@nestjs/jwt`, `passport-jwt` or
      `jsonwebtoken`, state whether verification defaults changed.
- [ ] **One purpose per PR.** Dependency upgrades are not mixed with feature
      work, so a revert removes only the upgrade.

The lockfile must be regenerated with the npm version bundled with Node 20,
which CI uses. Commit `package.json` and `package-lock.json` together.

## Migration review

### Automated rules

These rules check the committed history and the diff. They are errors:

| Code                            | Rule                                                                         |
| ------------------------------- | ---------------------------------------------------------------------------- |
| `MIGRATION_EDITED`              | A committed migration was modified, deleted or renamed                       |
| `MIGRATION_LOCK_CHANGED`        | `migration_lock.toml` was modified, deleted or renamed                       |
| `MIGRATION_LOCK_PROVIDER`       | The lock provider is not `postgresql`                                        |
| `MIGRATION_NAME`                | A directory name is not `YYYYMMDDHHMMSS_snake_case_name`                     |
| `MIGRATION_TIMESTAMP`           | The timestamp is not a real UTC date and time                                |
| `MIGRATION_DUPLICATE_TIMESTAMP` | Two migrations share a timestamp                                             |
| `MIGRATION_SQL_MISSING`         | A migration directory has no `migration.sql`                                 |
| `MIGRATION_OUT_OF_ORDER`        | A new migration sorts before an existing one, so it would apply out of order |

Historical migration IDs are part of every deployed database's
`_prisma_migrations` table. Editing or renaming one makes `prisma migrate
deploy` fail or silently skip the change, so fix mistakes with a new migration.
If the out-of-order rule fires after rebasing, delete your local migration
directory and regenerate it with `npm run prisma:migrate`.

The SQL of each **new** migration is scanned for statements that need a
rollout note. These are warnings, because Prisma generates several of them for
ordinary schema work:

| Code                       | Statement                                                    | Answer in the PR                                                       |
| -------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------- |
| `DESTRUCTIVE_DROP`         | `DROP TABLE/TYPE/...`, `DROP COLUMN`, `DROP CONSTRAINT`      | Does the previous server build still read it? How is it restored?      |
| `INDEX_DROPPED`            | `DROP INDEX`                                                 | Does any code rely on its uniqueness?                                  |
| `DATA_REWRITE`             | `UPDATE`, `DELETE FROM`, `TRUNCATE`                          | Which rows change, and is it safe to re-run?                           |
| `RENAME`                   | Any `RENAME`                                                 | Why not add, backfill, then drop?                                      |
| `COLUMN_TYPE_CHANGE`       | `ALTER COLUMN ... TYPE`                                      | Can values lose precision? Amounts are `DECIMAL(20,7)`                 |
| `NOT_NULL_ADDED`           | `SET NOT NULL`                                               | How were existing `NULL`s backfilled?                                  |
| `NOT_NULL_WITHOUT_DEFAULT` | `ADD COLUMN ... NOT NULL` without `DEFAULT`                  | It fails on non-empty tables. Add a default or a backfill step         |
| `UNIQUE_CONSTRAINT`        | `CREATE UNIQUE INDEX`, `ADD CONSTRAINT ... UNIQUE/PRIMARY KEY` | How do you know existing rows have no duplicates?                    |
| `ENUM_VALUE_ADDED`         | `ALTER TYPE ... ADD VALUE`                                   | Link the coordinated client change                                     |
| `ACCESS_CONTROL`           | RLS disable, policy changes, `GRANT`, `REVOKE`               | Consistency with `prisma/rls.sql`; request a security review           |

The scan ignores comments and string literal contents. It does not parse
dollar-quoted function bodies, which Prisma does not generate; review any
hand-written function by reading it.

### Reviewer checklist

- [ ] **Generated, then read.** The migration came from
      `npm run prisma:migrate` against a local database, and the SQL was read
      line by line. Prisma's own `-- Warnings` comments are answered.
- [ ] **Applies cleanly.** `npm run prisma:migrate:deploy` succeeds on a fresh
      local database and on one migrated from the previous `main`. Never run
      migration commands against production or a shared environment.
- [ ] **Old server, new schema.** The server build currently on `main` still
      works after this migration runs. Run migrations before starting the new
      server, so for a while the old build runs against the new schema.
      Additive changes satisfy this; removals and renames need an
      expand-then-contract sequence over two PRs.
- [ ] **Payment safety.** Constraints that protect the payment flow are kept:
      one payment per payment request, one row per Stellar transaction hash,
      single-use request IDs and the `network` columns.
- [ ] **Contract impact.** If an enum or column surfaces in an API response,
      the matching change in
      [VelaPayments/vela-payments](https://github.com/VelaPayments/vela-payments)
      is linked, and `docs/payment-lifecycle.md` or `docs/payment-request.v1.md`
      is updated.
- [ ] **RLS.** New tables or columns are reflected in `prisma/rls.sql` where
      direct Supabase access applies. That file is applied by hand after
      migrations; say so in the rollout notes if it changed.
- [ ] **Seed and tests.** `prisma/seed.ts` and test fixtures still match the
      schema; `npm test` and `npm run test:e2e` pass.

## Rollout notes

Every PR that needs either review states, in its description:

1. The output of `npm run review:changes`, with each warning answered.
2. Deploy order: migration first, then server, unless stated otherwise.
3. Whether the change can be rolled back by redeploying the previous server
   build. If not, how to restore the previous state.
4. Any manual step, such as applying `prisma/rls.sql` in the Supabase SQL
   editor or regenerating the Prisma client.
5. Which environments it was applied to. Local and testnet only; do not claim
   a deployment that did not happen.

## Limits of the automated check

- It reads one checkout. It cannot know which migrations a given database has
  applied; use `npx prisma migrate status` against your own local database.
- It flags statement shapes, not data. A `UNIQUE_CONSTRAINT` warning cannot
  tell whether duplicates exist.
- It does not query vulnerability databases or package metadata. That is the
  dependency-review action's job, plus the human checklist above.
- PRs touching paths that match `migration`, `config`, `payment`, `crypto` and
  similar names also go through the **Manual review required** job, which needs
  a maintainer to apply `security-reviewed`. The check here does not replace
  that review.
