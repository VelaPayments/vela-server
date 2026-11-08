import { Module } from '@nestjs/common';
import { StellarModule } from '../../stellar/stellar.module';
import { UsersModule } from '../users/users.module';
import { TransactionsController } from './transactions.controller';
import { TransactionsRepository } from './transactions.repository';
import { TransactionsService } from './transactions.service';

@Module({
  imports: [UsersModule, StellarModule],
  controllers: [TransactionsController],
  providers: [TransactionsRepository, TransactionsService],
})
export class TransactionsModule {}
