import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Asset,
  BASE_FEE,
  FeeBumpTransaction,
  Horizon,
  Memo,
  NotFoundError,
  Operation,
  rpc,
  StrKey,
  Transaction,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
import {
  STELLAR_ERROR,
  STELLAR_HORIZON_SERVER,
  STELLAR_NETWORK_CONFIG,
  STELLAR_RPC_SERVER,
  STELLAR_TRANSACTION_TIMEOUT_SECONDS,
  type StellarNetworkConfig,
} from './stellar.constants';

export type StellarAssetCode = 'XLM' | 'USDC';

export interface BuildPaymentTransactionParams {
  sourcePublicKey: string;
  destination: string;
  asset: StellarAssetCode;
  amount: string;
  memo?: string;
  timeoutSeconds?: number;
}

export interface ExpectedPaymentTransaction {
  sourcePublicKey: string;
  destination: string;
  asset: StellarAssetCode;
  amount: string;
  memo?: string | null;
}

export interface StellarHealthResult {
  status: 'ok' | 'degraded';
  network: StellarNetworkConfig['network'];
  horizon: {
    healthy: boolean;
    networkPassphraseMatched?: boolean;
    latestLedger?: number;
  };
  rpc: { healthy: boolean; latestLedger?: number };
}

export interface StellarSubmissionResult {
  hash: string;
  ledger: number;
}

export interface PollTransactionOptions {
  intervalMs?: number;
  maxAttempts?: number;
}

export type PollTransactionResult =
  | {
      confirmed: true;
      hash: string;
      ledger: number;
    }
  | {
      confirmed: false;
      hash: string;
      failureCode:
        typeof STELLAR_ERROR.TX_FAILED | typeof STELLAR_ERROR.TIMEOUT;
    };

const STELLAR_AMOUNT_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d{1,7})?$/;
const TRANSACTION_HASH_PATTERN = /^[a-f\d]{64}$/i;
const MEMO_TEXT_MAX_BYTES = 28;

@Injectable()
export class StellarService {
  constructor(
    @Inject(STELLAR_HORIZON_SERVER)
    private readonly horizon: Horizon.Server,
    @Inject(STELLAR_RPC_SERVER)
    private readonly rpcServer: rpc.Server,
    @Inject(STELLAR_NETWORK_CONFIG)
    private readonly networkConfig: StellarNetworkConfig,
    private readonly config: ConfigService,
  ) {}

  getNetwork(): 'TESTNET' | 'MAINNET' {
    return this.networkConfig.network === 'testnet' ? 'TESTNET' : 'MAINNET';
  }

  async getAccount(publicKey: string): Promise<Horizon.AccountResponse> {
    this.assertPublicKey(publicKey, 'account');

    try {
      return await this.horizon.loadAccount(publicKey);
    } catch (error) {
      if (this.isNotFound(error)) {
        throw new NotFoundException({
          statusCode: 404,
          message: 'Stellar account not found.',
          code: STELLAR_ERROR.ACCOUNT_NOT_FOUND,
        });
      }

      throw this.networkError('Unable to load the Stellar account.');
    }
  }

  async getHealth(): Promise<StellarHealthResult> {
    const [horizonResult, rpcResult] = await Promise.allSettled([
      this.horizon.root(),
      this.rpcServer.getHealth(),
    ]);

    const networkPassphraseMatched =
      horizonResult.status === 'fulfilled' &&
      horizonResult.value.network_passphrase ===
        this.networkConfig.networkPassphrase;
    const horizon =
      horizonResult.status === 'fulfilled'
        ? {
            healthy:
              networkPassphraseMatched &&
              Number.isInteger(horizonResult.value.history_latest_ledger),
            networkPassphraseMatched,
            latestLedger: horizonResult.value.history_latest_ledger,
          }
        : { healthy: false };
    const rpcHealth =
      rpcResult.status === 'fulfilled'
        ? {
            healthy: rpcResult.value.status === 'healthy',
            latestLedger: rpcResult.value.latestLedger,
          }
        : { healthy: false };

    return {
      status: horizon.healthy && rpcHealth.healthy ? 'ok' : 'degraded',
      network: this.networkConfig.network,
      horizon,
      rpc: rpcHealth,
    };
  }

  resolveAsset(assetCode: string): Asset {
    switch (assetCode.toUpperCase()) {
      case 'XLM':
        return Asset.native();
      case 'USDC':
        return new Asset('USDC', this.networkConfig.usdcIssuer);
      default:
        throw new BadRequestException({
          statusCode: 400,
          message: `Unsupported Stellar asset: ${assetCode}.`,
          code: 'PAYMENT_REQUEST_ASSET_UNSUPPORTED',
        });
    }
  }

