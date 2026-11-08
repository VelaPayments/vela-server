import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PaymentsService, PAYMENT_AUTHORIZED_EVENT } from './payments.service';
import { PaymentsRepository } from './payments.repository';
import { WebAuthnService } from '../../webauthn/webauthn.service';
import { UsersService } from '../users/users.service';
import { StellarService } from '../../stellar/stellar.service';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';

const AUTH_USER: AuthenticatedUser = { supabaseUserId: 'sb-1' };
const INTERNAL_USER = { id: 'user-1', email: 'alice@example.com' };
const PAYMENT_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const assertion = { id: 'cred-abc' } as never;

function basePayment(overrides: Record<string, unknown> = {}) {
  return {
    id: PAYMENT_ID,
    senderUserId: 'user-1',
    status: 'CREATED',
    createdAt: new Date(),
    expiresAt: null,
    authorizedAt: null,
    ...overrides,
  };
}

describe('PaymentsService.authorize', () => {
  let service: PaymentsService;
  let repo: { findById: jest.Mock; markAuthorized: jest.Mock };
  let webauthn: { verifyPaymentAssertion: jest.Mock };
  let users: { getUserBySupabaseId: jest.Mock };
  let emit: jest.Mock;

  beforeEach(() => {
    repo = {
      findById: jest.fn(),
      markAuthorized: jest.fn(),
    };

    webauthn = {
      verifyPaymentAssertion: jest.fn().mockResolvedValue(undefined),
    };
    users = {
      getUserBySupabaseId: jest.fn().mockResolvedValue(INTERNAL_USER),
    };
    emit = jest.fn();

    service = new PaymentsService(
      repo as unknown as PaymentsRepository,
      webauthn as unknown as WebAuthnService,
      users as unknown as UsersService,
      { emit } as unknown as EventEmitter2,
      {} as unknown as StellarService,
      {
        getOrThrow: jest.fn().mockReturnValue(300_000),
      } as unknown as ConfigService,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('transitions CREATED → AUTHORIZED on a verified assertion', async () => {
    const authorizedAt = new Date('2026-07-19T12:00:00.000Z');
    repo.findById.mockResolvedValue(basePayment());
    repo.markAuthorized.mockResolvedValue({
      id: PAYMENT_ID,
      status: 'AUTHORIZED',
      authorizedAt,
    });

    const result = await service.authorize(AUTH_USER, PAYMENT_ID, assertion);

    expect(result).toEqual({
      id: PAYMENT_ID,
      status: 'AUTHORIZED',
      authorizedAt: authorizedAt.toISOString(),
    });
    expect(webauthn.verifyPaymentAssertion).toHaveBeenCalledWith({
      internalUserId: 'user-1',
      paymentId: PAYMENT_ID,
      assertion,
    });
    expect(emit).toHaveBeenCalledWith(PAYMENT_AUTHORIZED_EVENT, {
      paymentId: PAYMENT_ID,
      userId: 'user-1',
    });
  });

  it('propagates 404 when the payment does not exist', async () => {
    repo.findById.mockRejectedValue(
      new NotFoundException({ code: 'PAYMENT_NOT_FOUND' }),
    );

    await expect(
      service.authorize(AUTH_USER, PAYMENT_ID, assertion),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(webauthn.verifyPaymentAssertion).not.toHaveBeenCalled();
  });

  it('rejects with 403 when the caller is not the sender', async () => {
    repo.findById.mockResolvedValue(
      basePayment({ senderUserId: 'someone-else' }),
    );

    await expect(
      service.authorize(AUTH_USER, PAYMENT_ID, assertion),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects with PAYMENT_INVALID_STATE when not CREATED', async () => {
    repo.findById.mockResolvedValue(basePayment({ status: 'AUTHORIZED' }));

    await expect(
      service.authorize(AUTH_USER, PAYMENT_ID, assertion),
    ).rejects.toMatchObject({ response: { code: 'PAYMENT_INVALID_STATE' } });
    expect(webauthn.verifyPaymentAssertion).not.toHaveBeenCalled();
  });

  it('rejects with PAYMENT_INVALID_STATE when expired', async () => {
    repo.findById.mockResolvedValue(
      basePayment({ expiresAt: new Date(Date.now() - 1000) }),
    );

    await expect(
      service.authorize(AUTH_USER, PAYMENT_ID, assertion),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(webauthn.verifyPaymentAssertion).not.toHaveBeenCalled();
  });

  it('rejects an expiration equal to the current time', async () => {
    const now = new Date('2026-10-06T12:00:00.000Z');
    jest.useFakeTimers().setSystemTime(now);
    repo.findById.mockResolvedValue(basePayment({ expiresAt: now }));

    await expect(
      service.authorize(AUTH_USER, PAYMENT_ID, assertion),
    ).rejects.toMatchObject({ response: { code: 'PAYMENT_INVALID_STATE' } });
    expect(webauthn.verifyPaymentAssertion).not.toHaveBeenCalled();
    expect(repo.markAuthorized).not.toHaveBeenCalled();
  });

  it('rejects a payment whose authorization window has elapsed', async () => {
    const now = new Date('2026-10-06T12:00:00.000Z');
    jest.useFakeTimers().setSystemTime(now);
    repo.findById.mockResolvedValue(
      basePayment({ createdAt: new Date(now.getTime() - 300_001) }),
    );

    await expect(
      service.authorize(AUTH_USER, PAYMENT_ID, assertion),
    ).rejects.toMatchObject({ response: { code: 'PAYMENT_INVALID_STATE' } });
    expect(webauthn.verifyPaymentAssertion).not.toHaveBeenCalled();
  });

  it('does not verify or persist when the authenticated user record is missing', async () => {
    users.getUserBySupabaseId.mockResolvedValue(null);

    await expect(
      service.authorize(AUTH_USER, PAYMENT_ID, assertion),
    ).rejects.toThrow('User record not found.');

    expect(repo.findById).not.toHaveBeenCalled();
    expect(webauthn.verifyPaymentAssertion).not.toHaveBeenCalled();
    expect(repo.markAuthorized).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });

  it('does not authorize if the assertion verification fails', async () => {
    repo.findById.mockResolvedValue(basePayment());
    webauthn.verifyPaymentAssertion.mockRejectedValue(
      new ConflictException('bad assertion'),
    );

    await expect(
      service.authorize(AUTH_USER, PAYMENT_ID, assertion),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(repo.markAuthorized).not.toHaveBeenCalled();
  });

  it('does not emit an authorization event when persistence fails', async () => {
    repo.findById.mockResolvedValue(basePayment());
    repo.markAuthorized.mockRejectedValue(new Error('database unavailable'));

    await expect(
      service.authorize(AUTH_USER, PAYMENT_ID, assertion),
    ).rejects.toThrow('database unavailable');

    expect(webauthn.verifyPaymentAssertion).toHaveBeenCalled();
    expect(repo.markAuthorized).toHaveBeenCalledWith(PAYMENT_ID);
    expect(emit).not.toHaveBeenCalled();
  });
});

describe('PaymentsService.create', () => {
  it('rejects a payment request from another Stellar network', async () => {
    const repo = {
      findWalletForUser: jest.fn().mockResolvedValue({ id: 'wallet-1' }),
      findPaymentRequest: jest.fn(),
      findPaymentRequestByExternalId: jest.fn().mockResolvedValue({
        id: 'request-1',
        receiverUserId: 'user-2',
        recipient: 'GDESTINATION',
        asset: 'XLM',
        amount: { toString: () => '1' },
        memo: null,
        network: 'MAINNET',
        expiresAt: new Date(Date.now() + 60_000),
        payment: null,
      }),
      create: jest.fn(),
    };
    const users = {
      getUserBySupabaseId: jest.fn().mockResolvedValue({ id: 'user-1' }),
    };
    const stellar = {
      getNetwork: jest.fn().mockReturnValue('TESTNET'),
      buildPaymentTransaction: jest.fn(),
    };
    const service = new PaymentsService(
      repo as unknown as PaymentsRepository,
      {} as unknown as WebAuthnService,
      users as unknown as UsersService,
      { emit: jest.fn() } as unknown as EventEmitter2,
      stellar as unknown as StellarService,
      {
        getOrThrow: jest.fn().mockReturnValue(300_000),
      } as unknown as ConfigService,
    );

    await expect(
      service.create(AUTH_USER, {
        requestId: 'request-external-1',
        senderPublicKey: 'GSENDER',
      }),
    ).rejects.toMatchObject({ response: { code: 'PAYMENT_NETWORK_MISMATCH' } });

    expect(stellar.buildPaymentTransaction).not.toHaveBeenCalled();
    expect(repo.create).not.toHaveBeenCalled();
  });
});

describe('PaymentsService.submit', () => {
  const payment = {
    id: PAYMENT_ID,
    senderUserId: 'user-1',
    receiverUserId: 'user-2',
    recipient: 'GDESTINATION',
    senderPublicKey: 'GSENDER',
    asset: 'XLM' as const,
    amount: { toString: () => '1.25' },
    memo: null,
    network: 'TESTNET' as const,
    status: 'SUBMITTED' as const,
    stellarTxHash: 'a'.repeat(64),
    expiresAt: null,
    createdAt: new Date(),
  };

  function createSubmitService(overrides: Record<string, jest.Mock> = {}) {
    const repo = {
      findById: jest.fn().mockResolvedValue(payment),
      markSubmitted: jest.fn(),
      markConfirmedAndRecord: jest.fn().mockResolvedValue(undefined),
      markFailed: jest.fn().mockResolvedValue(undefined),
      ...overrides,
    };
    const users = {
      getUserBySupabaseId: jest.fn().mockResolvedValue(INTERNAL_USER),
    };
    const stellar = {
      validatePaymentTransaction: jest.fn(),
      pollTransactionStatus: jest.fn().mockResolvedValue({
        confirmed: true,
        hash: payment.stellarTxHash,
        ledger: 123,
      }),
      submitTransaction: jest.fn(),
    };
    const service = new PaymentsService(
      repo as unknown as PaymentsRepository,
      {} as unknown as WebAuthnService,
      users as unknown as UsersService,
      { emit: jest.fn() } as unknown as EventEmitter2,
      stellar as unknown as StellarService,
      {
        getOrThrow: jest.fn().mockReturnValue(300_000),
      } as unknown as ConfigService,
    );
    return { service, repo, stellar };
  }

  it('reconciles a previously submitted payment after a lost response', async () => {
    const { service, repo, stellar } = createSubmitService();
    repo.findById
      .mockResolvedValueOnce(payment)
      .mockResolvedValueOnce({ ...payment, status: 'CONFIRMED' as const });

    const result = await service.submit(AUTH_USER, PAYMENT_ID, {
      signedXdr: 'retry-xdr',
    });

    expect(stellar.pollTransactionStatus).toHaveBeenCalledWith(
      payment.stellarTxHash,
    );
    expect(repo.markConfirmedAndRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentId: PAYMENT_ID,
        stellarTxHash: payment.stellarTxHash,
      }),
    );
    expect(result.status).toBe('CONFIRMED');
  });

  it('returns an already confirmed payment without relaying it again', async () => {
    const confirmed = { ...payment, status: 'CONFIRMED' as const };
    const { service, repo, stellar } = createSubmitService({
      findById: jest.fn().mockResolvedValue(confirmed),
    });

    const result = await service.submit(AUTH_USER, PAYMENT_ID, {
      signedXdr: 'retry-xdr',
    });

    expect(result.status).toBe('CONFIRMED');
    expect(stellar.submitTransaction).not.toHaveBeenCalled();
    expect(repo.markConfirmedAndRecord).not.toHaveBeenCalled();
  });

  it('leaves a submitted payment recoverable when confirmation polling fails', async () => {
    const { service, repo, stellar } = createSubmitService();
    stellar.pollTransactionStatus.mockRejectedValue(
      new Error('Horizon unavailable'),
    );

    await expect(
      service.submit(AUTH_USER, PAYMENT_ID, { signedXdr: 'retry-xdr' }),
    ).rejects.toThrow('Horizon unavailable');
    expect(repo.markFailed).not.toHaveBeenCalled();
  });

  it('keeps a submitted payment recoverable when bounded polling times out', async () => {
    const { service, repo, stellar } = createSubmitService();
    stellar.pollTransactionStatus.mockResolvedValue({
      confirmed: false,
      hash: payment.stellarTxHash,
      failureCode: 'STELLAR_TIMEOUT',
    });

    const result = await service.submit(AUTH_USER, PAYMENT_ID, {
      signedXdr: 'retry-xdr',
    });

    expect(result.status).toBe('SUBMITTED');
    expect(repo.markFailed).not.toHaveBeenCalled();
  });

  it('rejects an authorized payment after the configured submission window', async () => {
    const now = new Date('2026-11-08T12:00:00.000Z');
    jest.useFakeTimers().setSystemTime(now);
    const { service, stellar } = createSubmitService({
      findById: jest.fn().mockResolvedValue({
        ...payment,
        status: 'AUTHORIZED' as const,
        createdAt: new Date(now.getTime() - 300_001),
      }),
    });

    await expect(
      service.submit(AUTH_USER, PAYMENT_ID, { signedXdr: 'expired-xdr' }),
    ).rejects.toMatchObject({ response: { code: 'PAYMENT_INVALID_STATE' } });
    expect(stellar.validatePaymentTransaction).not.toHaveBeenCalled();
    expect(stellar.submitTransaction).not.toHaveBeenCalled();
  });
});
