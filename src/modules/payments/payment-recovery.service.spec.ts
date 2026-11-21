import {
  ConflictException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, type Payment } from '@prisma/client';
import { StellarService } from '../../stellar/stellar.service';
import { PaymentRecoveryService } from './payment-recovery.service';
import { PaymentsRepository } from './payments.repository';
import { PaymentsService } from './payments.service';

const NOW = new Date('2026-11-21T12:00:00.000Z');
const SUBMIT_TIMEOUT_MS = 300_000;
const HASH = 'b'.repeat(64);
const SINGLE_LOOKUP = { maxAttempts: 1, intervalMs: 0 };

function minutesAgo(minutes: number): Date {
  return new Date(NOW.getTime() - minutes * 60_000);
}

function stuckPayment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: 'pay-1',
    paymentRequestId: 'req-1',
    senderUserId: 'user-1',
    receiverUserId: 'user-2',
    recipient: 'GRECIPIENT',
    senderPublicKey: 'GSENDER',
    asset: 'XLM',
    amount: new Prisma.Decimal('1.25'),
    memo: null,
    network: 'TESTNET',
    status: 'SUBMITTED',
    stellarTxHash: HASH,
    failureReason: null,
    failureCode: null,
    authorizedAt: minutesAgo(59),
    submittedAt: minutesAgo(58),
    confirmedAt: null,
    expiresAt: null,
    createdAt: minutesAgo(60),
    updatedAt: minutesAgo(58),
    ...overrides,
  };
}

function setup(candidates: Payment[]) {
  const repo = {
    findRecoveryCandidates: jest.fn().mockResolvedValue(candidates),
    markIntentExpired: jest.fn().mockResolvedValue({ count: 1 }),
    findById: jest.fn(),
  };
  const payments = {
    reconcileSubmitted: jest.fn().mockResolvedValue('CONFIRMED'),
  };
  const stellar = {
    getNetwork: jest.fn().mockReturnValue('TESTNET'),
    pollTransactionStatus: jest
      .fn()
      .mockResolvedValue({ confirmed: true, hash: HASH, ledger: 42 }),
  };
  const service = new PaymentRecoveryService(
    repo as unknown as PaymentsRepository,
    payments as unknown as PaymentsService,
    stellar as unknown as StellarService,
    {
      getOrThrow: jest.fn().mockReturnValue(SUBMIT_TIMEOUT_MS),
    } as unknown as ConfigService,
  );
  return { service, repo, payments, stellar };
}

const run = (service: PaymentRecoveryService, apply: boolean) =>
  service.recover({ apply, olderThanMs: 30 * 60_000, limit: 50, now: NOW });

