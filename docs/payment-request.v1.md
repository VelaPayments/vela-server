# payment-request.v1

`payment-request.v1` is the canonical NFC payment request contract for Vela
mobile and server flows. Producers must emit this exact shape, and consumers
must reject invalid payloads with deterministic error codes.

## Required Fields

| Field       | Type   | Rule                                                                                                  |
| ----------- | ------ | ----------------------------------------------------------------------------------------------------- |
| `type`      | string | Must be `payment-request`.                                                                            |
| `version`   | number | Must be `1`.                                                                                          |
| `recipient` | string | Stellar public key in `G...` StrKey form: `^G[A-Z2-7]{55}$`.                                          |
| `asset`     | string | MVP supports only `XLM` and `USDC`.                                                                   |
| `amount`    | string | Positive decimal string with at most 7 decimal places.                                                |
| `timestamp` | string | ISO 8601 UTC date-time within 5 minutes of server time.                                               |
| `expiresAt` | string | ISO 8601 UTC date-time after `timestamp`, in the future, and no more than 24 hours after `timestamp`. |

## Optional Fields

| Field       | Type   | Rule                                                        |
| ----------- | ------ | ----------------------------------------------------------- |
| `memo`      | string | Optional user-facing memo, up to 280 characters.            |
| `requestId` | string | Optional idempotency or trace identifier, 1-128 characters. |
| `metadata`  | object | Optional JSON object for non-critical integration context.  |

Unknown fields are rejected. Amounts are strings so NFC producers do not lose
precision through JSON number parsing.

The mobile NFC codec adapts its internal `payment_request` representation,
whose timestamps are Unix seconds, to this wire contract. NFC bytes use the
versioned `payment-request` type above and ISO 8601 UTC timestamps. The shared
fixture at `test/fixtures/payment-request.v1.json` is also included in the
mobile repository and is validated by both implementations.

## Valid Payload

```json
{
  "type": "payment-request",
  "version": 1,
  "recipient": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  "asset": "XLM",
  "amount": "12.3456789",
  "timestamp": "2026-05-29T12:00:00.000Z",
  "expiresAt": "2026-05-29T12:15:00.000Z",
  "memo": "Coffee",
  "requestId": "req_123",
  "metadata": {
    "table": 7
  }
}
```

## Common Invalid Payloads

Unsupported asset:

```json
{
  "type": "payment-request",
  "version": 1,
  "recipient": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  "asset": "BTC",
  "amount": "12.50",
  "timestamp": "2026-05-29T12:00:00.000Z",
  "expiresAt": "2026-05-29T12:15:00.000Z"
}
```

Error:

```json
{
  "code": "PAYMENT_REQUEST_ASSET_UNSUPPORTED",
  "message": "asset must be one of: XLM, USDC.",
  "field": "asset"
}
```

Invalid amount:

```json
{
  "type": "payment-request",
  "version": 1,
  "recipient": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  "asset": "USDC",
  "amount": "1.12345678",
  "timestamp": "2026-05-29T12:00:00.000Z",
  "expiresAt": "2026-05-29T12:15:00.000Z"
}
```

Error:

```json
{
  "code": "PAYMENT_REQUEST_AMOUNT_INVALID",
  "message": "amount must be a positive decimal string with at most 7 decimal places.",
  "field": "amount"
}
```

Expiration before timestamp:

```json
{
  "type": "payment-request",
  "version": 1,
  "recipient": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  "asset": "XLM",
  "amount": "12.50",
  "timestamp": "2026-05-29T12:00:00.000Z",
  "expiresAt": "2026-05-29T11:59:59.000Z"
}
```

Errors:

```json
[
  {
    "code": "PAYMENT_REQUEST_EXPIRES_AT_OUT_OF_WINDOW",
    "message": "expiresAt must be in the future.",
    "field": "expiresAt"
  },
  {
    "code": "PAYMENT_REQUEST_EXPIRES_AT_OUT_OF_WINDOW",
    "message": "expiresAt must be after timestamp.",
    "field": "expiresAt"
  }
]
```

Invalid Stellar recipient:

```json
{
  "type": "payment-request",
  "version": 1,
  "recipient": "not-stellar",
  "asset": "XLM",
  "amount": "12.50",
  "timestamp": "2026-05-29T12:00:00.000Z",
  "expiresAt": "2026-05-29T12:15:00.000Z"
}
```

Error:

```json
{
  "code": "PAYMENT_REQUEST_RECIPIENT_INVALID",
  "message": "recipient must be a Stellar public key starting with G.",
  "field": "recipient"
}
```

## Versioning Strategy

`type` identifies the protocol family and `version` identifies the exact
contract. Consumers should dispatch validation by `(type, version)`.

Backward-compatible v1 changes may clarify documentation, add optional fields
that old consumers can ignore only after the unknown-field rule is intentionally
revised, or add examples without changing validation behavior.

Breaking changes require a new version, such as `version: 2`. A future
`payment-request.v2` validator should live beside v1, keep v1 tests intact, and
allow clients and servers to negotiate or route by version during migration.

## Client compatibility

The client encodes this versioned wire format and accepts the previous internal format for existing NFC tags. Fresh native reads enforce the same five-minute clock window and 24-hour expiration limit as the server. Leading-zero amounts and calendar-normalized invalid UTC dates are rejected. Optional memo and request ID limits are enforced in both validators.

Wire timestamps preserve millisecond precision. The client stores these as Unix seconds, including fractional seconds when supplied by the wire format. Codec decoding without `rejectExpired` performs structural validation for archival inspection; live readers enable freshness checks. Encoding validates the internal request before serialization.
