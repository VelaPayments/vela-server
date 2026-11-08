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
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { Public } from '../../auth/decorators/public.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { PaymentRequestsService } from './payment-requests.service';
import type { PaymentRequestValidationResponse } from './payment-requests.service';
import { CreatePaymentRequestDto } from './dto/create-payment-request.dto';
import { PaymentRequestResponseDto } from './dto/payment-request-response.dto';
import { ValidatePaymentRequestResponseDto } from './dto/validate-payment-request.dto';

@ApiTags('payment-requests')
@Controller('payment-requests')
export class PaymentRequestsController {
  constructor(
    private readonly paymentRequestsService: PaymentRequestsService,
  ) {}

  // ─── SRV-036: POST /v1/payment-requests/validate (Public) ───────────────────

  @Public()
  @Post('validate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Validate a payment-request.v1 payload',
    description:
      'Stateless validation of an NFC payment-request.v1 payload against the canonical contract. ' +
      'Returns HTTP 200 for both valid and invalid payloads — never 400 for contract errors.',
  })
  @ApiBody({
    description: 'Canonical payment-request.v1 JSON payload.',
    schema: {
      type: 'object',
      example: {
        type: 'payment-request',
        version: 1,
        recipient: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
        asset: 'USDC',
        amount: '25.00',
        timestamp: '2026-06-17T12:00:00.000Z',
        expiresAt: '2026-06-17T12:00:30.000Z',
      },
    },
  })
  @ApiOkResponse({
    type: ValidatePaymentRequestResponseDto,
    description: 'Validation result (always 200).',
  })
  validate(@Body() payload: unknown): PaymentRequestValidationResponse {
    return this.paymentRequestsService.validate(payload);
  }

  // ─── SRV-038: POST /v1/payment-requests (JWT — receiver) ────────────────────

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Register a receiver payment request',
    description:
      'Persists a new payment-request.v1 payload for the authenticated receiver. ' +
      'Returns 409 on duplicate requestId (anti-replay, SRV-039).',
  })
  @ApiBody({ type: CreatePaymentRequestDto })
  @ApiCreatedResponse({
    type: PaymentRequestResponseDto,
    description: 'Payment request created.',
  })
  @ApiUnprocessableEntityResponse({
    description: 'Payload fails payment-request.v1 contract validation.',
  })
  @ApiConflictResponse({
    description: 'Duplicate requestId — PAYMENT_REQUEST_ID_REPLAY.',
  })
  async create(
    @Body() dto: CreatePaymentRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PaymentRequestResponseDto> {
    return this.paymentRequestsService.create(dto, user);
  }

  @Get('external/:requestId')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Read an owned payment request by its NFC requestId.',
  })
  @ApiOkResponse({ type: PaymentRequestResponseDto })
  async findByExternalRequestId(
    @Param('requestId') requestId: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<PaymentRequestResponseDto> {
    return this.paymentRequestsService.findByExternalRequestId(
      requestId,
      currentUser,
    );
  }

  // ─── SRV-040: GET /v1/payment-requests/:id (JWT — owner) ────────────────────

  @Get(':id')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get a payment request by ID',
    description:
      'Returns the payment request matching the given UUID. ' +
      'The authenticated user must be the owner (receiverUserId).',
  })
  @ApiParam({ name: 'id', description: 'Payment request UUID', format: 'uuid' })
  @ApiOkResponse({
    type: PaymentRequestResponseDto,
    description: 'Payment request found.',
  })
  @ApiNotFoundResponse({ description: 'Payment request not found.' })
  async findById(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<PaymentRequestResponseDto> {
    return this.paymentRequestsService.findById(id, currentUser);
  }
}
