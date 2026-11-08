#!/usr/bin/env node

import { readFile } from 'node:fs/promises';

const file = process.argv[2];
if (!file) {
  console.error(
    'Usage: npm run validate:evidence -- <sanitized evidence JSON>',
  );
  process.exit(2);
}

const required = [
  'schemaVersion',
  'dateUtc',
  'network',
  'clientCommit',
  'serverCommit',
  'ciRunUrl',
  'receiverWallet',
  'payerWallet',
  'asset',
  'amount',
  'paymentRequestId',
  'paymentIntentId',
  'stellarTransactionHash',
  'horizonTransactionUrl',
  'confirmedLedger',
  'serverHistory',
  'productProof',
];
const proofFields = [
  'requestRegisteredBeforeNfc',
  'payerReviewedIntent',
  'passkeyAuthorizationCompleted',
  'signedXdrSubmitted',
  'receiverReachedConfirmed',
  'historyDisplayedExplorerLink',
  'networkValuesMatched',
  'issuerValuesMatched',
];
const publicKey = /^G[A-Z2-7]{55}$/;
const hash = /^[a-f\d]{64}$/i;
const commit = /^[a-f\d]{7,64}$/i;
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

try {
  const evidence = JSON.parse(await readFile(file, 'utf8'));
  const missing = required.filter((key) => evidence[key] === undefined);
  const errors = [...missing.map((key) => `missing ${key}`)];

  if (evidence.schemaVersion !== 1) errors.push('schemaVersion must be 1');
  if (evidence.network !== 'TESTNET') errors.push('network must be TESTNET');
  if (Number.isNaN(Date.parse(evidence.dateUtc)))
    errors.push('dateUtc must be an ISO date-time');
  if (!commit.test(evidence.clientCommit))
    errors.push('clientCommit must be a Git commit SHA');
  if (!commit.test(evidence.serverCommit))
    errors.push('serverCommit must be a Git commit SHA');
  if (!uuid.test(evidence.paymentRequestId))
    errors.push('paymentRequestId must be a UUID');
  if (!uuid.test(evidence.paymentIntentId))
    errors.push('paymentIntentId must be a UUID');
  if (!['XLM', 'USDC'].includes(evidence.asset))
    errors.push('asset must be XLM or USDC');
  if (
    !/^(?:0|[1-9]\d*)(?:\.\d{1,7})?$/.test(evidence.amount) ||
    Number(evidence.amount) <= 0
  ) {
    errors.push('amount must be a positive decimal with at most 7 places');
  }
  if (
    !publicKey.test(evidence.receiverWallet) ||
    !publicKey.test(evidence.payerWallet)
  ) {
    errors.push('receiverWallet and payerWallet must be Stellar public keys');
  }
  if (!hash.test(evidence.stellarTransactionHash))
    errors.push('stellarTransactionHash must be 64 hex characters');
  if (
    !Number.isInteger(evidence.confirmedLedger) ||
    evidence.confirmedLedger <= 0
  ) {
    errors.push('confirmedLedger must be a positive integer');
  }
  for (const field of proofFields) {
    if (typeof evidence.productProof?.[field] !== 'boolean') {
      errors.push(`productProof.${field} must be boolean`);
    } else if (!evidence.productProof[field]) {
      errors.push(`productProof.${field} must be true for release evidence`);
    }
  }
  if (
    evidence.serverHistory?.sender !== 'SENT' ||
    evidence.serverHistory?.receiver !== 'RECEIVED'
  ) {
    errors.push(
      'serverHistory must contain SENT sender and RECEIVED receiver records',
    );
  }
  if (
    evidence.asset === 'USDC' &&
    !publicKey.test(evidence.assetIssuer ?? '')
  ) {
    errors.push('assetIssuer must be a Stellar public key for USDC evidence');
  }
  for (const urlField of ['ciRunUrl', 'horizonTransactionUrl']) {
    try {
      const url = new URL(evidence[urlField]);
      if (url.protocol !== 'https:') errors.push(`${urlField} must use HTTPS`);
    } catch {
      errors.push(`${urlField} must be a valid URL`);
    }
  }
  try {
    const horizonUrl = new URL(evidence.horizonTransactionUrl);
    if (
      !horizonUrl.pathname.endsWith(
        `/transactions/${evidence.stellarTransactionHash}`,
      )
    ) {
      errors.push(
        'horizonTransactionUrl must point to the recorded transaction hash',
      );
    }
  } catch {
    // The HTTPS/URL validation above reports the actionable error.
  }

  if (errors.length) {
    console.error(errors.map((error) => `- ${error}`).join('\n'));
    process.exitCode = 1;
  } else {
    console.log(
      JSON.stringify({ valid: true, file, schemaVersion: 1 }, null, 2),
    );
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
