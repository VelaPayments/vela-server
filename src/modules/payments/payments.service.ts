import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PaymentStatus } from '@prisma/client';
import type { AuthenticationResponseJSON } from '@simplewebauthn/server';
import { WebAuthnService } from '../../webauthn/webauthn.service';
import { UsersService } from '../users/users.service';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { PaymentsRepository } from './payments.repository';
import { PaymentAuthorizedResponseDto } from './dto';
import { StellarService } from '../../stellar/stellar.service';
import { STELLAR_ERROR } from '../../stellar/stellar.constants';
import type { CreatePaymentDto } from './dto/create-payment.dto';
import type { SubmitPaymentDto } from './dto/submit-payment.dto';
import type { PaymentResponseDto } from './dto/payment-response.dto';

export const PAYMENT_AUTHORIZED_EVENT = 'payment.authorized';

@Injectable()
export class PaymentsService {
  constructor(
    private readonly repo: PaymentsRepository,
    private readonly webAuthnService: WebAuthnService,
    private readonly usersService: UsersService,
    private readonly events: EventEmitter2,
    private readonly stellarService: StellarService,
    private readonly config: ConfigService,
  ) {}

  async create(
    authUser: AuthenticatedUser,
    dto: CreatePaymentDto,
  ): Promise<PaymentResponseDto> {
    const user = await this.usersService.getUserBySupabaseId(
      authUser.supabaseUserId,
    );
    if (!user) throw new InternalServerErrorException('User record not found.');

    const network = this.stellarService.getNetwork();
    const wallet = await this.repo.findWalletForUser(
      user.id,
      dto.senderPublicKey,
      network,
    );
    if (!wallet) {
      throw new ForbiddenException({
        statusCode: 403,
        message: 'The sender wallet is not linked to this user.',
        code: 'WALLET_NOT_LINKED',
      });
    }

    if (!dto.paymentRequestId && !dto.requestId) {
      throw new BadRequestException({
        statusCode: 400,
        message: 'paymentRequestId or requestId is required.',
        code: 'PAYMENT_REQUEST_ID_REQUIRED',
      });
    }
    const request = dto.paymentRequestId
      ? await this.repo.findPaymentRequest(dto.paymentRequestId)
      : await this.repo.findPaymentRequestByExternalId(dto.requestId!);
    if (!request) {
      throw new BadRequestException({
        statusCode: 404,
        message: 'Payment request not found.',
        code: 'PAYMENT_REQUEST_NOT_FOUND',
      });
    }
    if (request.network !== network) {
      throw new ConflictException({
        statusCode: 409,
        message: 'Payment request belongs to a different Stellar network.',
        code: 'PAYMENT_NETWORK_MISMATCH',
      });
    }
    if (request.payment) {
      throw new ConflictException({
        statusCode: 409,
        message: 'Payment request has already been used.',
        code: 'PAYMENT_REQUEST_CONSUMED',
      });
    }
    if (request.receiverUserId === user.id) {
      throw new ConflictException({
        statusCode: 409,
        message: 'A payment cannot be sent to the same user.',
        code: 'PAYMENT_SELF_TRANSFER',
      });
    }
    if (request.expiresAt.getTime() <= Date.now()) {
      throw new ConflictException({
        statusCode: 409,
        message: 'Payment request has expired.',
        code: 'PAYMENT_REQUEST_EXPIRED',
      });
    }

    const unsigned = await this.stellarService.buildPaymentTransaction({
      sourcePublicKey: dto.senderPublicKey,
      destination: request.recipient,
      asset: request.asset,
      amount: request.amount.toString(),
      memo: request.memo || undefined,
    });

    const payment = await this.repo.create({
      paymentRequestId: request.id,
      senderUserId: user.id,
      receiverUserId: request.receiverUserId,
      recipient: request.recipient,
      senderPublicKey: dto.senderPublicKey,
      asset: request.asset,
      amount: request.amount.toString(),
      memo: request.memo || null,
      network,
      expiresAt: request.expiresAt,
    });

    return { ...toPaymentResponse(payment), unsignedXdr: unsigned.toXDR() };
  }

