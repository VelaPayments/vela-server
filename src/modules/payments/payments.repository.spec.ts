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

  describe('operator recovery queries', () => {
    function createRepository() {
      const prisma = {
        payment: {
          findMany: jest.fn().mockResolvedValue([]),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
      };
      const repository = new PaymentsRepository(
        prisma as unknown as PrismaService,
      );
      return { prisma, repository };
    }

    it('lists only non-terminal payments older than the cutoff, oldest first', async () => {
      const { prisma, repository } = createRepository();
      const cutoff = new Date('2026-11-21T11:30:00.000Z');

      await repository.findRecoveryCandidates(cutoff, 25);

      expect(prisma.payment.findMany).toHaveBeenCalledWith({
        where: {
          status: { in: ['CREATED', 'AUTHORIZED', 'SUBMITTED'] },
          createdAt: { lt: cutoff },
        },
        orderBy: { createdAt: 'asc' },
        take: 25,
      });
    });

    it('expires an intent only while it is still CREATED', async () => {
      const { prisma, repository } = createRepository();

      await repository.markIntentExpired('payment-1');

      expect(prisma.payment.updateMany).toHaveBeenCalledWith({
        where: { id: 'payment-1', status: 'CREATED' },
        data: expect.objectContaining({
          status: 'FAILED',
          failureCode: 'PAYMENT_INTENT_EXPIRED',
        }),
      });
    });
  });
});
