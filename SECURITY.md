# Security

This repository is public. ESS Robber Intel itself runs on the internet behind sign-in.

## Reporting a vulnerability

Report it privately. Do not open a public issue or pull request.

1. Use GitHub's private vulnerability reporting: the **Security** tab, then **Report a vulnerability**.
2. If that is unavailable, email petko.james@gmail.com with "ESS Robber Intel security" in the subject.

Include what you found, how to reproduce it, and what an attacker gains. You should get a reply within a week. Please give the owner time to fix it before you disclose it.

## In scope

- The server and web UI in `src/`: sign-in, sessions, Accounts and the Admin panel, and the API under `/api`.
- The container image built from `Dockerfile` and its deployment in `ops/home-server`, including the Tailscale Funnel that publishes it.
- The calibration job in `ops/calibration` and the scripts in `scripts/`.
- The CI workflow in `.github/workflows`.

Out of scope: EVE Online, CCP's ESI API, Tailscale, GitHub, and denial of service by sheer traffic volume.

## Security model

- **Sign-in.** Every `/api` route declares who may call it. Only `/api/health`, signing in and reading your own session are public. The figures need a signed-in Account that has replaced its temporary password. Account management needs an Admin. There is no self-registration: an Admin creates each Account, and a new Account must replace its temporary password at first sign-in. Weak and common passwords, and ones that hold the username, are refused.
- **Hashing.** Passwords are stored as salted scrypt hashes (N = 2^15, r = 8, p = 1) and compared in constant time. An unknown username is checked against a decoy hash, so response time does not reveal which usernames exist. A server-wide cap on concurrent hashing keeps a flood of sign-ins from exhausting the server.
- **Sessions.** A session is a 32-byte random token in an `HttpOnly`, `SameSite=Strict` cookie, sent `Secure` over HTTPS. The database holds only its SHA-256. A session ends 30 days after sign-in, or after 7 days unused. State-changing `/api` requests from another site's `Origin` are refused.
- **Headers.** Every response carries a strict Content-Security-Policy (`'self'` only, no inline script, `frame-ancestors 'none'`), `nosniff`, `no-referrer`, `X-Frame-Options: DENY` and same-origin opener and resource policies. HTTPS responses add HSTS. API responses are `no-store`.
- **Throttle.** After 10 failed sign-ins in 15 minutes for one username or one IP, further attempts are refused with 429 until the window clears.
- **Funnel.** The server publishes no port. A Tailscale container in front of it terminates HTTPS and is the only way in, so the home IP stays hidden and no client can forge `X-Forwarded-For`. The server trusts that one proxy and nothing past it.
- **Supply chain.** CI runs with a read-only token, and its actions and base images are pinned by digest. Dependabot proposes updates weekly. Merges to `main` need green checks.
