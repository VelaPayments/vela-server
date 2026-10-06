import { readFileSync } from 'node:fs';

import {
  PaymentRequestV1,
  validatePaymentRequestV1,
} from './payment-request.v1';

const NOW = new Date('2026-05-29T12:00:00.000Z');
const VALID_RECIPIENT = `G${'A'.repeat(55)}`;

function validPayload(
  overrides: Partial<PaymentRequestV1> = {},
): PaymentRequestV1 {
  return {
    type: 'payment-request',
    version: 1,
    recipient: VALID_RECIPIENT,
    asset: 'XLM',
    amount: '12.3456789',
    timestamp: '2026-05-29T12:00:00.000Z',
    expiresAt: '2026-05-29T12:15:00.000Z',
    ...overrides,
  };
}

describe('payment-request.v1 contract', () => {
  it('accepts the shared mobile NFC fixture', () => {
    const fixture = JSON.parse(
      readFileSync('test/fixtures/payment-request.v1.json', 'utf8'),
    ) as PaymentRequestV1;
    expect(validatePaymentRequestV1(fixture, NOW)).toEqual({
      valid: true,
      value: fixture,
      errors: [],
    });
  });

  it('accepts a valid minimal payment request', () => {
    const result = validatePaymentRequestV1(validPayload(), NOW);

    expect(result).toEqual({
      valid: true,
      value: validPayload(),
      errors: [],
    });
  });

  it('accepts optional memo, requestId, and metadata fields', () => {
    const payload = validPayload({
      memo: 'Coffee',
      requestId: 'req_123',
      metadata: { table: 7 },
    });

    const result = validatePaymentRequestV1(payload, NOW);

    expect(result).toEqual({
      valid: true,
      value: payload,
      errors: [],
    });
  });

  it('rejects missing required fields deterministically', () => {
    const payload: Partial<PaymentRequestV1> = validPayload();
    delete payload.recipient;

    expect(validatePaymentRequestV1(payload, NOW)).toEqual({
      valid: false,
      errors: [
        {
          code: 'PAYMENT_REQUEST_FIELD_REQUIRED',
          message: 'Missing required field: recipient.',
          field: 'recipient',
        },
      ],
    });
  });

  it('rejects unsupported contract type', () => {
    expect(
      validatePaymentRequestV1(validPayload({ type: 'invoice' as never }), NOW),
    ).toEqual({
      valid: false,
      errors: [
        {
          code: 'PAYMENT_REQUEST_TYPE_UNSUPPORTED',
          message: 'type must be payment-request.',
          field: 'type',
        },
      ],
    });
  });

  it('rejects unsupported contract version', () => {
    expect(
      validatePaymentRequestV1(validPayload({ version: 2 as 1 }), NOW),
    ).toEqual({
      valid: false,
      errors: [
        {
          code: 'PAYMENT_REQUEST_VERSION_UNSUPPORTED',
          message: 'version must be 1.',
          field: 'version',
        },
      ],
    });
  });

  it('rejects unsupported assets', () => {
    expect(
      validatePaymentRequestV1(validPayload({ asset: 'BTC' as never }), NOW),
    ).toEqual({
      valid: false,
      errors: [
        {
          code: 'PAYMENT_REQUEST_ASSET_UNSUPPORTED',
          message: 'asset must be one of: XLM, USDC.',
          field: 'asset',
        },
      ],
    });
  });

  it.each(['0', '-1', '1.12345678', '1.', '01'])(
    'rejects invalid amount %s',
    (amount) => {
      expect(validatePaymentRequestV1(validPayload({ amount }), NOW)).toEqual({
        valid: false,
        errors: [
          {
            code: 'PAYMENT_REQUEST_AMOUNT_INVALID',
            message:
              'amount must be a positive decimal string with at most 7 decimal places.',
            field: 'amount',
          },
        ],
      });
    },
  );

  it('rejects invalid Stellar recipients', () => {
    expect(
      validatePaymentRequestV1(validPayload({ recipient: 'not-stellar' }), NOW),
    ).toEqual({
      valid: false,
      errors: [
        {
          code: 'PAYMENT_REQUEST_RECIPIENT_INVALID',
          message: 'recipient must be a Stellar public key starting with G.',
          field: 'recipient',
        },
      ],
    });
  });

  it('rejects timestamps outside the allowed server clock window', () => {
    expect(
      validatePaymentRequestV1(
        validPayload({ timestamp: '2026-05-29T11:54:59.000Z' }),
        NOW,
      ),
    ).toEqual({
      valid: false,
      errors: [
        {
          code: 'PAYMENT_REQUEST_TIMESTAMP_OUT_OF_WINDOW',
          message: 'timestamp must be within 5 minutes of server time.',
          field: 'timestamp',
        },
      ],
    });
  });

  it('rejects invalid timestamp formats', () => {
    expect(
      validatePaymentRequestV1(
        validPayload({ timestamp: '2026-05-29 12:00:00' }),
        NOW,
      ),
    ).toEqual({
      valid: false,
      errors: [
        {
          code: 'PAYMENT_REQUEST_TIMESTAMP_INVALID',
          message: 'timestamp must be an ISO 8601 UTC date-time string.',
          field: 'timestamp',
        },
      ],
    });
  });

  it('rejects expirations before the timestamp', () => {
    expect(
      validatePaymentRequestV1(
        validPayload({ expiresAt: '2026-05-29T11:59:59.000Z' }),
        NOW,
      ),
    ).toEqual({
      valid: false,
      errors: [
        {
          code: 'PAYMENT_REQUEST_EXPIRES_AT_OUT_OF_WINDOW',
          message: 'expiresAt must be in the future.',
          field: 'expiresAt',
        },
        {
          code: 'PAYMENT_REQUEST_EXPIRES_AT_OUT_OF_WINDOW',
          message: 'expiresAt must be after timestamp.',
          field: 'expiresAt',
        },
      ],
    });
  });

  it('rejects expirations more than 24 hours after the timestamp', () => {
    expect(
      validatePaymentRequestV1(
        validPayload({ expiresAt: '2026-05-30T12:00:01.000Z' }),
        NOW,
      ),
    ).toEqual({
      valid: false,
      errors: [
        {
          code: 'PAYMENT_REQUEST_EXPIRES_AT_OUT_OF_WINDOW',
          message: 'expiresAt must be no more than 24 hours after timestamp.',
          field: 'expiresAt',
        },
      ],
    });
  });

  it('rejects non-object metadata', () => {
    expect(
      validatePaymentRequestV1(validPayload({ metadata: [] as never }), NOW),
    ).toEqual({
      valid: false,
      errors: [
        {
          code: 'PAYMENT_REQUEST_METADATA_INVALID',
          message: 'metadata must be a JSON object when provided.',
          field: 'metadata',
        },
      ],
    });
  });

  it('rejects unknown fields', () => {
    expect(
      validatePaymentRequestV1({ ...validPayload(), extra: true }, NOW),
    ).toEqual({
      valid: false,
      errors: [
        {
          code: 'PAYMENT_REQUEST_FIELD_UNKNOWN',
          message: 'Unknown field: extra.',
          field: 'payload',
        },
      ],
    });
  });
});
