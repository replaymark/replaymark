# Security Policy

## Supported versions

Only the latest 1.x release receives security fixes.

## Reporting a vulnerability

Please do not open a public issue. Use GitHub private vulnerability reporting: open the repository's **Security** tab and choose **Report a vulnerability**. Include the affected version, a description, reproduction steps and the impact. Never include real secrets in a report.

You can expect an acknowledgement within a few days and a fix or mitigation plan once the report is confirmed. Fixes are released as a new 1.x version and credited in the advisory unless you prefer otherwise.

## Scope

In scope:

- The public webhook listener (`POST /webhook` on port 8080): signature and timestamp verification, replay protection, request parsing.
- The admin listener (port 8081): authentication, sessions, roles and per-user data separation, the `/api/*` endpoints, the SSE stream, CSRF and cookie handling.
- Handling of secrets (Twitch credentials, webhook secret, SMTP credentials, password hashes) in configuration, logs and the database.
- The container image and the shipped compose files.

Out of scope:

- Exposing the admin listener (port 8081) to the public internet. It is designed for LAN/VPN access only.
- Issues that require a malicious operator or existing access to the host, the data directory or the `.env` file.
- Vulnerabilities in Twitch, your reverse proxy, your SMTP provider or other third-party software.
- Missing hardening of a deployment that deviates from the documented setup.
