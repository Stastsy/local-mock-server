/**
 * Error model of the mock server.
 *
 * Every failure the mock server reports — whether it happens while loading the
 * specification or while answering a request — carries a stable machine-readable
 * `code`, a human-readable `message` and, where applicable, a `pointer` into the
 * specification so the user can find the offending construct.
 */

export type MockErrorCode =
  // Specification loading (fail-fast, before the server starts listening)
  | 'SPEC_NOT_FOUND'
  | 'SPEC_UNREADABLE'
  | 'SPEC_INVALID'
  | 'UNSUPPORTED_SPEC_VERSION'
  | 'UNSUPPORTED_CONSTRUCT'
  // Request handling
  | 'ROUTE_NOT_FOUND'
  | 'METHOD_NOT_ALLOWED'
  | 'REQUEST_VALIDATION_FAILED'
  | 'NO_RESPONSE_FOR_STATUS'
  | 'NO_SUPPORTED_MEDIA_TYPE'
  | 'EXAMPLE_NOT_FOUND'
  | 'INVALID_PREFER_HEADER'
  | 'GENERATION_FAILED'
  // Placeholder used by the bootstrap skeleton only
  | 'NOT_IMPLEMENTED';

export interface MockErrorBody {
  code: MockErrorCode;
  message: string;
  /** JSON pointer into the OpenAPI document, e.g. `#/paths/~1pets/get/responses/200`. */
  pointer?: string;
  /** Structured, code-specific detail (validation failures, candidate values, ...). */
  details?: unknown;
}

export class MockError extends Error {
  readonly code: MockErrorCode;
  readonly status: number;
  readonly pointer?: string;
  readonly details?: unknown;

  constructor(
    code: MockErrorCode,
    message: string,
    options: { status?: number; pointer?: string; details?: unknown; cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'MockError';
    this.code = code;
    this.status = options.status ?? 500;
    if (options.pointer !== undefined) this.pointer = options.pointer;
    if (options.details !== undefined) this.details = options.details;
  }

  toBody(): MockErrorBody {
    const body: MockErrorBody = { code: this.code, message: this.message };
    if (this.pointer !== undefined) body.pointer = this.pointer;
    if (this.details !== undefined) body.details = this.details;
    return body;
  }
}

/** Media type used for every error the mock server itself produces. */
export const MOCK_ERROR_MEDIA_TYPE = 'application/problem+json';
