import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class SimulateTransactionDto {
  @ApiProperty({ description: 'Base64 Stellar transaction envelope XDR.' })
  @IsString()
  @MinLength(1)
  transactionXdr!: string;
}