  async submit(
    authUser: AuthenticatedUser,
    paymentId: string,
    dto: SubmitPaymentDto,
  ): Promise<PaymentResponseDto> {
    const user = await this.usersService.getUserBySupabaseId(
      authUser.supabaseUserId,
    );
    if (!user) throw new InternalServerErrorException('User record not found.');
    const payment = await this.repo.findById(paymentId);
    if (payment.senderUserId !== user.id) {
      throw new ForbiddenException({
        statusCode: 403,
        message: 'You are not the sender of this payment.',
        code: 'FORBIDDEN',
      });
    }
    if (payment.status === PaymentStatus.CONFIRMED) {
      return toPaymentResponse(payment);
    }
    if (payment.status === PaymentStatus.SUBMITTED) {
      if (!payment.stellarTxHash) {
        throw new ConflictException({
          statusCode: 409,
          message: 'Submitted payment is missing its Stellar transaction hash.',
          code: 'PAYMENT_INVALID_STATE',
        });
      }
      const stellarTxHash = payment.stellarTxHash;
      await this.reconcileSubmitted({ ...payment, stellarTxHash });
      return toPaymentResponse(await this.repo.findById(paymentId));
    }
    if (payment.status !== PaymentStatus.AUTHORIZED) {
      throw new ConflictException({
        statusCode: 409,
        message: `Payment is ${payment.status}; expected AUTHORIZED.`,
        code: 'PAYMENT_INVALID_STATE',
      });
    }
    this.assertWithinSubmissionWindow(payment.createdAt);
    if (payment.expiresAt && payment.expiresAt.getTime() <= Date.now()) {
      throw new ConflictException({
        statusCode: 409,
        message: 'Payment has expired.',
        code: 'PAYMENT_INVALID_STATE',
      });
    }

    this.stellarService.validatePaymentTransaction(dto.signedXdr, {
      sourcePublicKey: payment.senderPublicKey,
      destination: payment.recipient,
      asset: payment.asset,
      amount: payment.amount.toString(),
      memo: payment.memo,
    });

    let submission: { hash: string };
    try {
      submission = await this.stellarService.submitTransaction(dto.signedXdr);
    } catch (error) {
      await this.repo.markFailed(
        paymentId,
        'STELLAR_SUBMISSION_FAILED',
        error instanceof Error ? error.message : 'Stellar submission failed.',
      );
      throw error;
    }
    const marked = await this.repo.markSubmitted(paymentId, submission.hash);
    if (marked.count !== 1) {
      const current = await this.repo.findById(paymentId);
      const stellarTxHash = current.stellarTxHash;
      if (current.status === PaymentStatus.SUBMITTED && stellarTxHash) {
        await this.reconcileSubmitted({ ...current, stellarTxHash });
        return toPaymentResponse(await this.repo.findById(paymentId));
      }
      if (current.status === PaymentStatus.CONFIRMED) {
        return toPaymentResponse(current);
      }
      throw new ConflictException({
        statusCode: 409,
        message: 'Payment state changed before submission was recorded.',
        code: 'PAYMENT_INVALID_STATE',
      });
    }

    await this.reconcileSubmitted({
      ...payment,
      stellarTxHash: submission.hash,
    });

    return toPaymentResponse(await this.repo.findById(paymentId));
  }

  private async reconcileSubmitted(payment: {
    id: string;
    senderUserId: string;
    receiverUserId: string;
    senderPublicKey: string;
    recipient: string;
    asset: 'XLM' | 'USDC';
    amount: { toString(): string };
    memo: string | null;
    network: 'TESTNET' | 'MAINNET';
    stellarTxHash: string;
  }): Promise<void> {
    const confirmation = await this.stellarService.pollTransactionStatus(
      payment.stellarTxHash,
    );
    if (confirmation.confirmed) {
      await this.repo.markConfirmedAndRecord({
        paymentId: payment.id,
        senderUserId: payment.senderUserId,
        receiverUserId: payment.receiverUserId,
        senderPublicKey: payment.senderPublicKey,
        recipient: payment.recipient,
        asset: payment.asset,
        amount: payment.amount.toString(),
        memo: payment.memo,
        network: payment.network,
        stellarTxHash: confirmation.hash,
        ledger: confirmation.ledger,
      });
      return;
    }

    if (confirmation.failureCode !== STELLAR_ERROR.TIMEOUT) {
      await this.repo.markFailed(
        payment.id,
        confirmation.failureCode,
        'Stellar transaction was rejected.',
      );
    }
  }

