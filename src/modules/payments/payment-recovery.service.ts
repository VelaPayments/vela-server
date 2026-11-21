import {
  ConflictException,
  HttpException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Payment, PaymentStatus, Prisma } from '@prisma/client';
import { STELLAR_ERROR } from '../../stellar/stellar.constants';
import { StellarService } from '../../stellar/stellar.service';
import { PaymentsRepository } from './payments.repository';
import { PaymentsService, type ReconcileOutcome } from './payments.service';

export const RECOVERY_MAX_LIMIT = 500;

/**
 * What operator recovery did (or, in a dry run, would do) with one payment.
 *
 * - `CONFIRMED` / `FAILED`: Horizon returned a final result for the stored hash.
 * - `PENDING`: Horizon has no record of the hash yet; the payment stays SUBMITTED.
 * - `EXPIRED`: a CREATED intent outlived its authorization window and is closed.
 * - `SKIPPED`: the payment can still progress on its own, or changed state
 *   while recovery was running.
 * - `MANUAL_REVIEW`: the server cannot prove what happened on-chain; an
 *   operator must check Horizon before changing anything.
 * - `ERROR`: a dependency (usually Horizon) failed; nothing was written.
 */
export type RecoveryAction =
  ReconcileOutcome | 'EXPIRED' | 'SKIPPED' | 'MANUAL_REVIEW' | 'ERROR';

export interface RecoveryOptions {
  /** Write state changes. When false, recovery only reads the database and Horizon. */
  apply: boolean;
  /** Only payments created at least this long ago are considered. */
  olderThanMs: number;
  limit: number;
  now?: Date;
}

export interface RecoveryResult {
  paymentId: string;
  /** Status at the moment recovery inspected the payment. */
  status: PaymentStatus;
  action: RecoveryAction;
  /** True only when this run wrote a state change for the payment. */
  applied: boolean;
  stellarTxHash: string | null;
  reason: string;
}

export interface RecoveryReport {
  mode: 'dry-run' | 'apply';
  network: 'TESTNET' | 'MAINNET';
  checkedAt: string;
  createdBefore: string;
  limit: number;
  results: RecoveryResult[];
  summary: Record<RecoveryAction, number>;
}

// Candidates are already older than the cutoff, so a single Horizon lookup is
// enough. The client-facing bounded poll would only slow a sweep down.
const SINGLE_LOOKUP = { maxAttempts: 1, intervalMs: 0 } as const;

const ACTIONS: readonly RecoveryAction[] = [
  'CONFIRMED',
  'FAILED',
  'PENDING',
  'EXPIRED',
  'SKIPPED',
  'MANUAL_REVIEW',
  'ERROR',
];

/**
 * Operator recovery for payments that never reached a terminal state.
 *
 * Recovery only automates transitions the server can prove. A SUBMITTED payment
 * is resolved from Horizon using its stored hash, and an unauthorized CREATED
 * intent is closed once its window has elapsed. An AUTHORIZED payment with no
 * recorded hash may still have reached Stellar if the process stopped between
 * relaying and recording it, so it is always left for manual review.
 */
@Injectable()
export class PaymentRecoveryService {
  private readonly logger = new Logger(PaymentRecoveryService.name);

  constructor(
    private readonly repo: PaymentsRepository,
    private readonly paymentsService: PaymentsService,
    private readonly stellarService: StellarService,
    private readonly config: ConfigService,
  ) {}

  async recover(options: RecoveryOptions): Promise<RecoveryReport> {
    assertRecoveryOptions(options);

    const now = options.now ?? new Date();
    const createdBefore = new Date(now.getTime() - options.olderThanMs);
    const candidates = await this.repo.findRecoveryCandidates(
      createdBefore,
      options.limit,
    );

    // Sequential on purpose: it keeps Horizon request volume predictable and
    // makes each result reflect the state left by the previous write.
    const results: RecoveryResult[] = [];
    for (const payment of candidates) {
      results.push(await this.recoverOne(payment, options.apply, now));
    }

    return {
      mode: options.apply ? 'apply' : 'dry-run',
      network: this.stellarService.getNetwork(),
      checkedAt: now.toISOString(),
      createdBefore: createdBefore.toISOString(),
      limit: options.limit,
      results,
      summary: summarize(results),
    };
  }

