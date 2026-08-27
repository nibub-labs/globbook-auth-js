import { GlobbookAuthError } from './errors';
import type {
  CallbackParams,
  GlobbookAuthConfig,
  GlobbookScope,
  RawOAuthErrorResponse,
  RawTokenResponse,
  RawUserInfoResponse,
  TokenResponse,
  UserInfo,
} from './types';

/** Default base URL used when {@link GlobbookAuthConfig.baseUrl} is not provided. */
const DEFAULT_BASE_URL = 'https://globbook.com';

/**
 * Default request timeout (milliseconds) used when
 * {@link GlobbookAuthConfig.requestTimeoutMs} is not provided. Applied to
 * every HTTP request this client makes so a slow or unresponsive Globbook
 * endpoint can't hang the caller indefinitely.
 */
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

/**
 * Server-side client for "Sign in with Globbook" OAuth 2.0.
 *
 * Typical flow:
 * 1. Build a redirect URL with {@link getAuthorizationUrl} and send the user's
 *    browser there.
 * 2. Globbook redirects back to your `redirectUrl` with `?code=...` — parse
 *    it with the static {@link parseCallbackParams}.
 * 3. Exchange that code for an access token with {@link exchangeCodeForToken}.
 * 4. Fetch the user's profile with {@link getUserInfo}.
 *
 * @example
 * ```ts
 * const client = new GlobbookAuth({
 *   clientId: process.env.GLOBBOOK_CLIENT_ID!,
 *   clientSecret: process.env.GLOBBOOK_CLIENT_SECRET!,
 *   redirectUrl: 'https://yourapp.com/auth/globbook/callback',
 * });
 *
 * // Step 1 — redirect the browser
 * res.redirect(client.getAuthorizationUrl());
 *
 * // Step 2/3/4 — in your callback route
 * const { code } = GlobbookAuth.parseCallbackParams(req.url);
 * const token = await client.exchangeCodeForToken(code!);
 * const user = await client.getUserInfo(token.accessToken);
 * ```
 *
 * SECURITY: only ever construct this class in server-side code. It requires
 * `clientSecret`, which must never be shipped to a browser bundle.
 */
export class GlobbookAuth {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly redirectUrl: string;
  private readonly baseUrl: string;
  private readonly requestTimeoutMs: number;

  /**
   * @param config - See {@link GlobbookAuthConfig}. `clientId`, `clientSecret`,
   *   and `redirectUrl` are all required and validated synchronously — the
   *   constructor throws immediately (not on first API call) if any is
   *   missing or empty, so misconfiguration fails fast at startup rather than
   *   on a user's first login attempt.
   * @throws {Error} if `clientId`, `clientSecret`, or `redirectUrl` is missing/empty.
   */
  constructor(config: GlobbookAuthConfig) {
    if (!config || typeof config !== 'object') {
      throw new Error('GlobbookAuth: a configuration object is required.');
    }

    assertNonEmptyString(config.clientId, 'clientId');
    assertNonEmptyString(config.clientSecret, 'clientSecret');
    assertNonEmptyString(config.redirectUrl, 'redirectUrl');

    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
    this.redirectUrl = config.redirectUrl;
    this.baseUrl = normalizeBaseUrl(config.baseUrl ?? DEFAULT_BASE_URL);
    this.requestTimeoutMs = config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  }

  /**
   * @internal Builds the AbortSignal to attach to a request, honoring
   * `requestTimeoutMs` (0 disables the timeout).
   */
  private timeoutSignal(): AbortSignal | undefined {
    return this.requestTimeoutMs > 0 ? AbortSignal.timeout(this.requestTimeoutMs) : undefined;
  }

