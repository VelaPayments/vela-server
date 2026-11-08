<p align="center"><img src="assets/brand/vela-mark.png" alt="Vela" width="120" /></p>

# Vela — Server

Backend for **Vela**, an open-source contactless-payment prototype built around [Stellar](https://stellar.org) testnet.

The backend contains payment-request validation and persistence, passkey-based payment authorization, and a Stellar integration service for transaction building, signed-XDR submission and confirmation polling. It now exposes the payment-intent lifecycle consumed by the Expo client; native testnet execution remains the release verification gate.

> **Mobile client:** The Expo app lives in a separate repository — [VelaPayments/vela-payments](https://github.com/VelaPayments/vela-payments).

## How Vela uses Stellar

Stellar is the intended settlement network for Vela payments. The product goal is a short path from sharing a payment request to approving and confirming an XLM or issued-asset transfer. NFC carries the request between devices; funds move through a signed Stellar transaction and network confirmation.

This repository implements the server-side building blocks with `@stellar/stellar-sdk`:

| Capability                  | Implementation                                                                                                                            | Role in Vela                                                                                                         |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Network access              | [StellarModule](src/stellar/stellar.module.ts)                                                                                            | Configures Horizon and Stellar RPC clients, the network passphrase and the USDC issuer                               |
| Accounts and assets         | [StellarService](src/stellar/stellar.service.ts) — `getAccount`, `resolveAsset`                                                           | Loads source accounts; resolves native XLM or USDC by its configured issuer                                          |
| Payment construction        | `StellarService.buildPaymentTransaction`                                                                                                  | Builds an unsigned `Operation.payment` transaction with fee, network passphrase, optional memo and a bounded timeout |
| Submission and confirmation | `StellarService.submitTransaction`, `pollTransactionStatus`                                                                               | Accepts signed XDR, submits through Horizon and polls for an ingested outcome with bounded retries                   |
| RPC support                 | `StellarService.getHealth`, `simulateTransaction`; `POST /v1/transactions/simulate`                                                       | Checks provider health and exposes authenticated pre-sign simulation diagnostics                                     |
| Payment requests            | [Contract validator](src/contracts/payment-request.v1.ts) and [request service](src/modules/payment-requests/payment-requests.service.ts) | Validates supported assets, amount strings, recipient format and timestamps before persistence                       |
| Payment intents             | [PaymentsController](src/modules/payments/payments.controller.ts)                                                                         | Creates unsigned intents, enforces linked-wallet ownership, validates signed XDR and records confirmation state      |
| Confirmed history           | [TransactionsController](src/modules/transactions/transactions.controller.ts)                                                             | Indexes confirmed payments for both parties and exposes authenticated history at `GET /v1/transactions`              |

The transaction helpers have regression coverage in [stellar.service.spec.ts](src/stellar/stellar.service.spec.ts). `POST /v1/transactions/simulate` accepts a base64 transaction envelope for an authenticated RPC simulation check; the configured RPC provider may reject classic payment envelopes that are not Soroban transactions. `POST /v1/payments` returns an unsigned intent, the client independently validates it before authorization/signing, `POST /v1/payments/:id/authorize` verifies a payment-scoped WebAuthn assertion, and `POST /v1/payments/:id/submit` validates and relays the locally signed XDR. A completed real-device transfer has not yet been independently recorded.

The mocked HTTP contract flow is covered by [`test/payments-full-flow.e2e-spec.ts`](test/payments-full-flow.e2e-spec.ts); it exercises request creation, intent creation, authorization, confirmation, and history lookup without claiming a live Stellar settlement.

### Work that advances the Stellar integration

- Client/server `payment-request.v1` alignment is implemented, including ISO timestamps, external request IDs and shared validation boundaries.
- Memo byte-limit enforcement and bounded confirmation polling are implemented; clean CI verification remains pending in this checkout.
- [Protect authorization failure ordering](https://github.com/VelaPayments/vela-server/issues/64) before connecting authorization to submission.

The current prototype targets Stellar testnet. XLM is represented as the native asset; issued assets are identified by both code and issuer, so the USDC issuer must match the selected network. Payment-request memos are constrained to Stellar's 28-byte `MEMO_TEXT` capacity. See [Stellar's asset model](https://developers.stellar.org/docs/learn/fundamentals/stellar-data-structures/assets).

## Project status

Vela is an early Stellar testnet prototype under active development. It is not ready for real funds or production payment use.

| Area             | Current status                                                                                                       |
| ---------------- | -------------------------------------------------------------------------------------------------------------------- |
| Web preview      | [Live UI preview](https://vela-payments.vercel.app/); browser passkey setup and NFC are unavailable                  |
| Mobile           | Native onboarding, wallet and receive-flow code; requires a development build and physical-device validation         |
| Sending payments | Payment intent, WebAuthn authorization, signed-XDR validation, submission and confirmation endpoints are implemented |
| History          | Confirmed Vela payments are indexed for both parties; Horizon remains the external network source of truth           |
| Authentication   | Supabase JWT identifies users; WebAuthn registration and payment-scoped authorization are server verified            |
| Shared payload   | Server validates normalized `payment-request.v1`, persists receiver ownership and resolves NFC external request IDs  |
| Compatibility    | Passkey RP domain and app/storage/NFC identifiers are pending a coordinated migration decision                       |

See [contributing](CONTRIBUTING.md) and [Wave preparation](docs/wave-readiness.md) for current priorities. Architecture/build-plan documents include intended features and must not be treated as proof of completed functionality.

## Tech stack

| Layer            | Technology                             |
| ---------------- | -------------------------------------- |
| Framework        | NestJS 11                              |
| Language         | TypeScript 5.7 (strict)                |
| ORM              | Prisma + PostgreSQL                    |
| Database hosting | Supabase                               |
| Session auth     | Supabase Auth (JWT)                    |
| Payment auth     | WebAuthn (passkeys)                    |
| Blockchain       | `@stellar/stellar-sdk` (Horizon + RPC) |
| Validation       | `class-validator`, `class-transformer` |
| Config           | `@nestjs/config` + Joi                 |
| API docs         | `@nestjs/swagger`                      |
| Tests            | Jest + Supertest                       |

## Prerequisites

- **Node.js 20+** and npm
- A **Supabase** project with PostgreSQL (`DATABASE_URL` and `DIRECT_URL`)
- Stellar **testnet** access (default URLs are provided in `.env.example`)

## Project setup

```bash
# Install dependencies
npm install

# Configure environment (Windows: copy .env.example .env)
cp .env.example .env
# Edit .env with your Supabase credentials and secrets

npm run prisma:generate
npm run prisma:migrate

# Start development server
npm run start:dev
```

The API is versioned under `/v1`. Swagger UI is available at `/v1/docs` when the server is running.
Public liveness, combined readiness, and Stellar provider checks are available at `/v1/health`, `/v1/health/ready`, and `/v1/health/stellar`.

## Scripts

| Command                                | Description                                                 |
| -------------------------------------- | ----------------------------------------------------------- |
| `npm run start:dev`                    | Start with hot reload                                       |
| `npm run start:prod`                   | Run compiled build                                          |
| `npm run build`                        | Compile TypeScript                                          |
| `npm run lint`                         | Run ESLint                                                  |
| `npm test`                             | Unit tests                                                  |
| `npm run test:e2e`                     | End-to-end tests                                            |
| `npm run test:cov`                     | Coverage report                                             |
| `npm run check:testnet`                | Check Stellar testnet Horizon and RPC readiness             |
| `npm run verify:transaction -- <hash>` | Independently verify a confirmed testnet payment in Horizon |
| `npm run validate:evidence -- <file>`  | Validate a sanitized Wave evidence JSON record              |
| `npm run prisma:generate`              | Generate Prisma client                                      |
| `npm run prisma:migrate`               | Create/apply migrations                                     |
| `npm run prisma:studio`                | Open Prisma Studio                                          |
| `npm run prisma:seed`                  | Seed development data                                       |

## Project structure

Project structure:

```
vela-server/
├── prisma/                 # Schema, migrations, seed
├── docs/                   # Architecture, build plan, contracts
├── src/
│   ├── main.ts
│   ├── app.module.ts
│   ├── config/             # ConfigModule + env validation
│   ├── common/             # Filters, interceptors, decorators
│   ├── database/           # PrismaService (global)
│   ├── auth/               # Supabase JWT guards
│   ├── stellar/            # Horizon/RPC integration
│   ├── webauthn/           # Passkey verification
│   ├── contracts/          # payment-request.v1 contract
│   └── modules/
│       ├── users/
│       ├── payment-requests/
│       ├── payments/
│       └── transactions/      # Confirmed payment history
└── test/                   # E2E tests
```

## Documentation

| Document                                                                           | Description                                |
| ---------------------------------------------------------------------------------- | ------------------------------------------ |
| [docs/vela-overview.md](./docs/vela-overview.md)                                   | Product vision and UX flows                |
| [docs/server-build-plan.md](./docs/server-build-plan.md)                           | Full server build plan (SRV tasks)         |
| [docs/server-build-plan-consolidated.md](./docs/server-build-plan-consolidated.md) | Consolidated task reference                |
| [docs/release-checklist.md](./docs/release-checklist.md)                           | Testnet release and Wave evidence gates    |
| [docs/drips-appeal-summary.md](./docs/drips-appeal-summary.md)                     | Substantive-change summary for Wave appeal |

## Supported assets (MVP)

| Asset | Network         | Notes                                      |
| ----- | --------------- | ------------------------------------------ |
| XLM   | Stellar testnet | Native asset                               |
| USDC  | Stellar testnet | Issuer via `STELLAR_USDC_ISSUER` in `.env` |

## Environment variables

Copy `.env.example` to `.env` and replace placeholders with your values. Variable groups:

- **App** — `NODE_ENV`, `PORT`, `API_PREFIX`, `CORS_ORIGINS`
- **Database** — `DATABASE_URL`, `DIRECT_URL` (Supabase PostgreSQL)
- **Supabase Auth** — `SUPABASE_URL`, `SUPABASE_JWT_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`
- **Stellar** — network, Horizon/RPC URLs, USDC issuer, network passphrase
- **WebAuthn** — RP ID, name, and origin (must match the Expo client)
- **Payments / rate limiting** — submit timeouts, poll intervals, throttle settings

See `.env.example` for the full list with placeholder values.

## Security notes

- Never commit `.env` or real secrets to the repository.
- Do not log JWTs, service role keys, or raw WebAuthn challenges.
- Hybrid auth model: Supabase session for API access + WebAuthn for payment approval.

## License

[MIT](LICENSE).
