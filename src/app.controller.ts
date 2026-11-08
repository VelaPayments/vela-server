import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from './auth/decorators/public.decorator';
import { AppService } from './app.service';
import { StellarService } from './stellar/stellar.service';
import { PrismaService } from './database/prisma.service';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly stellarService: StellarService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Public()
  @SkipThrottle()
  @Get('health')
  getHealth(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Public()
  @SkipThrottle()
  @Get('health/stellar')
  getStellarHealth() {
    return this.stellarService.getHealth();
  }

  @Public()
  @SkipThrottle()
  @Get('health/ready')
  async getReadiness() {
    const [databaseResult, stellarResult] = await Promise.allSettled([
      this.prisma.$queryRaw`SELECT 1`,
      this.stellarService.getHealth(),
    ]);
    const databaseHealthy = databaseResult.status === 'fulfilled';
    const stellarHealth =
      stellarResult.status === 'fulfilled'
        ? stellarResult.value
        : { status: 'degraded' as const };

    return {
      status:
        databaseHealthy && stellarHealth.status === 'ok' ? 'ok' : 'degraded',
      database: { healthy: databaseHealthy },
      stellar: stellarHealth,
    };
  }
}
