// prisma/seed.ts
import {
  PrismaClient,
  StellarNetwork,
  AssetCode,
  PaymentRequestStatus,
} from '@prisma/client';

const prisma = new PrismaClient();

const TESTNET_PUBKEYS = {
  alice: 'GAHJJJKMOKYE4RVPZEWZTKH5FVI4PA3VL7GK2LFNUBSGBV3LZOPEXC',
  bob: 'GBVKI23OQZCANDXPQC7KVBHFCLNLQZSNWXAZDGB7YKN7RVXBOQERQE',
};

async function main() {
  // Upsert users
  const alice = await prisma.user.upsert({
    where: { email: 'alice@vela.test' },
    update: {},
    create: {
      supabaseUserId: 'supabase-alice-000',
      email: 'alice@vela.test',
      displayName: 'Alice (Receiver)',
    },
  });

  const bob = await prisma.user.upsert({
    where: { email: 'bob@vela.test' },
    update: {},
    create: {
      supabaseUserId: 'supabase-bob-000',
      email: 'bob@vela.test',
      displayName: 'Bob (Sender)',
    },
  });

  // Wallets
  await prisma.wallet.upsert({
    where: {
      stellarPublicKey_network: {
        stellarPublicKey: TESTNET_PUBKEYS.alice,
        network: StellarNetwork.TESTNET,
      },
    },
    update: {},
    create: {
      userId: alice.id,
      stellarPublicKey: TESTNET_PUBKEYS.alice,
      network: StellarNetwork.TESTNET,
      isPrimary: true,
      label: 'Alice iPhone',
    },
  });

  await prisma.wallet.upsert({
    where: {
      stellarPublicKey_network: {
        stellarPublicKey: TESTNET_PUBKEYS.bob,
        network: StellarNetwork.TESTNET,
      },
    },
    update: {},
    create: {
      userId: bob.id,
      stellarPublicKey: TESTNET_PUBKEYS.bob,
      network: StellarNetwork.TESTNET,
      isPrimary: true,
      label: 'Bob Android',
    },
  });

  // Sample PaymentRequest (CREATED — not yet consumed)
  const expiresAt = new Date(Date.now() + 30 * 1000); // 30s from now
  await prisma.paymentRequest.create({
    data: {
      receiverUserId: alice.id,
      recipient: TESTNET_PUBKEYS.alice,
      asset: AssetCode.USDC,
      amount: '25.0000000',
      memo: 'Coffee seed',
      network: StellarNetwork.TESTNET,
      status: PaymentRequestStatus.CREATED,
      payloadTimestamp: new Date(),
      expiresAt,
    },
  });

  console.log(
    'Seed complete — alice@vela.test (receiver), bob@vela.test (sender)',
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
