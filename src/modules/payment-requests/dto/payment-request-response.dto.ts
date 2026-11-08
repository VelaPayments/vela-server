import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class PaymentRequestResponseDto {
  @ApiProperty({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  id: string;

  @ApiProperty({
    example: 'CREATED',
    enum: ['CREATED', 'SHARED', 'EXPIRED', 'CONSUMED'],
  })
  status: string;

  @ApiPropertyOptional({ example: 'req_receiver_001' })
  externalRequestId?: string | null;

  @ApiPropertyOptional({ example: 'payment-uuid', nullable: true })
  paymentId?: string | null;

  @ApiPropertyOptional({ example: 'CONFIRMED', nullable: true })
  paymentStatus?: string | null;

  @ApiPropertyOptional({ example: 'stellar-transaction-hash', nullable: true })
  stellarTxHash?: string | null;

  @ApiProperty({
    example: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
  })
  recipient: string;

  @ApiProperty({ example: 'USDC' })
  asset: string;

  @ApiProperty({ enum: ['TESTNET', 'MAINNET'] })
  network: string;

  @ApiProperty({ example: '10.00' })
  amount: string;

  @ApiProperty({ example: '2026-06-17T12:00:30.000Z' })
  expiresAt: string;

  @ApiPropertyOptional({ example: '2026-06-17T12:00:00.000Z' })
  createdAt?: string;
}
