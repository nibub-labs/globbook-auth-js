/**
 * Configuration accepted by the {@link GlobbookAuth} constructor.
 */
export interface GlobbookAuthConfig {
  /**
   * Your app's client ID, issued when you register the app in the Globbook
   * developer console. Sent to Globbook as `client_id` on every request.
   */
  clientId: string;

  /**
   * Your app's client secret, issued alongside `clientId`.
   *
   * SECURITY: this value must only ever be used in server-side code. Never
   * construct a {@link GlobbookAuth} instance with a real `clientSecret` in
   * browser/client-side JavaScript — anyone who can read your frontend bundle
   * can read the secret. See the README's "Security" section.
   */
  clientSecret: string;

  /**
   * The URL Globbook redirects the user's browser back to after they approve
   * (or deny) the consent screen. Must exactly match the redirect URL
   * registered for this app in the Globbook developer console — the SDK does
   * not validate this against the console's configuration itself, the backend
   * does.
   */
  redirectUrl: string;

  /**
   * Base URL of the Globbook API. Defaults to `https://globbook.com`.
   * Override this to point at a staging/self-hosted environment.
   */
  baseUrl?: string;

  /**
   * Timeout in milliseconds applied to every HTTP request this client makes
   * (token exchange, userinfo). Defaults to 10000 (10s) so a slow or
   * unresponsive Globbook endpoint can't hang your request handler
   * indefinitely. Pass `0` to disable the timeout entirely.
   */
  requestTimeoutMs?: number;
}

/**
 * The result of exchanging an authorization code for an access token
 * (`POST /api/v2/oauth/token`), translated from the API's snake_case JSON
 * body into idiomatic camelCase.
 */
export interface TokenResponse {
  /** Opaque bearer token — pass this to {@link GlobbookAuth.getUserInfo}. */
  accessToken: string;

  /** Always `"Bearer"` for this API, but kept as a real field rather than assumed. */
  tokenType: string;

  /** Token lifetime in seconds from the moment it was issued (typically 3600). */
  expiresIn: number;
}

/**
 * The authenticated user's profile, as returned by
 * `GET /api/v2/oauth/userinfo`.
 *
 * The fields mirror the OIDC (`openid-connect`) convention (`sub`,
 * `preferred_username`, `given_name`, ...).
 */
export interface UserInfo {
  /** OIDC subject identifier — an MD5 hash. Stable per-user, but not the raw numeric Globbook user id. */
  sub: string;
  /** The user's @handle/username. */
  preferredUsername: string;
  /** Whether the user's profile is verified (blue-check equivalent). */
  profileVerified: boolean;
  email: string;
  /** First + last name joined by a space, or just one half if the other is empty. */
  name: string;
  givenName: string;
  familyName: string;
  /** May be an empty string if unset. */
  bio: string;
  /** Signed CDN URL, or `null` if the user has no avatar. */
  picture: string | null;
  /** Signed CDN URL, or `null` if the user has no cover image. */
  coverImage: string | null;
  /** May be an empty string if unset. */
  website: string;

  /**
   * Restricted claims. Each is `null` unless BOTH are true: your app is
   * verified in the Globbook Developer Console, and the user granted the
   * matching scope (`"birthdate"`, `"gender"`, `"phone"`, `"address"`) on
   * the consent screen — request scopes via
   * {@link GlobbookAuth.getAuthorizationUrl}'s `scopes` option. An
   * unverified app never receives these regardless of what's requested or
   * approved.
   */
  birthdate: string | null;
  gender: string | null;
  phoneNumber: string | null;
  /** `"city country"` — this platform stores no street-level address. */
  address: string | null;
}

/**
 * Restricted OIDC-style scopes you may request via
 * {@link GlobbookAuth.getAuthorizationUrl}'s `scopes` option. Requesting a
 * scope only has an effect if your app is verified in the Globbook
 * Developer Console — see the `UserInfo` restricted-claims doc comment.
 */
export type GlobbookScope = 'birthdate' | 'gender' | 'phone' | 'address';

/**
 * Result of {@link GlobbookAuth.parseCallbackParams} — the authorization code
 * extracted from the query string Globbook redirects the browser to after
 * consent.
 */
export interface CallbackParams {
  /**
   * The authorization code to pass to {@link GlobbookAuth.exchangeCodeForToken}.
   * `null` if `code` was not present in the URL.
   */
  code: string | null;

  /**
   * The CSRF-protection value Globbook echoed back, if you passed one to
   * {@link GlobbookAuth.getAuthorizationUrl}'s `state` option. `null` if you
   * didn't send one, or it wasn't present in the callback URL. If you sent
   * one, compare this against what you stored before redirecting and reject
   * the callback on a mismatch — see the README's "CSRF protection (state)"
   * section.
   */
  state: string | null;
}

/** @internal Raw shape of a successful `POST /api/v2/oauth/token` response. */
export interface RawTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

/** @internal Raw shape of a successful `GET/POST /api/v2/oauth/userinfo` response. */
export interface RawUserInfoResponse {
  sub: string;
  preferred_username: string;
  profile_verified: boolean;
  email: string;
  name: string;
  given_name: string;
  family_name: string;
  bio: string;
  picture: string | null;
  cover_image: string | null;
  website: string;
  birthdate?: string;
  gender?: string;
  phone_number?: string;
  address?: string;
}

/** @internal Raw shape of an OAuth-standard error response body. */
export interface RawOAuthErrorResponse {
  error: string;
  error_description: string;
}
