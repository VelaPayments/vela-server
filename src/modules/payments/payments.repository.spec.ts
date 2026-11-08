/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { StellarNetwork } from '@prisma/client';
import type { PrismaService } from '../../database/prisma.service';
import { PaymentsRepository } from './payments.repository';

describe('PaymentsRepository', () => {
  it('confirms a payment and indexes sender/receiver history in one transaction', async () => {
    const tx = {
      payment: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      transaction: {
        upsert: jest
          .fn()
          .mockResolvedValueOnce({ id: 'sent-row' })
          .mockResolvedValueOnce({ id: 'received-row' }),
      },
    };
    const prisma = {
      $transaction: jest.fn((callback: (value: typeof tx) => unknown) =>
        callback(tx),
      ),
    };
    const repository = new PaymentsRepository(
      prisma as unknown as PrismaService,
    );

    await repository.markConfirmedAndRecord({
      paymentId: 'payment-1',
      senderUserId: 'sender-1',
      receiverUserId: 'receiver-1',
      senderPublicKey: 'GSENDER',
      recipient: 'GRECIPIENT',
      asset: 'XLM',
      amount: '1.25',
      memo: 'coffee',
      network: StellarNetwork.TESTNET,
      stellarTxHash: 'a'.repeat(64),
      ledger: 123,
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.payment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'payment-1', status: 'SUBMITTED' },
        data: expect.objectContaining({ status: 'CONFIRMED' }),
      }),
    );
    expect(tx.transaction.upsert).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        create: expect.objectContaining({
          userId: 'sender-1',
          direction: 'SENT',
          paymentId: 'payment-1',
        }),
      }),
    );
    expect(tx.transaction.upsert).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        create: expect.objectContaining({
          userId: 'receiver-1',
          direction: 'RECEIVED',
        }),
      }),
    );
  });

  it('does not index history when the payment is no longer submitted', async () => {
    const tx = {
      payment: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      transaction: { upsert: jest.fn() },
    };
    const prisma = {
      $transaction: jest.fn((callback: (value: typeof tx) => unknown) =>
        callback(tx),
      ),
    };
    const repository = new PaymentsRepository(
      prisma as unknown as PrismaService,
    );

    await expect(
      repository.markConfirmedAndRecord({
        paymentId: 'payment-1',
        senderUserId: 'sender-1',
        receiverUserId: 'receiver-1',
        senderPublicKey: 'GSENDER',
        recipient: 'GRECIPIENT',
        asset: 'XLM',
        amount: '1.25',
        network: StellarNetwork.TESTNET,
        stellarTxHash: 'b'.repeat(64),
        ledger: 123,
      }),
    ).rejects.toMatchObject({ response: { code: 'PAYMENT_INVALID_STATE' } });
    expect(tx.transaction.upsert).not.toHaveBeenCalled();
  });
});
