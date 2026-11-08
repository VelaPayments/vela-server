import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class PaymentResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({
    enum: ['CREATED', 'AUTHORIZED', 'SUBMITTED', 'CONFIRMED', 'FAILED'],
  })
  status!: string;

  @ApiProperty({ format: 'uuid', nullable: true })
  paymentRequestId!: string | null;

  @ApiProperty()
  recipient!: string;

  @ApiProperty()
  senderPublicKey!: string;

  @ApiProperty({ enum: ['XLM', 'USDC'] })
  asset!: string;

  @ApiProperty({ enum: ['TESTNET', 'MAINNET'] })
  network!: string;

  @ApiProperty()
  amount!: string;

  @ApiPropertyOptional({ nullable: true })
  memo!: string | null;

  @ApiProperty({ format: 'date-time', nullable: true })
  expiresAt!: string | null;

  @ApiPropertyOptional({ nullable: true })
  stellarTxHash!: string | null;

  @ApiPropertyOptional({ nullable: true })
  failureCode!: string | null;

  @ApiPropertyOptional({
    description:
      'Unsigned transaction XDR, returned when a payment is created.',
  })
  unsignedXdr?: string;
}
