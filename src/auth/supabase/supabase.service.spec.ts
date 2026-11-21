import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from './supabase.service';
import * as jwt from 'jsonwebtoken';

describe('SupabaseService', () => {
  let service: SupabaseService;

  const testSecret = 'test-secret-key-for-jwt-verification';

  beforeEach(async () => {
    const mockConfigService = {
      get: jest.fn((key: string) => {
        const config: Record<string, string> = {
          'supabase.jwtSecret': testSecret,
        };
        return config[key];
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SupabaseService,
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    service = module.get<SupabaseService>(SupabaseService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should verify a valid JWT token', () => {
    const payload = {
      sub: 'test-user-id',
      email: 'test@example.com',
      email_verified: true,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    };
    const token = jwt.sign(payload, testSecret, { algorithm: 'HS256' });

    const result = service.verifyToken(token);
    expect(result).toBeDefined();
    expect(result.sub).toBe('test-user-id');
    expect(result.email).toBe('test@example.com');
  });

  it('should throw on invalid JWT token', () => {
    const invalidToken = 'invalid.token.here';
    expect(() => service.verifyToken(invalidToken)).toThrow();
  });

  it('should extract user claims from JWT', () => {
    const payload = {
      sub: 'user-123',
      email: 'user@example.com',
      email_verified: false,
      aud: 'authenticated',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    };
    const token = jwt.sign(payload, testSecret, { algorithm: 'HS256' });

    const claims = service.verifyToken(token);
    expect(claims.sub).toBe('user-123');
    expect(claims.email).toBe('user@example.com');
    expect(claims.email_verified).toBe(false);
  });

  it('should throw on expired token', () => {
    const expiredPayload = {
      sub: 'user-123',
      email: 'user@example.com',
      iat: Math.floor(Date.now() / 1000) - 7200,
      exp: Math.floor(Date.now() / 1000) - 3600,
    };
    const token = jwt.sign(expiredPayload, testSecret, { algorithm: 'HS256' });

    expect(() => service.verifyToken(token)).toThrow();
  });

  describe('with a previous secret configured for rotation', () => {
    const previousSecret = 'test-previous-secret-for-rotation';

    function createService(previous: string | undefined) {
      const config: Record<string, string | undefined> = {
        'supabase.jwtSecret': testSecret,
        'supabase.previousJwtSecret': previous,
      };
      return new SupabaseService({
        get: (key: string) => config[key],
      } as unknown as ConfigService);
    }

    it('verifies tokens signed with either secret', () => {
      const rotatingService = createService(previousSecret);

      for (const secret of [testSecret, previousSecret]) {
        const token = jwt.sign({ sub: 'user-123' }, secret, {
          algorithm: 'HS256',
        });
        expect(rotatingService.verifyToken(token).sub).toBe('user-123');
      }
    });

    it('reports expiry rather than a bad signature for old tokens', () => {
      const token = jwt.sign(
        { sub: 'user-123', exp: Math.floor(Date.now() / 1000) - 3600 },
        previousSecret,
        { algorithm: 'HS256' },
      );

      expect(() => createService(previousSecret).verifyToken(token)).toThrow(
        'JWT token expired',
      );
    });

    it('rejects previous-secret tokens after the previous secret is removed', () => {
      const token = jwt.sign({ sub: 'user-123' }, previousSecret, {
        algorithm: 'HS256',
      });

      expect(() => createService(undefined).verifyToken(token)).toThrow(
        'Invalid JWT token',
      );
    });
  });
});
