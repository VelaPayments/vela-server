import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import type { LinkWalletDto } from './dtos/link-wallet.dto';
import type { UserProfileDto } from './dtos/user-profile.dto';

export interface CreateOrUpdateUserInput {
  supabaseUserId: string;
  email?: string;
  displayName?: string;
}

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async createOrUpdateUser(input: CreateOrUpdateUserInput) {
    return this.prisma.user.upsert({
      where: { supabaseUserId: input.supabaseUserId },
      update: {
        email: input.email,
        displayName: input.displayName,
      },
      create: {
        supabaseUserId: input.supabaseUserId,
        email: input.email || '',
        displayName: input.displayName,
      },
      include: {
        wallets: true,
      },
    });
  }

  async getUserBySupabaseId(supabaseUserId: string) {
    return this.prisma.user.findUnique({
      where: { supabaseUserId },
      include: {
        wallets: true,
      },
    });
  }

  async getUserById(id: string) {
    return this.prisma.user.findUnique({
      where: { id },
      include: {
        wallets: true,
      },
    });
  }

  async requireUser(supabaseUserId: string) {
    const user = await this.getUserBySupabaseId(supabaseUserId);
    if (!user) throw new InternalServerErrorException('User record not found.');
    return user;
  }

  async linkWallet(supabaseUserId: string, dto: LinkWalletDto) {
    const user = await this.requireUser(supabaseUserId);
    const network = dto.network;

    try {
      return await this.prisma.$transaction(async (tx) => {
        const existing = await tx.wallet.findUnique({
          where: {
            stellarPublicKey_network: {
              stellarPublicKey: dto.stellarPublicKey,
              network,
            },
          },
        });
        if (existing && existing.userId !== user.id) {
          throw new ConflictException({
            statusCode: 409,
            message: 'This Stellar wallet is already linked to another user.',
            code: 'WALLET_ALREADY_LINKED',
          });
        }

        await tx.wallet.updateMany({
          where: { userId: user.id, network },
          data: { isPrimary: false },
        });

        if (existing) {
          await tx.wallet.update({
            where: { id: existing.id },
            data: { isPrimary: true, label: dto.label ?? null },
          });
        } else {
          await tx.wallet.create({
            data: {
              userId: user.id,
              stellarPublicKey: dto.stellarPublicKey,
              network,
              isPrimary: true,
              label: dto.label ?? null,
            },
          });
        }
        const profile = await tx.user.findUnique({
          where: { supabaseUserId },
          include: { wallets: true },
        });
        if (!profile)
          throw new InternalServerErrorException('User record not found.');
        return profile;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException({
          statusCode: 409,
          message: 'This Stellar wallet is already linked to another user.',
          code: 'WALLET_ALREADY_LINKED',
        });
      }
      throw error;
    }
  }

  toProfile(
    user: NonNullable<Awaited<ReturnType<UsersService['getUserBySupabaseId']>>>,
  ): UserProfileDto {
    return {
      id: user.id,
      supabaseUserId: user.supabaseUserId,
      email: user.email,
      displayName: user.displayName,
      wallets: user.wallets,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }
}
