import { CHALLENGE_TYPE } from './webauthn.constants';
import { WebAuthnRepository } from './webauthn.repository';

describe('WebAuthnRepository.consumeLatestValid', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('does not consume a stored challenge that has expired', async () => {
    const now = new Date('2026-10-06T12:00:00.000Z');
    const expiredChallenge = {
      id: 'expired-challenge',
      userId: 'user-1',
      challenge: 'stale',
      type: CHALLENGE_TYPE.REGISTRATION,
      paymentId: null,
      expiresAt: new Date(now.getTime() - 1),
    };
    jest.useFakeTimers().setSystemTime(now);

    const transaction = {
      webAuthnChallenge: {
        findFirst: jest.fn(
          ({ where }: { where: { expiresAt?: { gt?: Date } } }) => {
            const cutoff = where.expiresAt?.gt;
            return cutoff && expiredChallenge.expiresAt > cutoff
              ? expiredChallenge
              : null;
          },
        ),
        delete: jest.fn(),
      },
    };
    const prisma = {
      $transaction: jest.fn((callback: (tx: typeof transaction) => unknown) =>
        callback(transaction),
      ),
    };
    const repository = new WebAuthnRepository(prisma as never);

    await expect(
      repository.consumeLatestValid({
        userId: 'user-1',
        type: CHALLENGE_TYPE.REGISTRATION,
      }),
    ).resolves.toBeNull();

    expect(transaction.webAuthnChallenge.findFirst).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        type: CHALLENGE_TYPE.REGISTRATION,
        paymentId: null,
        expiresAt: { gt: now },
      },
      orderBy: { createdAt: 'desc' },
    });
    expect(transaction.webAuthnChallenge.delete).not.toHaveBeenCalled();
  });
});
