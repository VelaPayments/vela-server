import { Module } from '@nestjs/common';
import { WebAuthnModule } from '../../webauthn/webauthn.module';
import { UsersModule } from '../users/users.module';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { PaymentsRepository } from './payments.repository';
import { StellarModule } from '../../stellar/stellar.module';

@Module({
  imports: [WebAuthnModule, UsersModule, StellarModule],
  controllers: [PaymentsController],
  providers: [PaymentsService, PaymentsRepository],
  exports: [PaymentsService],
})
export class PaymentsModule {}
