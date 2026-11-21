import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = join(__dirname, '..');
const readRepoFile = (name: string) =>
  readFileSync(join(repoRoot, name), 'utf8');

const PRIVATE_REPORT_URL =
  'https://github.com/VelaPayments/vela-server/security/advisories/new';

const REQUIRED_SECTIONS = [
  'Supported versions',
  'Reporting a vulnerability',
  'What to include',
  'What not to include',
  'Scope',
  'Testing guidelines',
  'Disclosure process',
];

// Credential shapes that must never appear in a published policy, not even as
// an "example" a reporter might copy.
const LEAK_PATTERNS: ReadonlyArray<[label: string, pattern: RegExp]> = [
  ['a Stellar secret seed', /\bS[A-Z2-7]{55}\b/],
  ['a JWT', /\beyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{10,}/],
  ['a PEM private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
];

/**
 * Lists the reasons a security policy would be unsafe or unusable for a
 * reporter. An empty result means the policy meets the published contract.
 */
function findSecurityPolicyProblems(policy: string): string[] {
  const problems: string[] = [];

  const headings = new Set(
    [...policy.matchAll(/^#{2,3} (.+)$/gm)].map(([, title]) => title.trim()),
  );
  for (const section of REQUIRED_SECTIONS) {
    if (!headings.has(section)) problems.push(`missing section: ${section}`);
  }

  if (!policy.includes(PRIVATE_REPORT_URL)) {
    problems.push('missing private vulnerability reporting link');
  }
  if (!/do not report security vulnerabilities through public/i.test(policy)) {
    problems.push('does not warn against public vulnerability reports');
  }
  // The fallback asks for a public issue, so it must forbid technical details
  // or it becomes a public disclosure channel.
  if (!/no technical details/i.test(policy)) {
    problems.push('public fallback does not forbid technical details');
  }
  if (!/stellar testnet only/i.test(policy)) {
    problems.push('does not state the testnet-only scope');
  }

  for (const [label, pattern] of LEAK_PATTERNS) {
    if (pattern.test(policy)) problems.push(`contains ${label}`);
  }

  return problems;
}

describe('Security policy', () => {
  const policy = readRepoFile('SECURITY.md');

  it('publishes a complete private reporting and disclosure process', () => {
    expect(findSecurityPolicyProblems(policy)).toEqual([]);
  });

  it.each(['README.md', 'CONTRIBUTING.md'])(
    'is linked from %s so contributors can find it',
    (file) => {
      expect(readRepoFile(file)).toMatch(/\]\((?:\.\/)?SECURITY\.md\)/);
    },
  );

  describe('policy checks', () => {
    it('rejects a policy that routes reports to public issues', () => {
      const publicOnly = policy
        .replaceAll(
          PRIVATE_REPORT_URL,
          'https://github.com/VelaPayments/vela-server/issues/new',
        )
        .replace(
          /\*\*Please do not report security vulnerabilities.*\r?\n/,
          '',
        );

      expect(findSecurityPolicyProblems(publicOnly)).toEqual([
        'missing private vulnerability reporting link',
        'does not warn against public vulnerability reports',
      ]);
    });

    it('rejects a public fallback that allows technical details', () => {
      const leakyFallback = policy.replace(
        /no technical details/i,
        'a short summary of the problem',
      );

      expect(findSecurityPolicyProblems(leakyFallback)).toEqual([
        'public fallback does not forbid technical details',
      ]);
    });

    it('rejects a policy without a disclosure timeline', () => {
      const withoutDisclosure = policy.replace(
        '## Disclosure process',
        '## Notes',
      );

      expect(findSecurityPolicyProblems(withoutDisclosure)).toEqual([
        'missing section: Disclosure process',
      ]);
    });

    it.each([
      ['a Stellar secret seed', `S${'A'.repeat(55)}`],
      [
        'a JWT',
        'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.c2lnbmF0dXJlLXBsYWNlaG9sZGVy',
      ],
    ])('rejects a policy that embeds %s', (label, sample) => {
      expect(
        findSecurityPolicyProblems(`${policy}\nExample: ${sample}\n`),
      ).toEqual([`contains ${label}`]);
    });
  });
});
