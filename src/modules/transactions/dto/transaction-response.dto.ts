import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class TransactionResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: ['SENT', 'RECEIVED'] })
  direction!: string;

  @ApiProperty()
  stellarTxHash!: string;

  @ApiProperty()
  counterparty!: string;

  @ApiProperty({ enum: ['XLM', 'USDC'] })
  asset!: string;

  @ApiProperty()
  amount!: string;

  @ApiPropertyOptional({ nullable: true })
  memo!: string | null;

  @ApiProperty({ enum: ['TESTNET', 'MAINNET'] })
  network!: string;

  @ApiPropertyOptional({ nullable: true })
  ledger!: number | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty()
  explorerUrl!: string;
}
