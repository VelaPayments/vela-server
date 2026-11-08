import { ApiProperty } from '@nestjs/swagger';

export class SimulateTransactionResponseDto {
  @ApiProperty({
    description: 'Raw Stellar RPC simulation response.',
    type: Object,
  })
  simulation!: Record<string, unknown>;
}
