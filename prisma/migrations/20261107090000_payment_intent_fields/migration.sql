ALTER TABLE "payments"
  ADD COLUMN "memo" VARCHAR(280),
  ADD COLUMN "network" "StellarNetwork" NOT NULL DEFAULT 'TESTNET';

ALTER TABLE "payment_requests"
  ADD COLUMN "network" "StellarNetwork" NOT NULL DEFAULT 'TESTNET';
