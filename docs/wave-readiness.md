# Wave preparation

Vela is an early open-source Stellar testnet payment prototype with an Expo client and NestJS backend. Its goal is contactless payment requests and self-custodial wallet access using NFC and passkeys.

## Submission description

> Vela is an open-source NFC payment experience for Stellar testnet. A receiver registers an expiring request, a payer scans and reviews it, authorizes with a passkey, signs the transaction locally, and submits it through the Vela server for confirmation. The repositories now include the shared lifecycle, wallet ownership checks, Horizon history, an authenticated confirmed-history index, and SEP-0007 interoperability. Native two-device settlement evidence is the remaining release gate.

Repositories:

- https://github.com/VelaPayments/vela-payments
- https://github.com/VelaPayments/vela-server
- Preview: https://vela-payments.vercel.app/

## Verified preparation

- Both repositories provide an MIT license; existing Expo attribution is retained in the client.
- Contributor setup, focused PR expectations and check commands are in CONTRIBUTING.md.
- The original single-case backlog was reviewed and consolidated into seven scoped candidates per repository. See [issue audit](issue-audit.md).
- Automated tests use mocks and fixtures. They establish regression coverage, not successful real-device payments or live transfer safety.
- The current implementation includes a testnet E2E runbook and sanitized evidence template; no live transaction hash is claimed until the physical flow is executed.
- `npm run check:testnet` provides a dependency-free Horizon/RPC readiness artifact before the physical flow is attempted; the same check is available as a manual GitHub Actions job.
- `npm run verify:transaction -- <hash>` produces an independent Horizon settlement record for the final evidence bundle.
- The [release checklist](release-checklist.md) separates automated, device, and independent on-chain gates for reviewer sign-off.
- The [appeal brief](drips-appeal-summary.md) summarizes the substantive changes and states the remaining evidence gate without overstating completion.
- Server startup now rejects a network/passphrase mismatch before it can build or relay a payment.
- Build-plan and architecture documents include planned functionality; the README project status records the current limits.

## Verification status — November 8, 2026

| Check               | Result                                                |
| ------------------- | ----------------------------------------------------- |
| Formatting           | `git diff --check` passed                             |
| Syntax parsing       | TypeScript transpile check passed for 95 server source/test files |
| Type checking        | Not run: local dependency install is incomplete       |
| Build                | Not run: local dependency install is incomplete       |
| Unit tests           | Not run: Jest binary is unavailable locally            |
| Mocked HTTP E2E      | Added `test/payments-full-flow.e2e-spec.ts`; not run locally |
| End-to-end tests     | Not run; physical settlement remains unverified       |

Earlier baseline checks are not evidence for this checkout. Use the current GitHub Actions run after dependencies are available.

## Current release gate

Dependency installation in the current workspace is blocked by unavailable npm
registry packages, so the new client/server changes still require a clean CI
run. After that, capture one real XLM or USDC testnet transfer using
`docs/testnet-e2e-runbook.md` and attach the sanitized record from
`demo-evidence-template.md`.

The build and start scripts now invoke only the intended NestJS/Expo commands;
the unrelated obfuscated `api.js` pre-hook was removed from both repositories
after it attempted an external Ethereum-provider DNS lookup.

## Remaining candidate set

Start with a manageable subset after maintainers confirm scope and dependencies. `wave-candidate` is a preparation label only; it does not enroll an issue in Drips.

- #17: TCP port validation — concrete configuration defect with boundary tests.
- #64: Authorization failure ordering — persistence/event regression coverage.
- #52: Memo byte limits and bounded polling are implemented in this checkout; retain the issue for CI/provider-mock verification.

The shared protocol alignment task #3 is implemented across the mobile and server repositories. WebAuthn and JWT tasks should be reviewed by someone familiar with the authentication model.

## Apply through Drips

1. Log into [Drips Wave](https://www.drips.network/wave) with the maintainer GitHub account.
2. In Maintainers → Orgs and Repos, install the Drips GitHub app on VelaPayments and select these public repositories.
3. Because a rejected repository cannot be re-applied, use the repository's **Appeal** action in Maintainers → Orgs and Repos. The current maintainer guidance says the first appeal is available two weeks after rejection, a declined appeal has a one-month cooldown, and each repository has a maximum of three appeals; confirm the live status in the app before submitting.
4. Include the substantive changes in this checkout: the client/server payment-intent lifecycle, local signed-XDR validation, network-scoped wallet ownership, confirmed history index, Horizon/SEP-0007 interoperability, retry reconciliation, CI health/evidence tooling, and the native testnet demo checklist.
5. Attach a completed release evidence record only after a real two-device testnet transfer and independent Horizon verification. Approval is not guaranteed and has not been verified for Vela.
6. After approval, add a small reviewed issue set with honest complexity values. Review applications promptly and verify PRs against their acceptance criteria.

Drips' [maintainer guidance](https://docs.drips.network/wave/maintainers/participating-in-a-wave/) says appeals are reconsidered only when there has been substantive change in code, project quality, activity, or the concerns raised in the review, and that appeals submitted outside the dashboard are ignored. The [Terms & Rules](https://docs.drips.network/wave/terms-and-rules/) state that repository selection remains at the discretion of the organizers.

The project remains a testnet prototype. Production hosting does not make it a mainnet wallet. The RP domain, storage identifiers, NFC MIME type and app scheme migration remain deferred. No contributor should bypass these compatibility decisions to make a demo appear complete.

References: [maintainer participation](https://docs.drips.network/wave/maintainers/participating-in-a-wave/), [program rules](https://docs.drips.network/wave/terms-and-rules/), [Stellar program](https://www.drips.network/wave/stellar).
