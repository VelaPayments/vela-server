import type { TransactionsRepository } from './transactions.repository';
import { TransactionsService } from './transactions.service';
import type { UsersService } from '../users/users.service';
import { TransactionQueryDto } from './dto';
import type { StellarService } from '../../stellar/stellar.service';

describe('TransactionsService', () => {
  it('returns paginated history with decimal amounts serialized as strings', async () => {
    const repo = {
      listForUser: jest.fn().mockResolvedValue([
        1,
        [
          {
            id: 'tx-1',
            direction: 'SENT',
            stellarTxHash: 'hash-1',
            counterparty: 'GDESTINATION',
            asset: 'XLM',
            amount: { toString: () => '1.2500000' },
            memo: null,
            network: 'TESTNET',
            ledger: 123,
            createdAt: new Date('2026-11-07T12:00:00.000Z'),
          },
        ],
      ]),
    };
    const users = {
      requireUser: jest.fn().mockResolvedValue({ id: 'user-1' }),
    };
    const stellar = {};
    const service = new TransactionsService(
      repo as unknown as TransactionsRepository,
      users as unknown as UsersService,
      stellar as unknown as StellarService,
    );

    const query = Object.assign(new TransactionQueryDto(), {
      page: 2,
      limit: 500,
      asset: 'XLM',
      direction: 'SENT',
      from: '2026-11-01T00:00:00.000Z',
      to: '2026-11-30T23:59:59.999Z',
    });

    await expect(
      service.list({ supabaseUserId: 'sb-1' }, query),
    ).resolves.toEqual({
      data: [
        {
          id: 'tx-1',
          direction: 'SENT',
          stellarTxHash: 'hash-1',
          counterparty: 'GDESTINATION',
          asset: 'XLM',
          amount: '1.2500000',
          memo: null,
          network: 'TESTNET',
          ledger: 123,
          createdAt: '2026-11-07T12:00:00.000Z',
          explorerUrl: 'https://stellar.expert/explorer/testnet/tx/hash-1',
        },
      ],
      meta: { page: 2, limit: 100, total: 1, totalPages: 1 },
    });
    expect(repo.listForUser).toHaveBeenCalledWith(
      'user-1',
      2,
      100,
      expect.objectContaining({
        asset: 'XLM',
        direction: 'SENT',
        from: new Date('2026-11-01T00:00:00.000Z'),
        to: new Date('2026-11-30T23:59:59.999Z'),
      }),
    );
  });

  it('rejects an inverted date range before querying the repository', async () => {
    const repo = { listForUser: jest.fn() };
    const users = {
      requireUser: jest.fn().mockResolvedValue({ id: 'user-1' }),
    };
    const stellar = {};
    const service = new TransactionsService(
      repo as unknown as TransactionsRepository,
      users as unknown as UsersService,
      stellar as unknown as StellarService,
    );
    const query = Object.assign(new TransactionQueryDto(), {
      from: '2026-11-30T00:00:00.000Z',
      to: '2026-11-01T00:00:00.000Z',
    });

    await expect(
      service.list({ supabaseUserId: 'sb-1' }, query),
    ).rejects.toMatchObject({
      response: { code: 'TRANSACTION_DATE_RANGE_INVALID' },
    });
    expect(repo.listForUser).not.toHaveBeenCalled();
  });

  it('delegates XDR simulation to the configured Stellar RPC service', async () => {
    const stellar = {
      simulateTransaction: jest.fn().mockResolvedValue({
        latestLedger: 123,
        events: [],
        results: [],
      }),
    };
    const service = new TransactionsService(
      {} as TransactionsRepository,
      {} as UsersService,
      stellar as unknown as StellarService,
    );

    const dto = { transactionXdr: 'AAAA' };
    await expect(
      service.simulate({ supabaseUserId: 'sb-1' }, dto),
    ).resolves.toEqual({
      simulation: {
        latestLedger: 123,
        events: [],
        results: [],
      },
    });
    expect(stellar.simulateTransaction).toHaveBeenCalledWith('AAAA');
  });
});
