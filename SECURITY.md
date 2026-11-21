# Security policy

Vela is an early open-source prototype that targets the **Stellar testnet only**. It is not ready for real funds, mainnet assets or production payment use. We still treat security reports seriously: the server handles authentication, passkey (WebAuthn) authorization and signed Stellar transactions, and flaws found now shape how the project is built.

## Supported versions

Only the latest commit on the `main` branch is supported. There are no tagged releases or long-term support branches yet, so fixes land on `main` and are not backported.

| Version         | Supported |
| --------------- | --------- |
| `main` (latest) | Yes       |
| Older commits   | No        |

## Reporting a vulnerability

**Please do not report security vulnerabilities through public GitHub issues, pull requests, discussions or Wave/Drips comments.**

Report privately through GitHub's private vulnerability reporting:

1. Open the [new security advisory form](https://github.com/VelaPayments/vela-server/security/advisories/new) (also reachable from the repository's **Security** tab via **Report a vulnerability**).
2. Describe the issue using the checklist below and submit. Only you and the repository maintainers can see the report.

If the form is unavailable (for example, private reporting has not been enabled yet), open a public issue titled **"Security contact request"** that contains **no technical details** — no affected endpoint, file, payload or reproduction steps. A maintainer will reply with a private channel for the full report.

For vulnerabilities in the Expo mobile client, use the same process in [VelaPayments/vela-payments](https://github.com/VelaPayments/vela-payments). If a problem spans both repositories, such as the `payment-request.v1` payload, passkey ceremonies or the payment-intent lifecycle, report it in either repository and say that it affects both; maintainers coordinate the fix across them.

### What to include

- The affected endpoint, module or file, and the commit SHA you tested.
- Step-by-step reproduction against a **local** instance or **Stellar testnet** accounts you control.
- The impact you observed or expect (for example, authorization bypass, replayed payment approval, cross-user data access, or a transaction built or submitted with values the user did not approve).
- Any suggested fix or mitigation, if you have one.

### What not to include

Do not send any of the following, even privately. Redact them or replace them with placeholders:

- Stellar secret seeds (`S...` keys), mnemonic phrases or any private key.
- Real JWTs, Supabase service role keys, database URLs or other credentials.
- Raw WebAuthn challenges, signed assertions or signed transaction XDR from real users.
- Personal data belonging to anyone other than yourself.

Testnet public keys and testnet transaction hashes are fine to share.

## Scope

In scope for this repository:

- Authentication and authorization: Supabase JWT handling, route guards and linked-wallet ownership checks.
- WebAuthn registration and payment-scoped authorization, including challenge expiry and replay protection.
- Payment-request validation and persistence (`payment-request.v1`).
- Payment-intent creation, signed-XDR validation, submission and confirmation polling.
- Transaction history exposure between payer and receiver.
- Rate limiting, input validation, error responses that leak sensitive data, and logging of credentials or signed payloads.
- Supply-chain or CI issues in this repository's workflows and scripts.

Out of scope:

- Vulnerabilities in the Stellar network, Horizon, Stellar RPC or `@stellar/stellar-sdk` itself. Report those to the Stellar Development Foundation through its own disclosure program. If such a flaw makes Vela exploitable in a way specific to this code, report that part here as well.
- Vulnerabilities in Supabase or other third-party services. Report those to the provider.
- Known prototype limitations already documented in the [README](README.md), such as the deferred passkey RP domain and app identifier migration.
- Findings that need mainnet funds, physical access to someone else's device, social engineering or phishing.
- Volumetric denial-of-service or load testing.
- Missing hardening headers or best-practice suggestions with no demonstrated impact. These are welcome as regular issues.

## Testing guidelines

While researching:

- Use only Stellar testnet accounts and a local or self-hosted instance of the server that you control.
- Do not access, modify or delete data that belongs to other users, and stop as soon as you confirm a flaw that exposes such data.
- Do not run automated scanners or load tests against any hosted Vela deployment or the public web preview.
- Do not publicly disclose the issue before the coordinated disclosure date described below.

We will not pursue or support legal action against researchers who follow this policy in good faith. Vela does not currently run a paid bug bounty.

## Disclosure process

Vela is maintained by volunteers, so the timelines below are targets rather than guarantees:

| Stage                       | Target                                                                     |
| --------------------------- | -------------------------------------------------------------------------- |
| Acknowledge the report      | Within 3 business days                                                     |
| Initial assessment          | Within 7 business days: confirmed, needs more information, or not a flaw   |
| Fix or mitigation on `main` | Depends on severity; we share an expected date once the issue is confirmed |
| Public disclosure           | After the fix lands, or 90 days after the report, whichever comes first    |

How a confirmed report is handled:

1. A maintainer acknowledges the report and keeps the discussion in the private advisory.
2. We confirm the issue, agree on severity with the reporter and, where useful, invite them to a temporary private fork to review the fix.
3. The fix is merged to `main`. Changes to shared payloads, authentication or the payment lifecycle are coordinated with [VelaPayments/vela-payments](https://github.com/VelaPayments/vela-payments) so neither side ships an incompatible fix.
4. We publish a GitHub security advisory describing the affected commits, impact and remediation, and request a CVE when the issue warrants one.
5. Reporters are credited in the advisory unless they ask to remain anonymous.

If a vulnerability is being actively exploited, we may disclose earlier and will tell the reporter before we do. If we need more time than the 90-day window, we will explain why and agree a new date with the reporter.