describe('PaymentRecoveryService', () => {
  it('selects candidates created before the cutoff, bounded by the limit', async () => {
    const { service, repo } = setup([]);

    const report = await service.recover({
      apply: false,
      olderThanMs: 30 * 60_000,
      limit: 10,
      now: NOW,
    });

    expect(repo.findRecoveryCandidates).toHaveBeenCalledWith(
      minutesAgo(30),
      10,
    );
    expect(report).toMatchObject({
      mode: 'dry-run',
      network: 'TESTNET',
      checkedAt: NOW.toISOString(),
      createdBefore: minutesAgo(30).toISOString(),
      results: [],
    });
  });

  it.each([
    [{ olderThanMs: 0, limit: 10 }],
    [{ olderThanMs: 60_000, limit: 0 }],
    [{ olderThanMs: 60_000, limit: 501 }],
    [{ olderThanMs: 1.5, limit: 10 }],
  ])('rejects invalid options %j before querying', async (options) => {
    const { service, repo } = setup([]);

    await expect(
      service.recover({ apply: false, now: NOW, ...options }),
    ).rejects.toBeInstanceOf(RangeError);
    expect(repo.findRecoveryCandidates).not.toHaveBeenCalled();
  });

  describe('SUBMITTED payments', () => {
    it('reports the Horizon outcome in a dry run without writing', async () => {
      const { service, payments, stellar } = setup([stuckPayment()]);

      const report = await run(service, false);

      expect(stellar.pollTransactionStatus).toHaveBeenCalledWith(
        HASH,
        SINGLE_LOOKUP,
      );
      expect(payments.reconcileSubmitted).not.toHaveBeenCalled();
      expect(report.results).toEqual([
        expect.objectContaining({
          paymentId: 'pay-1',
          status: 'SUBMITTED',
          action: 'CONFIRMED',
          applied: false,
          stellarTxHash: HASH,
        }),
      ]);
    });

    it.each([
      ['STELLAR_TX_FAILED', 'FAILED'],
      ['STELLAR_TIMEOUT', 'PENDING'],
    ])(
      'maps a %s lookup to %s in a dry run',
      async (failureCode, expectedAction) => {
        const { service, stellar } = setup([stuckPayment()]);
        stellar.pollTransactionStatus.mockResolvedValue({
          confirmed: false,
          hash: HASH,
          failureCode,
        });

        const report = await run(service, false);

        expect(report.results[0]).toMatchObject({
          action: expectedAction,
          applied: false,
        });
      },
    );

    it('confirms through the shared reconciliation path when applied', async () => {
      const payment = stuckPayment();
      const { service, payments } = setup([payment]);

      const report = await run(service, true);

      expect(payments.reconcileSubmitted).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'pay-1', stellarTxHash: HASH }),
        SINGLE_LOOKUP,
      );
      expect(report.mode).toBe('apply');
      expect(report.results[0]).toMatchObject({
        action: 'CONFIRMED',
        applied: true,
      });
      expect(report.summary.CONFIRMED).toBe(1);
    });

    it('leaves a payment SUBMITTED when Horizon has no record yet', async () => {
      const { service, payments } = setup([stuckPayment()]);
      payments.reconcileSubmitted.mockResolvedValue('PENDING');

      const report = await run(service, true);

      expect(report.results[0]).toMatchObject({
        action: 'PENDING',
        applied: false,
      });
    });

    it('reports a Horizon outage by code only and continues the sweep', async () => {
      const first = stuckPayment({ id: 'pay-1' });
      const second = stuckPayment({
        id: 'pay-2',
        stellarTxHash: 'c'.repeat(64),
      });
      const { service, payments } = setup([first, second]);
      const warn = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);
      payments.reconcileSubmitted
        .mockRejectedValueOnce(
          new ServiceUnavailableException({
            statusCode: 503,
            message: 'upstream said: connect ECONNREFUSED 10.0.0.7:443',
            code: 'STELLAR_NETWORK_ERROR',
          }),
        )
        .mockResolvedValueOnce('CONFIRMED');

      const report = await run(service, true);

      expect(report.results[0]).toMatchObject({
        paymentId: 'pay-1',
        action: 'ERROR',
        applied: false,
      });
      expect(report.results[0].reason).toContain('STELLAR_NETWORK_ERROR');
      expect(report.results[0].reason).not.toContain('ECONNREFUSED');
      expect(report.results[1]).toMatchObject({
        paymentId: 'pay-2',
        action: 'CONFIRMED',
      });
      expect(report.summary).toMatchObject({ ERROR: 1, CONFIRMED: 1 });
      expect(warn).toHaveBeenCalledWith(
        'Recovery of payment pay-1 failed: STELLAR_NETWORK_ERROR',
      );
      warn.mockRestore();
    });

    it('reports a database failure by Prisma code, not by query text', async () => {
      const { service, payments } = setup([stuckPayment()]);
      jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      payments.reconcileSubmitted.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError(
          'Invalid `prisma.payment.updateMany()` invocation: secret detail',
          { code: 'P2034', clientVersion: 'test' },
        ),
      );

      const report = await run(service, true);

      expect(report.results[0]).toMatchObject({ action: 'ERROR' });
      expect(report.results[0].reason).toContain('DATABASE_P2034');
      expect(report.results[0].reason).not.toContain('secret detail');
      jest.restoreAllMocks();
    });

    it('skips a payment that a client retry confirmed mid-recovery', async () => {
      const { service, repo, payments } = setup([stuckPayment()]);
      payments.reconcileSubmitted.mockRejectedValue(
        new ConflictException({ code: 'PAYMENT_INVALID_STATE' }),
      );
      repo.findById.mockResolvedValue(stuckPayment({ status: 'CONFIRMED' }));

      const report = await run(service, true);

      expect(report.results[0]).toMatchObject({
        action: 'SKIPPED',
        applied: false,
      });
      expect(report.results[0].reason).toContain('now CONFIRMED');
    });

    it('needs manual review when the stored hash is missing', async () => {
      const { service, payments, stellar } = setup([
        stuckPayment({ stellarTxHash: null }),
      ]);

      const report = await run(service, true);

      expect(report.results[0]).toMatchObject({ action: 'MANUAL_REVIEW' });
      expect(stellar.pollTransactionStatus).not.toHaveBeenCalled();
      expect(payments.reconcileSubmitted).not.toHaveBeenCalled();
    });
  });

  describe('CREATED intents', () => {
    const created = (overrides: Partial<Payment> = {}) =>
      stuckPayment({
        status: 'CREATED',
        stellarTxHash: null,
        authorizedAt: null,
        submittedAt: null,
        ...overrides,
      });

    it('expires an intent whose authorization window has elapsed', async () => {
      const { service, repo } = setup([created()]);

      const report = await run(service, true);

      expect(repo.markIntentExpired).toHaveBeenCalledWith('pay-1');
      expect(report.results[0]).toMatchObject({
        action: 'EXPIRED',
        applied: true,
      });
    });

    it('only reports the expiry in a dry run', async () => {
      const { service, repo } = setup([created()]);

      const report = await run(service, false);

      expect(repo.markIntentExpired).not.toHaveBeenCalled();
      expect(report.results[0]).toMatchObject({
        action: 'EXPIRED',
        applied: false,
      });
    });

    it('treats the exact end of the window as elapsed, like authorize does', async () => {
      const { service, repo } = setup([
        created({ createdAt: new Date(NOW.getTime() - SUBMIT_TIMEOUT_MS) }),
      ]);

      await run(service, true);

      expect(repo.markIntentExpired).toHaveBeenCalledTimes(1);
    });

    it('leaves an intent that can still be authorized', async () => {
      const { service, repo } = setup([
        created({
          createdAt: new Date(NOW.getTime() - SUBMIT_TIMEOUT_MS + 1),
        }),
      ]);

      const report = await run(service, true);

      expect(repo.markIntentExpired).not.toHaveBeenCalled();
      expect(report.results[0]).toMatchObject({ action: 'SKIPPED' });
    });

    it('expires an intent whose payment request has expired', async () => {
      const { service, repo } = setup([
        created({
          createdAt: new Date(NOW.getTime() - 1_000),
          expiresAt: new Date(NOW.getTime() - 1),
        }),
      ]);

      const report = await run(service, true);

      expect(repo.markIntentExpired).toHaveBeenCalledWith('pay-1');
      expect(report.results[0].action).toBe('EXPIRED');
    });

    it('skips an intent that was authorized between the read and the write', async () => {
      const { service, repo } = setup([created()]);
      repo.markIntentExpired.mockResolvedValue({ count: 0 });
      repo.findById.mockResolvedValue(created({ status: 'AUTHORIZED' }));

      const report = await run(service, true);

      expect(report.results[0]).toMatchObject({
        action: 'SKIPPED',
        applied: false,
      });
      expect(report.results[0].reason).toContain('now AUTHORIZED');
    });
  });

  describe('AUTHORIZED payments', () => {
    const authorized = (overrides: Partial<Payment> = {}) =>
      stuckPayment({
        status: 'AUTHORIZED',
        stellarTxHash: null,
        submittedAt: null,
        ...overrides,
      });

    it('never changes an expired authorization automatically', async () => {
      const { service, repo, payments, stellar } = setup([authorized()]);

      const report = await run(service, true);

      expect(report.results[0]).toMatchObject({
        action: 'MANUAL_REVIEW',
        applied: false,
      });
      expect(repo.markIntentExpired).not.toHaveBeenCalled();
      expect(payments.reconcileSubmitted).not.toHaveBeenCalled();
      expect(stellar.pollTransactionStatus).not.toHaveBeenCalled();
    });

    it('leaves an authorization its sender can still submit', async () => {
      const { service } = setup([
        authorized({ createdAt: new Date(NOW.getTime() - 60_000) }),
      ]);

      const report = await run(service, true);

      expect(report.results[0].action).toBe('SKIPPED');
    });
  });

  it('flags a payment from another network without contacting Horizon', async () => {
    const { service, payments, stellar } = setup([
      stuckPayment({ network: 'MAINNET' }),
    ]);

    const report = await run(service, true);

    expect(report.results[0]).toMatchObject({
      action: 'MANUAL_REVIEW',
      applied: false,
    });
    expect(stellar.pollTransactionStatus).not.toHaveBeenCalled();
    expect(payments.reconcileSubmitted).not.toHaveBeenCalled();
  });
});
