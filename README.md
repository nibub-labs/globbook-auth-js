# @nibub-labs/globbook-auth

Official TypeScript SDK for **"Sign in with Globbook"** — a server-side OAuth 2.0
client for the authorization code flow: build the consent redirect, exchange
the returned code for an access token, and fetch the authenticated user's
profile.

- Zero runtime dependencies — built on the native `fetch` API, works in
  Node.js 18+, browsers, and edge runtimes.
- Ships both CJS and ESM builds with full TypeScript types.
- Every API failure is normalized into a single typed `GlobbookAuthError`.
- Fully typed, camelCase public API — the wire protocol's snake_case JSON
  never leaks into your code.

## Installation

```bash
npm install @nibub-labs/globbook-auth
```

## Quickstart

The example below is intentionally framework-agnostic (plain Node.js
`http`-style handlers) — the same three calls work identically in Express,
Fastify, Next.js route handlers, or any other server framework.

```ts
import { GlobbookAuth, GlobbookAuthError } from '@nibub-labs/globbook-auth';

const client = new GlobbookAuth({
  clientId: process.env.GLOBBOOK_CLIENT_ID!,
  clientSecret: process.env.GLOBBOOK_CLIENT_SECRET!,
  redirectUrl: 'https://yourapp.com/auth/globbook/callback',
  // baseUrl: 'https://staging.globbook.com', // optional, defaults to https://globbook.com
});

// --- Step 1: "Sign in with Globbook" button/link -------------------------
app.get('/auth/globbook', (req, res) => {
  res.redirect(client.getAuthorizationUrl());
});

// --- Step 2/3/4: handle the callback --------------------------------------
app.get('/auth/globbook/callback', async (req, res) => {
  const { code } = GlobbookAuth.parseCallbackParams(req.url);

  if (!code) {
    return res.status(400).send('Missing authorization code.');
  }

  try {
    const token = await client.exchangeCodeForToken(code);
    const user = await client.getUserInfo(token.accessToken);

    // `user.sub` is a stable per-user identifier — use it to find or create
    // a local account record.
    req.session.userId = user.sub;
    req.session.email = user.email;

    res.redirect('/dashboard');
  } catch (err) {
    if (err instanceof GlobbookAuthError) {
      console.error(`Globbook sign-in failed [${err.code}]: ${err.description}`);
      return res.status(400).send('Sign-in with Globbook failed. Please try again.');
    }
    throw err;
  }
});
```

## How the flow works

1. **Redirect** — your app sends the user's browser to the URL returned by
   `client.getAuthorizationUrl()`. Globbook shows its own hosted consent
   screen.
2. **Callback** — if the user approves, Globbook redirects the browser back to
   the exact `redirectUrl` your app was registered with in the Globbook
   developer console, appending `?code=...`.
3. **Token exchange** — your server exchanges that code for a short-lived
   access token by calling `client.exchangeCodeForToken(code)`.
4. **User info** — your server calls `client.getUserInfo(accessToken)` to
   fetch the user's profile.

App registration (choosing your `redirectUrl`, obtaining `clientId`/
`clientSecret`) happens once, manually, in the Globbook developer console —
this SDK does not provide an app-registration API.

## API Reference

### `new GlobbookAuth(config)`

Creates a client instance. **Validates synchronously** — throws immediately
if a required field is missing, rather than failing on the first API call.

| Field | Type | Required | Description |
|---|---|---|---|
| `clientId` | `string` | yes | Your app's client ID from the Globbook developer console. |
| `clientSecret` | `string` | yes | Your app's client secret. **Server-side only** — see [Security](#security). |
| `redirectUrl` | `string` | yes | Must exactly match the redirect URL registered for this app. |
| `baseUrl` | `string` | no | Defaults to `https://globbook.com`. Override for staging/self-hosted environments. |
| `requestTimeoutMs` | `number` | no | Defaults to `10000` (10s). Applied to every request; pass `0` to disable. |

```ts
const client = new GlobbookAuth({
  clientId: '...',
  clientSecret: '...',
  redirectUrl: 'https://yourapp.com/auth/globbook/callback',
});
```

---

### `client.getAuthorizationUrl(options?: { scopes?: GlobbookScope[]; state?: string }): string`

Builds the URL to redirect the user's browser to for the Globbook consent
screen. Makes no network request — it's a pure URL builder. Your app is
responsible for actually issuing the redirect.

```ts
const url = client.getAuthorizationUrl();
// => "https://globbook.com/api/v2/oauth/authorize?client_id=..."
res.redirect(url);
```

