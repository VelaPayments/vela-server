import { ExecutionContext } from '@nestjs/common';
import { Controller, Get, INestApplication, UseGuards } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { PassportModule } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { sign } from 'jsonwebtoken';
import request from 'supertest';
import { SupabaseAuthGuard } from './supabase-auth.guard';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { SupabaseStrategy } from '../strategies/supabase.strategy';
import { UsersService } from '../../modules/users/users.service';

const JWT_SECRET = 'test-only-jwt-secret';

@Controller('protected')
@UseGuards(SupabaseAuthGuard)
class ProtectedTestController {
  @Get()
  getProtectedResource() {
    return { ok: true };
  }
}

describe('SupabaseAuthGuard', () => {
  it('should be defined', () => {
    const mockReflector = new Reflector();
    const guard = new SupabaseAuthGuard(mockReflector);
    expect(guard).toBeDefined();
  });

  it('should skip auth for public routes', () => {
    const mockReflector = {
      getAllAndOverride: jest.fn().mockReturnValue(true),
    } as unknown as Reflector;

    const guard = new SupabaseAuthGuard(mockReflector);

    const mockHandler = () => {};
    const mockClass = class {};

    const mockContext = {
      getHandler: () => mockHandler,
      getClass: () => mockClass,
    } as unknown as ExecutionContext;

    const result = guard.canActivate(mockContext);
    expect(result).toBe(true);
  });

  it('should check for IS_PUBLIC_KEY metadata', () => {
    const mockHandler = () => {};
    const mockClass = class {};

    const getAllAndOverride = jest.fn().mockReturnValue(true);
    const mockReflector = { getAllAndOverride } as unknown as Reflector;

    const guard = new SupabaseAuthGuard(mockReflector);

    const mockContext = {
      getHandler: () => mockHandler,
      getClass: () => mockClass,
    } as unknown as ExecutionContext;

    void guard.canActivate(mockContext);

    expect(getAllAndOverride).toHaveBeenCalledWith(IS_PUBLIC_KEY, [
      mockHandler,
      mockClass,
    ]);
  });

  describe('protected endpoint authentication', () => {
    let app: INestApplication;
    let usersService: { createOrUpdateUser: jest.Mock };

    beforeAll(async () => {
      usersService = { createOrUpdateUser: jest.fn().mockResolvedValue({}) };
      const moduleRef = await Test.createTestingModule({
        imports: [PassportModule.register({})],
        controllers: [ProtectedTestController],
        providers: [
          SupabaseAuthGuard,
          SupabaseStrategy,
          {
            provide: ConfigService,
            useValue: { get: jest.fn().mockReturnValue(JWT_SECRET) },
          },
          { provide: UsersService, useValue: usersService },
        ],
      }).compile();

      app = moduleRef.createNestApplication();
      await app.init();
    });

    afterAll(async () => {
      await app.close();
    });

    beforeEach(() => usersService.createOrUpdateUser.mockClear());

    it('rejects missing bearer tokens without synchronizing a user', async () => {
      await request(app.getHttpServer()).get('/protected').expect(401);

      expect(usersService.createOrUpdateUser).not.toHaveBeenCalled();
    });

    it.each([
      ['an invalid signature', sign({ sub: 'user-1' }, 'wrong-secret')],
      [
        'an expired token',
        sign(
          { sub: 'user-1', exp: Math.floor(Date.now() / 1000) - 1 },
          JWT_SECRET,
        ),
      ],
      ['a missing subject', sign({ aud: 'authenticated' }, JWT_SECRET)],
      ['an empty subject', sign({ sub: '' }, JWT_SECRET)],
      ['a nonstring subject', sign({ sub: 42 }, JWT_SECRET)],
    ])('rejects %s before user synchronization', async (_label, token) => {
      await request(app.getHttpServer())
        .get('/protected')
        .set('Authorization', `Bearer ${token}`)
        .expect(401);

      expect(usersService.createOrUpdateUser).not.toHaveBeenCalled();
    });
  });
});
