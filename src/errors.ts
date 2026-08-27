/**
 * Standard OAuth 2.0 error codes returned by the Globbook OAuth API.
 *
 * - `invalid_request` — a required field was missing or malformed in the request
 *   (e.g. a token exchange call missing `code`).
 * - `invalid_grant` — the `client_id` / `client_secret` / `code` combination was
 *   rejected (wrong secret, expired code, already-used code, etc.).
 * - `invalid_token` — the access token supplied to `/oauth/userinfo` is missing,
 *   malformed, or expired.
 * - `unsupported_media_type` — the request body was not sent as
 *   `application/x-www-form-urlencoded`. You should never see this from the SDK
 *   itself (it always sends the correct content type), but it's included in case
 *   a proxy or custom `fetch` implementation rewrites the request.
 * - `timeout` — the request did not complete within `requestTimeoutMs` (see
 *   {@link GlobbookAuthConfig.requestTimeoutMs}). Raised by this SDK, not the API.
 * - `network_error` — the request failed before reaching the API (DNS, TLS,
 *   connection refused). Raised by this SDK, not the API.
 */
export type GlobbookOAuthErrorCode =
  | 'invalid_request'
  | 'invalid_grant'
  | 'invalid_token'
  | 'unsupported_media_type'
  | 'timeout'
  | 'network_error'
  | (string & {});

/**
 * Thrown for every API-level failure raised by the Globbook OAuth endpoints
 * (token exchange, userinfo). Wraps the OAuth-standard `{ error,
 * error_description }` JSON body the backend returns on non-2xx responses.
 *
 * The SDK never lets a raw `fetch` `Response` or a generic `Error` escape from
 * an API call — every failure path (network error, non-JSON body, malformed
 * response, and genuine OAuth errors) is normalized into this type so calling
 * code has exactly one thing to catch.
 *
 * @example
 * ```ts
 * try {
 *   const token = await client.exchangeCodeForToken(code);
 * } catch (err) {
 *   if (err instanceof GlobbookAuthError) {
 *     console.error(err.code, err.description);
 *   }
 * }
 * ```
 */
export class GlobbookAuthError extends Error {
  /** The OAuth error code (e.g. `invalid_grant`). See {@link GlobbookOAuthErrorCode}. */
  public readonly code: GlobbookOAuthErrorCode;

  /** Human-readable description of the error, as returned by the API — safe to show in logs. */
  public readonly description: string;

  /** The HTTP status code of the response that produced this error, if known. */
  public readonly status?: number;

  constructor(code: GlobbookOAuthErrorCode, description: string, status?: number) {
    // The Error `message` intentionally mirrors `description` only — never include
    // request bodies/headers here, since callers sometimes let SDK errors bubble
    // into logs and we must never leak a client_secret or access_token that way.
    super(description || code);
    this.name = 'GlobbookAuthError';
    this.code = code;
    this.description = description;
    this.status = status;

    // Restore the prototype chain (needed when targeting ES5 downlevel output).
    Object.setPrototypeOf(this, GlobbookAuthError.prototype);
  }
}
