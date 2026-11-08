import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

const STELLAR_PUBLIC_KEY_REGEX = /^G[A-Z2-7]{55}$/;

export class LinkWalletDto {
  @ApiProperty({
    description: 'Stellar public key owned by the client device.',
  })
  @IsString()
  @Matches(STELLAR_PUBLIC_KEY_REGEX)
  stellarPublicKey!: string;

  @ApiProperty({ enum: ['TESTNET', 'MAINNET'] })
  @IsIn(['TESTNET', 'MAINNET'])
  network!: 'TESTNET' | 'MAINNET';

  @ApiPropertyOptional({ maxLength: 80 })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  label?: string;
}
