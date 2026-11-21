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
  // Matching the current secret almost always means the swap was forgotten,
  // so fail fast instead of silently running without an overlap window.
  SUPABASE_JWT_SECRET_PREVIOUS: Joi.string()
    .allow('')
    .invalid(Joi.ref('SUPABASE_JWT_SECRET'))
    .messages({
      'any.invalid':
        '"SUPABASE_JWT_SECRET_PREVIOUS" must differ from "SUPABASE_JWT_SECRET"',
    })
    .optional(),
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
  PAYMENT_POLL_INTERVAL_MS: Joi.number().integer().min(0).required(),
  PAYMENT_POLL_MAX_ATTEMPTS: Joi.number().integer().positive().required(),
  THROTTLE_TTL_MS: Joi.number().integer().positive().required(),
  THROTTLE_LIMIT: Joi.number().integer().positive().required(),
}).unknown(true);
