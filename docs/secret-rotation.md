# Secret rotation without downtime

This runbook covers rotating the secrets `vela-server` reads from its
environment, what the server does during a rotation, and where it cannot avoid
interruption. It describes current behaviour only; anything listed under
[Limitations](#limitations) is not handled by the server today.

## How the server reads secrets

- All configuration is loaded once at process start (`src/config/configuration.ts`)
  and validated by `src/config/env.validation.ts`. There is **no hot reload**:
  every change below takes effect only when a new process starts.
- Zero downtime therefore depends on the deployment replacing instances
  gradually (rolling or blue/green) so at least one healthy instance is always
  serving. A single-instance deployment always has a restart gap, whatever
  the secret.
- Gate traffic on `GET /v1/health/ready`. It answers HTTP `200` even when
  degraded, so the probe must check the body (`database.healthy === true`),
  not just the status code.
- The server holds **no Stellar signing keys**. Clients submit signed XDR;
  the server builds, submits and polls. There is nothing on the Stellar side
  to rotate here.

## Secret inventory

| Variable                       | Used by                                       | Rotation approach                                    |
| ------------------------------ | --------------------------------------------- | ---------------------------------------------------- |
| `SUPABASE_JWT_SECRET`          | Bearer-token verification on every request    | Overlap window with `SUPABASE_JWT_SECRET_PREVIOUS`   |
| `SUPABASE_JWT_SECRET_PREVIOUS` | Optional; accepted only during an overlap     | Set at the start of a rotation, cleared at the end   |
| `SUPABASE_SERVICE_ROLE_KEY`    | Validated at startup; not read by any handler | Rolling restart with the new value                   |
| `DATABASE_URL` (password)      | Prisma runtime connections via the pooler     | Rolling restart; see [Database](#database-passwords) |
| `DIRECT_URL` (password)        | `prisma migrate` only                         | Update wherever migrations run                       |

Values that look like configuration but must **not** be rotated casually:
`WEBAUTHN_RP_ID` and `WEBAUTHN_ORIGIN` are bound into every registered passkey,
so changing them makes existing passkeys unusable. `STELLAR_USDC_ISSUER` and
`STELLAR_NETWORK_PASSPHRASE` identify the asset and network. None of these are
secrets, and changing any of them is a coordinated protocol change with
[VelaPayments/vela-payments](https://github.com/VelaPayments/vela-payments),
not a rotation.

## Rotating `SUPABASE_JWT_SECRET`

Supabase access tokens are HS256 JWTs signed with the project's JWT secret.
Swapping the secret outright would reject every token issued before the swap
with `401` until each client refreshes its session. To avoid that, the server
accepts two secrets during an **overlap window**:

- `SUPABASE_JWT_SECRET` is the current secret, used to verify new tokens.
- `SUPABASE_JWT_SECRET_PREVIOUS` is the outgoing secret. It is still accepted
  for tokens that were issued before the switch.

Both values go through exactly the same checks. A token signed with the
previous secret still has to be unexpired and still needs a valid `sub`, and
it never skips the WebAuthn step needed to authorize a payment. Startup fails
if the two values are identical, because that usually means the swap was
forgotten.

### Choose the overlap window

The window must be at least as long as the longest-lived access token, plus
clock skew:

```text
overlap >= Supabase JWT expiry (Auth settings; 3600 s by default) + 5 minutes
```

Use your project's configured expiry, not the default, if you have changed it.

### Procedure

1. **Stage the new secret.** Generate a high-entropy value in your secret
   manager. Do not paste it into tickets, chat, PR descriptions or shell
   history.
2. **Deploy both secrets.** Roll out every server instance with:

   ```dotenv
   SUPABASE_JWT_SECRET=<new secret>
   SUPABASE_JWT_SECRET_PREVIOUS=<current secret>
   ```

   The server now accepts tokens signed with either value. Supabase is still
   issuing tokens with the old secret, so nothing changes for clients yet.

3. **Confirm the rollout finished.** Every instance has to be on the new
   configuration before step 4. An instance that still has only the old
   secret will reject tokens signed with the new one.
4. **Switch the secret in Supabase.** Set the project JWT secret to the new
   value. New sessions and refreshed tokens are now signed with it, and the
   server keeps accepting tokens signed with the old one.
5. **Wait out the overlap window** measured from step 4.
6. **Retire the previous secret.** Roll out again with
   `SUPABASE_JWT_SECRET_PREVIOUS` empty or removed.
7. **Revoke the old value** in your secret manager.

### Verify each phase

Use test accounts on a non-production Supabase project, and keep tokens out of
logs and saved shell history:

```bash
# Should return 200 after step 2 (old-secret token) and after step 4 (new-secret token).
curl -sS -o /dev/null -w '%{http_code}\n' \
  -H "Authorization: Bearer $VELA_TEST_ACCESS_TOKEN" \
  "$VELA_API_URL/v1/users/me"
```

After step 6, an access token issued **before** step 4 should return `401`,
and a freshly issued one should return `200`. The automated equivalents run
in CI. These are the "JWT secret rotation" cases in
`src/auth/guards/supabase-auth.guard.spec.ts` and the helper tests in
`src/auth/jwt-secrets.spec.ts`.

### Rollback

During the overlap window, roll back by swapping the two values
(`SUPABASE_JWT_SECRET=<old>`, `SUPABASE_JWT_SECRET_PREVIOUS=<new>`) and
reverting the Supabase setting. Tokens signed with either value keep working
while you do this.

### Supabase-side effects to check first

The server can only control which tokens it accepts. Before you start, check
Supabase's current documentation for what changing the JWT secret does to your
project. In projects that use the legacy JWT-based `anon` and `service_role`
API keys, those keys are signed with the JWT secret too and change along with
it. If so:

- update `SUPABASE_SERVICE_ROLE_KEY` in step 2 of this runbook, and
- coordinate the new `anon` key with the Expo client
  ([VelaPayments/vela-payments](https://github.com/VelaPayments/vela-payments)),
  which this server does not configure.

If the secret can't be staged before it goes live (step 4 has to happen before
you know the new value), deploy step 2 as soon as you have the value. Clients
whose tokens are signed with the new secret will get `401` until that rollout
completes.

## Rotating `SUPABASE_SERVICE_ROLE_KEY`

No request handler reads this key today. It is only checked for presence at
startup, so rotating it needs one rolling restart with the new value and has no
effect on requests in progress. If a future change starts calling Supabase with
this key, this section has to describe an overlap strategy for it.

## Database passwords

`PrismaService` connects during module initialisation, so a wrong password
stops the process at startup instead of failing requests later. Postgres has
one active password per role, so changing the password for the role the server
uses has a short window where instances that haven't restarted yet can't open
**new** connections. Connections that are already open keep working.

To keep that window short:

1. Change the password in Supabase.
2. Immediately roll out `DATABASE_URL` (and `DIRECT_URL` wherever migrations
   run) with the new password. Let an instance take traffic only once
   `/v1/health/ready` reports `database.healthy: true`.

True zero-downtime database rotation needs two login roles that alternate. You
switch the server to the standby role, then rotate the idle one. That is a
database and infrastructure change and is out of scope for this repository.

## What is never logged or committed

- No secret value appears in logs, errors or validation messages. When the two
  JWT secrets are equal, startup fails with a message that names the variables
  only.
- Choosing which secret verifies a token produces no log output, so neither
  token contents nor the matching secret are written anywhere.
- Test fixtures use obviously fake `test-only-*` placeholder secrets. Never
  commit `.env`, real tokens, or screenshots of the Supabase settings page.

## Limitations

- **No hot reload.** Every rotation needs a process restart, and a
  single-instance deployment has a restart gap.
- **Symmetric secrets only.** The server verifies HS256 tokens with shared
  secrets. Supabase's asymmetric JWT signing keys (JWKS, with standby keys)
  would let rotation happen without redeploying the server, but they are not
  supported here. Supporting them should be its own issue.
- **No physical-device or testnet dependency.** Rotation involves only the
  session layer. Stellar testnet accounts and native passkeys are unaffected,
  but a passkey assertion still needs a valid session token to reach the
  authorize endpoint.
