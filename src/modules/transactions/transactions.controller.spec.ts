import { TransactionsController } from './transactions.controller';
import type { TransactionsService } from './transactions.service';
import type { TransactionQueryDto } from './dto';

describe('TransactionsController', () => {
  it('passes the validated query to the history service', async () => {
    const service = {
      list: jest.fn().mockResolvedValue({
        data: [],
        meta: { page: 2, limit: 20, total: 0, totalPages: 0 },
      }),
    };
    const controller = new TransactionsController(
      service as unknown as TransactionsService,
    );
    const user = { supabaseUserId: 'sb-1' };

    const query = { page: 2, limit: 20 } as TransactionQueryDto;
    await expect(controller.list(user, query)).resolves.toEqual({
      data: [],
      meta: { page: 2, limit: 20, total: 0, totalPages: 0 },
    });
    expect(service.list).toHaveBeenCalledWith(user, query);
  });

  it('passes simulation XDR to the transaction service', async () => {
    const service = {
      simulate: jest.fn().mockResolvedValue({
        simulation: { latestLedger: 123 },
      }),
    };
    const controller = new TransactionsController(
      service as unknown as TransactionsService,
    );
    const user = { supabaseUserId: 'sb-1' };
    const dto = { transactionXdr: 'AAAA' };

    await expect(controller.simulate(user, dto)).resolves.toEqual({
      simulation: { latestLedger: 123 },
    });
    expect(service.simulate).toHaveBeenCalledWith(user, dto);
  });
});
