import { parseRecoveryArgs } from './recovery-args';

describe('parseRecoveryArgs', () => {
  it('defaults to a 30 minute, 50 payment dry run', () => {
    expect(parseRecoveryArgs([])).toEqual({
      kind: 'run',
      options: { apply: false, olderThanMs: 30 * 60_000, limit: 50 },
    });
  });

  it('accepts both --flag value and --flag=value forms', () => {
    expect(
      parseRecoveryArgs(['--apply', '--older-than-minutes', '90', '--limit=5']),
    ).toEqual({
      kind: 'run',
      options: { apply: true, olderThanMs: 90 * 60_000, limit: 5 },
    });
  });

  it('returns help without parsing the remaining arguments', () => {
    expect(parseRecoveryArgs(['--help', '--bogus'])).toEqual({ kind: 'help' });
  });

  it.each([
    [['--aply'], 'Unknown option: --aply'],
    [['--apply=false'], '--apply does not take a value.'],
    [['--limit'], '--limit must be an integer between 1 and 500.'],
    [['--limit', '0'], '--limit must be an integer between 1 and 500.'],
    [['--limit=501'], '--limit must be an integer between 1 and 500.'],
    [['--limit=1e2'], '--limit must be an integer between 1 and 500.'],
    [
      ['--older-than-minutes=-5'],
      '--older-than-minutes must be an integer between 1 and 525600.',
    ],
    [
      ['--older-than-minutes', '525601'],
      '--older-than-minutes must be an integer between 1 and 525600.',
    ],
  ])('rejects %j', (argv, message) => {
    expect(parseRecoveryArgs(argv)).toEqual({ kind: 'error', message });
  });
});
