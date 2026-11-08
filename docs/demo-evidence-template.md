# Vela Stellar Wave Evidence

Use one copy of this template for each verified testnet transfer. Keep the file free of secrets and commit only sanitized evidence.

## Transfer

- Date/time (UTC):
- Network: `TESTNET`
- Client commit (7-64 hexadecimal characters):
- Server commit (7-64 hexadecimal characters):
- CI workflow/run URL:
- Receiver wallet:
- Payer wallet:
- Asset and amount:
- Asset issuer (USDC only):
- Payment request ID (UUID):
- Payment intent ID (UUID):
- Stellar transaction hash (64 hexadecimal characters):
- Horizon transaction URL:
- Confirmed ledger (positive integer):
- Server history records: sender `SENT` / receiver `RECEIVED`

## Product proof

- Receiver request created and registered before NFC broadcast: yes/no
- Payer displayed destination and amount before approval: yes/no
- Passkey authorization completed: yes/no
- Signed XDR submitted by the Vela server: yes/no
- Receiver status changed to confirmed from server polling: yes/no
- History screen displayed the transaction with an explorer link: yes/no
- Client/server network values matched: yes/no
- Client/server USDC issuer values matched (USDC only): yes/no

## Attachments

Include sanitized screenshots of the receiver waiting state, payer review state, payer success state, receiver success state, and history entry. Do not attach Supabase tokens, passkey payloads, secret keys, seed phrases, or unredacted logs.

Before attaching the record, run `npm run validate:evidence -- <file>`. The validator rejects placeholders, incomplete product proof, and Horizon URLs that do not contain the recorded transaction hash.
