import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { UsersService } from '../modules/users/users.service';
import type { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import { WebAuthnRepository } from './webauthn.repository';
import {
  CHALLENGE_TTL_MS,
  CHALLENGE_TYPE,
  MAX_CREDENTIALS_PER_USER,
  WEBAUTHN_ERROR,
} from './webauthn.constants';

export interface WebAuthnCredentialSummary {
  id: string;
  deviceName: string | null;
  createdAt: Date;
  lastUsedAt: Date | null;
}

/** Minimal shape of a stored credential record, as returned by the repository. */
interface StoredCredentialRecord {
  id: string;
  credentialId: string;
  deviceName: string | null;
  createdAt: Date;
  lastUsedAt: Date | null;
}

interface RpConfig {
  rpId: string;
  rpName: string;
  origin: string;
}

@Injectable()
export class WebAuthnService {
  private readonly logger = new Logger(WebAuthnService.name);

  constructor(
    private readonly repo: WebAuthnRepository,
    private readonly usersService: UsersService,
    private readonly config: ConfigService,
  ) {}

  async generateRegistrationOptions(
    authUser: AuthenticatedUser,
  ): Promise<PublicKeyCredentialCreationOptionsJSON> {
    const { rpId, rpName } = this.rp();
    const user = await this.resolveUser(authUser);
    const existing = await this.repo.listByUser(user.id);

    if (existing.length >= MAX_CREDENTIALS_PER_USER) {
      throw new ConflictException({
        statusCode: 409,
        message: `Maximum of ${MAX_CREDENTIALS_PER_USER} passkeys reached — remove one before adding another.`,
        code: WEBAUTHN_ERROR.CREDENTIAL_LIMIT_REACHED,
      });
    }

    const options = await generateRegistrationOptions({
      rpName,
      rpID: rpId,
      userName: user.email,
      userID: new TextEncoder().encode(user.id),
      attestationType: 'none',
      excludeCredentials: existing.map((c: StoredCredentialRecord) => ({
        id: c.credentialId,
      })),
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'preferred',
      },
    });

    await this.storeChallenge(
      user.id,
      options.challenge,
      CHALLENGE_TYPE.REGISTRATION,
    );

    return options;
  }

  async verifyRegistration(
    authUser: AuthenticatedUser,
    body: RegistrationResponseJSON,
    deviceName?: string,
  ): Promise<{ verified: true; credentialId: string }> {
    const { rpId, origin } = this.rp();
    const user = await this.resolveUser(authUser);

    const challenge = await this.repo.consumeLatestValid({
      userId: user.id,
      type: CHALLENGE_TYPE.REGISTRATION,
    });
    if (!challenge) {
      throw this.error(
        WEBAUTHN_ERROR.CHALLENGE_EXPIRED,
        'No active registration challenge — request options again.',
      );
    }

    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response: body,
        expectedChallenge: challenge.challenge,
        expectedOrigin: origin,
        expectedRPID: rpId,
        requireUserVerification: false,
      });
    } catch (err) {
      throw this.error(
        WEBAUTHN_ERROR.VERIFICATION_FAILED,
        err instanceof Error
          ? err.message
          : 'Registration verification failed.',
      );
    }

    if (!verification.verified || !verification.registrationInfo) {
      throw this.error(
        WEBAUTHN_ERROR.VERIFICATION_FAILED,
        'Registration response could not be verified.',
      );
    }

    const { credential } = verification.registrationInfo;

    try {
      await this.repo.createCredential({
        userId: user.id,
        credentialId: credential.id,
        publicKey: Uint8Array.from(credential.publicKey),
        counter: BigInt(credential.counter),
        deviceName: deviceName?.trim() || null,
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException({
          statusCode: 409,
          message: 'This passkey is already registered.',
          code: WEBAUTHN_ERROR.CREDENTIAL_EXISTS,
        });
      }
      throw err;
    }

    return { verified: true, credentialId: credential.id };
  }

  async generateAuthenticationOptions(
    authUser: AuthenticatedUser,
    paymentId: string,
  ): Promise<PublicKeyCredentialRequestOptionsJSON> {
    const { rpId } = this.rp();
    const user = await this.resolveUser(authUser);
    const credentials = await this.repo.listByUser(user.id);

    if (credentials.length === 0) {
      throw this.error(
        WEBAUTHN_ERROR.NO_CREDENTIALS,
        'No registered passkeys — register a credential first.',
      );
    }

    const options = await generateAuthenticationOptions({
      rpID: rpId,
      allowCredentials: credentials.map((c: StoredCredentialRecord) => ({
        id: c.credentialId,
      })),
      userVerification: 'preferred',
    });

    await this.storeChallenge(
      user.id,
      options.challenge,
      CHALLENGE_TYPE.AUTHENTICATION,
      paymentId,
    );

    return options;
  }

  async verifyPaymentAssertion(params: {
    internalUserId: string;
    paymentId: string;
    assertion: AuthenticationResponseJSON;
  }): Promise<void> {
    const { rpId, origin } = this.rp();
    const { internalUserId, paymentId, assertion } = params;

    const challenge = await this.repo.consumeLatestValid({
      userId: internalUserId,
      type: CHALLENGE_TYPE.AUTHENTICATION,
      paymentId,
    });
    if (!challenge) {
      throw this.error(
        WEBAUTHN_ERROR.CHALLENGE_EXPIRED,
        'Authentication challenge missing or expired — request options again.',
      );
    }

    const credential = await this.repo.findByCredentialId(assertion.id);
    if (!credential || credential.userId !== internalUserId) {
      throw this.error(
        WEBAUTHN_ERROR.VERIFICATION_FAILED,
        'Unknown credential for this user.',
      );
    }

    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response: assertion,
        expectedChallenge: challenge.challenge,
        expectedOrigin: origin,
        expectedRPID: rpId,
        requireUserVerification: false,
        credential: {
          id: credential.credentialId,
          publicKey: new Uint8Array(credential.publicKey),
          counter: Number(credential.counter),
        },
      });
    } catch (err) {
      throw this.error(
        WEBAUTHN_ERROR.VERIFICATION_FAILED,
        err instanceof Error ? err.message : 'Assertion verification failed.',
      );
    }

    if (!verification.verified) {
      throw this.error(
        WEBAUTHN_ERROR.VERIFICATION_FAILED,
        'Passkey assertion could not be verified.',
      );
    }

    await this.repo.updateCounter(
      credential.credentialId,
      BigInt(verification.authenticationInfo.newCounter),
      new Date(),
    );
  }

  async listCredentials(
    authUser: AuthenticatedUser,
  ): Promise<WebAuthnCredentialSummary[]> {
    const user = await this.resolveUser(authUser);
    const credentials = await this.repo.listByUser(user.id);
    return credentials.map((c: StoredCredentialRecord) => ({
      id: c.id,
      deviceName: c.deviceName,
      createdAt: c.createdAt,
      lastUsedAt: c.lastUsedAt,
    }));
  }

  /**
   * Revoke (delete) a registered passkey. Enforces the "never zero" rule from
   * the per-device policy: a user's last remaining credential cannot be
   * revoked, since that would lock them out of authorizing payments.
   */
  async revokeCredential(
    authUser: AuthenticatedUser,
    credentialRecordId: string,
  ): Promise<void> {
    const user = await this.resolveUser(authUser);
    const outcome = await this.repo.revokeCredentialForUser(
      credentialRecordId,
      user.id,
    );

    if (outcome === 'not_found') {
      throw new NotFoundException({
        statusCode: 404,
        message: 'Passkey not found.',
        code: WEBAUTHN_ERROR.CREDENTIAL_NOT_FOUND,
      });
    }

    if (outcome === 'last_credential') {
      throw new ConflictException({
        statusCode: 409,
        message:
          'Cannot remove your last passkey — register another device first.',
        code: WEBAUTHN_ERROR.LAST_CREDENTIAL,
      });
    }
  }

  private rp(): RpConfig {
    const rpId = this.config.get<string>('webauthn.rpId');
    const rpName = this.config.get<string>('webauthn.rpName');
    const origin = this.config.get<string>('webauthn.origin');
    if (!rpId || !rpName || !origin) {
      throw new InternalServerErrorException('WebAuthn RP is not configured.');
    }
    return { rpId, rpName, origin };
  }

  private async resolveUser(authUser: AuthenticatedUser) {
    const user = await this.usersService.getUserBySupabaseId(
      authUser.supabaseUserId,
    );
    if (!user) {
      // Should not happen — SupabaseStrategy upserts on every request.
      this.logger.error(
        `No internal user for supabase id ${authUser.supabaseUserId}`,
      );
      throw new InternalServerErrorException('User record not found.');
    }
    return user;
  }

  private storeChallenge(
    userId: string,
    challenge: string,
    type: (typeof CHALLENGE_TYPE)[keyof typeof CHALLENGE_TYPE],
    paymentId?: string,
  ) {
    return this.repo.createChallenge({
      userId,
      challenge,
      type,
      paymentId: paymentId ?? null,
      expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
    });
  }

  private error(code: string, message: string): BadRequestException {
    return new BadRequestException({ statusCode: 400, message, code });
  }
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: string }).code === 'P2002'
  );
}
