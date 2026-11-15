import { Injectable } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import type { ChallengeType } from './webauthn.constants';

type PrismaTx = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

export interface CreateChallengeInput {
  userId: string;
  challenge: string;
  type: ChallengeType;
  paymentId?: string | null;
  expiresAt: Date;
}

export interface ConsumeChallengeQuery {
  userId: string;
  type: ChallengeType;
  paymentId?: string | null;
}

export interface CreateCredentialInput {
  userId: string;
  credentialId: string;
  publicKey: Uint8Array<ArrayBuffer>;
  counter: bigint;
  deviceName?: string | null;
}

export type RevokeCredentialResult =
  'deleted' | 'not_found' | 'last_credential';

class LastCredentialInvariantError extends Error {
  constructor() {
    super('Cannot revoke the last remaining credential');
  }
}

@Injectable()
export class WebAuthnRepository {
  constructor(private readonly prisma: PrismaService) {}

  createChallenge(input: CreateChallengeInput) {
    return this.prisma.webAuthnChallenge.create({
      data: {
        userId: input.userId,
        challenge: input.challenge,
        type: input.type,
        paymentId: input.paymentId ?? null,
        expiresAt: input.expiresAt,
      },
    });
  }

  async consumeLatestValid(query: ConsumeChallengeQuery) {
    return this.prisma.$transaction(async (tx: PrismaTx) => {
      const now = new Date();
      const candidate = await tx.webAuthnChallenge.findFirst({
        where: {
          userId: query.userId,
          type: query.type,
          paymentId: query.paymentId ?? null,
          expiresAt: { gt: now },
        },
        orderBy: { createdAt: 'desc' },
      });

      if (!candidate) {
        return null;
      }

      await tx.webAuthnChallenge.delete({ where: { id: candidate.id } });
      return candidate;
    });
  }

  createCredential(input: CreateCredentialInput) {
    return this.prisma.webAuthnCredential.create({
      data: {
        userId: input.userId,
        credentialId: input.credentialId,
        publicKey: input.publicKey,
        counter: input.counter,
        deviceName: input.deviceName ?? null,
      },
    });
  }

  listByUser(userId: string) {
    return this.prisma.webAuthnCredential.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    });
  }

  countByUser(userId: string) {
    return this.prisma.webAuthnCredential.count({ where: { userId } });
  }

  findByCredentialId(credentialId: string) {
    return this.prisma.webAuthnCredential.findUnique({
      where: { credentialId },
    });
  }

  /** Scoped lookup by internal `id` (not `credentialId`) for device management. */
  findByIdForUser(id: string, userId: string) {
    return this.prisma.webAuthnCredential.findFirst({
      where: { id, userId },
    });
  }

  updateCounter(credentialId: string, counter: bigint, lastUsedAt: Date) {
    return this.prisma.webAuthnCredential.update({
      where: { credentialId },
      data: { counter, lastUsedAt },
    });
  }

  deleteById(id: string) {
    return this.prisma.webAuthnCredential.delete({ where: { id } });
  }

  /**
   * Atomically enforces credential ownership and the per-user "never zero"
   * passkey invariant inside a single database transaction serialized by a
   * row-level lock on the owning user record.
   */
  async revokeCredentialForUser(
    id: string,
    userId: string,
  ): Promise<RevokeCredentialResult> {
    try {
      return await this.prisma.$transaction(async (tx: PrismaTx) => {
        await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM "users" WHERE id = ${userId} FOR UPDATE
        `;

        const credential = await tx.webAuthnCredential.findFirst({
          where: { id, userId },
        });
        if (!credential) {
          return 'not_found';
        }

        const total = await tx.webAuthnCredential.count({
          where: { userId },
        });
        if (total <= 1) {
          return 'last_credential';
        }

        const deleted = await tx.webAuthnCredential.deleteMany({
          where: { id: credential.id, userId },
        });
        if (deleted.count === 0) {
          return 'not_found';
        }

        const remaining = await tx.webAuthnCredential.count({
          where: { userId },
        });
        if (remaining < 1) {
          throw new LastCredentialInvariantError();
        }

        return 'deleted';
      });
    } catch (error) {
      if (error instanceof LastCredentialInvariantError) {
        return 'last_credential';
      }
      throw error;
    }
  }
}
