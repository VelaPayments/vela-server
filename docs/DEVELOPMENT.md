# Development Guide

Backend API for **Vela**: peer-to-peer NFC payments on the Stellar network (testnet MVP).

## Technology
- Node.js

## Setup
- Install dependencies with `npm ci`.
- `npm run format` runs `prettier --write "src/**/*.ts" "test/**/*.ts"`.
- `npm run prisma:generate` runs `prisma generate`.
- `npm run prisma:migrate` runs `prisma migrate dev`.
- `npm run prisma:migrate:deploy` runs `prisma migrate deploy`.
- `npm run prisma:reset` runs `prisma migrate reset`.
- `npm run prisma:seed` runs `prisma db seed`.
- `npm run prisma:studio` runs `prisma studio`.
- `npm run start` runs `nest start`.
- `npm run start:debug` runs `nest start --debug --watch`.
- `npm run start:dev` runs `nest start --watch`.
- `npm run start:prod` runs `node dist/main`.

## Project checks
- `npm run build` runs `nest build`.
- `npm run lint` runs `eslint "{src,apps,libs,test}/**/*.ts" --fix`.
- `npm run test` runs `jest`.
- `npm run test:cov` runs `jest --coverage`.
- `npm run test:debug` runs `node --inspect-brk -r tsconfig-paths/register -r ts-node/register node_modules/.bin/jest --runInBand`.
- `npm run test:e2e` runs `jest --config ./test/jest-e2e.json`.
- `npm run test:watch` runs `jest --watch`.

## Configuration
Environment variable names documented in `.env.example` (values intentionally omitted):
- `API_PREFIX`
- `CORS_ORIGINS`
- `DATABASE_URL`
- `DIRECT_URL`
- `NODE_ENV`
- `PAYMENT_POLL_INTERVAL_MS` (may be `0` in tests to disable the wait between polls)
- `PAYMENT_POLL_MAX_ATTEMPTS`
- `PAYMENT_SUBMIT_TIMEOUT_MS`
- `PORT`
- `STELLAR_HORIZON_URL`
- `STELLAR_NETWORK`
- `STELLAR_NETWORK_PASSPHRASE`
- `STELLAR_RPC_URL`
- `STELLAR_USDC_ISSUER`
- `SUPABASE_JWT_SECRET`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_URL`
- `THROTTLE_LIMIT`
- `THROTTLE_TTL_MS`
- `WEBAUTHN_ORIGIN`
- `WEBAUTHN_RP_ID`
- `WEBAUTHN_RP_NAME`

## Repository layout
- `.agents/`
- `.claude/`
- `.cursor/`
- `.vscode/`
- `docs/`
- `prisma/`
- `src/`
- `test/`

## Contributing
Keep changes focused, update documentation when behavior changes, and include a clear summary with proposed changes.