  /**
   * Builds the URL to redirect the user's browser to for the Globbook-hosted
   * consent screen. This does not make a network request — the SDK's role
   * here is purely to construct the correct URL; your application is
   * responsible for actually redirecting the browser (e.g.
   * `res.redirect(url)` in Express, or `Response.redirect(url)` on the edge).
   *
   * After the user approves, Globbook redirects back to the `redirectUrl`
   * this client was configured with, appending `?code=...`.
   *
   * @param options.scopes - Restricted scopes to request in addition to the
   *   base profile (`"birthdate"`, `"gender"`, `"phone"`, `"address"`) — see
   *   {@link GlobbookScope}. Rendered as a space-delimited `scope` query
   *   parameter. Requesting a scope only has an effect if this app is
   *   verified in the Globbook Developer Console — Globbook's consent
   *   screen never offers restricted scopes to an unverified app, and
   *   {@link getUserInfo} never returns them either way unless the user
   *   actually grants them at consent time. Omit for the base profile only.
   * @param options.state - An opaque value you generate before redirecting
   *   the user here — Globbook echoes it back unchanged in the `state`
   *   query parameter on the redirect to your `redirectUrl`, so
   *   {@link parseCallbackParams} can hand it back to you to compare
   *   against what you stored before the redirect (RFC 6749 §10.12 CSRF
   *   protection). Globbook never interprets this value itself. Optional;
   *   omit to skip CSRF protection.
   * @returns The full authorization URL, e.g.
   *   `https://globbook.com/api/v2/oauth/authorize?client_id=...`.
   */
  getAuthorizationUrl(options?: { scopes?: GlobbookScope[]; state?: string }): string {
    const url = new URL('/api/v2/oauth/authorize', this.baseUrl);
    url.searchParams.set('client_id', this.clientId);
    if (options?.scopes && options.scopes.length > 0) {
      url.searchParams.set('scope', options.scopes.join(' '));
    }
    if (options?.state) {
      url.searchParams.set('state', options.state);
    }
    return url.toString();
  }

  /**
   * Parses the `code` (and `state`, if present) query parameters out of the
   * callback request your app receives after the user approves consent.
   * Framework-agnostic — accepts any full URL, path+query string, or bare
   * query string, so it works the same whether you pass `req.url` from
   * Express, `request.url` from a Fetch API `Request`, or
   * `window.location.href`.
   *
   * @param input - A full URL, a path with query string, or a bare query
   *   string (with or without a leading `?`).
   * @returns `{ code, state }` — both are `null` if not present. If you
   *   passed `state` to {@link getAuthorizationUrl}, compare the returned
   *   `state` against what you stored before redirecting and reject the
   *   callback on a mismatch — see the README's "CSRF protection (state)"
   *   section.
   *
   * @example
   * ```ts
   * // Express
   * const { code, state } = GlobbookAuth.parseCallbackParams(req.url);
   *
   * // Fetch API / edge runtimes
   * const { code, state } = GlobbookAuth.parseCallbackParams(request.url);
   * ```
   */
  static parseCallbackParams(input: string): CallbackParams {
    const searchParams = extractSearchParams(input);
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    return { code, state };
  }

  /**
   * Exchanges an authorization code (from {@link parseCallbackParams}) for an
   * access token via `POST /api/v2/oauth/token`.
   *
   * Sent as `application/x-www-form-urlencoded` — the Globbook API rejects
   * JSON bodies on this endpoint with a 415. This is handled for you; you
   * never need to set content type or encode the body yourself.
   *
   * @param code - The code value received in the OAuth callback.
   * @returns The issued access token. See {@link TokenResponse}.
   * @throws {GlobbookAuthError} if `code` is empty, or the API rejects the
   *   request (e.g. `invalid_grant` for an expired/already-used code).
   */
  async exchangeCodeForToken(code: string): Promise<TokenResponse> {
    if (!code || typeof code !== 'string') {
      throw new GlobbookAuthError(
        'invalid_request',
        'exchangeCodeForToken: "code" is required and must be a non-empty string.',
      );
    }

    const body = new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      code,
    });

    const raw = await this.post<RawTokenResponse>('/api/v2/oauth/token', body);

    return {
      accessToken: raw.access_token,
      tokenType: raw.token_type,
      expiresIn: raw.expires_in,
    };
  }

  /**
   * Fetches the authenticated user's profile via
   * `GET /api/v2/oauth/userinfo` using `Authorization: Bearer {accessToken}`.
   *
   * @param accessToken - The access token from {@link exchangeCodeForToken}.
   * @returns The user's profile. See {@link UserInfo}.
   * @throws {GlobbookAuthError} if `accessToken` is empty, or the API rejects
   *   it (`invalid_token` — missing, malformed, or expired).
   */
  async getUserInfo(accessToken: string): Promise<UserInfo> {
    if (!accessToken || typeof accessToken !== 'string') {
      throw new GlobbookAuthError(
        'invalid_request',
        'getUserInfo: "accessToken" is required and must be a non-empty string.',
      );
    }

    const url = new URL('/api/v2/oauth/userinfo', this.baseUrl);

    let response: Response;
    try {
      response = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
        signal: this.timeoutSignal(),
      });
    } catch (cause) {
      throw networkError(cause);
    }

    const raw = await parseJsonOrThrow<RawUserInfoResponse>(response);
    return mapUserInfo(raw);
  }

  /**
   * Internal helper: POSTs a `URLSearchParams` body as
   * `application/x-www-form-urlencoded` and returns the parsed JSON on
   * success, throwing {@link GlobbookAuthError} on any failure.
   */
  private async post<T>(path: string, body: URLSearchParams): Promise<T> {
    const url = new URL(path, this.baseUrl);

    let response: Response;
    try {
      response = await fetch(url.toString(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: body.toString(),
        signal: this.timeoutSignal(),
      });
    } catch (cause) {
      throw networkError(cause);
    }

    return parseJsonOrThrow<T>(response);
  }
}

