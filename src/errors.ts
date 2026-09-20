/**
 * Error model of the mock server.
 *
 * Every failure the mock server reports — whether it happens while loading the
 * specification or while answering a request — carries a stable machine-readable
 * `code`, a human-readable `message` and, where applicable, a `pointer` into the
 * specification so the user can find the offending construct.
 *
 * The code vocabulary below is normative: it is REQ-045's table, and nothing else.
 */

/** Codes that reject `createServer`. Their HTTP status is deliberately not part of the contract. */
export type LoadTimeErrorCode =
  | 'CONFIG_INVALID'
  | 'SPEC_NOT_FOUND'
  | 'SPEC_UNREADABLE'
  | 'UNSUPPORTED_SPEC_VERSION'
  | 'SPEC_INVALID'
  | 'SPEC_REF_UNRESOLVABLE'
  | 'UNSUPPORTED_CONSTRUCT';

/** Codes served as `application/problem+json` with `X-Mock-Source: mock`. */
export type RequestTimeErrorCode =
  | 'ROUTE_NOT_FOUND'
  | 'METHOD_NOT_ALLOWED'
  | 'MALFORMED_REQUEST_BODY'
  | 'UNSUPPORTED_REQUEST_MEDIA_TYPE'
  | 'REQUEST_VALIDATION_FAILED'
  | 'INVALID_PREFER_HEADER'
  | 'NO_RESPONSE_FOR_STATUS'
  | 'EXAMPLE_NOT_FOUND'
  | 'NO_SUPPORTED_MEDIA_TYPE'
  | 'GENERATION_FAILED';

export type MockErrorCode = LoadTimeErrorCode | RequestTimeErrorCode;

/** REQ-045, request-time table. The only statuses a mock error may ever use. */
export const REQUEST_TIME_STATUS: Readonly<Record<RequestTimeErrorCode, number>> = {
  ROUTE_NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  MALFORMED_REQUEST_BODY: 400,
  UNSUPPORTED_REQUEST_MEDIA_TYPE: 415,
  REQUEST_VALIDATION_FAILED: 422,
  INVALID_PREFER_HEADER: 400,
  NO_RESPONSE_FOR_STATUS: 400,
  EXAMPLE_NOT_FOUND: 400,
  NO_SUPPORTED_MEDIA_TYPE: 406,
  GENERATION_FAILED: 500,
};

function statusFor(code: MockErrorCode): number {
  const status = (REQUEST_TIME_STATUS as Record<string, number | undefined>)[code];
  // Load-time codes never reach HTTP; 500 is a placeholder no requirement may depend on (REQ-008).
  return status ?? 500;
}

export interface MockErrorBody {
  code: MockErrorCode;
  message: string;
  /** JSON pointer into the OpenAPI document, e.g. `#/paths/~1pets/get/responses/200`. */
  pointer?: string;
  /** Structured, code-specific detail (validation failures, candidate values, ...). */
  details?: unknown;
}

export interface MockErrorOptions {
  pointer?: string;
  details?: unknown;
  cause?: unknown;
}

export class MockError extends Error {
  readonly code: MockErrorCode;
  readonly status: number;
  readonly pointer?: string;
  readonly details?: unknown;

  constructor(code: MockErrorCode, message: string, options: MockErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'MockError';
    this.code = code;
    this.status = statusFor(code);
    if (options.pointer !== undefined) this.pointer = options.pointer;
    if (options.details !== undefined) this.details = options.details;
  }

  /** REQ-042: exactly these members, and no others. */
  toBody(): MockErrorBody {
    const body: MockErrorBody = { code: this.code, message: this.message };
    if (this.pointer !== undefined) body.pointer = this.pointer;
    if (this.details !== undefined) body.details = this.details;
    return body;
  }
}

/** Media type used for every error the mock server itself produces. */
export const MOCK_ERROR_MEDIA_TYPE = 'application/problem+json';
