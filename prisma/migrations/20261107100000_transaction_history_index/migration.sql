CREATE UNIQUE INDEX "transactions_userId_stellarTxHash_key"
ON "transactions"("userId", "stellarTxHash");
