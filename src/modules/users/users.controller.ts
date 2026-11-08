import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { LinkWalletDto } from './dtos/link-wallet.dto';
import { UserProfileDto } from './dtos/user-profile.dto';
import { UsersService } from './users.service';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  @ApiOperation({
    summary: 'Read the authenticated Vela profile and linked wallets.',
  })
  @ApiOkResponse({ type: UserProfileDto })
  async getMe(@CurrentUser() user: AuthenticatedUser): Promise<UserProfileDto> {
    return this.usersService.toProfile(
      await this.usersService.requireUser(user.supabaseUserId),
    );
  }

  @Post('me/wallet')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'Link a client-owned Stellar public key to the authenticated user.',
  })
  @ApiCreatedResponse({ type: UserProfileDto })
  @ApiConflictResponse({ description: 'WALLET_ALREADY_LINKED.' })
  async linkWallet(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: LinkWalletDto,
  ): Promise<UserProfileDto> {
    const profile = await this.usersService.linkWallet(
      user.supabaseUserId,
      dto,
    );
    return this.usersService.toProfile(profile);
  }
}