  async getStatus(
    authUser: AuthenticatedUser,
    paymentId: string,
  ): Promise<PaymentResponseDto> {
    const user = await this.usersService.getUserBySupabaseId(
      authUser.supabaseUserId,
    );
    if (!user) throw new InternalServerErrorException('User record not found.');
    const payment = await this.repo.findById(paymentId);
    if (
      payment.senderUserId !== user.id &&
      payment.receiverUserId !== user.id
    ) {
      throw new ForbiddenException({
        statusCode: 403,
        message: 'You do not have access to this payment.',
        code: 'FORBIDDEN',
      });
    }
    return toPaymentResponse(payment);
  }

  async authorize(
    authUser: AuthenticatedUser,
    paymentId: string,
    assertion: AuthenticationResponseJSON,
  ): Promise<PaymentAuthorizedResponseDto> {
    const user = await this.usersService.getUserBySupabaseId(
      authUser.supabaseUserId,
    );
    if (!user) {
      throw new InternalServerErrorException('User record not found.');
    }

    const payment = await this.repo.findById(paymentId);

    if (payment.senderUserId !== user.id) {
      throw new ForbiddenException({
        statusCode: 403,
        message: 'You are not the sender of this payment.',
        code: 'FORBIDDEN',
      });
    }

    if (payment.status !== PaymentStatus.CREATED) {
      throw new ConflictException({
        statusCode: 409,
        message: `Payment is ${payment.status}; expected CREATED.`,
        code: 'PAYMENT_INVALID_STATE',
      });
    }

    this.assertWithinSubmissionWindow(payment.createdAt);
    if (payment.expiresAt && payment.expiresAt.getTime() <= Date.now()) {
      throw new ConflictException({
        statusCode: 409,
        message: 'Payment has expired.',
        code: 'PAYMENT_INVALID_STATE',
      });
    }

    await this.webAuthnService.verifyPaymentAssertion({
      internalUserId: user.id,
      paymentId,
      assertion,
    });

    const authorized = await this.repo.markAuthorized(paymentId);

    this.events.emit(PAYMENT_AUTHORIZED_EVENT, {
      paymentId: authorized.id,
      userId: user.id,
    });

    return {
      id: authorized.id,
      status: authorized.status,
      authorizedAt: authorized.authorizedAt?.toISOString() ?? null,
    };
  }

  private assertWithinSubmissionWindow(createdAt: Date): void {
    const timeoutMs = this.config.getOrThrow<number>(
      'payments.submitTimeoutMs',
    );
    if (createdAt.getTime() + timeoutMs <= Date.now()) {
      throw new ConflictException({
        statusCode: 409,
        message: 'Payment authorization window has expired.',
        code: 'PAYMENT_INVALID_STATE',
      });
    }
  }
}

function toPaymentResponse(payment: {
  id: string;
  status: string;
  paymentRequestId: string | null;
  recipient: string;
  senderPublicKey: string;
  asset: string;
  network: string;
  amount: { toString(): string };
  memo: string | null;
  expiresAt: Date | null;
  stellarTxHash: string | null;
  failureCode: string | null;
}): PaymentResponseDto {
  return {
    id: payment.id,
    status: payment.status,
    paymentRequestId: payment.paymentRequestId,
    recipient: payment.recipient,
    senderPublicKey: payment.senderPublicKey,
    asset: payment.asset,
    network: payment.network,
    amount: payment.amount.toString(),
    memo: payment.memo,
    expiresAt: payment.expiresAt?.toISOString() ?? null,
    stellarTxHash: payment.stellarTxHash,
    failureCode: payment.failureCode,
  };
}
