#!/usr/bin/env node

const horizonUrl =
  process.env.STELLAR_HORIZON_URL ?? 'https://horizon-testnet.stellar.org';
const rpcUrl =
  process.env.STELLAR_RPC_URL ?? 'https://soroban-testnet.stellar.org';
const network = process.env.STELLAR_NETWORK ?? 'testnet';
const timeoutMs = Number(process.env.STELLAR_HEALTH_TIMEOUT_MS ?? 15_000);
const TESTNET_NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015';

if (network !== 'testnet') {
  console.error(`Refusing testnet check for STELLAR_NETWORK=${network}.`);
  process.exit(2);
}

async function readJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    const body = await response.json().catch(() => ({}));
    return { ok: response.ok, status: response.status, body };
  } finally {
    clearTimeout(timeout);
  }
}

const checkedAt = new Date().toISOString();
const result = {
  checkedAt,
  network,
  horizon: { url: horizonUrl, healthy: false },
  rpc: { url: rpcUrl, healthy: false },
};

try {
  const horizon = await readJson(horizonUrl);
  result.horizon = {
    url: horizonUrl,
    healthy:
      horizon.ok &&
      horizon.body.network_passphrase === TESTNET_NETWORK_PASSPHRASE &&
      Number.isInteger(horizon.body.history_latest_ledger),
    status: horizon.status,
    networkPassphraseMatched:
      horizon.body.network_passphrase === TESTNET_NETWORK_PASSPHRASE,
    networkPassphrase: horizon.body.network_passphrase,
    latestLedger: horizon.body.history_latest_ledger,
  };
} catch (error) {
  result.horizon.error = error instanceof Error ? error.message : String(error);
}

try {
  const healthUrl = `${rpcUrl.replace(/\/$/, '')}/health`;
  const rpc = await readJson(healthUrl);
  result.rpc = {
    url: healthUrl,
    healthy: rpc.ok && rpc.body.status === 'healthy',
    status: rpc.status,
    providerStatus: rpc.body.status,
    latestLedger: rpc.body.latestLedger,
  };
} catch (error) {
  result.rpc.error = error instanceof Error ? error.message : String(error);
}

console.log(JSON.stringify(result, null, 2));
if (!result.horizon.healthy || !result.rpc.healthy) process.exitCode = 1;
