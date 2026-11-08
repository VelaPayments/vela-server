import {
  Injectable,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { Prisma, StellarNetwork } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import type { CreatePaymentRequestDto } from './dto/create-payment-request.dto';

export interface CreatePaymentRequestInput {
  dto: CreatePaymentRequestDto;
  receiverUserId: string;
  network: StellarNetwork;
}

type PrismaTx = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

@Injectable()
export class PaymentRequestsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Persist a new PaymentRequest and optionally record the requestId
   * in UsedRequestId atomically within a transaction (anti-replay — SRV-039).
   *
   * Throws ConflictException when the requestId has already been used.
   */
  async create(input: CreatePaymentRequestInput) {
    const { dto, receiverUserId, network } = input;

    // SRV-039: check for replay before creating
    if (dto.requestId) {
      const existing = await this.prisma.usedRequestId.findUnique({
        where: { requestId: dto.requestId },
      });
      if (existing) {
        throw new ConflictException({
          statusCode: 409,
          message: 'Duplicate requestId — payment request already exists.',
          code: 'PAYMENT_REQUEST_ID_REPLAY',
        });
      }
    }

    try {
      return await this.prisma.$transaction(async (tx: PrismaTx) => {
        const paymentRequest = await tx.paymentRequest.create({
          data: {
            externalRequestId: dto.requestId ?? null,
            receiverUserId,
            recipient: dto.recipient,
            asset: dto.asset,
            amount: dto.amount,
            memo: dto.memo ?? null,
            network,
            payloadTimestamp: new Date(dto.timestamp),
            expiresAt: new Date(dto.expiresAt),

            metadata: dto.metadata
              ? (dto.metadata as Prisma.InputJsonValue)
              : undefined,
          },
        });

        if (dto.requestId) {
          await tx.usedRequestId.create({
            data: {
              requestId: dto.requestId,
              paymentRequestId: paymentRequest.id,
            },
          });
        }

        return paymentRequest;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException({
          statusCode: 409,
          message: 'Duplicate requestId — payment request already exists.',
          code: 'PAYMENT_REQUEST_ID_REPLAY',
        });
      }
      throw error;
    }
  }

  /**
   * Find a PaymentRequest by internal UUID.
   * Throws NotFoundException when not found.
   */
  async findById(id: string, receiverUserId?: string) {
    const record = await this.prisma.paymentRequest.findUnique({
      where: { id },
      include: { payment: true },
    });
    if (!record) {
      throw new NotFoundException({
        statusCode: 404,
        message: `Payment request ${id} not found.`,
        code: 'PAYMENT_REQUEST_NOT_FOUND',
      });
    }
    if (receiverUserId && record.receiverUserId !== receiverUserId) {
      throw new NotFoundException({
        statusCode: 404,
        message: `Payment request ${id} not found.`,
        code: 'PAYMENT_REQUEST_NOT_FOUND',
      });
    }
    return record;
  }

  async findByExternalRequestId(externalRequestId: string) {
    return this.prisma.paymentRequest.findUnique({
      where: { externalRequestId },
      include: { payment: true },
    });
  }
}
