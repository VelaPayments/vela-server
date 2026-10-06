import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PaymentsService, PAYMENT_AUTHORIZED_EVENT } from './payments.service';
import { PaymentsRepository } from './payments.repository';
import { WebAuthnService } from '../../webauthn/webauthn.service';
import { UsersService } from '../users/users.service';
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
