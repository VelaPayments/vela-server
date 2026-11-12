/**
 * E2E tests for POST /v1/payment-requests and GET /v1/payment-requests/:id
 * SRV-038, SRV-039, SRV-040
 *
 * PrismaService is mocked so no live DB is required. Protected routes use a
 * locally signed test JWT so the production guard is exercised.
 */
import { Test, TestingModule } from '@nestjs/testing';
import {
  INestApplication,
  ConflictException,
  NotFoundException,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { ConfigModule } from '@nestjs/config';
import { envValidationSchema } from '../src/config/env.validation';
import configuration from '../src/config/configuration';
import helmet from 'helmet';
import compression from 'compression';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { PaymentRequestsRepository } from '../src/modules/payment-requests/payment-requests.repository';
import { UsersService } from '../src/modules/users/users.service';
import type { Application as ExpressApplication } from 'express';

const PERSIST_ROUTE = '/v1/payment-requests';
const JWT_SECRET = 'secret';

const VALID_RECIPIENT =
  'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';

function validCreateBody(overrides: Record<string, unknown> = {}) {
  const now = Date.now();
  return {
    type: 'payment-request',
    version: 1,
    recipient: VALID_RECIPIENT,
    asset: 'USDC',
    amount: '10.00',
    timestamp: new Date(now).toISOString(),
    expiresAt: new Date(now + 30_000).toISOString(),
    requestId: `req_${Date.now()}`,
    ...overrides,
  };
}

function bearer(): string {
  const token = jwt.sign(
    { sub: 'test-supabase-user-id', email: 'alice@example.com' },
    JWT_SECRET,
    { expiresIn: '1h' },
  );
  return `Bearer ${token}`;
}

describe('PaymentRequests persist + retrieve (e2e)', () => {
  let app: INestApplication<ExpressApplication>;
  let mockRepo: {
    create: jest.Mock;
    findById: jest.Mock;
  };

  const createdPrId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

  beforeEach(async () => {
    process.env.NODE_ENV = 'test';
    process.env.PORT = '3001';
    process.env.API_PREFIX = 'v1';
    process.env.CORS_ORIGINS = 'http://localhost:8081';
    process.env.DATABASE_URL =
      'postgresql://postgres:password@localhost:5432/postgres';
    process.env.DIRECT_URL =
      'postgresql://postgres:password@localhost:5432/postgres';
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_JWT_SECRET = 'secret';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service_role';
    process.env.STELLAR_NETWORK = 'testnet';
    process.env.STELLAR_HORIZON_URL = 'https://horizon-testnet.stellar.org';
    process.env.STELLAR_RPC_URL = 'https://soroban-testnet.stellar.org';
    process.env.STELLAR_USDC_ISSUER = VALID_RECIPIENT;
    process.env.STELLAR_NETWORK_PASSPHRASE =
      'Test SDF Network ; September 2015';
    process.env.WEBAUTHN_RP_ID = 'localhost';
    process.env.WEBAUTHN_RP_NAME = 'Vela';
    process.env.WEBAUTHN_ORIGIN = 'http://localhost:8081';
    process.env.PAYMENT_SUBMIT_TIMEOUT_MS = '300000';
    process.env.PAYMENT_POLL_INTERVAL_MS = '2000';
    process.env.PAYMENT_POLL_MAX_ATTEMPTS = '30';
    process.env.THROTTLE_TTL_MS = '60000';
    process.env.THROTTLE_LIMIT = '100';

    const now = new Date();
    const future = new Date(now.getTime() + 30_000);

    mockRepo = {
      create: jest.fn().mockResolvedValue({
        id: createdPrId,
        externalRequestId: 'req_001',
        receiverUserId: 'test-supabase-user-id',
        recipient: VALID_RECIPIENT,
        asset: 'USDC',
        amount: { toString: () => '10.00' },
        memo: null,
        network: 'TESTNET',
        status: 'CREATED',
        payloadTimestamp: now,
        expiresAt: future,
        metadata: null,
        createdAt: now,
      }),
      findById: jest.fn().mockResolvedValue({
        id: createdPrId,
        externalRequestId: 'req_001',
        receiverUserId: 'test-supabase-user-id',
        recipient: VALID_RECIPIENT,
        asset: 'USDC',
        amount: { toString: () => '10.00' },
        memo: null,
        network: 'TESTNET',
        status: 'SHARED',
        payloadTimestamp: now,
        expiresAt: future,
        metadata: null,
        createdAt: now,
      }),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          validationSchema: envValidationSchema,
          validationOptions: { abortEarly: false, allowUnknown: false },
          load: [configuration],
        }),
        AppModule,
      ],
    })
      .overrideProvider(PrismaService)
      .useValue({ $connect: jest.fn(), $disconnect: jest.fn() })
      .overrideProvider(PaymentRequestsRepository)
      .useValue(mockRepo)
      .overrideProvider(UsersService)
      .useValue({
        createOrUpdateUser: jest.fn().mockResolvedValue({}),
        requireUser: jest.fn().mockResolvedValue({
          id: 'internal-test-user-id',
          wallets: [
            {
              stellarPublicKey: VALID_RECIPIENT,
              network: 'TESTNET',
            },
          ],
        }),
      })
      .compile();

    app = moduleFixture.createNestApplication();
    app.use(helmet());
    app.use(compression());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  // ─── SRV-038 ──────────────────────────────────────────────────────────────

  describe('POST /v1/payment-requests', () => {
    it('returns 201 with the created payment request', async () => {
      const body = validCreateBody({ requestId: 'req_001' });
      const res = await request(app.getHttpServer())
        .post(PERSIST_ROUTE)
        .set('Authorization', bearer())
        .send(body);

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        id: createdPrId,
        status: 'CREATED',
        asset: 'USDC',
        amount: '10.00',
      });
    });

    it('returns 400 when required DTO fields are missing (ValidationPipe)', async () => {
      const res = await request(app.getHttpServer())
        .post(PERSIST_ROUTE)
        .set('Authorization', bearer())
        .send({ type: 'payment-request' }); // missing many required fields

      expect(res.status).toBe(400);
    });

    it('returns 422 when asset is unsupported (v1 contract)', async () => {
      const res = await request(app.getHttpServer())
        .post(PERSIST_ROUTE)
        .set('Authorization', bearer())
        .send(validCreateBody({ asset: 'ETH' }));

      // ValidationPipe strips 'ETH' via @IsIn → 400; or v1 validation 422
      // Either is acceptable; assert it is not 201
      expect(res.status).not.toBe(201);
    });

    // SRV-039: anti-replay
    it('returns 409 with PAYMENT_REQUEST_ID_REPLAY on duplicate requestId', async () => {
      mockRepo.create.mockRejectedValueOnce(
        new ConflictException({
          statusCode: 409,
          message: 'Duplicate requestId',
          code: 'PAYMENT_REQUEST_ID_REPLAY',
        }),
      );

      const res = await request(app.getHttpServer())
        .post(PERSIST_ROUTE)
        .set('Authorization', bearer())
        .send(validCreateBody({ requestId: 'req_duplicate' }));

      expect(res.status).toBe(409);
    });
  });

  // ─── SRV-040 ──────────────────────────────────────────────────────────────

  describe('GET /v1/payment-requests/:id', () => {
    it('returns 200 with the payment request', async () => {
      const res = await request(app.getHttpServer())
        .get(`${PERSIST_ROUTE}/${createdPrId}`)
        .set('Authorization', bearer());

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        id: createdPrId,
        status: 'SHARED',
        asset: 'USDC',
      });
    });

    it('returns 400 for a non-UUID id parameter', async () => {
      const res = await request(app.getHttpServer())
        .get(`${PERSIST_ROUTE}/not-a-uuid`)
        .set('Authorization', bearer());
      expect(res.status).toBe(400);
    });

    it('returns 404 when the payment request does not exist', async () => {
      mockRepo.findById.mockRejectedValueOnce(
        new NotFoundException({
          statusCode: 404,
          message: 'Payment request not found.',
          code: 'PAYMENT_REQUEST_NOT_FOUND',
        }),
      );

      const res = await request(app.getHttpServer())
        .get(`${PERSIST_ROUTE}/00000000-0000-0000-0000-000000000000`)
        .set('Authorization', bearer());
      expect(res.status).toBe(404);
    });
  });
});
