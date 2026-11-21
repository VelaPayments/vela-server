import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as jwt from 'jsonwebtoken';
import {
  resolveJwtVerificationSecrets,
  selectJwtVerificationSecret,
} from '../jwt-secrets';

const SUPABASE_JWT_ALGORITHMS: jwt.Algorithm[] = ['HS256'];

export interface SupabaseJwtPayload {
  sub: string;
  aud: string;
  email?: string;
  email_verified?: boolean;
  iat: number;
  exp: number;
  [key: string]: any;
}

@Injectable()
export class SupabaseService {
  private readonly verificationSecrets: readonly string[];

  constructor(private configService: ConfigService) {
    this.verificationSecrets = resolveJwtVerificationSecrets(
      this.configService.get<string>('supabase.jwtSecret'),
      this.configService.get<string>('supabase.previousJwtSecret'),
    );
  }

  verifyToken(token: string): SupabaseJwtPayload {
    const secret = selectJwtVerificationSecret(
      token,
      this.verificationSecrets,
      SUPABASE_JWT_ALGORITHMS,
    );
    try {
      const payload = jwt.verify(token, secret, {
        algorithms: SUPABASE_JWT_ALGORITHMS,
        clockTolerance: 5 * 60,
      }) as SupabaseJwtPayload;
      return payload;
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        throw new Error('JWT token expired');
      }
      if (error instanceof jwt.JsonWebTokenError) {
        throw new Error('Invalid JWT token');
      }
      throw error;
    }
  }
}
