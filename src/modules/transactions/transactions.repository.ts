import { Injectable } from '@nestjs/common';
import type { AssetCode, TransactionDirection } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class TransactionsRepository {
  constructor(private readonly prisma: PrismaService) {}

  listForUser(
    userId: string,
    page: number,
    limit: number,
    filters: {
      asset?: AssetCode;
      direction?: TransactionDirection;
      from?: Date;
      to?: Date;
    } = {},
  ) {
    const createdAt =
      filters.from || filters.to
        ? {
            ...(filters.from ? { gte: filters.from } : {}),
            ...(filters.to ? { lte: filters.to } : {}),
          }
        : undefined;
    return this.prisma.$transaction([
      this.prisma.transaction.count({
        where: {
          userId,
          asset: filters.asset,
          direction: filters.direction,
          createdAt,
        },
      }),
      this.prisma.transaction.findMany({
        where: {
          userId,
          asset: filters.asset,
          direction: filters.direction,
          createdAt,
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);
  }
}
