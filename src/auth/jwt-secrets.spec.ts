import { sign } from 'jsonwebtoken';
import {
  resolveJwtVerificationSecrets,
  selectJwtVerificationSecret,
} from './jwt-secrets';

// Test-only placeholders; never reuse real Supabase secrets in fixtures.
const CURRENT_SECRET = 'test-only-current-jwt-secret';
const PREVIOUS_SECRET = 'test-only-previous-jwt-secret';

describe('resolveJwtVerificationSecrets', () => {
  it('returns only the current secret when no rotation is in progress', () => {
    expect(resolveJwtVerificationSecrets(CURRENT_SECRET)).toEqual([
      CURRENT_SECRET,
    ]);
  });

  it('orders the current secret ahead of the previous one', () => {
    expect(
      resolveJwtVerificationSecrets(CURRENT_SECRET, PREVIOUS_SECRET),
    ).toEqual([CURRENT_SECRET, PREVIOUS_SECRET]);
  });

  it.each(['', '   '])(
    'ignores a blank previous secret (%j) left behind after rotation',
    (previousSecret) => {
      expect(
        resolveJwtVerificationSecrets(CURRENT_SECRET, previousSecret),
      ).toEqual([CURRENT_SECRET]);
    },
  );

  it('does not list the same secret twice', () => {
    expect(
      resolveJwtVerificationSecrets(CURRENT_SECRET, CURRENT_SECRET),
    ).toEqual([CURRENT_SECRET]);
  });

  it.each([undefined, '', '  '])(
    'refuses to start without a current secret (%j)',
    (currentSecret) => {
      expect(() =>
        resolveJwtVerificationSecrets(currentSecret, PREVIOUS_SECRET),
      ).toThrow('SUPABASE_JWT_SECRET is not configured');
    },
  );
});

describe('selectJwtVerificationSecret', () => {
  const rotatingSecrets = [CURRENT_SECRET, PREVIOUS_SECRET];

  it('selects the current secret for tokens issued after rotation', () => {
    const token = sign({ sub: 'user-1' }, CURRENT_SECRET);

    expect(selectJwtVerificationSecret(token, rotatingSecrets)).toBe(
      CURRENT_SECRET,
    );
  });

  it('selects the previous secret for tokens issued before rotation', () => {
    const token = sign({ sub: 'user-1' }, PREVIOUS_SECRET);

    expect(selectJwtVerificationSecret(token, rotatingSecrets)).toBe(
      PREVIOUS_SECRET,
    );
  });

  it('still selects the signing secret for an expired token so the caller reports expiry', () => {
    const token = sign(
      { sub: 'user-1', exp: Math.floor(Date.now() / 1000) - 60 },
      PREVIOUS_SECRET,
    );

    expect(selectJwtVerificationSecret(token, rotatingSecrets)).toBe(
      PREVIOUS_SECRET,
    );
  });

  it.each([
    ['a retired secret', sign({ sub: 'user-1' }, 'test-only-retired-secret')],
    ['a malformed token', 'not.a.jwt'],
    ['an empty token', ''],
  ])('falls back to the current secret for %s', (_label, token) => {
    expect(selectJwtVerificationSecret(token, rotatingSecrets)).toBe(
      CURRENT_SECRET,
    );
  });

  it('honours an algorithm allow-list when matching secrets', () => {
    const token = sign({ sub: 'user-1' }, PREVIOUS_SECRET, {
      algorithm: 'HS512',
    });

    expect(selectJwtVerificationSecret(token, rotatingSecrets, ['HS256'])).toBe(
      CURRENT_SECRET,
    );
  });
});
