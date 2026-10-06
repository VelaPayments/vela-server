export const PAYMENT_REQUEST_V1_TYPE = 'payment-request';
export const PAYMENT_REQUEST_V1_VERSION = 1;

export const PAYMENT_REQUEST_V1_SUPPORTED_ASSETS = ['XLM', 'USDC'] as const;

export type PaymentRequestV1Asset =
  (typeof PAYMENT_REQUEST_V1_SUPPORTED_ASSETS)[number];

export interface PaymentRequestV1 {
  type: typeof PAYMENT_REQUEST_V1_TYPE;
  version: typeof PAYMENT_REQUEST_V1_VERSION;
  recipient: string;
  asset: PaymentRequestV1Asset;
  amount: string;
  timestamp: string;
  expiresAt: string;
  memo?: string;
  requestId?: string;
  metadata?: Record<string, unknown>;
}

export interface PaymentRequestValidationError {
  code: PaymentRequestValidationErrorCode;
  message: string;
  field?: keyof PaymentRequestV1 | 'payload';
}

export type PaymentRequestValidationErrorCode =
  | 'PAYMENT_REQUEST_PAYLOAD_INVALID'
  | 'PAYMENT_REQUEST_FIELD_REQUIRED'
  | 'PAYMENT_REQUEST_FIELD_UNKNOWN'
  | 'PAYMENT_REQUEST_TYPE_UNSUPPORTED'
  | 'PAYMENT_REQUEST_VERSION_UNSUPPORTED'
  | 'PAYMENT_REQUEST_RECIPIENT_INVALID'
  | 'PAYMENT_REQUEST_ASSET_UNSUPPORTED'
  | 'PAYMENT_REQUEST_AMOUNT_INVALID'
  | 'PAYMENT_REQUEST_TIMESTAMP_INVALID'
  | 'PAYMENT_REQUEST_TIMESTAMP_OUT_OF_WINDOW'
  | 'PAYMENT_REQUEST_EXPIRES_AT_INVALID'
  | 'PAYMENT_REQUEST_EXPIRES_AT_OUT_OF_WINDOW'
  | 'PAYMENT_REQUEST_METADATA_INVALID'
  | 'PAYMENT_REQUEST_MEMO_INVALID'
  | 'PAYMENT_REQUEST_ID_INVALID';

export type PaymentRequestValidationResult =
  | {
      valid: true;
      value: PaymentRequestV1;
      errors: [];
    }
  | {
      valid: false;
      errors: PaymentRequestValidationError[];
    };

export const paymentRequestV1JsonSchema = {
  $id: 'https://github.com/VelaPayments/vela-server/blob/main/docs/payment-request.v1.md',
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'payment-request.v1',
  type: 'object',
  additionalProperties: false,
  required: [
    'type',
    'version',
    'recipient',
    'asset',
    'amount',
    'timestamp',
    'expiresAt',
  ],
  properties: {
    type: { const: PAYMENT_REQUEST_V1_TYPE },
    version: { const: PAYMENT_REQUEST_V1_VERSION },
    recipient: {
      type: 'string',
      pattern: '^G[A-Z2-7]{55}$',
    },
    asset: {
      type: 'string',
      enum: PAYMENT_REQUEST_V1_SUPPORTED_ASSETS,
    },
    amount: {
      type: 'string',
      pattern: '^(?!0+(?:\\.0{1,7})?$)(?:0|[1-9]\\d*)(?:\\.\\d{1,7})?$',
    },
    timestamp: {
      type: 'string',
      format: 'date-time',
    },
    expiresAt: {
      type: 'string',
      format: 'date-time',
    },
    memo: {
      type: 'string',
      maxLength: 280,
    },
    requestId: {
      type: 'string',
      minLength: 1,
      maxLength: 128,
    },
    metadata: {
      type: 'object',
      additionalProperties: true,
    },
  },
} as const;

const ALLOWED_FIELDS = new Set([
  'type',
  'version',
  'recipient',
  'asset',
  'amount',
  'timestamp',
  'expiresAt',
  'memo',
  'requestId',
  'metadata',
]);

const REQUIRED_FIELDS: Array<keyof PaymentRequestV1> = [
  'type',
  'version',
  'recipient',
  'asset',
  'amount',
  'timestamp',
  'expiresAt',
];

