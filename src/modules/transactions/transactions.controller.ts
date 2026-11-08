import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import {
  SimulateTransactionDto,
  SimulateTransactionResponseDto,
  TransactionListResponseDto,
  TransactionQueryDto,
} from './dto';
import { TransactionsService } from './transactions.service';

@ApiTags('transactions')
@ApiBearerAuth()
@Controller('transactions')
export class TransactionsController {
  constructor(private readonly transactionsService: TransactionsService) {}

  @Post('simulate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Simulate a Stellar transaction through the configured RPC provider.',
    description:
      'Diagnostic endpoint for pre-sign checks. The configured Stellar RPC provider may reject classic payment envelopes ' +
      'that are not Soroban transactions.',
  })
  @ApiOkResponse({ type: SimulateTransactionResponseDto })
  simulate(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SimulateTransactionDto,
  ): Promise<SimulateTransactionResponseDto> {
    return this.transactionsService.simulate(user, dto);
  }

  @Get()
  @ApiOperation({
    summary: 'List confirmed Vela payment history for the authenticated user.',
  })
  @ApiOkResponse({ type: TransactionListResponseDto })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: TransactionQueryDto,
  ): Promise<TransactionListResponseDto> {
    return this.transactionsService.list(user, query);
  }
}