Pass `scopes` to also request restricted claims (see
[Restricted claims](#restricted-claims) below), and/or `state` for CSRF
protection (see [CSRF protection (state)](#csrf-protection-state) below):

```ts
const url = client.getAuthorizationUrl({ scopes: ['birthdate', 'gender'], state: csrfToken });
// => "https://globbook.com/api/v2/oauth/authorize?client_id=...&scope=birthdate+gender&state=..."
```

---

### `GlobbookAuth.parseCallbackParams(input: string): { code: string | null; state: string | null }`

**Static** helper. Framework-agnostic — accepts a full URL, a path+query
string, or a bare query string. Extracts the authorization code (and CSRF
state, if present) from the callback request.

```ts
const { code, state } = GlobbookAuth.parseCallbackParams(req.url);
// req.url can be "/callback?code=abc123", a full URL, or "code=abc123"
```

---

### `client.exchangeCodeForToken(code: string): Promise<TokenResponse>`

Exchanges an authorization code for an access token via
`POST /api/v2/oauth/token` (sent as `application/x-www-form-urlencoded` —
handled for you).

```ts
interface TokenResponse {
  accessToken: string;
  tokenType: string; // "Bearer"
  expiresIn: number; // seconds, typically 3600
}
```

```ts
const token = await client.exchangeCodeForToken(code);
```

Throws `GlobbookAuthError` with code `invalid_grant` if the code is
expired/already used or the credentials don't match, or `invalid_request` if
a required field is missing.

---

### `client.getUserInfo(accessToken: string): Promise<UserInfo>`

Fetches the authenticated user's profile via `GET /api/v2/oauth/userinfo`
with `Authorization: Bearer {accessToken}`.

```ts
interface UserInfo {
  sub: string;                 // OIDC subject identifier (MD5 hash, stable per-user)
  preferredUsername: string;
  profileVerified: boolean;
  email: string;
  name: string;                // "given family", or just one half if the other is empty
  givenName: string;
  familyName: string;
  bio: string;
  picture: string | null;      // signed CDN URL, or null
  coverImage: string | null;   // signed CDN URL, or null
  website: string;

  // Restricted claims — see "Restricted claims" below.
  birthdate: string | null;
  gender: string | null;
  phoneNumber: string | null;
  address: string | null;
}
```

```ts
const user = await client.getUserInfo(token.accessToken);
console.log(user.email, user.preferredUsername);
```

Throws `GlobbookAuthError` with code `invalid_token` if the access token is
missing, malformed, or expired.

### Restricted claims

`birthdate`, `gender`, `phoneNumber`, and `address` are gated separately from
the rest of the profile. Globbook only populates them — the field is `null`
otherwise — when **both** are true:

1. Your app has been verified in the Globbook Developer Console.
2. You requested the matching scope (`'birthdate'`, `'gender'`, `'phone'`,
   `'address'`) via `getAuthorizationUrl()`'s `scopes` argument, **and** the
   signed-in user granted it on the consent screen — requesting a scope is
   not the same as receiving it; the user can uncheck any scope
   individually.

An unverified app never receives these fields, regardless of what scopes it
requests or what the user approves. Always check for `null` before use.

### CSRF protection (state)

Pass `state` to `getAuthorizationUrl()` to protect against login CSRF (RFC
6749 §10.12): an attacker who obtains their own valid authorization code
could otherwise trick a victim's browser into completing the attacker's
login on the victim's session.

```ts
// Before redirecting — generate an unguessable value and store it
// (session, signed cookie) tied to the current browser session.
const csrfToken = crypto.randomUUID();
req.session.oauthState = csrfToken;

const url = client.getAuthorizationUrl({ state: csrfToken });
res.redirect(url);

// In your callback handler — compare before exchanging the code.
const { code, state } = GlobbookAuth.parseCallbackParams(req.url);
if (!code || state !== req.session.oauthState) {
  return res.status(400).send('Invalid or missing state — possible CSRF.');
}
```

`state` is entirely optional and Globbook never interprets it — it's
echoed back unchanged, per the RFC 6749 `state` parameter. Omitting it does
not change any other behavior; this is opt-in hardening, not a required
step.

## Error handling

Every API-level failure — a rejected token exchange, an invalid access token,
a network error, or a malformed response — is thrown as a single
`GlobbookAuthError`. You never need to catch a raw `fetch` error or inspect a
`Response` object yourself.

```ts
import { GlobbookAuthError } from '@nibub-labs/globbook-auth';

try {
  const token = await client.exchangeCodeForToken(code);
} catch (err) {
  if (err instanceof GlobbookAuthError) {
    // err.code        -> e.g. "invalid_grant"
    // err.description -> human-readable message from the API
    // err.status      -> HTTP status code, if known
    console.error(`OAuth error [${err.code}]: ${err.description}`);
  } else {
    throw err; // unexpected, non-API error — don't swallow it
  }
}
```

Common codes: `invalid_request` (missing/malformed field, HTTP 400),
`invalid_grant` (bad code/credentials, HTTP 401), `invalid_token` (bad access
token, HTTP 401), `timeout` (request exceeded `requestTimeoutMs`, raised by
the SDK), `network_error` (request failed before reaching the API, raised by
the SDK).

## Security

- **`clientSecret` must never be used in browser/client-side code.** Anyone
  who can read your frontend JavaScript bundle can read the secret and
  impersonate your app. Only construct `GlobbookAuth` inside server-side code
  (an API route, a backend service) — never in a component that ships to the
  browser.
- The SDK never logs `clientSecret` or `accessToken`, and never includes them
  in a thrown error's message or in `GlobbookAuthError`'s default output.
- This package has **zero runtime dependencies** by design, to minimize
  supply-chain attack surface for a library that handles secrets and tokens.

## Requirements

- Node.js 18+ (for native `fetch`), or any modern browser/edge runtime.
- TypeScript 5+ if you're consuming the type definitions directly (not
  required for plain JavaScript usage).

## License

MIT © Nibub — see [LICENSE](./LICENSE).