  private async recoverOne(
    payment: Payment,
    apply: boolean,
    now: Date,
  ): Promise<RecoveryResult> {
    const base = {
      paymentId: payment.id,
      status: payment.status,
      stellarTxHash: payment.stellarTxHash,
    };

    if (payment.network !== this.stellarService.getNetwork()) {
      return {
        ...base,
        action: 'MANUAL_REVIEW',
        applied: false,
        reason: `Payment belongs to ${payment.network}; the server is configured for ${this.stellarService.getNetwork()}.`,
      };
    }

    try {
      switch (payment.status) {
        case PaymentStatus.SUBMITTED:
          return { ...base, ...(await this.recoverSubmitted(payment, apply)) };
        case PaymentStatus.CREATED:
          return {
            ...base,
            ...(await this.recoverCreated(payment, apply, now)),
          };
        case PaymentStatus.AUTHORIZED:
          return { ...base, ...this.reviewAuthorized(payment, now) };
        default:
          return {
            ...base,
            action: 'SKIPPED',
            applied: false,
            reason: `Payment is already ${payment.status}.`,
          };
      }
    } catch (error) {
      const code = errorCode(error);
      this.logger.warn(`Recovery of payment ${payment.id} failed: ${code}`);
      return {
        ...base,
        action: 'ERROR',
        applied: false,
        reason: `Recovery failed with ${code}; no state was changed.`,
      };
    }
  }

  private async recoverSubmitted(
    payment: Payment,
    apply: boolean,
  ): Promise<Pick<RecoveryResult, 'action' | 'applied' | 'reason'>> {
    const stellarTxHash = payment.stellarTxHash;
    if (!stellarTxHash) {
      return {
        action: 'MANUAL_REVIEW',
        applied: false,
        reason:
          'SUBMITTED payment has no stored Stellar hash; locate the transaction from the sender account in Horizon.',
      };
    }

    if (!apply) {
      const lookup = await this.stellarService.pollTransactionStatus(
        stellarTxHash,
        SINGLE_LOOKUP,
      );
      const outcome: ReconcileOutcome = lookup.confirmed
        ? 'CONFIRMED'
        : lookup.failureCode === STELLAR_ERROR.TIMEOUT
          ? 'PENDING'
          : 'FAILED';
      return {
        action: outcome,
        applied: false,
        reason: describeOutcome(outcome, false),
      };
    }

    let outcome: ReconcileOutcome;
    try {
      outcome = await this.paymentsService.reconcileSubmitted(
        { ...payment, stellarTxHash },
        SINGLE_LOOKUP,
      );
    } catch (error) {
      // A client retry can confirm the payment between our read and our write;
      // the repository refuses the second confirmation, which is the safe result.
      if (error instanceof ConflictException) {
        return this.changedState(payment.id);
      }
      throw error;
    }

    return {
      action: outcome,
      applied: outcome !== 'PENDING',
      reason: describeOutcome(outcome, true),
    };
  }

  private async recoverCreated(
    payment: Payment,
    apply: boolean,
    now: Date,
  ): Promise<Pick<RecoveryResult, 'action' | 'applied' | 'reason'>> {
    if (!this.hasWindowElapsed(payment, now)) {
      return {
        action: 'SKIPPED',
        applied: false,
        reason: 'Intent is still within its authorization window.',
      };
    }

    if (!apply) {
      return {
        action: 'EXPIRED',
        applied: false,
        reason:
          'Intent was never authorized and its window has elapsed; --apply closes it as FAILED with PAYMENT_INTENT_EXPIRED.',
      };
    }

    const expired = await this.repo.markIntentExpired(payment.id);
    if (expired.count !== 1) {
      return this.changedState(payment.id);
    }
    return {
      action: 'EXPIRED',
      applied: true,
      reason:
        'Intent was never authorized and its window has elapsed; closed as FAILED with PAYMENT_INTENT_EXPIRED.',
    };
  }

