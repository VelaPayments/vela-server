import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import type { AuthenticationResponseJSON } from '@simplewebauthn/server';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { AuthenticationResponseDto } from '../../webauthn/dto';
import { PaymentsService } from './payments.service';
import {
  CreatePaymentDto,
  PaymentAuthorizedResponseDto,
  PaymentResponseDto,
  SubmitPaymentDto,
} from './dto';

@ApiTags('payments')
@ApiBearerAuth()
@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create a payment intent and unsigned Stellar transaction.',
  })
  @ApiCreatedResponse({ type: PaymentResponseDto })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreatePaymentDto,
  ): Promise<PaymentResponseDto> {
    return this.paymentsService.create(user, dto);
  }

  @Post(':id/authorize')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Authorize a payment with a passkey assertion',
    description:
      'Verifies the WebAuthn assertion for the payment and transitions it ' +
      'CREATED → AUTHORIZED. Requires a challenge from ' +
      '`POST /v1/webauthn/authenticate/options`.',
  })
  @ApiParam({ name: 'id', description: 'Payment UUID', format: 'uuid' })
  @ApiOkResponse({ type: PaymentAuthorizedResponseDto })
  @ApiNotFoundResponse({ description: 'PAYMENT_NOT_FOUND.' })
  @ApiConflictResponse({ description: 'PAYMENT_INVALID_STATE.' })
  @ApiBadRequestResponse({
    description: 'WEBAUTHN_VERIFICATION_FAILED or WEBAUTHN_CHALLENGE_EXPIRED.',
  })
  authorize(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: AuthenticationResponseDto,
  ): Promise<PaymentAuthorizedResponseDto> {
    return this.paymentsService.authorize(
      user,
      id,
      body as unknown as AuthenticationResponseJSON,
    );
  }

  @Post(':id/submit')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Submit an authorized, locally signed Stellar transaction.',
  })
  @ApiOkResponse({ type: PaymentResponseDto })
  submit(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SubmitPaymentDto,
  ): Promise<PaymentResponseDto> {
    return this.paymentsService.submit(user, id, dto);
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Read payment status for its sender or receiver.' })
  @ApiOkResponse({ type: PaymentResponseDto })
  getStatus(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PaymentResponseDto> {
    return this.paymentsService.getStatus(user, id);
  }
}
