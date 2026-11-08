import { BadRequestException, Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { UsersService } from '../users/users.service';
import {
  SimulateTransactionDto,
  SimulateTransactionResponseDto,
  TransactionListResponseDto,
  TransactionQueryDto,
} from './dto';
import { TransactionsRepository } from './transactions.repository';
import { StellarService } from '../../stellar/stellar.service';

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function explorerUrl(network: string, hash: string): string {
  const networkPath = network === 'MAINNET' ? 'public' : 'testnet';
  return `https://stellar.expert/explorer/${networkPath}/tx/${hash}`;
}

@Injectable()
export class TransactionsService {
  constructor(
    private readonly repo: TransactionsRepository,
    private readonly usersService: UsersService,
    private readonly stellarService: StellarService,
  ) {}

  async simulate(
    _authUser: AuthenticatedUser,
    dto: SimulateTransactionDto,
  ): Promise<SimulateTransactionResponseDto> {
    const simulation = await this.stellarService.simulateTransaction(
      dto.transactionXdr,
    );

    return {
      simulation: simulation as unknown as Record<string, unknown>,
    };
  }

  async list(
    authUser: AuthenticatedUser,
    query: TransactionQueryDto = new TransactionQueryDto(),
  ): Promise<TransactionListResponseDto> {
    const user = await this.usersService.requireUser(authUser.supabaseUserId);
    const page = query.page || DEFAULT_PAGE;
    const limit = Math.min(
      Math.max(query.limit || DEFAULT_LIMIT, 1),
      MAX_LIMIT,
    );
    const from = query.from ? new Date(query.from) : undefined;
    const to = query.to ? new Date(query.to) : undefined;
    if (from && to && from > to) {
      throw new BadRequestException({
        statusCode: 400,
        message: '`from` must be earlier than or equal to `to`.',
        code: 'TRANSACTION_DATE_RANGE_INVALID',
      });
    }
    const [total, transactions] = await this.repo.listForUser(
      user.id,
      page,
      limit,
      {
        asset: query.asset,
        direction: query.direction,
        from,
        to,
      },
    );

    return {
      data: transactions.map((transaction) => ({
        id: transaction.id,
        direction: transaction.direction,
        stellarTxHash: transaction.stellarTxHash,
        counterparty: transaction.counterparty,
        asset: transaction.asset,
        amount: transaction.amount.toString(),
        memo: transaction.memo,
        network: transaction.network,
        ledger: transaction.ledger,
        createdAt: transaction.createdAt.toISOString(),
        explorerUrl: explorerUrl(
          transaction.network,
          transaction.stellarTxHash,
        ),
      })),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }
}
