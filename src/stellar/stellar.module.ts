import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Horizon, Networks, rpc } from '@stellar/stellar-sdk';
import {
  STELLAR_HORIZON_SERVER,
  STELLAR_NETWORK_CONFIG,
  STELLAR_RPC_SERVER,
  type StellarNetworkConfig,
} from './stellar.constants';
import { StellarService } from './stellar.service';

@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: STELLAR_NETWORK_CONFIG,
      inject: [ConfigService],
      useFactory: (config: ConfigService): StellarNetworkConfig => {
        const network = config.getOrThrow<'testnet' | 'mainnet'>(
          'stellar.network',
        );
        const networkPassphrase = config.getOrThrow<string>(
          'stellar.networkPassphrase',
        );
        const expectedPassphrase = String(
          network === 'testnet' ? Networks.TESTNET : Networks.PUBLIC,
        );
        if (networkPassphrase !== expectedPassphrase) {
          throw new Error(
            `STELLAR_NETWORK_PASSPHRASE does not match STELLAR_NETWORK=${network}.`,
          );
        }

        return {
          network,
          horizonUrl: config.getOrThrow<string>('stellar.horizonUrl'),
          rpcUrl: config.getOrThrow<string>('stellar.rpcUrl'),
          usdcIssuer: config.getOrThrow<string>('stellar.usdcIssuer'),
          networkPassphrase,
        };
      },
    },
    {
      provide: STELLAR_HORIZON_SERVER,
      inject: [STELLAR_NETWORK_CONFIG],
      useFactory: (config: StellarNetworkConfig): Horizon.Server =>
        new Horizon.Server(config.horizonUrl),
    },
    {
      provide: STELLAR_RPC_SERVER,
      inject: [STELLAR_NETWORK_CONFIG],
      useFactory: (config: StellarNetworkConfig): rpc.Server =>
        new rpc.Server(config.rpcUrl),
    },
    StellarService,
  ],
  exports: [StellarService],
})
export class StellarModule {}
