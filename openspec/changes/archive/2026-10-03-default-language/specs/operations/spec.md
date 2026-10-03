# Spec Delta

## MODIFIED Requirements

### Requirement: Validated environment
All environment variables from the brief SHALL be validated at startup; invalid or missing required values SHALL print a clear message naming the variable (never its secret value) and exit non-zero. `SMTP_SECURITY` SHALL map `starttls`→STARTTLS required, `ssl`→implicit TLS, `none`→no TLS. `DEFAULT_LANGUAGE` SHALL accept `en` or `de` and default to `en`. `.env.example` SHALL document every variable.

#### Scenario: Short webhook secret
- **WHEN** `TWITCH_WEBHOOK_SECRET` has 5 characters
- **THEN** startup fails with a message naming `TWITCH_WEBHOOK_SECRET`

#### Scenario: Invalid default language
- **WHEN** `DEFAULT_LANGUAGE` is `fr`
- **THEN** startup fails with a message naming `DEFAULT_LANGUAGE`
