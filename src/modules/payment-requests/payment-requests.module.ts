import { Module } from '@nestjs/common';
import { PaymentRequestsController } from './payment-requests.controller';
import { PaymentRequestsService } from './payment-requests.service';
import { PaymentRequestsRepository } from './payment-requests.repository';
import { UsersModule } from '../users/users.module';
import { StellarModule } from '../../stellar/stellar.module';

@Module({
  controllers: [PaymentRequestsController],
  imports: [UsersModule, StellarModule],
  providers: [PaymentRequestsService, PaymentRequestsRepository],
  exports: [PaymentRequestsService],
})
export class PaymentRequestsModule {}
