import * as jwt from 'jsonwebtoken';

/**
 * Builds the ordered list of secrets used to verify Supabase access tokens.
 *
 * The current secret always comes first. A previous secret is only present
 * during a rotation overlap window (see docs/secret-rotation.md), so tokens
 * issued before the switch keep working until they expire naturally.
 *
 * Blank previous values are treated as unset because operators commonly leave
 * `SUPABASE_JWT_SECRET_PREVIOUS=` in place after finishing a rotation.
 */
export function resolveJwtVerificationSecrets(
  currentSecret: string | undefined,
  previousSecret?: string,
): readonly string[] {
  if (!currentSecret || currentSecret.trim().length === 0) {
    throw new Error('SUPABASE_JWT_SECRET is not configured');
  }

  const hasDistinctPrevious =
    typeof previousSecret === 'string' &&
    previousSecret.trim().length > 0 &&
    previousSecret !== currentSecret;

  return hasDistinctPrevious
    ? [currentSecret, previousSecret]
    : [currentSecret];
}

/**
 * Returns the configured secret whose signature matches `token`.
 *
 * Only the signature is checked here: expiry and not-before are deliberately
 * ignored so the caller's own verification still produces the usual
 * "expired" error instead of a misleading "invalid signature". When no secret
 * matches, the current secret is returned so the caller fails exactly as it
 * did before rotation support existed.
 */
export function selectJwtVerificationSecret(
  token: string,
  secrets: readonly string[],
  algorithms?: jwt.Algorithm[],
): string {
  const [currentSecret] = secrets;
  if (secrets.length === 1) {
    return currentSecret;
  }

  const matchingSecret = secrets.find((secret) => {
    try {
      jwt.verify(token, secret, {
        algorithms,
        ignoreExpiration: true,
        ignoreNotBefore: true,
      });
      return true;
    } catch {
      return false;
    }
  });

  return matchingSecret ?? currentSecret;
}
