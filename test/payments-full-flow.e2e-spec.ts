/**
 * HTTP-level payment flow with mocked persistence and external Stellar/WebAuthn
 * boundaries. This proves the server contract and state transitions without
 * claiming a live testnet settlement.
 */
import { Test, TestingModule } from '@nestjs/testing';
import {
  INestApplication,
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
import { PaymentsRepository } from '../src/modules/payments/payments.repository';
import { TransactionsRepository } from '../src/modules/transactions/transactions.repository';
import { UsersService } from '../src/modules/users/users.service';
import { WebAuthnService } from '../src/webauthn/webauthn.service';
import { StellarService } from '../src/stellar/stellar.service';
import type { Application as ExpressApplication } from 'express';

const JWT_SECRET = 'secret';
const REQUEST_ID = 'req_full_flow_001';
const PAYMENT_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const TX_HASH = 'a'.repeat(64);
const RECIPIENT = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
const SENDER = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

function bearer(): string {
  return `Bearer ${jwt.sign(
    { sub: 'sender-supabase-id', email: 'sender@example.com' },
    JWT_SECRET,
    { expiresIn: '1h' },
  )}`;
}

function createRequestBody() {
  const now = Date.now();
  return {
    type: 'payment-request',
    version: 1,
    recipient: RECIPIENT,
    asset: 'XLM',
    amount: '1.25',
    timestamp: new Date(now).toISOString(),
    expiresAt: new Date(now + 30_000).toISOString(),
    requestId: REQUEST_ID,
  };
}

describe('Payment + history full flow (e2e)', () => {
  let app: INestApplication<ExpressApplication>;
  let paymentRequestsRepo: { create: jest.Mock };
  let paymentsRepo: {
    findWalletForUser: jest.Mock;
    findPaymentRequestByExternalId: jest.Mock;
    create: jest.Mock;
    findById: jest.Mock;
    markAuthorized: jest.Mock;
    markSubmitted: jest.Mock;
    markConfirmedAndRecord: jest.Mock;
  };
  let transactionsRepo: { listForUser: jest.Mock };
  let stellar: {
    getNetwork: jest.Mock;
    buildPaymentTransaction: jest.Mock;
    validatePaymentTransaction: jest.Mock;
    submitTransaction: jest.Mock;
    pollTransactionStatus: jest.Mock;
  };
  let users: {
    createOrUpdateUser: jest.Mock;
    getUserBySupabaseId: jest.Mock;
    requireUser: jest.Mock;
  };

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
    process.env.SUPABASE_JWT_SECRET = JWT_SECRET;
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service_role';
    process.env.STELLAR_NETWORK = 'testnet';
    process.env.STELLAR_HORIZON_URL = 'https://horizon-testnet.stellar.org';
    process.env.STELLAR_RPC_URL = 'https://soroban-testnet.stellar.org';
    process.env.STELLAR_USDC_ISSUER = RECIPIENT;
    process.env.STELLAR_NETWORK_PASSPHRASE =
      'Test SDF Network ; September 2015';
    process.env.WEBAUTHN_RP_ID = 'localhost';
    process.env.WEBAUTHN_RP_NAME = 'Vela';
    process.env.WEBAUTHN_ORIGIN = 'http://localhost:8081';
    process.env.PAYMENT_SUBMIT_TIMEOUT_MS = '300000';
    process.env.PAYMENT_POLL_INTERVAL_MS = '0';
    process.env.PAYMENT_POLL_MAX_ATTEMPTS = '3';
    process.env.THROTTLE_TTL_MS = '60000';
    process.env.THROTTLE_LIMIT = '100';

    const now = new Date();
    const expiresAt = new Date(now.getTime() + 30_000);
    const requestRecord = {
      id: 'request-1',
      externalRequestId: REQUEST_ID,
      receiverUserId: 'receiver-1',
      recipient: RECIPIENT,
      asset: 'XLM',
      amount: { toString: () => '1.25' },
      memo: null,
      network: 'TESTNET',
      status: 'CREATED',
      payloadTimestamp: now,
      expiresAt,
      metadata: null,
      createdAt: now,
      payment: null,
    };
    const basePayment = {
      id: PAYMENT_ID,
      paymentRequestId: 'request-1',
      senderUserId: 'sender-1',
      receiverUserId: 'receiver-1',
      recipient: RECIPIENT,
      senderPublicKey: SENDER,
      asset: 'XLM',
      amount: { toString: () => '1.25' },
      memo: null,
      network: 'TESTNET',
      createdAt: now,
      expiresAt,
      stellarTxHash: null,
      failureCode: null,
    };

    paymentRequestsRepo = {
      create: jest.fn().mockResolvedValue(requestRecord),
    };
    paymentsRepo = {
      findWalletForUser: jest.fn().mockResolvedValue({ id: 'wallet-1' }),
      findPaymentRequestByExternalId: jest
        .fn()
        .mockResolvedValue(requestRecord),
      create: jest.fn().mockResolvedValue({
        ...basePayment,
        status: 'CREATED',
        authorizedAt: null,
        submittedAt: null,
        confirmedAt: null,
      }),
      findById: jest
        .fn()
        .mockResolvedValueOnce({ ...basePayment, status: 'CREATED' })
        .mockResolvedValueOnce({ ...basePayment, status: 'AUTHORIZED' })
        .mockResolvedValueOnce({
          ...basePayment,
          status: 'CONFIRMED',
          stellarTxHash: TX_HASH,
        }),
      markAuthorized: jest.fn().mockResolvedValue({
        id: PAYMENT_ID,
        status: 'AUTHORIZED',
        authorizedAt: now,
      }),
      markSubmitted: jest.fn().mockResolvedValue({ count: 1 }),
      markConfirmedAndRecord: jest.fn().mockResolvedValue(undefined),
    };
    transactionsRepo = {
      listForUser: jest.fn().mockResolvedValue([
        1,
        [
          {
            id: 'transaction-1',
            direction: 'SENT',
            stellarTxHash: TX_HASH,
            counterparty: RECIPIENT,
            asset: 'XLM',
            amount: { toString: () => '1.25' },
            memo: null,
            network: 'TESTNET',
            ledger: 123,
            createdAt: now,
          },
        ],
      ]),
    };
    stellar = {
      getNetwork: jest.fn().mockReturnValue('TESTNET'),
      buildPaymentTransaction: jest.fn().mockResolvedValue({
        toXDR: () => 'unsigned-xdr',
      }),
      validatePaymentTransaction: jest.fn(),
      submitTransaction: jest.fn().mockResolvedValue({ hash: TX_HASH }),
      pollTransactionStatus: jest.fn().mockResolvedValue({
        confirmed: true,
        hash: TX_HASH,
        ledger: 123,
      }),
    };
    users = {
      createOrUpdateUser: jest.fn().mockResolvedValue({ id: 'sender-1' }),
      getUserBySupabaseId: jest.fn().mockResolvedValue({
        id: 'sender-1',
        wallets: [{ stellarPublicKey: SENDER, network: 'TESTNET' }],
      }),
      requireUser: jest.fn().mockResolvedValue({
        id: 'sender-1',
        wallets: [{ stellarPublicKey: RECIPIENT, network: 'TESTNET' }],
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
      .useValue(paymentRequestsRepo)
      .overrideProvider(PaymentsRepository)
      .useValue(paymentsRepo)
      .overrideProvider(TransactionsRepository)
      .useValue(transactionsRepo)
      .overrideProvider(UsersService)
      .useValue(users)
      .overrideProvider(WebAuthnService)
      .useValue({
        generateAuthenticationOptions: jest.fn().mockResolvedValue({
          challenge: 'payment-challenge',
        }),
        verifyPaymentAssertion: jest.fn().mockResolvedValue(undefined),
      })
      .overrideProvider(StellarService)
      .useValue(stellar)
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

  it('runs request creation, intent, authorization, submission, and history lookup', async () => {
    const auth = bearer();
    const createRequest = await request(app.getHttpServer())
      .post('/v1/payment-requests')
      .set('Authorization', auth)
      .send(createRequestBody());
    expect(createRequest.status).toBe(201);
    expect(createRequest.body).toMatchObject({
      id: 'request-1',
      network: 'TESTNET',
    });

    const intent = await request(app.getHttpServer())
      .post('/v1/payments')
      .set('Authorization', auth)
      .send({ senderPublicKey: SENDER, requestId: REQUEST_ID });
    expect(intent.status).toBe(201);
    expect(intent.body).toMatchObject({
      id: PAYMENT_ID,
      status: 'CREATED',
      unsignedXdr: 'unsigned-xdr',
    });

    const options = await request(app.getHttpServer())
      .post('/v1/webauthn/authenticate/options')
      .set('Authorization', auth)
      .send({ paymentId: PAYMENT_ID });
    expect(options.status).toBe(200);

    const assertion = await request(app.getHttpServer())
      .post(`/v1/payments/${PAYMENT_ID}/authorize`)
      .set('Authorization', auth)
      .send({
        id: 'credential-1',
        rawId: 'credential-1',
        type: 'public-key',
        response: {
          authenticatorData: 'authenticator-data',
          clientDataJSON: 'client-data',
          signature: 'signature',
        },
      });
    expect(assertion.status).toBe(200);
    expect((assertion.body as { status?: string }).status).toBe('AUTHORIZED');

    const submitted = await request(app.getHttpServer())
      .post(`/v1/payments/${PAYMENT_ID}/submit`)
      .set('Authorization', auth)
      .send({ signedXdr: 'signed-xdr' });
    expect(submitted.status).toBe(200);
    expect(submitted.body).toMatchObject({
      status: 'CONFIRMED',
      stellarTxHash: TX_HASH,
    });

    const history = await request(app.getHttpServer())
      .get('/v1/transactions?page=1&limit=20')
      .set('Authorization', auth);
    expect(history.status).toBe(200);
    expect(history.body).toMatchObject({
      data: [{ stellarTxHash: TX_HASH, direction: 'SENT' }],
      meta: { page: 1, limit: 20, total: 1 },
    });
    expect(paymentsRepo.markConfirmedAndRecord).toHaveBeenCalledWith(
      expect.objectContaining({ stellarTxHash: TX_HASH, ledger: 123 }),
    );
  });
});