  private reviewAuthorized(
    payment: Payment,
    now: Date,
  ): Pick<RecoveryResult, 'action' | 'applied' | 'reason'> {
    if (!this.hasWindowElapsed(payment, now)) {
      return {
        action: 'SKIPPED',
        applied: false,
        reason: 'Authorized payment can still be submitted by its sender.',
      };
    }

    // The server does not keep signed XDR, so without a recorded hash it
    // cannot tell "never relayed" apart from "relayed, then crashed".
    return {
      action: 'MANUAL_REVIEW',
      applied: false,
      reason:
        'Authorized but no submission was recorded; check the sender account in Horizon for a matching payment before closing it.',
    };
  }

  private async changedState(
    paymentId: string,
  ): Promise<Pick<RecoveryResult, 'action' | 'applied' | 'reason'>> {
    const current = await this.repo.findById(paymentId);
    return {
      action: 'SKIPPED',
      applied: false,
      reason: `Payment changed state during recovery and is now ${current.status}.`,
    };
  }

  /** Mirrors the authorize/submit window check in PaymentsService. */
  private hasWindowElapsed(payment: Payment, now: Date): boolean {
    const timeoutMs = this.config.getOrThrow<number>(
      'payments.submitTimeoutMs',
    );
    const nowMs = now.getTime();
    return (
      payment.createdAt.getTime() + timeoutMs <= nowMs ||
      (payment.expiresAt !== null && payment.expiresAt.getTime() <= nowMs)
    );
  }
}

function assertRecoveryOptions(options: RecoveryOptions): void {
  if (!Number.isSafeInteger(options.olderThanMs) || options.olderThanMs <= 0) {
    throw new RangeError('olderThanMs must be a positive integer.');
  }
  if (
    !Number.isInteger(options.limit) ||
    options.limit < 1 ||
    options.limit > RECOVERY_MAX_LIMIT
  ) {
    throw new RangeError(
      `limit must be an integer between 1 and ${RECOVERY_MAX_LIMIT}.`,
    );
  }
}

function describeOutcome(outcome: ReconcileOutcome, applied: boolean): string {
  switch (outcome) {
    case 'CONFIRMED':
      return applied
        ? 'Horizon reports the transaction succeeded; payment confirmed and history indexed.'
        : 'Horizon reports the transaction succeeded; --apply confirms it and indexes history.';
    case 'FAILED':
      return applied
        ? 'Horizon reports the transaction failed; payment marked FAILED.'
        : 'Horizon reports the transaction failed; --apply marks it FAILED.';
    case 'PENDING':
      return 'Horizon has no record of the stored hash yet; payment left SUBMITTED.';
  }
}

/**
 * Reports only the canonical error code. Raw provider messages can carry
 * request details that do not belong in operator output.
 */
function errorCode(error: unknown): string {
  if (error instanceof HttpException) {
    const response = error.getResponse();
    if (
      typeof response === 'object' &&
      response !== null &&
      'code' in response &&
      typeof response.code === 'string'
    ) {
      return response.code;
    }
  }
  // Prisma codes such as P1001 identify the failure without echoing the query.
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return `DATABASE_${error.code}`;
  }
  return 'UNEXPECTED_ERROR';
}

function summarize(results: RecoveryResult[]): Record<RecoveryAction, number> {
  const summary = Object.fromEntries(
    ACTIONS.map((action) => [action, 0]),
  ) as Record<RecoveryAction, number>;
  for (const result of results) summary[result.action] += 1;
  return summary;
}