const STELLAR_ADDRESS_PATTERN = /^G[A-Z2-7]{55}$/;
const ISO_UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const AMOUNT_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d{1,7})?$/;
const MAX_DECIMAL_PLACES = 7;
const TIMESTAMP_CLOCK_SKEW_MS = 5 * 60 * 1000;
const MAX_EXPIRATION_WINDOW_MS = 24 * 60 * 60 * 1000;

export function validatePaymentRequestV1(
  payload: unknown,
  now = new Date(),
): PaymentRequestValidationResult {
  const errors: PaymentRequestValidationError[] = [];

  if (!isPlainObject(payload)) {
    return {
      valid: false,
      errors: [
        {
          code: 'PAYMENT_REQUEST_PAYLOAD_INVALID',
          message: 'Payment request payload must be a JSON object.',
          field: 'payload',
        },
      ],
    };
  }

  for (const field of Object.keys(payload).sort()) {
    if (!ALLOWED_FIELDS.has(field)) {
      errors.push({
        code: 'PAYMENT_REQUEST_FIELD_UNKNOWN',
        message: `Unknown field: ${field}.`,
        field: 'payload',
      });
    }
  }

  for (const field of REQUIRED_FIELDS) {
    if (!(field in payload)) {
      errors.push({
        code: 'PAYMENT_REQUEST_FIELD_REQUIRED',
        message: `Missing required field: ${field}.`,
        field,
      });
    }
  }

  validateType(payload.type, errors);
  validateVersion(payload.version, errors);
  validateRecipient(payload.recipient, errors);
  validateAsset(payload.asset, errors);
  validateAmount(payload.amount, errors);
  validateMetadata(payload.metadata, errors);
  if (
    payload.memo !== undefined &&
    (typeof payload.memo !== 'string' || payload.memo.length > 280)
  ) {
    errors.push({
      code: 'PAYMENT_REQUEST_MEMO_INVALID',
      message: 'memo must be a string with at most 280 characters.',
      field: 'memo',
    });
  }
  if (
    payload.requestId !== undefined &&
    (typeof payload.requestId !== 'string' ||
      payload.requestId.length < 1 ||
      payload.requestId.length > 128)
  ) {
    errors.push({
      code: 'PAYMENT_REQUEST_ID_INVALID',
      message: 'requestId must be a string containing 1 to 128 characters.',
      field: 'requestId',
    });
  }

  const timestamp = parseIsoUtcDate(payload.timestamp);
  const expiresAt = parseIsoUtcDate(payload.expiresAt);

  validateTimestamp(payload.timestamp, timestamp, now, errors);
  validateExpiresAt(payload.expiresAt, expiresAt, timestamp, now, errors);

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    value: payload as unknown as PaymentRequestV1,
    errors: [],
  };
}

function validateType(
  type: unknown,
  errors: PaymentRequestValidationError[],
): void {
  if (type === undefined) {
    return;
  }

  if (type !== PAYMENT_REQUEST_V1_TYPE) {
    errors.push({
      code: 'PAYMENT_REQUEST_TYPE_UNSUPPORTED',
      message: 'type must be payment-request.',
      field: 'type',
    });
  }
}

function validateVersion(
  version: unknown,
  errors: PaymentRequestValidationError[],
): void {
  if (version === undefined) {
    return;
  }

  if (version !== PAYMENT_REQUEST_V1_VERSION) {
    errors.push({
      code: 'PAYMENT_REQUEST_VERSION_UNSUPPORTED',
      message: 'version must be 1.',
      field: 'version',
    });
  }
}

function validateRecipient(
  recipient: unknown,
  errors: PaymentRequestValidationError[],
): void {
  if (recipient === undefined) {
    return;
  }

  if (
    typeof recipient !== 'string' ||
    !STELLAR_ADDRESS_PATTERN.test(recipient)
  ) {
    errors.push({
      code: 'PAYMENT_REQUEST_RECIPIENT_INVALID',
      message: 'recipient must be a Stellar public key starting with G.',
      field: 'recipient',
    });
  }
}

function validateAsset(
  asset: unknown,
  errors: PaymentRequestValidationError[],
): void {
  if (asset === undefined) {
    return;
  }

  if (
    typeof asset !== 'string' ||
    !PAYMENT_REQUEST_V1_SUPPORTED_ASSETS.includes(
      asset as PaymentRequestV1Asset,
    )
  ) {
    errors.push({
      code: 'PAYMENT_REQUEST_ASSET_UNSUPPORTED',
      message: 'asset must be one of: XLM, USDC.',
      field: 'asset',
    });
  }
}

