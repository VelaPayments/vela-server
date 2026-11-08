# Drips Stellar Wave appeal brief

Vela is requesting reconsideration after the repositories were removed from the
Stellar Wave. The project has made substantive changes to the product, code,
documentation, and release process; the remaining proof gate is one verified
native-device testnet transfer.

## What changed

- Implemented the shared `payment-request.v1` lifecycle across Expo and NestJS:
  receiver registration, NFC delivery, payment-intent creation, passkey
  authorization, local signing, Horizon submission, bounded confirmation, and
  receiver polling.
- Added signed-XDR intent validation on both client and server, network-scoped
  wallet ownership, USDC issuer/trustline checks, balance preflight, memo-byte
  enforcement, replay protection, rate limiting, and network/passphrase guards.
- Added retry reconciliation for interrupted submissions so a stored Stellar
  hash is reconciled instead of relaying a second payment.
- Added authenticated confirmed-history indexing for sender and receiver,
  Horizon-backed client history, Stellar Expert links, SEP-0007 payment URI
  support, and independent Horizon transaction verification.
- Added CI health tooling, a sanitized evidence validator, release checklist,
  architecture/lifecycle documentation, and native two-device demo runbooks.

## Evidence status

Static TypeScript checks and formatting checks pass in both repositories.
Mocked unit/HTTP coverage and CI workflows are present, but dependency
installation is currently blocked in this workspace by an uncached npm package.
No live transaction is claimed until the workflow is run on physical devices,
the transaction is verified in Horizon, and the sanitized record passes
`npm run validate:evidence -- <file>`.

## Review links

- [Native demo checklist](https://github.com/VelaPayments/vela-payments/blob/main/docs/testnet-demo.md)
- [Server testnet runbook](./testnet-e2e-runbook.md)
- [Release checklist](./release-checklist.md)
- [Drips maintainer appeal guidance](https://docs.drips.network/wave/maintainers/participating-in-a-wave/)

Submit this brief through the repository's **Appeal** action in Maintainers →
Orgs and Repos. The current guidance requires substantive change; it also
states that the first appeal is available two weeks after rejection, a
declined appeal has a one-month cooldown, and a repository may be appealed at
most three times. Do not submit the appeal by email or another channel.
