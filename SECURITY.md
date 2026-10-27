# Security policy

## Supported versions

Vulnerabilities are fixed in the latest released version. Always update to the latest one
([docs/install/upgrading.md](docs/install/upgrading.md)).

## How to report a vulnerability

**Do not open a public issue.** Write to security@spiderjad.com (or use "Report a vulnerability" in the
GitHub Security tab) with:

- which component and version,
- how to reproduce it (steps or a minimal proof of concept),
- the impact you see (for example, access to another company's data).

We reply within 3 business days at most and keep you informed until it is fixed. We publish the
advisory with the fixed version and, if you wish, with your name in the acknowledgements.

## What we are especially interested in

- Access to another company's data (isolation between tenants) or to content without permission.
- Privilege escalation between roles or capabilities.
- Bypassing two-step verification or plugin license verification.
- Injection (SQL, XSS, templates), SSRF, and reading or writing files outside the storage.

Only test against your own installations, never against third-party servers.
