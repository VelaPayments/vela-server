#!/usr/bin/env node

const hash = process.argv[2];
const horizonUrl =
  process.env.STELLAR_HORIZON_URL ?? 'https://horizon-testnet.stellar.org';
const network = process.env.STELLAR_NETWORK ?? 'testnet';
const timeoutMs = Number(process.env.STELLAR_VERIFY_TIMEOUT_MS ?? 15_000);
const expected = {
  payer: process.env.STELLAR_EXPECTED_PAYER,
  receiver: process.env.STELLAR_EXPECTED_RECEIVER,
  asset: process.env.STELLAR_EXPECTED_ASSET,
  amount: process.env.STELLAR_EXPECTED_AMOUNT,
  issuer: process.env.STELLAR_EXPECTED_ISSUER,
  memo: process.env.STELLAR_EXPECTED_MEMO,
};
const expectationKeys = ['payer', 'receiver', 'asset', 'amount'];
const hasExpectedPayment = expectationKeys.some((key) => expected[key]);

function normalizeAmount(value) {
  const [whole, fraction = ''] = String(value).split('.');
  const normalizedWhole = whole.replace(/^0+(?=\d)/, '') || '0';
  const normalizedFraction = fraction.replace(/0+$/, '');
  return normalizedFraction
    ? `${normalizedWhole}.${normalizedFraction}`
    : normalizedWhole;
}

if (!hash || !/^[a-f\d]{64}$/i.test(hash)) {
  console.error(
    'Usage: npm run verify:transaction -- <64-character Stellar transaction hash>',
  );
  process.exit(2);
}

if (network !== 'testnet') {
  console.error(
    `Refusing testnet verification for STELLAR_NETWORK=${network}.`,
  );
  process.exit(2);
}

if (hasExpectedPayment && expectationKeys.some((key) => !expected[key])) {
  console.error(
    'Expected-payment verification requires STELLAR_EXPECTED_PAYER, ' +
      'STELLAR_EXPECTED_RECEIVER, STELLAR_EXPECTED_ASSET, and ' +
      'STELLAR_EXPECTED_AMOUNT together.',
  );
  process.exit(2);
}

if (expected.asset && !['XLM', 'USDC'].includes(expected.asset)) {
  console.error('STELLAR_EXPECTED_ASSET must be XLM or USDC.');
  process.exit(2);
}

if (expected.asset === 'USDC' && !expected.issuer) {
  console.error(
    'STELLAR_EXPECTED_ISSUER is required when expected asset is USDC.',
  );
  process.exit(2);
}

async function getJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(`Horizon returned HTTP ${response.status} for ${url}`);
    }
    return body;
  } finally {
    clearTimeout(timeout);
  }
}

try {
  const base = horizonUrl.replace(/\/$/, '');
  const transaction = await getJson(`${base}/transactions/${hash}`);
  const operations = await getJson(
    `${base}/operations?transaction=${hash}&limit=100`,
  );
  const paymentOperations = (operations.records ?? [])
    .filter((operation) => operation.type === 'payment')
    .map((operation) => ({
      id: operation.id,
      from: operation.from,
      to: operation.to,
      amount: operation.amount,
      assetType: operation.asset_type,
      assetCode:
        operation.asset_type === 'native' ? 'XLM' : operation.asset_code,
      assetIssuer: operation.asset_issuer ?? null,
    }));

  const matchedPaymentOperation = hasExpectedPayment
    ? paymentOperations.find(
        (operation) =>
          operation.from === expected.payer &&
          operation.to === expected.receiver &&
          operation.assetCode === expected.asset &&
          normalizeAmount(operation.amount) ===
            normalizeAmount(expected.amount) &&
          (!expected.issuer || operation.assetIssuer === expected.issuer) &&
          (!expected.memo ||
            (transaction.memo_type === 'text' &&
              transaction.memo === expected.memo)),
      )
    : undefined;
  const paymentVerified = hasExpectedPayment
    ? Boolean(matchedPaymentOperation)
    : paymentOperations.length > 0;

  const result = {
    verification:
      transaction.successful && paymentVerified ? 'passed' : 'failed',
    checkedAt: new Date().toISOString(),
    network,
    horizonUrl: base,
    transaction: {
      hash: transaction.hash,
      successful: transaction.successful,
      ledger: transaction.ledger,
      createdAt: transaction.created_at,
      sourceAccount: transaction.source_account,
      memoType: transaction.memo_type,
      memo: transaction.memo ?? null,
    },
    paymentOperations,
    expectedPayment: hasExpectedPayment ? expected : null,
    matchedPaymentOperation: matchedPaymentOperation ?? null,
  };

  console.log(JSON.stringify(result, null, 2));
  if (result.verification !== 'passed') process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
