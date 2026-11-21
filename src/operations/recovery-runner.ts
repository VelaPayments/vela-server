import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { PaymentRecoveryService } from '../modules/payments/payment-recovery.service';
import { StellarService } from '../stellar/stellar.service';
import type { RecoveryCliOptions } from './recovery-args';

const EXIT_OK = 0;
const EXIT_RECOVERY_ERRORS = 1;
const EXIT_USAGE = 2;

/**
 * Boots the application context with the server's own configuration and runs
 * one recovery sweep. Prints a single JSON report to stdout.
 */
export async function runRecovery(
  options: RecoveryCliOptions,
): Promise<number> {
  // Only errors go to stderr; stdout stays a single JSON report that can be
  // redirected to a file and attached to an incident record.
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error'],
  });

  try {
    const network = app.get(StellarService).getNetwork();
    if (network !== 'TESTNET') {
      console.error(
        `Refusing to run payment recovery on ${network}; Vela supports Stellar testnet only.`,
      );
      return EXIT_USAGE;
    }

    const report = await app.get(PaymentRecoveryService).recover(options);
    console.log(JSON.stringify(report, null, 2));
    return report.summary.ERROR > 0 ? EXIT_RECOVERY_ERRORS : EXIT_OK;
  } finally {
    await app.close();
  }
}
