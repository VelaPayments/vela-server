import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { PaymentRequestsController } from './payment-requests.controller';
import { PaymentRequestsService } from './payment-requests.service';
import { PaymentRequestsRepository } from './payment-requests.repository';
import { CreatePaymentRequestDto } from './dto/create-payment-request.dto';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';

const mockUser: AuthenticatedUser = { supabaseUserId: 'uid-abc' };

const mockResponseDto = {
  id: 'pr-uuid-1',
  status: 'CREATED',
  externalRequestId: 'req_001',
  recipient: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
  asset: 'USDC',
  network: 'TESTNET',
  amount: '10.00',
  expiresAt: new Date(Date.now() + 30_000).toISOString(),
  createdAt: new Date().toISOString(),
};

describe('PaymentRequestsController', () => {
  let controller: PaymentRequestsController;
  let service: { validate: jest.Mock; create: jest.Mock; findById: jest.Mock };

  beforeEach(async () => {
    const mockService = {
      validate: jest.fn(),
      create: jest.fn(),
      findById: jest.fn(),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [PaymentRequestsController],
      providers: [
        { provide: PaymentRequestsService, useValue: mockService },
        { provide: PaymentRequestsRepository, useValue: {} },
      ],
    }).compile();

    controller = moduleRef.get(PaymentRequestsController);
    service = mockService;
  });

  describe('validate()', () => {
    it('delegates the payload to the service and returns its result', () => {
      const expected = {
        valid: true as const,
        normalized: undefined,
        errors: [],
      };
      service.validate.mockReturnValue(expected);

      const result = controller.validate({ type: 'payment-request' });

      expect(service.validate).toHaveBeenCalledWith({
        type: 'payment-request',
      });
      expect(result).toBe(expected);
    });
  });

  describe('create()', () => {
    it('delegates to service.create and returns the response DTO', async () => {
      service.create.mockResolvedValue(mockResponseDto);
      const dto = { requestId: 'req_001' } as CreatePaymentRequestDto;

      const result = await controller.create(dto, mockUser);

      expect(service.create).toHaveBeenCalledWith(dto, mockUser);
      expect(result).toBe(mockResponseDto);
    });

    it('propagates ConflictException from service', async () => {
      service.create.mockRejectedValue(new ConflictException());
      await expect(
        controller.create({} as CreatePaymentRequestDto, mockUser),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('findById()', () => {
    it('delegates to service.findById and returns the response DTO', async () => {
      service.findById.mockResolvedValue({
        ...mockResponseDto,
        status: 'SHARED',
      });

      const result = await controller.findById('pr-uuid-1', mockUser);

      expect(service.findById).toHaveBeenCalledWith('pr-uuid-1', mockUser);
      expect(result.status).toBe('SHARED');
    });

    it('propagates NotFoundException from service', async () => {
      service.findById.mockRejectedValue(new NotFoundException());
      await expect(
        controller.findById('missing-id', mockUser),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
