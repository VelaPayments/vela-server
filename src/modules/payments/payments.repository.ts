import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PaymentStatus, Prisma, StellarNetwork } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class PaymentsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string) {
    const payment = await this.prisma.payment.findUnique({ where: { id } });
    if (!payment) {
      throw new NotFoundException({
        statusCode: 404,
        message: `Payment ${id} not found.`,
        code: 'PAYMENT_NOT_FOUND',
      });
    }
    return payment;
  }

  findPaymentRequest(id: string) {
    return this.prisma.paymentRequest.findUnique({
      where: { id },
      include: { payment: true },
    });
  }

  findPaymentRequestByExternalId(externalRequestId: string) {
    return this.prisma.paymentRequest.findUnique({
      where: { externalRequestId },
      include: { payment: true },
    });
  }

  findWalletForUser(
    userId: string,
    publicKey: string,
    network?: StellarNetwork,
  ) {
    return this.prisma.wallet.findFirst({
      where: {
        userId,
        stellarPublicKey: publicKey,
        ...(network ? { network } : {}),
      },
    });
  }

  create(input: {
    paymentRequestId: string;
    senderUserId: string;
    receiverUserId: string;
    recipient: string;
    senderPublicKey: string;
    asset: 'XLM' | 'USDC';
    amount: string;
    memo?: string | null;
    network: StellarNetwork;
    expiresAt: Date;
  }) {
    return this.prisma.$transaction(async (tx) => {
      try {
        const payment = await tx.payment.create({ data: input });
        await tx.paymentRequest.update({
          where: { id: input.paymentRequestId },
          data: { status: 'CONSUMED' },
        });
        return payment;
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          throw new ConflictException({
            statusCode: 409,
            message: 'Payment request has already been used.',
            code: 'PAYMENT_REQUEST_CONSUMED',
          });
        }
        throw error;
      }
    });
  }

  markSubmitted(id: string, hash: string) {
    return this.prisma.payment.updateMany({
      where: { id, status: 'AUTHORIZED' },
      data: {
        status: 'SUBMITTED',
        stellarTxHash: hash,
        submittedAt: new Date(),
      },
    });
  }

  async markConfirmedAndRecord(input: {
    paymentId: string;
    senderUserId: string;
    receiverUserId: string;
    senderPublicKey: string;
    recipient: string;
    asset: 'XLM' | 'USDC';
    amount: string;
    memo?: string | null;
    network: StellarNetwork;
    stellarTxHash: string;
    ledger: number;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const marked = await tx.payment.updateMany({
        where: { id: input.paymentId, status: 'SUBMITTED' },
        data: {
          status: 'CONFIRMED',
          stellarTxHash: input.stellarTxHash,
          confirmedAt: new Date(),
        },
      });
      if (marked.count !== 1) {
        throw new ConflictException({
          statusCode: 409,
          message: 'Payment is no longer in a SUBMITTED state.',
          code: 'PAYMENT_INVALID_STATE',
        });
      }

      const common = {
        stellarTxHash: input.stellarTxHash,
        asset: input.asset,
        amount: input.amount,
        memo: input.memo ?? null,
        network: input.network,
        ledger: input.ledger,
      };

      const sent = await tx.transaction.upsert({
        where: {
          userId_stellarTxHash: {
            userId: input.senderUserId,
            stellarTxHash: input.stellarTxHash,
          },
        },
        update: { paymentId: input.paymentId, ...common },
        create: {
          userId: input.senderUserId,
          paymentId: input.paymentId,
          direction: 'SENT',
          counterparty: input.recipient,
          ...common,
        },
      });

      const received = await tx.transaction.upsert({
        where: {
          userId_stellarTxHash: {
            userId: input.receiverUserId,
            stellarTxHash: input.stellarTxHash,
          },
        },
        update: common,
        create: {
          userId: input.receiverUserId,
          direction: 'RECEIVED',
          counterparty: input.senderPublicKey,
          ...common,
        },
      });

      return { sent, received };
    });
  }

  markFailed(id: string, code: string, reason: string) {
    return this.prisma.payment.updateMany({
      where: { id, status: { in: ['AUTHORIZED', 'SUBMITTED'] } },
      data: { status: 'FAILED', failureCode: code, failureReason: reason },
    });
  }

  async markAuthorized(id: string) {
    const now = new Date();
    const result = await this.prisma.payment.updateMany({
      where: { id, status: PaymentStatus.CREATED },
      data: { status: PaymentStatus.AUTHORIZED, authorizedAt: now },
    });

    if (result.count !== 1) {
      throw new ConflictException({
        statusCode: 409,
        message: 'Payment is no longer in a CREATED state.',
        code: 'PAYMENT_INVALID_STATE',
      });
    }

    return this.prisma.payment.findUniqueOrThrow({ where: { id } });
  }
}
