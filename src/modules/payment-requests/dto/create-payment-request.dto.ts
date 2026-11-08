import {
  IsString,
  IsNumber,
  IsIn,
  IsDateString,
  IsOptional,
  IsObject,
  MinLength,
  MaxLength,
  Matches,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PAYMENT_REQUEST_V1_SUPPORTED_ASSETS } from '../../../contracts/payment-request.v1';
import type { PaymentRequestV1Asset } from '../../../contracts/payment-request.v1';

const STELLAR_ADDRESS_REGEX = /^G[A-Z2-7]{55}$/;
const AMOUNT_REGEX = /^(?!0+(?:\.0{1,7})?$)(?:0|[1-9]\d*)(?:\.\d{1,7})?$/;

export class CreatePaymentRequestDto {
  @ApiProperty({
    description: 'Must be "payment-request".',
    example: 'payment-request',
  })
  @IsString()
  type: string;

  @ApiProperty({ description: 'Must be 1.', example: 1 })
  @IsNumber()
  @Min(1)
  version: number;

  @ApiProperty({
    description: 'Receiver Stellar public key (G…).',
    example: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
  })
  @IsString()
  @Matches(STELLAR_ADDRESS_REGEX, {
    message: 'recipient must be a valid Stellar public key starting with G',
  })
  recipient: string;

  @ApiProperty({
    description: 'Asset code.',
    enum: PAYMENT_REQUEST_V1_SUPPORTED_ASSETS,
    example: 'USDC',
  })
  @IsIn(PAYMENT_REQUEST_V1_SUPPORTED_ASSETS)
  asset: PaymentRequestV1Asset;

  @ApiProperty({
    description: 'Positive decimal string, ≤7 decimal places.',
    example: '10.00',
  })
  @IsString()
  @Matches(AMOUNT_REGEX, {
    message:
      'amount must be a positive decimal string with at most 7 decimal places',
  })
  amount: string;

  @ApiProperty({
    description: 'ISO-8601 UTC timestamp of the request.',
    example: '2026-06-17T12:00:00.000Z',
  })
  @IsDateString()
  timestamp: string;

  @ApiProperty({
    description: 'ISO-8601 UTC expiry timestamp.',
    example: '2026-06-17T12:00:30.000Z',
  })
  @IsDateString()
  expiresAt: string;

  @ApiPropertyOptional({
    description: 'Optional Stellar MEMO_TEXT (≤280 chars and ≤28 UTF-8 bytes).',
    example: 'Invoice #42',
  })
  @IsOptional()
  @IsString()
  @MaxLength(280)
  memo?: string;

  @ApiPropertyOptional({
    description: 'Optional idempotency key (1–128 chars).',
    example: 'req_receiver_001',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  requestId?: string;

  @ApiPropertyOptional({
    description: 'Optional arbitrary metadata object.',
    type: 'object',
    additionalProperties: true,
  })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
