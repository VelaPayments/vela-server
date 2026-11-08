# Vela payment lifecycle

This document describes the implemented server boundary for a self-custodial
Stellar payment. The server creates the intent and relays a transaction; the
client remains the only place that holds the sender's private key.

## Flow

1. The receiver creates and optionally persists a `payment-request.v1` payload.
   The linked recipient wallet must be on the API's active Stellar network, and
   the request records that network for the remainder of its lifecycle.
2. The payer calls `POST /v1/payments` with the NFC request ID (or request UUID)
   and a linked Stellar public key.
3. The server verifies the wallet link, request expiry, recipient identity,
   self-transfer rules, and request replay state. It returns an unsigned
   payment transaction XDR.
4. The client previews the intent and independently parses the unsigned XDR
   against the expected source, destination, asset, amount, memo, and network
   before asking for passkey authorization or signing locally.
5. The payer obtains a payment-scoped WebAuthn challenge from
   `POST /v1/webauthn/authenticate/options`, then calls
   `POST /v1/payments/:id/authorize`.
   The configured `PAYMENT_SUBMIT_TIMEOUT_MS` bounds the age of the intent
   before authorization or submission is accepted.
6. The client posts the signed envelope to `POST /v1/payments/:id/submit`.
   The server parses the XDR and checks that its source, destination, asset,
   amount, network, and single-payment-operation shape match the stored intent
   before relaying it to Horizon.
7. The server records `SUBMITTED`, polls for a bounded confirmation result,
   and transitions the payment to `CONFIRMED` or `FAILED`. A bounded polling
   timeout keeps it `SUBMITTED` for later reconciliation. On confirmation it
   indexes one `SENT` and one `RECEIVED` history record for the two users. If
   the client loses the submit response, retrying the same intent reconciles
   the stored Stellar hash instead of relaying a second transaction; transient
   Horizon polling failures also leave the payment recoverable in `SUBMITTED`.
   Only an explicit failed transaction result becomes `FAILED`.
8. Either party can read the result from `GET /v1/payments/:id`.
9. Either party can read confirmed Vela history from `GET /v1/transactions`;
   independently observed Horizon history remains authoritative for settlement.

## State transitions

```text
CREATED -> AUTHORIZED -> SUBMITTED -> CONFIRMED
                                  \-> FAILED
```

Payment requests are marked `CONSUMED` in the same database transaction that
creates the payment. This prevents two payment intents from being created from
the same request under normal or concurrent use.

## Verification boundary

The server rejects fee-bump envelopes, multi-operation transactions, a source
account different from the linked wallet, and payment operations whose
destination, amount, or configured XLM/USDC asset identity does not match the
intent. Stellar submission errors remain mapped to the service's canonical
failure codes. Real-device NFC, passkey ceremony, and testnet settlement are
exercised by the client runbook; the resulting hash and ledger must still be
independently verified in Horizon before release claims are made.
