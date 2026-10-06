import {
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import {
  Account,
  Networks,
  Transaction,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
import {
  STELLAR_ERROR,
  STELLAR_HORIZON_SERVER,
  STELLAR_NETWORK_CONFIG,
  STELLAR_RPC_SERVER,
  type StellarNetworkConfig,
} from './stellar.constants';
import { StellarService } from './stellar.service';

const SOURCE_PUBLIC_KEY =
  'GDRBQURX6WK6GAD7JYZBRWMRN227K3LPPNCBOJR4LHGB6TLPD5AODF4P';
const DESTINATION_PUBLIC_KEY =
  'GC43WDPPGCGGMMGJWZ2TSRQ2SEG7A4WCBE2MDQFQYFOIV6SBH7372UUA';
const USDC_ISSUER = 'GB7CIUNLWUF367P2UHQDNLJTVXUWT7TCHQD5BIXPLEMVKHZIQICPDAXN';
const TX_HASH = 'a'.repeat(64);

const NETWORK_CONFIG: StellarNetworkConfig = {
  network: 'testnet',
  horizonUrl: 'https://horizon-testnet.stellar.org',
  rpcUrl: 'https://soroban-testnet.stellar.org',
  usdcIssuer: USDC_ISSUER,
  networkPassphrase: Networks.TESTNET,
};

interface HorizonMock {
  loadAccount: jest.Mock;
  root: jest.Mock;
  submitTransaction: jest.Mock;
  transactions: jest.Mock;
}

interface RpcMock {
  getHealth: jest.Mock;
  simulateTransaction: jest.Mock;
}

describe('StellarService', () => {
  let service: StellarService;
  let horizon: HorizonMock;
  let rpcServer: RpcMock;
  let transactionCall: jest.Mock;

  beforeEach(async () => {
    transactionCall = jest.fn();
    horizon = {
      loadAccount: jest.fn(),
      root: jest.fn(),
      submitTransaction: jest.fn(),
      transactions: jest.fn().mockReturnValue({
        transaction: jest.fn().mockReturnValue({ call: transactionCall }),
      }),
    };
    rpcServer = {
      getHealth: jest.fn(),
      simulateTransaction: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StellarService,
        {
          provide: STELLAR_HORIZON_SERVER,
          useValue: horizon,
        },
        {
          provide: STELLAR_RPC_SERVER,
          useValue: rpcServer,
        },
        {
          provide: STELLAR_NETWORK_CONFIG,
          useValue: NETWORK_CONFIG,
        },
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: jest.fn((key: string) => {
              const values: Record<string, number> = {
                'payments.pollIntervalMs': 2_000,
                'payments.pollMaxAttempts': 30,
              };
              return values[key];
            }),
          },
        },
      ],
    }).compile();

    service = module.get(StellarService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getAccount', () => {
    it('loads a valid account from Horizon', async () => {
      const account = new Account(SOURCE_PUBLIC_KEY, '7');
      horizon.loadAccount.mockResolvedValue(account);

      await expect(service.getAccount(SOURCE_PUBLIC_KEY)).resolves.toBe(
        account,
      );
      expect(horizon.loadAccount).toHaveBeenCalledWith(SOURCE_PUBLIC_KEY);
    });

    it('maps a Horizon 404 to STELLAR_ACCOUNT_NOT_FOUND', async () => {
      horizon.loadAccount.mockRejectedValue({ response: { status: 404 } });

      await expect(service.getAccount(SOURCE_PUBLIC_KEY)).rejects.toMatchObject(
        {
          response: { code: STELLAR_ERROR.ACCOUNT_NOT_FOUND },
        },
      );
      await expect(
        service.getAccount(SOURCE_PUBLIC_KEY),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects malformed public keys before calling Horizon', async () => {
      await expect(service.getAccount('not-a-key')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(horizon.loadAccount).not.toHaveBeenCalled();
    });

    it('maps Horizon outages to STELLAR_NETWORK_ERROR', async () => {
      horizon.loadAccount.mockRejectedValue(new Error('offline'));

      await expect(service.getAccount(SOURCE_PUBLIC_KEY)).rejects.toMatchObject(
        {
          response: { code: STELLAR_ERROR.NETWORK },
        },
      );
    });
  });

  describe('getHealth', () => {
    it('reports both Horizon and RPC as healthy', async () => {
      horizon.root.mockResolvedValue({ history_latest_ledger: 123 });
      rpcServer.getHealth.mockResolvedValue({
        status: 'healthy',
        latestLedger: 124,
      });

      await expect(service.getHealth()).resolves.toEqual({
        status: 'ok',
        network: 'testnet',
        horizon: { healthy: true, latestLedger: 123 },
        rpc: { healthy: true, latestLedger: 124 },
      });
    });

    it('reports degraded status without leaking provider errors', async () => {
      horizon.root.mockRejectedValue(new Error('secret upstream detail'));
      rpcServer.getHealth.mockResolvedValue({
        status: 'healthy',
        latestLedger: 124,
      });

      await expect(service.getHealth()).resolves.toEqual({
        status: 'degraded',
        network: 'testnet',
        horizon: { healthy: false },
        rpc: { healthy: true, latestLedger: 124 },
      });
    });
  });

  describe('resolveAsset', () => {
    it('resolves native XLM', () => {
      expect(service.resolveAsset('XLM').isNative()).toBe(true);
    });

    it('resolves USDC with the configured issuer', () => {
      const asset = service.resolveAsset('USDC');

      expect(asset.code).toBe('USDC');
      expect(asset.issuer).toBe(USDC_ISSUER);
    });

    it('rejects unsupported assets', () => {
      expect(() => service.resolveAsset('BTC')).toThrow(BadRequestException);
    });
  });

  describe('buildPaymentTransaction', () => {
    beforeEach(() => {
      horizon.loadAccount.mockResolvedValue(
        new Account(SOURCE_PUBLIC_KEY, '7'),
      );
    });

    it('builds an unsigned payment transaction with a bounded timeout', async () => {
      const transaction = await service.buildPaymentTransaction({
        sourcePublicKey: SOURCE_PUBLIC_KEY,
        destination: DESTINATION_PUBLIC_KEY,
        asset: 'USDC',
        amount: '25.5000000',
        memo: 'Invoice 42',
        timeoutSeconds: 60,
      });

      expect(transaction).toBeInstanceOf(Transaction);
      expect(transaction.signatures).toHaveLength(0);
      expect(transaction.operations).toHaveLength(1);
      expect(transaction.operations[0]).toMatchObject({
        type: 'payment',
        destination: DESTINATION_PUBLIC_KEY,
        amount: '25.5000000',
      });
      expect(transaction.memo.value?.toString()).toBe('Invoice 42');
      expect(transaction.timeBounds?.maxTime).not.toBe('0');
    });

    it.each(['0', '-1', '1.00000001', 'not-a-number'])(
      'rejects invalid amount %s',
      async (amount) => {
        await expect(
          service.buildPaymentTransaction({
            sourcePublicKey: SOURCE_PUBLIC_KEY,
            destination: DESTINATION_PUBLIC_KEY,
            asset: 'XLM',
            amount,
          }),
        ).rejects.toMatchObject({
          response: { code: 'PAYMENT_REQUEST_AMOUNT_INVALID' },
        });
      },
    );

    it('rejects memos over the Stellar text memo limit', async () => {
      await expect(
        service.buildPaymentTransaction({
          sourcePublicKey: SOURCE_PUBLIC_KEY,
          destination: DESTINATION_PUBLIC_KEY,
          asset: 'XLM',
          amount: '1',
          memo: 'x'.repeat(29),
        }),
      ).rejects.toMatchObject({
        response: { code: 'PAYMENT_XDR_INVALID' },
      });
    });

    it('accepts a multibyte text memo at the 28-byte limit', async () => {
      const memo = 'é'.repeat(14);

      const transaction = await service.buildPaymentTransaction({
        sourcePublicKey: SOURCE_PUBLIC_KEY,
        destination: DESTINATION_PUBLIC_KEY,
        asset: 'XLM',
        amount: '1',
        memo,
      });

      expect(Buffer.byteLength(memo, 'utf8')).toBe(28);
      expect(transaction.memo.value?.toString()).toBe(memo);
    });

    it('rejects a multibyte memo over the byte limit before loading an account', async () => {
      const memo = 'é'.repeat(15);

      await expect(
        service.buildPaymentTransaction({
          sourcePublicKey: SOURCE_PUBLIC_KEY,
          destination: DESTINATION_PUBLIC_KEY,
          asset: 'XLM',
          amount: '1',
          memo,
        }),
      ).rejects.toMatchObject({
        response: { code: 'PAYMENT_XDR_INVALID' },
      });
      expect(horizon.loadAccount).not.toHaveBeenCalled();
    });
  });

  describe('simulateTransaction', () => {
    it('returns a successful RPC simulation', async () => {
      const transaction = buildTransaction();
      const simulation = {
        id: '1',
        latestLedger: 123,
        events: [],
        _parsed: true,
        transactionData: {},
        minResourceFee: '0',
      };
      rpcServer.simulateTransaction.mockResolvedValue(simulation);

      await expect(
        service.simulateTransaction(transaction.toXDR()),
      ).resolves.toBe(simulation);
    });

    it('maps an RPC simulation error to STELLAR_TX_FAILED', async () => {
      rpcServer.simulateTransaction.mockResolvedValue({
        id: '1',
        latestLedger: 123,
        events: [],
        _parsed: true,
        error: 'transaction failed',
      });

      await expect(
        service.simulateTransaction(buildTransaction()),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it('maps RPC outages to STELLAR_NETWORK_ERROR', async () => {
      rpcServer.simulateTransaction.mockRejectedValue(new Error('offline'));

      await expect(
        service.simulateTransaction(buildTransaction()),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    });
  });

  describe('submitTransaction', () => {
    it('broadcasts transaction XDR through Horizon', async () => {
      horizon.submitTransaction.mockResolvedValue({
        hash: TX_HASH,
        ledger: 555,
      });

      await expect(
        service.submitTransaction(buildTransaction().toXDR()),
      ).resolves.toEqual({ hash: TX_HASH, ledger: 555 });
      expect(horizon.submitTransaction).toHaveBeenCalledWith(
        expect.objectContaining({ signatures: [] }),
      );
    });

    it('rejects malformed XDR before calling Horizon', async () => {
      await expect(service.submitTransaction('not-xdr')).rejects.toMatchObject({
        response: { code: 'PAYMENT_XDR_INVALID' },
      });
      expect(horizon.submitTransaction).not.toHaveBeenCalled();
    });

    it('maps op_underfunded to the canonical Stellar code', async () => {
      horizon.submitTransaction.mockRejectedValue({
        response: {
          status: 400,
          data: {
            extras: {
              result_codes: {
                transaction: 'tx_failed',
                operations: ['op_underfunded'],
              },
            },
          },
        },
      });

      await expect(
        service.submitTransaction(buildTransaction().toXDR()),
      ).rejects.toMatchObject({
        response: { code: STELLAR_ERROR.OP_UNDERFUNDED },
      });
    });
  });

  describe('pollTransactionStatus', () => {
    it('returns confirmation details when Horizon finds a successful tx', async () => {
      transactionCall.mockResolvedValue({
        successful: true,
        hash: TX_HASH,
        ledger_attr: 777,
      });

      await expect(
        service.pollTransactionStatus(TX_HASH, {
          intervalMs: 0,
          maxAttempts: 1,
        }),
      ).resolves.toEqual({ confirmed: true, hash: TX_HASH, ledger: 777 });
    });

    it('returns STELLAR_TX_FAILED for an ingested failed tx', async () => {
      transactionCall.mockResolvedValue({
        successful: false,
        hash: TX_HASH,
        ledger_attr: 777,
      });

      await expect(
        service.pollTransactionStatus(TX_HASH, {
          intervalMs: 0,
          maxAttempts: 1,
        }),
      ).resolves.toEqual({
        confirmed: false,
        hash: TX_HASH,
        failureCode: STELLAR_ERROR.TX_FAILED,
      });
    });

    it('returns STELLAR_TIMEOUT after bounded not-found polling', async () => {
      transactionCall.mockRejectedValue({ response: { status: 404 } });

      await expect(
        service.pollTransactionStatus(TX_HASH, {
          intervalMs: 0,
          maxAttempts: 2,
        }),
      ).resolves.toEqual({
        confirmed: false,
        hash: TX_HASH,
        failureCode: STELLAR_ERROR.TIMEOUT,
      });
      expect(transactionCall).toHaveBeenCalledTimes(2);
    });

    it('stops after the configured attempts when polling with delays', async () => {
      jest.useFakeTimers();
      transactionCall.mockRejectedValue({ response: { status: 404 } });
      const polling = service.pollTransactionStatus(TX_HASH, {
        intervalMs: 100,
        maxAttempts: 3,
      });

      await jest.advanceTimersByTimeAsync(200);
      await expect(polling).resolves.toMatchObject({
        confirmed: false,
        failureCode: STELLAR_ERROR.TIMEOUT,
      });
      expect(transactionCall).toHaveBeenCalledTimes(3);
      jest.useRealTimers();
    });

    it('maps polling provider failures to STELLAR_NETWORK_ERROR', async () => {
      transactionCall.mockRejectedValue(
        Object.assign(new Error('private provider timeout details'), {
          response: { status: 503 },
        }),
      );

      await expect(
        service.pollTransactionStatus(TX_HASH, {
          intervalMs: 0,
          maxAttempts: 1,
        }),
      ).rejects.toMatchObject({
        response: {
          code: STELLAR_ERROR.NETWORK,
          message: 'Unable to poll the Stellar transaction.',
        },
      });
    });
  });
});

function buildTransaction(): Transaction {
  return new TransactionBuilder(new Account(SOURCE_PUBLIC_KEY, '1'), {
    fee: '100',
    networkPassphrase: Networks.TESTNET,
  })
    .setTimeout(30)
    .build();
}
