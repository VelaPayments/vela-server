# Operator recovery for stuck payments

This runbook covers payments that stopped before a terminal state
(`CONFIRMED` or `FAILED`). It describes what the server can resolve on its
own, what it deliberately leaves to a person, and how to run the recovery tool.

Vela is a Stellar **testnet** prototype. The recovery tool refuses to run when
the server is configured for any other network.

## When is a payment stuck?

The normal lifecycle is described in [payment-lifecycle.md](payment-lifecycle.md).
A payment is a recovery candidate when it is still `CREATED`, `AUTHORIZED` or
`SUBMITTED` some time after it was created. The common causes are:

| Cause                                                              | Left in      |
| ------------------------------------------------------------------ | ------------ |
| Payer abandoned the flow before approving with a passkey           | `CREATED`    |
| Payer approved, then never submitted the signed envelope           | `AUTHORIZED` |
| Server stopped between relaying to Horizon and recording the hash  | `AUTHORIZED` |
| Confirmation polling timed out, or Horizon was briefly unavailable | `SUBMITTED`  |
| Client lost the submit response and never retried                  | `SUBMITTED`  |

A client retry of `POST /v1/payments/:id/submit` already reconciles a
`SUBMITTED` payment. The recovery tool covers the cases where nobody retries.

## What recovery does

Recovery only automates transitions the server can prove from its own records
and Horizon. Every write is conditional on the payment still being in the
state that was inspected, so recovery is safe to re-run and safe to run while
clients are active.

| Status       | Condition                                       | Action          | Effect with `--apply`                                                    |
| ------------ | ----------------------------------------------- | --------------- | ------------------------------------------------------------------------ |
| `SUBMITTED`  | Horizon reports the stored hash succeeded       | `CONFIRMED`     | Marked `CONFIRMED`; `SENT`/`RECEIVED` history indexed, as a client retry |
| `SUBMITTED`  | Horizon reports the stored hash failed          | `FAILED`        | Marked `FAILED` with `STELLAR_TX_FAILED`                                 |
| `SUBMITTED`  | Horizon has no record of the stored hash        | `PENDING`       | None; stays `SUBMITTED`                                                  |
| `SUBMITTED`  | No stored hash                                  | `MANUAL_REVIEW` | None                                                                     |
| `CREATED`    | Authorization window or request expiry elapsed  | `EXPIRED`       | Marked `FAILED` with `PAYMENT_INTENT_EXPIRED`                            |
| `CREATED`    | Still within its window                         | `SKIPPED`       | None                                                                     |
| `AUTHORIZED` | Authorization window or request expiry elapsed  | `MANUAL_REVIEW` | None                                                                     |
| `AUTHORIZED` | Still within its window                         | `SKIPPED`       | None                                                                     |
| Any          | Payment belongs to a different Stellar network  | `MANUAL_REVIEW` | None                                                                     |
| Any          | Horizon or the database failed for this payment | `ERROR`         | None; the sweep continues with the next payment                          |

The window is the same rule `authorize` and `submit` enforce:
`createdAt + PAYMENT_SUBMIT_TIMEOUT_MS`, or the payment's `expiresAt`,
whichever comes first.

### Why `CREATED` can be closed but `AUTHORIZED` cannot

The server relays signed XDR only for `AUTHORIZED` payments. A `CREATED` intent
has never been accepted for submission, so nothing can have reached Stellar
through Vela and closing it is safe.

An `AUTHORIZED` payment without a hash is ambiguous. The server does not keep
the signed envelope, so "the payer never submitted" and "Horizon accepted it,
then the server stopped before recording the hash" look identical in the
database. Marking it `FAILED` could hide a settled payment, so recovery only
reports it.

## Running recovery

Run the tool from a server checkout, with the server's environment (the same
`.env` or secret configuration the API uses). It needs database and Horizon
access, and it is not exposed over HTTP.

```sh
# 1. Dry run (the default). Reads the database and Horizon, writes nothing.
npm run recover:payments

# 2. Review the report, then apply the same sweep.
npm run recover:payments -- --apply

# Narrow or widen the sweep.
npm run recover:payments -- --older-than-minutes 120 --limit 20
```

| Option                     | Default | Meaning                                              |
| -------------------------- | ------- | ---------------------------------------------------- |
| `--apply`                  | off     | Write state changes. Without it the run is read-only |
| `--older-than-minutes <n>` | `30`    | Only consider payments created at least `n` minutes  |
| `--limit <n>`              | `50`    | Inspect at most `n` payments (1–500), oldest first   |
| `--help`                   |         | Print usage                                          |

Unknown options are rejected, so a mistyped `--aply` fails instead of silently
running as a dry run.

Exit codes: `0` when every payment was handled, including `MANUAL_REVIEW`
results; `1` when at least one payment reported `ERROR` or the run could not
start; `2` for usage errors or a non-testnet configuration.

The report is a single JSON document on stdout:

