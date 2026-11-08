import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, Matches } from 'class-validator';

const STELLAR_PUBLIC_KEY_REGEX = /^G[A-Z2-7]{55}$/;

export class CreatePaymentDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  paymentRequestId?: string;

  @ApiPropertyOptional({
    description: 'External requestId carried in payment-request.v1.',
  })
  @IsOptional()
  @IsString()
  requestId?: string;

  @ApiProperty({ description: 'Sender Stellar public key.' })
  @IsString()
  @Matches(STELLAR_PUBLIC_KEY_REGEX)
  senderPublicKey!: string;
}
