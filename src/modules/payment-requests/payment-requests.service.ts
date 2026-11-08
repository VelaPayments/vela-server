import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  PaymentRequestV1,
  PaymentRequestValidationError,
  validatePaymentRequestV1,
} from '../../contracts/payment-request.v1';
import { CreatePaymentRequestDto } from './dto/create-payment-request.dto';
import { PaymentRequestResponseDto } from './dto/payment-request-response.dto';
import { PaymentRequestsRepository } from './payment-requests.repository';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { UsersService } from '../users/users.service';
import { StellarService } from '../../stellar/stellar.service';

type PrismaPaymentRequest = Awaited<
  ReturnType<PaymentRequestsRepository['findById']>
>;
type PaymentRequestForResponse = Omit<PrismaPaymentRequest, 'payment'> & {
  payment?: PrismaPaymentRequest['payment'];
};

export interface PaymentRequestValidationResponse {
  valid: boolean;
  normalized?: PaymentRequestV1;
  errors: PaymentRequestValidationError[];
}

function toResponseDto(
  pr: PaymentRequestForResponse,
): PaymentRequestResponseDto {
  return {
    id: pr.id,
    status: pr.status,
    externalRequestId: pr.externalRequestId,
    paymentId: pr.payment?.id ?? null,
    paymentStatus: pr.payment?.status ?? null,
    stellarTxHash: pr.payment?.stellarTxHash ?? null,
    recipient: pr.recipient,
    asset: pr.asset,
    network: pr.network,
    amount: pr.amount.toString(),
    expiresAt: pr.expiresAt.toISOString(),
    createdAt: pr.createdAt.toISOString(),
  };
}

@Injectable()
export class PaymentRequestsService {
  constructor(
    private readonly repo: PaymentRequestsRepository,
    private readonly usersService: UsersService,
    private readonly stellarService: StellarService,
  ) {}

  /** SRV-036/037: Stateless validation — no DB touch. */
  validate(payload: unknown): PaymentRequestValidationResponse {
    const result = validatePaymentRequestV1(payload, new Date());

    if (result.valid) {
      return { valid: true, normalized: result.value, errors: [] };
    }

    return { valid: false, errors: result.errors };
  }

  /**
   * SRV-038/039: Persist a receiver payment request.
   * Validates the v1 contract first, then delegates to the repo which
   * atomically guards the requestId anti-replay via UsedRequestId.
   */
  async create(
    dto: CreatePaymentRequestDto,
    user: AuthenticatedUser,
  ): Promise<PaymentRequestResponseDto> {
    const rawPayload: Record<string, unknown> = {
      type: dto.type,
      version: dto.version,
      recipient: dto.recipient,
      asset: dto.asset,
      amount: dto.amount,
      timestamp: dto.timestamp,
      expiresAt: dto.expiresAt,
    };
    if (dto.memo !== undefined) rawPayload.memo = dto.memo;
    if (dto.requestId !== undefined) rawPayload.requestId = dto.requestId;
    if (dto.metadata !== undefined) rawPayload.metadata = dto.metadata;

    const validation = validatePaymentRequestV1(rawPayload, new Date());

    if (!validation.valid) {
      const messages = validation.errors
        .map((e) => `${e.field ?? 'payload'}: ${e.message}`)
        .join('; ');
      throw new UnprocessableEntityException({
        statusCode: 422,
        message: messages,
        code: validation.errors[0]?.code,
        errors: validation.errors,
      });
    }

    const internalUser = await this.usersService.requireUser(
      user.supabaseUserId,
    );
    const network = this.stellarService.getNetwork();
    const wallet = internalUser.wallets.find(
      (candidate) =>
        candidate.stellarPublicKey === dto.recipient &&
        candidate.network === network,
    );
    if (!wallet) {
      throw new ForbiddenException({
        statusCode: 403,
        message: `The recipient wallet must be linked to the authenticated user on the ${network.toLowerCase()} network.`,
        code: 'RECIPIENT_WALLET_NOT_LINKED',
      });
    }

    const paymentRequest = await this.repo.create({
      dto,
      receiverUserId: internalUser.id,
      network,
    });

    return toResponseDto(paymentRequest);
  }

  /** SRV-040: Retrieve by internal UUID. */
  async findById(
    id: string,
    user: AuthenticatedUser,
  ): Promise<PaymentRequestResponseDto> {
    const internalUser = await this.usersService.requireUser(
      user.supabaseUserId,
    );
    const pr = await this.repo.findById(id, internalUser.id);
    return toResponseDto(pr);
  }

  async findByExternalRequestId(
    externalRequestId: string,
    user: AuthenticatedUser,
  ): Promise<PaymentRequestResponseDto> {
    const internalUser = await this.usersService.requireUser(
      user.supabaseUserId,
    );
    const pr = await this.repo.findByExternalRequestId(externalRequestId);
    if (!pr || pr.receiverUserId !== internalUser.id) {
      throw new NotFoundException({
        statusCode: 404,
        message: 'Payment request not found.',
        code: 'PAYMENT_REQUEST_NOT_FOUND',
      });
    }
    return toResponseDto(pr);
  }
}
