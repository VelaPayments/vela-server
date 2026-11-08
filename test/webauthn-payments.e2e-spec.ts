/**
 * E2E for the S10 HTTP surface: WebAuthn options/verify routes and the
 * payments authorize route (SRV-043–045).
 *
 * PrismaService is mocked (no live DB) and WebAuthnService is mocked so we
 * exercise routing, the REAL Supabase JWT guard, DTO validation, and the
 * payments state guards without a real authenticator/FIDO ceremony (that path
 * is covered by unit tests). Auth is driven with a JWT signed using the test
 * SUPABASE_JWT_SECRET so the production guard runs unmodified.
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
import { WebAuthnService } from '../src/webauthn/webauthn.service';
import { PaymentsRepository } from '../src/modules/payments/payments.repository';
import { UsersService } from '../src/modules/users/users.service';
import type { Application as ExpressApplication } from 'express';

const PAYMENT_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const JWT_SECRET = 'secret'; // matches env.setup.ts SUPABASE_JWT_SECRET

function bearer(): string {
  const token = jwt.sign(
    { sub: 'test-supabase-user-id', email: 'alice@example.com' },
    JWT_SECRET,
    { expiresIn: '1h' },
  );
  return `Bearer ${token}`;
}

const assertionBody = {
  id: 'cred-abc',
  rawId: 'cred-abc',
  type: 'public-key',
  response: {
    authenticatorData: 'a',
    clientDataJSON: 'b',
    signature: 'c',
  },
};

describe('WebAuthn + payments authorize (e2e)', () => {
  let app: INestApplication<ExpressApplication>;
  let webAuthnMock: {
    generateRegistrationOptions: jest.Mock;
    verifyRegistration: jest.Mock;
    generateAuthenticationOptions: jest.Mock;
    verifyPaymentAssertion: jest.Mock;
    listCredentials: jest.Mock;
    revokeCredential: jest.Mock;
  };
  let paymentsRepoMock: { findById: jest.Mock; markAuthorized: jest.Mock };
  let usersMock: {
    getUserBySupabaseId: jest.Mock;
    createOrUpdateUser: jest.Mock;
  };

  beforeEach(async () => {
    webAuthnMock = {
      generateRegistrationOptions: jest
        .fn()
        .mockResolvedValue({ challenge: 'reg-challenge' }),
      verifyRegistration: jest
        .fn()
        .mockResolvedValue({ verified: true, credentialId: 'cred-abc' }),
      generateAuthenticationOptions: jest
        .fn()
        .mockResolvedValue({ challenge: 'auth-challenge' }),
      verifyPaymentAssertion: jest.fn().mockResolvedValue(undefined),
      listCredentials: jest.fn().mockResolvedValue([
        {
          id: 'record-1',
          deviceName: 'iPhone 15',
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          lastUsedAt: null,
        },
      ]),
      revokeCredential: jest.fn().mockResolvedValue(undefined),
    };
    paymentsRepoMock = {
      findById: jest.fn().mockResolvedValue({
        id: PAYMENT_ID,
        senderUserId: 'user-1',
        status: 'CREATED',
        createdAt: new Date(),
        expiresAt: null,
        authorizedAt: null,
      }),
      markAuthorized: jest.fn().mockResolvedValue({
        id: PAYMENT_ID,
        status: 'AUTHORIZED',
        authorizedAt: new Date('2026-07-19T12:00:00.000Z'),
      }),
    };
    usersMock = {
      getUserBySupabaseId: jest
        .fn()
        .mockResolvedValue({ id: 'user-1', email: 'alice@example.com' }),
      createOrUpdateUser: jest.fn().mockResolvedValue({ id: 'user-1' }),
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
      .overrideProvider(WebAuthnService)
      .useValue(webAuthnMock)
      .overrideProvider(PaymentsRepository)
      .useValue(paymentsRepoMock)
      .overrideProvider(UsersService)
      .useValue(usersMock)
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

  describe('auth guard', () => {
    it('returns 401 without a bearer token', async () => {
      const res = await request(app.getHttpServer()).post(
        '/v1/webauthn/register/options',
      );
      expect(res.status).toBe(401);
    });
  });

  describe('POST /v1/webauthn/register/options', () => {
    it('returns 200 with options for an authenticated user', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/webauthn/register/options')
        .set('Authorization', bearer());
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ challenge: 'reg-challenge' });
    });

    it('returns 409 when the per-device credential limit is reached', async () => {
      webAuthnMock.generateRegistrationOptions.mockRejectedValueOnce(
        new ConflictException({
          statusCode: 409,
          message: 'Maximum of 5 passkeys reached.',
          code: 'WEBAUTHN_CREDENTIAL_LIMIT_REACHED',
        }),
      );
      const res = await request(app.getHttpServer())
        .post('/v1/webauthn/register/options')
        .set('Authorization', bearer());
      expect(res.status).toBe(409);
      expect((res.body as { code?: string }).code).toBe(
        'WEBAUTHN_CREDENTIAL_LIMIT_REACHED',
      );
    });
  });

  describe('GET /v1/webauthn/credentials', () => {
    it('returns 401 without a bearer token', async () => {
      const res = await request(app.getHttpServer()).get(
        '/v1/webauthn/credentials',
      );
      expect(res.status).toBe(401);
    });

    it('returns 200 with the mapped device list', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/webauthn/credentials')
        .set('Authorization', bearer());
      expect(res.status).toBe(200);
      expect(res.body).toEqual([
        {
          id: 'record-1',
          deviceName: 'iPhone 15',
          createdAt: '2026-01-01T00:00:00.000Z',
          lastUsedAt: null,
        },
      ]);
    });
  });

  describe('DELETE /v1/webauthn/credentials/:id', () => {
    const RECORD_ID = 'b2c3d4e5-f6a7-8901-bcde-f12345678901';

    it('returns 400 for a non-UUID id', async () => {
      const res = await request(app.getHttpServer())
        .delete('/v1/webauthn/credentials/not-a-uuid')
        .set('Authorization', bearer());
      expect(res.status).toBe(400);
    });

    it('returns 204 on successful revocation', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/v1/webauthn/credentials/${RECORD_ID}`)
        .set('Authorization', bearer());
      expect(res.status).toBe(204);
      expect(webAuthnMock.revokeCredential).toHaveBeenCalledWith(
        expect.objectContaining({ supabaseUserId: 'test-supabase-user-id' }),
        RECORD_ID,
      );
    });

    it('returns 404 when the credential is not found', async () => {
      webAuthnMock.revokeCredential.mockRejectedValueOnce(
        new NotFoundException({
          statusCode: 404,
          message: 'Passkey not found.',
          code: 'WEBAUTHN_CREDENTIAL_NOT_FOUND',
        }),
      );
      const res = await request(app.getHttpServer())
        .delete(`/v1/webauthn/credentials/${RECORD_ID}`)
        .set('Authorization', bearer());
      expect(res.status).toBe(404);
      expect((res.body as { code?: string }).code).toBe(
        'WEBAUTHN_CREDENTIAL_NOT_FOUND',
      );
    });

    it('returns 409 when revoking the last remaining passkey', async () => {
      webAuthnMock.revokeCredential.mockRejectedValueOnce(
        new ConflictException({
          statusCode: 409,
          message: 'Cannot remove your last passkey.',
          code: 'WEBAUTHN_LAST_CREDENTIAL',
        }),
      );
      const res = await request(app.getHttpServer())
        .delete(`/v1/webauthn/credentials/${RECORD_ID}`)
        .set('Authorization', bearer());
      expect(res.status).toBe(409);
      expect((res.body as { code?: string }).code).toBe(
        'WEBAUTHN_LAST_CREDENTIAL',
      );
    });
  });

  describe('POST /v1/webauthn/authenticate/options', () => {
    it('returns 400 when paymentId is missing', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/webauthn/authenticate/options')
        .set('Authorization', bearer())
        .send({});
      expect(res.status).toBe(400);
    });

    it('returns 200 with a challenge for a valid paymentId', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/webauthn/authenticate/options')
        .set('Authorization', bearer())
        .send({ paymentId: PAYMENT_ID });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ challenge: 'auth-challenge' });
    });
  });

  describe('POST /v1/payments/:id/authorize', () => {
    it('returns 400 for a non-UUID id', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/payments/not-a-uuid/authorize')
        .set('Authorization', bearer())
        .send(assertionBody);
      expect(res.status).toBe(400);
    });

    it('returns 200 and AUTHORIZED on success', async () => {
      const res = await request(app.getHttpServer())
        .post(`/v1/payments/${PAYMENT_ID}/authorize`)
        .set('Authorization', bearer())
        .send(assertionBody);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: PAYMENT_ID, status: 'AUTHORIZED' });
    });

    it('returns 409 PAYMENT_INVALID_STATE when not CREATED', async () => {
      paymentsRepoMock.findById.mockResolvedValueOnce({
        id: PAYMENT_ID,
        senderUserId: 'user-1',
        status: 'AUTHORIZED',
        expiresAt: null,
        authorizedAt: new Date(),
      });
      const res = await request(app.getHttpServer())
        .post(`/v1/payments/${PAYMENT_ID}/authorize`)
        .set('Authorization', bearer())
        .send(assertionBody);
      expect(res.status).toBe(409);
      expect((res.body as { code?: string }).code).toBe(
        'PAYMENT_INVALID_STATE',
      );
    });

    it('returns 403 when the caller is not the sender', async () => {
      paymentsRepoMock.findById.mockResolvedValueOnce({
        id: PAYMENT_ID,
        senderUserId: 'another-user',
        status: 'CREATED',
        expiresAt: null,
        authorizedAt: null,
      });
      const res = await request(app.getHttpServer())
        .post(`/v1/payments/${PAYMENT_ID}/authorize`)
        .set('Authorization', bearer())
        .send(assertionBody);
      expect(res.status).toBe(403);
    });
  });
});