```json
{
  "mode": "dry-run",
  "network": "TESTNET",
  "checkedAt": "2026-11-21T12:00:00.000Z",
  "createdBefore": "2026-11-21T11:30:00.000Z",
  "limit": 50,
  "results": [
    {
      "paymentId": "<payment-uuid>",
      "status": "SUBMITTED",
      "action": "CONFIRMED",
      "applied": false,
      "stellarTxHash": "<64-character hash>",
      "reason": "Horizon reports the transaction succeeded; --apply confirms it and indexes history."
    }
  ],
  "summary": {
    "CONFIRMED": 1,
    "FAILED": 0,
    "PENDING": 0,
    "EXPIRED": 0,
    "SKIPPED": 0,
    "MANUAL_REVIEW": 0,
    "ERROR": 0
  }
}
```

The report contains payment UUIDs, statuses and Stellar transaction hashes. It
never includes public keys, signed envelopes, tokens or raw provider error
text; failures are reported by canonical code only, for example
`STELLAR_NETWORK_ERROR`. Payment UUIDs are internal identifiers, so replace
them with placeholders before you paste a report into a public issue.

## Handling each result

**`CONFIRMED` / `FAILED` / `EXPIRED`** — No further action. The payer and
receiver see the final state from `GET /v1/payments/:id`. A confirmed payment
also appears in `GET /v1/transactions` for both users.

An expired intent leaves its payment request `CONSUMED`. This is unchanged
behavior: a request can back only one payment, so the receiver must create a
new request.

**`PENDING`** — Horizon's submit endpoint returns a hash only after the
transaction is included in a ledger, so a stored hash that Horizon cannot find
usually means the configured `STELLAR_HORIZON_URL` is not the instance that
accepted it, or the testnet has been reset since. Check the hash against the
original Horizon with `npm run verify:transaction -- <hash>`. Do not mark the
payment by hand. Re-run recovery once the configured Horizon can see the hash.

**`ERROR`** — Usually a Horizon outage (`STELLAR_NETWORK_ERROR`). Check
`npm run check:testnet` and re-run. Nothing was written for that payment.

**`MANUAL_REVIEW` on an `AUTHORIZED` payment** — Find out whether the payment
reached Stellar:

1. Read the payment row (sender public key, recipient, asset, amount, memo,
   `createdAt`) from the database.
2. List the sender account's recent payments in Horizon, for example
   `GET <horizon>/accounts/<sender>/payments?order=desc&limit=50`, and look for
   one to the recipient with the same asset, amount and memo after `createdAt`.
3. **No match:** leave the payment as it is. `submit` already refuses it
   because its window has elapsed, so the row is inert, and editing state by
   hand would create a second source of truth.
4. **A match:** first prove the transaction is exactly this payment:

   ```sh
   STELLAR_EXPECTED_PAYER=<sender> STELLAR_EXPECTED_RECEIVER=<recipient> \
   STELLAR_EXPECTED_ASSET=XLM STELLAR_EXPECTED_AMOUNT=<amount> \
   npm run verify:transaction -- <hash>
   ```

   Add `STELLAR_EXPECTED_ISSUER` for USDC and `STELLAR_EXPECTED_MEMO` when the
   payment has a memo. Only after `verification: passed`, record the hash with
   a single guarded statement, reviewed by a second maintainer:

   ```sql
   UPDATE payments
   SET status = 'SUBMITTED', "stellarTxHash" = '<hash>',
       "submittedAt" = now(), "updatedAt" = now()
   WHERE id = '<payment-uuid>' AND status = 'AUTHORIZED';
   ```

   Then run `npm run recover:payments -- --apply`. It confirms the payment and
   indexes history through the same code path as a client retry. Recovery
   checks that the transaction succeeded, not which operation it contains;
   the verifier step above covers that, so do not skip it.

**`MANUAL_REVIEW` on a `SUBMITTED` payment without a hash** — The server
writes status and hash in one update, so this indicates an out-of-band data
change. Follow the same Horizon lookup as above and raise it with the
maintainers.

**`MANUAL_REVIEW` for a network mismatch** — The payment was created under a
different `STELLAR_NETWORK`. It cannot be resolved by this deployment; do not
point the server at another network to resolve it.

## Known gap: Horizon timeout during submit

If Horizon answers `POST /transactions` with a server error or timeout, the
transaction may still be included in a later ledger. `submit` currently marks
such a payment `FAILED` with `STELLAR_SUBMISSION_FAILED` and does not store the
hash, so recovery does not inspect it. If a payer reports funds moved for a
payment shown as `FAILED` with that code, use the Horizon lookup above and
escalate. Persisting the envelope hash before relaying would close this gap;
it changes `submit` behavior and is tracked separately from this runbook.

## Rollout notes

- No schema migration. Recovery reuses existing columns and enum values.
- `PAYMENT_INTENT_EXPIRED` is a new `failureCode` value on `FAILED` payments
  returned by `GET /v1/payments/:id`. Clients that treat `FAILED` generically
  need no change. Clients that switch on `failureCode` should handle it as
  "request expired; ask the receiver for a new request".
- Recovery is operator-run and is not scheduled. The candidate query filters on
  status and `createdAt` without a dedicated index; `--limit` bounds each sweep,
  which is adequate at prototype scale.
- Regression coverage is unit-level with mocked Prisma and Horizon
  (`payment-recovery.service.spec.ts`, `recovery-args.spec.ts`, plus additions
  to the payments service and repository specs). No live testnet recovery has
  been recorded yet; record one in the release evidence before claiming it.
