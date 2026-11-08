# Stellar Testnet E2E Runbook

This runbook is the release evidence path for the Vela payment lifecycle.

## Configure

1. Set the server Supabase JWT secret and database URL in `vela-server/.env`.
2. Apply the forward migration with `npm run prisma:migrate:deploy`.
3. Set the client `EXPO_PUBLIC_API_URL` to the server's LAN URL, for example `http://192.168.1.20:3000/v1`.
4. Configure the client Supabase URL and anon key. Never place a service-role key in Expo variables.
5. Keep both client and server on Stellar testnet; confirm the configured USDC issuer before testing USDC.
6. Before using either device, verify `GET http://<server-host>:3000/v1/health/ready` reports `status: ok`, and verify `GET http://<server-host>:3000/v1/health/stellar` reports `network: testnet`, `horizon.networkPassphraseMatched: true`, and healthy Horizon/RPC checks. From the server repository, `npm run check:testnet` performs the same provider and Horizon network-identity checks without requiring the Nest server or database and prints sanitized JSON suitable for the evidence record. The server CI workflow also exposes this as a manual `workflow_dispatch` health job.
7. For native passkeys, set `WEBAUTHN_RP_ID`, `WEBAUTHN_ORIGIN`, and
   `EXPO_PUBLIC_WEBAUTHN_RP_ID` to the same deployed relying-party domain and
   publish the required Apple and Android association files.

## Exercise the flow

1. Create or sign into a Supabase user and register a device passkey.
2. Create a testnet wallet in the client and confirm the wallet appears from `GET /v1/users/me`.
   Wallet linking and payment requests are network-scoped; use `TESTNET` while the server is on testnet.
3. On a receiver device, create a request. The client registers the request before broadcasting its `payment_request.v1` NFC payload.
   The API response should report `network: TESTNET`; do not continue if it reports another network.
4. On a payer device, scan the payload, create a payment intent, authorize it with the server WebAuthn challenge, sign the returned XDR locally, and submit it.
   If you are testing the RPC diagnostic surface, send the unsigned envelope to
   `POST /v1/transactions/simulate` before signing and record whether the
   configured provider accepts it. A simulation response is not settlement
   evidence and does not replace Horizon confirmation.
5. Record the client/server commit SHAs, CI run URL, payment UUID, Stellar transaction hash, network, issuer (for USDC), ledger, and Horizon URL. Run the verifier with the captured payment fields so it proves the exact operation, for example:
   `STELLAR_EXPECTED_PAYER=<payer> STELLAR_EXPECTED_RECEIVER=<receiver> STELLAR_EXPECTED_ASSET=XLM STELLAR_EXPECTED_AMOUNT=1.00 npm run verify:transaction -- <hash>`.
   Decimal formatting differences such as `1`, `1.00`, and `1.0000000` are normalized without floating-point conversion.
   Add `STELLAR_EXPECTED_ISSUER=<issuer>` for USDC and `STELLAR_EXPECTED_MEMO=<memo>` when applicable. Attach its sanitized JSON output; the verifier independently checks the successful transaction and matching payment operation in Horizon. The manual server workflow exposes the same optional expectation inputs, so a CI run can preserve the exact-operation verification output.
6. Copy `demo-evidence.example.json`, replace the placeholders with sanitized values, mark only observed product-proof fields `true`, and run `npm run validate:evidence -- <file>` before submitting the record.
7. With each user session, call `GET /v1/transactions?page=1&limit=20` and
   confirm the sender has one `SENT` record and the receiver has one `RECEIVED`
   record for the same transaction hash. Use `asset`, `direction`, `from`, or
   `to` filters when checking a larger history. Refresh the client History tab
   and confirm the matching Horizon row is labeled `Indexed by Vela`. Compare
   this application index with Horizon before capturing the final evidence.

## Evidence checklist

Attach the request/intent IDs, sanitized API responses, Horizon link, and screenshots of the receiver waiting and success states. Do not attach secrets, access tokens, seed phrases, or raw private key material.
