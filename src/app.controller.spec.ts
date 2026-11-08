import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { StellarService } from './stellar/stellar.service';
import { PrismaService } from './database/prisma.service';

describe('AppController', () => {
  let appController: AppController;
  let stellarService: { getHealth: jest.Mock };
  let prismaService: { $queryRaw: jest.Mock };

  beforeEach(async () => {
    stellarService = { getHealth: jest.fn() };
    prismaService = {
      $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
    };
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        AppService,
        {
          provide: StellarService,
          useValue: stellarService,
        },
        {
          provide: PrismaService,
          useValue: prismaService,
        },
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('should return "Hello World!"', () => {
      expect(appController.getHello()).toBe('Hello World!');
    });
  });

  it('returns a public liveness response', () => {
    expect(appController.getHealth()).toEqual({ status: 'ok' });
  });

  it('delegates Stellar readiness to StellarService', async () => {
    const health = { status: 'ok', network: 'testnet' };
    stellarService.getHealth.mockResolvedValue(health);

    await expect(appController.getStellarHealth()).resolves.toEqual(health);
  });

  it('reports database and Stellar readiness without exposing provider errors', async () => {
    const stellar = { status: 'ok', network: 'testnet' };
    stellarService.getHealth.mockResolvedValue(stellar);

    await expect(appController.getReadiness()).resolves.toEqual({
      status: 'ok',
      database: { healthy: true },
      stellar,
    });
    expect(prismaService.$queryRaw).toHaveBeenCalled();
  });

  it('reports degraded readiness when Stellar providers are degraded', async () => {
    stellarService.getHealth.mockResolvedValue({
      status: 'degraded',
      network: 'testnet',
    });

    await expect(appController.getReadiness()).resolves.toMatchObject({
      status: 'degraded',
      database: { healthy: true },
    });
  });

  it('reports database failure as degraded without returning the database error', async () => {
    prismaService.$queryRaw.mockRejectedValue(
      new Error('database secret detail'),
    );
    stellarService.getHealth.mockResolvedValue({
      status: 'ok',
      network: 'testnet',
    });

    await expect(appController.getReadiness()).resolves.toEqual({
      status: 'degraded',
      database: { healthy: false },
      stellar: { status: 'ok', network: 'testnet' },
    });
  });
});
