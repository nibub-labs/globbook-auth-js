# Changelog

## 1.0.0 - Initial release

Initial release of `@nibub-labs/globbook-auth`, the official TypeScript SDK for "Sign in with Globbook."

- `GlobbookAuth` client class covering the full OAuth 2.0 authorization code flow:
  - `getAuthorizationUrl()` — builds the Globbook-hosted consent screen redirect URL.
  - `GlobbookAuth.parseCallbackParams(url)` — framework-agnostic parsing of the
    `code` callback query parameter.
  - `exchangeCodeForToken(code)` — exchanges an authorization code for an access
    token via `POST /api/v2/oauth/token` (`application/x-www-form-urlencoded`).
  - `getUserInfo(accessToken)` — fetches the authenticated user's profile via
    `GET /api/v2/oauth/userinfo`, returning the OIDC-style fields.
- `GlobbookAuthError` — typed error class carrying the OAuth `error` code and
  `error_description` for every API-level failure.
- Fail-fast constructor validation of `clientId`/`clientSecret`/`redirectUrl`.
- Zero runtime dependencies; built on the native `fetch` API for both Node.js
  (18+) and browser/edge runtimes.
- Dual CJS/ESM build output with full TypeScript type definitions.
