# Changelog

## 1.1.0

- **Fixed**: `UserInfo.birthdate` and `UserInfo.gender` are now `string | null` instead of
  `string`. Globbook's `/api/v2/oauth/userinfo` omits these fields entirely (not as empty
  strings) unless your app is verified in the Globbook Developer Console and the user granted the
  matching scope at consent time. If you compared either field to `''`, switch to a `null` check
  instead.
- **Added**: `UserInfo.phoneNumber` and `UserInfo.address` (`string | null`) — restricted claims
  that were previously unreachable through this SDK entirely.
- **Changed**: `getAuthorizationUrl()` now takes a single options object
  (`{ scopes?, state? }`) instead of a bare scopes array — this ships alongside the new `state`
  support below rather than as a separate later change.
- **Added**: `getAuthorizationUrl({ scopes })` requests restricted claims (`'birthdate' |
  'gender' | 'phone' | 'address'`) — previously there was no way to request these scopes at all, so
  `getUserInfo` could never have returned them regardless of app verification status.
- **Added**: `getAuthorizationUrl({ state })` / `CallbackParams.state` — optional CSRF protection
  (RFC 6749 §10.12). Generate an unguessable value, pass it as `state`, and compare
  `parseCallbackParams()`'s returned `state` against it in your callback handler before exchanging
  the code. Entirely opt-in; omitting it changes no other behavior. See the README's "CSRF
  protection (state)" section.

## 1.0.1 - Republish

No functional changes — version bump to publish the package to npm.

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
