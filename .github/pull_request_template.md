## ⚠️ REQUIRED — Linked issue

> **Before submitting the PR, replace `#` with the issue number.**
> Without this, the issue will **not close automatically** on merge.

Closes #

<!-- Valid examples:
  Closes #42
  Closes #42, Closes #43
-->

---

## PR title

Use a clear, concise title. Suggested format:

```
type(scope): short description
```

**Types:** `feat` · `fix` · `refactor` · `docs` · `test` · `chore`

**Example:** `feat(payments): add transaction confirmation endpoint`

---

## Description

<!-- What does this PR do and why? Brief context for reviewers. -->

## Type of change

- [ ] New feature (`feat`)
- [ ] Bug fix (`fix`)
- [ ] Refactor / internal improvement
- [ ] Database migration (Prisma)
- [ ] Documentation
- [ ] Tests
- [ ] Other: <!-- describe -->

## Changes made

<!-- Concrete list of what changed. -->

-
-

## Test plan

<!-- How you verified it works. Reproducible steps. -->

- [ ]
- [ ] Unit / e2e tests updated or added
- [ ] Tested locally with `npm run start:dev` (or the relevant command)

## Dependencies

<!-- If package.json or package-lock.json changed, answer the dependency checklist in docs/change-review.md. If not, write "N/A". -->

N/A

## Migrations / database

<!-- If applicable: Prisma schema changes, migrations, seeds, plus the rollout notes from docs/change-review.md. If not, write "N/A". -->

N/A

<!-- For either section, paste the output of:
  git diff --name-status origin/main...HEAD | npm run review:changes
-->

## Checklist

- [ ] I included `Closes #` with the correct issue number
- [ ] Code follows project conventions (NestJS, modules, etc.)
- [ ] `npm run lint` and `npm run test` pass without errors
- [ ] Prisma migrations generated and tested (if applicable)
- [ ] `npm run review:changes` reports no errors for dependency or migration changes
- [ ] Updated documentation if the change requires it
