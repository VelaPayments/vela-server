# Vela testnet release checklist

Use this checklist for each candidate demo build. Check an item only when its
evidence is attached to the release record; implementation alone is not proof
of a successful testnet transfer.

## Automated and configuration gates

- [ ] Current client and server commits are recorded.
- [ ] Client and server CI workflows pass, including build, lint, typecheck, unit tests, and mocked HTTP E2E tests.
- [ ] `npm run check:testnet` reports healthy testnet Horizon/RPC providers and `networkPassphraseMatched: true`.
- [ ] Deployed `GET /v1/health/ready` reports `status: ok` before the device demo.
- [ ] `.env` values are supplied through secret configuration; no JWTs, service-role keys, seed phrases, or private keys are committed.
- [ ] Server and client report the same `TESTNET` network and USDC issuer.
- [ ] The server starts with a network passphrase that matches its configured network.
- [ ] WebAuthn RP ID/origin and native association files match the demo domain.

## Two-device payment gates

- [ ] Receiver wallet is linked to the server and has the requested asset trustline when using USDC.
- [ ] Receiver creates a request, payer receives it over NFC, and the payer reviews the destination, asset, amount, expiry, and memo.
- [ ] Payer balance and issuer checks pass before passkey approval.
- [ ] Payer authorizes with a payment-scoped passkey and signs locally.
- [ ] Server confirms the payment and the receiver waiting screen reaches
      success.
- [ ] Interrupted submission retry reconciles the existing transaction hash.

## Independent settlement and history gates

- [ ] `npm run verify:transaction -- <hash>` returns `verification: passed`.
- [ ] The Horizon record shows the expected network, ledger, payment operation, amount, asset issuer, destination, and memo.
- [ ] Both users see matching `SENT`/`RECEIVED` records from `GET /v1/transactions`.
- [ ] Client History reconciles the Horizon record and displays `Indexed by Vela`; Stellar Expert link opens successfully.
- [ ] Sanitized screenshots, API identifiers, CI URL, and verifier output are
      attached to `demo-evidence-template.md`.
- [ ] The machine-readable record passes `npm run validate:evidence -- <file>`;
      start from `demo-evidence.example.json`.
