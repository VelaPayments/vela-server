import Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'production', 'test').required(),
  PORT: Joi.number().integer().min(1).max(65535).required(),
  API_PREFIX: Joi.string().required(),
  CORS_ORIGINS: Joi.string().required(),
  DATABASE_URL: Joi.string()
    .uri({ scheme: ['postgresql', 'postgres'] })
    .required(),
  DIRECT_URL: Joi.string()
    .uri({ scheme: ['postgresql', 'postgres'] })
    .required(),
  SUPABASE_URL: Joi.string().uri().required(),
  SUPABASE_JWT_SECRET: Joi.string().required(),
  SUPABASE_SERVICE_ROLE_KEY: Joi.string().required(),
  STELLAR_NETWORK: Joi.string().valid('testnet', 'mainnet').required(),
  STELLAR_HORIZON_URL: Joi.string().uri().required(),
  STELLAR_RPC_URL: Joi.string().uri().required(),
  STELLAR_USDC_ISSUER: Joi.string()
    .pattern(/^G[A-Z2-7]{55}$/)
    .required(),
  STELLAR_NETWORK_PASSPHRASE: Joi.string().required(),
  WEBAUTHN_RP_ID: Joi.string().required(),
  WEBAUTHN_RP_NAME: Joi.string().required(),
  WEBAUTHN_ORIGIN: Joi.string().uri().required(),
  PAYMENT_SUBMIT_TIMEOUT_MS: Joi.number().integer().positive().required(),
  PAYMENT_POLL_INTERVAL_MS: Joi.number().integer().positive().required(),
  PAYMENT_POLL_MAX_ATTEMPTS: Joi.number().integer().positive().required(),
  THROTTLE_TTL_MS: Joi.number().integer().positive().required(),
  THROTTLE_LIMIT: Joi.number().integer().positive().required(),
}).unknown(true);
