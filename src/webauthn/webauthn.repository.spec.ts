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

interface MockCredentialRow {
  id: string;
  userId: string;
  credentialId: string;
}

function createLockingPrismaHarness(initialRows: MockCredentialRow[]) {
  let rows = initialRows.map((row) => ({ ...row }));
  const userLocks = new Map<string, Promise<void>>();

  const acquireUserLock = async (userId: string): Promise<() => void> => {
    while (userLocks.has(userId)) {
      await userLocks.get(userId);
    }
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = () => {
        userLocks.delete(userId);
        resolve();
      };
    });
    userLocks.set(userId, gate);
    return release;
  };

  const prisma = {
    $transaction: jest.fn(
      async <T>(callback: (tx: unknown) => Promise<T>): Promise<T> => {
        const snapshotBeforeTx = rows.map((row) => ({ ...row }));
        const heldReleases: Array<() => void> = [];

        const tx = {
          $queryRaw: jest.fn(
            async (
              _strings: TemplateStringsArray,
              lockedUserId: string,
            ): Promise<Array<{ id: string }>> => {
              const release = await acquireUserLock(lockedUserId);
              heldReleases.push(release);
              return [{ id: lockedUserId }];
            },
          ),
          webAuthnCredential: {
            findFirst: jest.fn(
              async ({
                where,
              }: {
                where: { id: string; userId: string };
              }): Promise<MockCredentialRow | null> => {
                await Promise.resolve();
                return (
                  rows.find(
                    (row) => row.id === where.id && row.userId === where.userId,
                  ) ?? null
                );
              },
            ),
            count: jest.fn(
              async ({
                where,
              }: {
                where: { userId: string };
              }): Promise<number> => {
                await Promise.resolve();
                return rows.filter((row) => row.userId === where.userId).length;
              },
            ),
            deleteMany: jest.fn(
              async ({
                where,
              }: {
                where: { id: string; userId: string };
              }): Promise<{ count: number }> => {
                await Promise.resolve();
                const before = rows.length;
                rows = rows.filter(
                  (row) =>
                    !(row.id === where.id && row.userId === where.userId),
                );
                return { count: before - rows.length };
              },
            ),
          },
        };

        try {
          return await callback(tx);
        } catch (err) {
          rows = snapshotBeforeTx;
          throw err;
        } finally {
          for (const release of heldReleases) {
            release();
          }
        }
      },
    ),
  };

  return {
    prisma,
    getRowsForUser: (userId: string) =>
      rows.filter((row) => row.userId === userId),
  };
}

describe('WebAuthnRepository.revokeCredentialForUser', () => {
  it('preserves the sole passkey when a user only has one credential', async () => {
    const harness = createLockingPrismaHarness([
      { id: 'record-1', userId: 'user-1', credentialId: 'cred-1' },
    ]);
    const repository = new WebAuthnRepository(harness.prisma as never);

    await expect(
      repository.revokeCredentialForUser('record-1', 'user-1'),
    ).resolves.toBe('last_credential');

    expect(harness.getRowsForUser('user-1')).toHaveLength(1);
  });

  it('serializes two racing revocations so a user with two credentials never ends up with zero', async () => {
    const harness = createLockingPrismaHarness([
      { id: 'record-1', userId: 'user-1', credentialId: 'cred-1' },
      { id: 'record-2', userId: 'user-1', credentialId: 'cred-2' },
    ]);
    const repository = new WebAuthnRepository(harness.prisma as never);

    const outcomes = await Promise.all([
      repository.revokeCredentialForUser('record-1', 'user-1'),
      repository.revokeCredentialForUser('record-2', 'user-1'),
    ]);

    expect([...outcomes].sort()).toEqual(['deleted', 'last_credential']);
    expect(harness.getRowsForUser('user-1')).toHaveLength(1);
  });

  it('rolls back and returns last_credential if a concurrent delete drops remaining count below one', async () => {
    let rolledBack = false;
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'user-1' }]),
      webAuthnCredential: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: 'record-2', userId: 'user-1' }),
        count: jest.fn().mockResolvedValueOnce(2).mockResolvedValueOnce(0),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (value: typeof tx) => unknown) => {
        try {
          return await callback(tx);
        } catch (err) {
          rolledBack = true;
          throw err;
        }
      }),
    };
    const repository = new WebAuthnRepository(prisma as never);

    await expect(
      repository.revokeCredentialForUser('record-2', 'user-1'),
    ).resolves.toBe('last_credential');
    expect(rolledBack).toBe(true);
  });

  it('returns not_found for another user credential without touching either user records', async () => {
    const harness = createLockingPrismaHarness([
      { id: 'record-1', userId: 'user-1', credentialId: 'cred-1' },
      { id: 'record-2', userId: 'user-1', credentialId: 'cred-2' },
      { id: 'record-other', userId: 'user-2', credentialId: 'cred-other' },
    ]);
    const repository = new WebAuthnRepository(harness.prisma as never);

    await expect(
      repository.revokeCredentialForUser('record-other', 'user-1'),
    ).resolves.toBe('not_found');

    expect(harness.getRowsForUser('user-1')).toHaveLength(2);
    expect(harness.getRowsForUser('user-2')).toHaveLength(1);
  });

  it('propagates database failures without masking them as not_found or last_credential', async () => {
    const dbFailure = new Error('database unavailable');
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'user-1' }]),
      webAuthnCredential: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: 'record-1', userId: 'user-1' }),
        count: jest.fn().mockResolvedValue(2),
        deleteMany: jest.fn().mockRejectedValue(dbFailure),
      },
    };
    const prisma = {
      $transaction: jest.fn((callback: (value: typeof tx) => unknown) =>
        callback(tx),
      ),
    };
    const repository = new WebAuthnRepository(prisma as never);

    await expect(
      repository.revokeCredentialForUser('record-1', 'user-1'),
    ).rejects.toThrow('database unavailable');
  });
});