/** @internal */
function assertNonEmptyString(value: unknown, name: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`GlobbookAuth: "${name}" is required and must be a non-empty string.`);
  }
}

/** @internal Strips a trailing slash so `new URL(path, baseUrl)` never double-slashes. */
function normalizeBaseUrl(baseUrl: string): string {
  assertNonEmptyString(baseUrl, 'baseUrl');
  return baseUrl.replace(/\/+$/, '');
}

/**
 * @internal
 * Accepts a full URL, a path+query string, or a bare query string (with or
 * without a leading `?`) and returns its `URLSearchParams`. Extracts
 * everything from the first `?` onward when present (works for full URLs and
 * path+query alike via the standard `URL` class against a dummy base);
 * otherwise falls back to treating the whole input as a query string, which
 * covers the "bare query string with no leading `?`" case.
 */
function extractSearchParams(input: string): URLSearchParams {
  if (!input) {
    return new URLSearchParams();
  }

  const queryIndex = input.indexOf('?');
  if (queryIndex !== -1) {
    return new URLSearchParams(input.slice(queryIndex + 1));
  }

  try {
    const url = new URL(input, 'http://localhost');
    if (url.search) {
      return url.searchParams;
    }
  } catch {
    // Not a parseable URL — fall through to bare-query-string handling below.
  }

  // No "?" found and not a full URL with its own query — treat the entire
  // input as a bare query string (e.g. "code=abc123").
  return new URLSearchParams(input);
}

/** @internal Wraps a network-level failure (fetch throwing) into a GlobbookAuthError. */
function networkError(cause: unknown): GlobbookAuthError {
  if (cause instanceof Error && (cause.name === 'TimeoutError' || cause.name === 'AbortError')) {
    return new GlobbookAuthError(
      'timeout',
      'Request to Globbook timed out. Increase requestTimeoutMs in GlobbookAuthConfig if this endpoint is expected to be slow.',
    );
  }
  const message = cause instanceof Error ? cause.message : 'Unknown network error';
  return new GlobbookAuthError('network_error', `Request to Globbook failed: ${message}`);
}

/**
 * @internal
 * Parses a fetch `Response` as JSON, throwing a {@link GlobbookAuthError} for
 * any non-2xx status (using the OAuth-standard `{ error, error_description }`
 * body when present) or for a response that isn't valid JSON at all.
 */
async function parseJsonOrThrow<T>(response: Response): Promise<T> {
  let json: unknown;
  try {
    json = await response.json();
  } catch {
    if (response.ok) {
      throw new GlobbookAuthError(
        'invalid_response',
        'Globbook API returned a non-JSON response.',
        response.status,
      );
    }
    throw new GlobbookAuthError(
      'invalid_response',
      `Globbook API returned a non-JSON error response (HTTP ${response.status}).`,
      response.status,
    );
  }

  if (!response.ok) {
    const errorBody = json as Partial<RawOAuthErrorResponse>;
    throw new GlobbookAuthError(
      errorBody?.error ?? 'unknown_error',
      errorBody?.error_description ?? `Globbook API request failed with HTTP ${response.status}.`,
      response.status,
    );
  }

  return json as T;
}

/** @internal Translates a raw userinfo response into the public {@link UserInfo} shape. */
function mapUserInfo(raw: RawUserInfoResponse): UserInfo {
  return {
    sub: raw.sub,
    preferredUsername: raw.preferred_username,
    profileVerified: raw.profile_verified,
    email: raw.email,
    name: raw.name,
    givenName: raw.given_name,
    familyName: raw.family_name,
    bio: raw.bio,
    picture: raw.picture,
    coverImage: raw.cover_image,
    website: raw.website,
    // Restricted claims are omitted from the JSON entirely (not sent as
    // empty strings) unless the app is verified and the user granted the
    // matching scope — normalize the missing key to null rather than
    // `undefined` so callers get a consistent, always-present field to
    // check.
    birthdate: raw.birthdate ?? null,
    gender: raw.gender ?? null,
    phoneNumber: raw.phone_number ?? null,
    address: raw.address ?? null,
  };
}