function validateAmount(
  amount: unknown,
  errors: PaymentRequestValidationError[],
): void {
  if (amount === undefined) {
    return;
  }

  if (typeof amount !== 'string' || !AMOUNT_PATTERN.test(amount)) {
    errors.push({
      code: 'PAYMENT_REQUEST_AMOUNT_INVALID',
      message:
        'amount must be a positive decimal string with at most 7 decimal places.',
      field: 'amount',
    });
    return;
  }

  const [, fractional = ''] = amount.split('.');
  const numericAmount = Number(amount);

  if (
    !Number.isFinite(numericAmount) ||
    numericAmount <= 0 ||
    fractional.length > MAX_DECIMAL_PLACES
  ) {
    errors.push({
      code: 'PAYMENT_REQUEST_AMOUNT_INVALID',
      message:
        'amount must be a positive decimal string with at most 7 decimal places.',
      field: 'amount',
    });
  }
}

function validateTimestamp(
  timestampValue: unknown,
  timestamp: Date | undefined,
  now: Date,
  errors: PaymentRequestValidationError[],
): void {
  if (timestampValue === undefined) {
    return;
  }

  if (!timestamp) {
    errors.push({
      code: 'PAYMENT_REQUEST_TIMESTAMP_INVALID',
      message: 'timestamp must be an ISO 8601 UTC date-time string.',
      field: 'timestamp',
    });
    return;
  }

  const earliestTimestamp = now.getTime() - TIMESTAMP_CLOCK_SKEW_MS;
  const latestTimestamp = now.getTime() + TIMESTAMP_CLOCK_SKEW_MS;

  if (
    timestamp.getTime() < earliestTimestamp ||
    timestamp.getTime() > latestTimestamp
  ) {
    errors.push({
      code: 'PAYMENT_REQUEST_TIMESTAMP_OUT_OF_WINDOW',
      message: 'timestamp must be within 5 minutes of server time.',
      field: 'timestamp',
    });
  }
}

function validateExpiresAt(
  expiresAtValue: unknown,
  expiresAt: Date | undefined,
  timestamp: Date | undefined,
  now: Date,
  errors: PaymentRequestValidationError[],
): void {
  if (expiresAtValue === undefined) {
    return;
  }

  if (!expiresAt) {
    errors.push({
      code: 'PAYMENT_REQUEST_EXPIRES_AT_INVALID',
      message: 'expiresAt must be an ISO 8601 UTC date-time string.',
      field: 'expiresAt',
    });
    return;
  }

  if (expiresAt.getTime() <= now.getTime()) {
    errors.push({
      code: 'PAYMENT_REQUEST_EXPIRES_AT_OUT_OF_WINDOW',
      message: 'expiresAt must be in the future.',
      field: 'expiresAt',
    });
  }

  if (timestamp && expiresAt.getTime() <= timestamp.getTime()) {
    errors.push({
      code: 'PAYMENT_REQUEST_EXPIRES_AT_OUT_OF_WINDOW',
      message: 'expiresAt must be after timestamp.',
      field: 'expiresAt',
    });
  }

  if (
    timestamp &&
    expiresAt.getTime() - timestamp.getTime() > MAX_EXPIRATION_WINDOW_MS
  ) {
    errors.push({
      code: 'PAYMENT_REQUEST_EXPIRES_AT_OUT_OF_WINDOW',
      message: 'expiresAt must be no more than 24 hours after timestamp.',
      field: 'expiresAt',
    });
  }
}

function validateMetadata(
  metadata: unknown,
  errors: PaymentRequestValidationError[],
): void {
  if (metadata === undefined) {
    return;
  }

  if (!isPlainObject(metadata)) {
    errors.push({
      code: 'PAYMENT_REQUEST_METADATA_INVALID',
      message: 'metadata must be a JSON object when provided.',
      field: 'metadata',
    });
  }
}

function parseIsoUtcDate(value: unknown): Date | undefined {
  if (typeof value !== 'string' || !ISO_UTC_PATTERN.test(value)) {
    return undefined;
  }

  const date = new Date(value);

  const canonical = value.includes('.') ? value : value.replace('Z', '.000Z');
  if (Number.isNaN(date.getTime()) || date.toISOString() !== canonical) {
    return undefined;
  }

  return date;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}
