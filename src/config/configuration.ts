export default () => ({
  app: {
    nodeEnv: process.env.NODE_ENV,
    port: Number(process.env.PORT),
    apiPrefix: process.env.API_PREFIX,
    corsOrigins: process.env.CORS_ORIGINS,
  },
  database: {
    url: process.env.DATABASE_URL,
    directUrl: process.env.DIRECT_URL,
  },
  supabase: {
    url: process.env.SUPABASE_URL,
    jwtSecret: process.env.SUPABASE_JWT_SECRET,
    // Optional; only set during a JWT secret rotation overlap window.
    previousJwtSecret: process.env.SUPABASE_JWT_SECRET_PREVIOUS,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  },
  stellar: {
    network: process.env.STELLAR_NETWORK,
    horizonUrl: process.env.STELLAR_HORIZON_URL,
    rpcUrl: process.env.STELLAR_RPC_URL,
    usdcIssuer: process.env.STELLAR_USDC_ISSUER,
    networkPassphrase: process.env.STELLAR_NETWORK_PASSPHRASE,
  },
  webauthn: {
    rpId: process.env.WEBAUTHN_RP_ID,
    rpName: process.env.WEBAUTHN_RP_NAME,
    origin: process.env.WEBAUTHN_ORIGIN,
  },
  payments: {
    submitTimeoutMs: Number(process.env.PAYMENT_SUBMIT_TIMEOUT_MS),
    pollIntervalMs: Number(process.env.PAYMENT_POLL_INTERVAL_MS),
    pollMaxAttempts: Number(process.env.PAYMENT_POLL_MAX_ATTEMPTS),
  },
  throttle: {
    ttlMs: Number(process.env.THROTTLE_TTL_MS),
    limit: Number(process.env.THROTTLE_LIMIT),
  },
});