  async buildPaymentTransaction(
    params: BuildPaymentTransactionParams,
  ): Promise<Transaction> {
    this.assertPublicKey(params.sourcePublicKey, 'sourcePublicKey');
    this.assertPublicKey(params.destination, 'destination');
    this.assertAmount(params.amount);
    this.assertMemo(params.memo);

    const timeoutSeconds =
      params.timeoutSeconds ?? STELLAR_TRANSACTION_TIMEOUT_SECONDS;
    if (!Number.isInteger(timeoutSeconds) || timeoutSeconds <= 0) {
      throw this.invalidTransaction(
        'timeoutSeconds must be a positive integer.',
      );
    }

    const account = await this.getAccount(params.sourcePublicKey);
    const builder = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.networkConfig.networkPassphrase,
    }).addOperation(
      Operation.payment({
        destination: params.destination,
        asset: this.resolveAsset(params.asset),
        amount: params.amount,
      }),
    );

    if (params.memo) {
      builder.addMemo(Memo.text(params.memo));
    }

    return builder.setTimeout(timeoutSeconds).build();
  }

  async simulateTransaction(
    transactionOrXdr: Transaction | FeeBumpTransaction | string,
  ): Promise<rpc.Api.SimulateTransactionSuccessResponse> {
    const transaction = this.toTransaction(transactionOrXdr);

    try {
      const result = await this.rpcServer.simulateTransaction(transaction);
      if (rpc.Api.isSimulationError(result)) {
        throw new UnprocessableEntityException({
          statusCode: 422,
          message: 'Stellar transaction simulation failed.',
          code: STELLAR_ERROR.TX_FAILED,
        });
      }
      return result;
    } catch (error) {
      if (error instanceof UnprocessableEntityException) {
        throw error;
      }
      throw this.networkError('Unable to simulate the Stellar transaction.');
    }
  }

  async submitTransaction(signedXdr: string): Promise<StellarSubmissionResult> {
    const transaction = this.toTransaction(signedXdr);

    try {
      const result = await this.horizon.submitTransaction(transaction);
      return { hash: result.hash, ledger: result.ledger };
    } catch (error) {
      if (this.isServerError(error)) {
        throw this.networkError('Unable to submit the Stellar transaction.');
      }

      const resultCodes = this.getHorizonResultCodes(error);
      const operationCodes = resultCodes?.operations ?? [];
      const code = operationCodes.includes('op_underfunded')
        ? STELLAR_ERROR.OP_UNDERFUNDED
        : resultCodes?.transaction === 'tx_insufficient_balance'
          ? STELLAR_ERROR.INSUFFICIENT_BALANCE
          : STELLAR_ERROR.TX_FAILED;

      throw new UnprocessableEntityException({
        statusCode: 422,
        message: 'Stellar rejected the transaction.',
        code,
      });
    }
  }

  /**
   * Verifies that a locally signed envelope still represents the payment
   * intent created by Vela before it is relayed to Horizon.
   */
  validatePaymentTransaction(
    signedXdr: string,
    expected: ExpectedPaymentTransaction,
  ): void {
    const parsed = this.toTransaction(signedXdr);
    if (!(parsed instanceof Transaction)) {
      throw this.invalidTransaction(
        'Fee-bump transactions are not supported for payment intents.',
      );
    }

    const transaction = parsed as Transaction & {
      source: string;
      operations: Array<{
        type?: string;
        destination?: string;
        amount?: string;
        asset?: Asset;
      }>;
      memo?: { type?: string; value?: { toString(): string } };
    };
    if (transaction.source !== expected.sourcePublicKey) {
      throw this.invalidTransaction(
        'Signed transaction source does not match the payment intent.',
      );
    }
    if (transaction.operations.length !== 1) {
      throw this.invalidTransaction(
        'Payment transactions must contain exactly one operation.',
      );
    }

    const actualMemo =
      transaction.memo?.type === 'text'
        ? (transaction.memo.value?.toString() ?? null)
        : null;
    if ((expected.memo ?? null) !== actualMemo) {
      throw this.invalidTransaction(
        'Signed transaction memo does not match the payment intent.',
      );
    }

    const operation = transaction.operations[0];
    if (
      operation.type !== 'payment' ||
      operation.destination !== expected.destination ||
      operation.amount !== expected.amount ||
      !this.assetMatches(operation.asset, expected.asset)
    ) {
      throw this.invalidTransaction(
        'Signed transaction does not match the payment intent.',
      );
    }
  }

  async pollTransactionStatus(
    hash: string,
    options: PollTransactionOptions = {},
  ): Promise<PollTransactionResult> {
    if (!TRANSACTION_HASH_PATTERN.test(hash)) {
      throw this.invalidTransaction('Invalid Stellar transaction hash.');
    }

    const intervalMs =
      options.intervalMs ??
      this.config.getOrThrow<number>('payments.pollIntervalMs');
    const maxAttempts =
      options.maxAttempts ??
      this.config.getOrThrow<number>('payments.pollMaxAttempts');

    if (!Number.isInteger(intervalMs) || intervalMs < 0) {
      throw this.invalidTransaction(
        'intervalMs must be a non-negative integer.',
      );
    }
    if (!Number.isInteger(maxAttempts) || maxAttempts <= 0) {
      throw this.invalidTransaction('maxAttempts must be a positive integer.');
    }

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        const transaction = await this.horizon
          .transactions()
          .transaction(hash)
          .call();

        if (transaction.successful) {
          return {
            confirmed: true,
            hash: transaction.hash,
            ledger: transaction.ledger_attr,
          };
        }

        return {
          confirmed: false,
          hash,
          failureCode: STELLAR_ERROR.TX_FAILED,
        };
      } catch (error) {
        if (!this.isNotFound(error)) {
          throw this.networkError('Unable to poll the Stellar transaction.');
        }
      }

      if (attempt < maxAttempts - 1 && intervalMs > 0) {
        await this.sleep(intervalMs);
      }
    }

    return {
      confirmed: false,
      hash,
      failureCode: STELLAR_ERROR.TIMEOUT,
    };
  }

  private toTransaction(
    transactionOrXdr: Transaction | FeeBumpTransaction | string,
  ): Transaction | FeeBumpTransaction {
    if (typeof transactionOrXdr !== 'string') {
      return transactionOrXdr;
    }

    try {
      return TransactionBuilder.fromXDR(
        transactionOrXdr,
        this.networkConfig.networkPassphrase,
      );
    } catch {
      throw this.invalidTransaction('Invalid Stellar transaction XDR.');
    }
  }

  private assertPublicKey(publicKey: string, field: string): void {
    if (!StrKey.isValidEd25519PublicKey(publicKey)) {
      throw new BadRequestException({
        statusCode: 400,
        message: `${field} must be a valid Stellar public key.`,
        code: 'PAYMENT_REQUEST_RECIPIENT_INVALID',
      });
    }
  }

  private assertAmount(amount: string): void {
    if (!STELLAR_AMOUNT_PATTERN.test(amount) || !/[1-9]/.test(amount)) {
      throw new BadRequestException({
        statusCode: 400,
        message:
          'amount must be a positive decimal string with at most 7 decimal places.',
        code: 'PAYMENT_REQUEST_AMOUNT_INVALID',
      });
    }
  }

  private assertMemo(memo?: string): void {
    if (memo && Buffer.byteLength(memo, 'utf8') > MEMO_TEXT_MAX_BYTES) {
      throw this.invalidTransaction(
        `memo must not exceed ${MEMO_TEXT_MAX_BYTES} UTF-8 bytes.`,
      );
    }
  }

  private assetMatches(
    asset: Asset | undefined,
    expected: StellarAssetCode,
  ): boolean {
    if (!asset) return false;
    if (expected === 'XLM') return asset.isNative();
    return (
      !asset.isNative() &&
      asset.getCode() === 'USDC' &&
      asset.getIssuer() === this.networkConfig.usdcIssuer
    );
  }

  private invalidTransaction(message: string): BadRequestException {
    return new BadRequestException({
      statusCode: 400,
      message,
      code: 'PAYMENT_XDR_INVALID',
    });
  }

  private networkError(message: string): ServiceUnavailableException {
    return new ServiceUnavailableException({
      statusCode: 503,
      message,
      code: STELLAR_ERROR.NETWORK,
    });
  }

  private isNotFound(error: unknown): boolean {
    if (error instanceof NotFoundError) {
      return true;
    }
    return this.getResponseStatus(error) === 404;
  }

  private isServerError(error: unknown): boolean {
    const status = this.getResponseStatus(error);
    return status === undefined || status >= 500;
  }

  private getResponseStatus(error: unknown): number | undefined {
    if (!error || typeof error !== 'object' || !('response' in error)) {
      return undefined;
    }
    const response = error.response;
    if (!response || typeof response !== 'object' || !('status' in response)) {
      return undefined;
    }
    return typeof response.status === 'number' ? response.status : undefined;
  }

  private getHorizonResultCodes(error: unknown):
    | {
        transaction?: string;
        operations?: string[];
      }
    | undefined {
    if (!error || typeof error !== 'object' || !('response' in error)) {
      return undefined;
    }
    const response = error.response;
    if (!response || typeof response !== 'object' || !('data' in response)) {
      return undefined;
    }
    const data = response.data;
    if (!data || typeof data !== 'object' || !('extras' in data)) {
      return undefined;
    }
    const extras = data.extras;
    if (!extras || typeof extras !== 'object' || !('result_codes' in extras)) {
      return undefined;
    }
    const resultCodes = extras.result_codes;
    if (!resultCodes || typeof resultCodes !== 'object') {
      return undefined;
    }

    return {
      transaction:
        'transaction' in resultCodes &&
        typeof resultCodes.transaction === 'string'
          ? resultCodes.transaction
          : undefined,
      operations:
        'operations' in resultCodes && Array.isArray(resultCodes.operations)
          ? resultCodes.operations.filter(
              (code): code is string => typeof code === 'string',
            )
          : undefined,
    };
  }

  private sleep(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }
}
