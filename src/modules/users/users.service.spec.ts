import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../database/prisma.service';
import { UsersService } from './users.service';

describe('UsersService', () => {
  let service: UsersService;
  let prismaService: PrismaService;

  beforeEach(async () => {
    const mockPrismaService = {
      user: {
        upsert: jest.fn().mockResolvedValue({
          id: 'db-user-1',
          supabaseUserId: 'supa-user-123',
          email: 'test@example.com',
          displayName: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          wallets: [],
        }),
        findUnique: jest.fn().mockResolvedValue({
          id: 'db-user-1',
          supabaseUserId: 'supa-user-123',
          email: 'test@example.com',
          displayName: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          wallets: [],
        }),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
    prismaService = module.get<PrismaService>(PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should create user if not exists', async () => {
    const user = await service.createOrUpdateUser({
      supabaseUserId: 'supa-user-123',
      email: 'test@example.com',
    });
    expect(user.supabaseUserId).toBe('supa-user-123');
    expect(user.email).toBe('test@example.com');
  });

  it('should call prisma upsert with correct where clause', async () => {
    const prismaUpsert = jest.spyOn(prismaService.user, 'upsert');
    await service.createOrUpdateUser({
      supabaseUserId: 'supa-user-123',
      email: 'test@example.com',
    });

    expect(prismaUpsert).toHaveBeenCalledWith({
      where: { supabaseUserId: 'supa-user-123' },
      update: {
        email: 'test@example.com',
        displayName: undefined,
      },
      create: {
        supabaseUserId: 'supa-user-123',
        email: 'test@example.com',
        displayName: undefined,
      },
      include: {
        wallets: true,
      },
    });
  });

  it('should get user by supabase id', async () => {
    const user = await service.getUserBySupabaseId('supa-user-123');
    expect(user).toBeDefined();
    expect(user?.supabaseUserId).toBe('supa-user-123');
  });

  it('should get user by id', async () => {
    const user = await service.getUserById('db-user-1');
    expect(user).toBeDefined();
  });
});

describe('UsersService.linkWallet ownership', () => {
  it('does not reassign a wallet already linked to another user', async () => {
    const tx = {
      wallet: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'wallet-1',
          userId: 'different-user',
        }),
        updateMany: jest.fn(),
        update: jest.fn(),
        create: jest.fn(),
      },
    };
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'user-1',
          supabaseUserId: 'supa-user-123',
          email: 'test@example.com',
          displayName: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          wallets: [],
        }),
      },
      $transaction: jest.fn((callback: (value: typeof tx) => unknown) =>
        callback(tx),
      ),
    };
    const service = new UsersService(prisma as never);

    await expect(
      service.linkWallet('supa-user-123', {
        stellarPublicKey:
          'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        network: 'TESTNET',
      }),
    ).rejects.toMatchObject({ response: { code: 'WALLET_ALREADY_LINKED' } });

    expect(tx.wallet.updateMany).not.toHaveBeenCalled();
    expect(tx.wallet.update).not.toHaveBeenCalled();
    expect(tx.wallet.create).not.toHaveBeenCalled();
  });

  it('returns the linked wallet from the same transaction', async () => {
    const linkedWallet = {
      id: 'wallet-1',
      userId: 'user-1',
      stellarPublicKey:
        'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      network: 'TESTNET',
      isPrimary: true,
      label: null,
    };
    const tx = {
      wallet: {
        findUnique: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn(),
        update: jest.fn(),
        create: jest.fn().mockResolvedValue(linkedWallet),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'user-1',
          supabaseUserId: 'supa-user-123',
          email: 'test@example.com',
          displayName: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          wallets: [linkedWallet],
        }),
      },
    };
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'user-1',
          supabaseUserId: 'supa-user-123',
          email: 'test@example.com',
          displayName: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          wallets: [],
        }),
      },
      $transaction: jest.fn((callback: (value: typeof tx) => unknown) =>
        callback(tx),
      ),
    };
    const service = new UsersService(prisma as never);

    await expect(
      service.linkWallet('supa-user-123', {
        stellarPublicKey: linkedWallet.stellarPublicKey,
        network: 'TESTNET',
      }),
    ).resolves.toMatchObject({
      wallets: [
        expect.objectContaining({
          stellarPublicKey: linkedWallet.stellarPublicKey,
        }),
      ],
    });
    expect(tx.user.findUnique).toHaveBeenCalledWith({
      where: { supabaseUserId: 'supa-user-123' },
      include: { wallets: true },
    });
    expect(prisma.user.findUnique).toHaveBeenCalledTimes(1);
  });
});
