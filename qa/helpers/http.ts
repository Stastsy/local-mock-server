/**
 * HTTP client for the acceptance suite: the global `fetch` and nothing else
 * (ARCHITECTURE section 4, rule 1 — no `inject`, no supertest).
 */

export interface Res {
  status: number;
  headers: Headers;
  /** Raw response body as text; empty string when the body had zero bytes. */
  text: string;
  /** Parsed body, or `undefined` when the body is empty or is not JSON. */
  json: unknown;
  /** Media type of `Content-Type`, lowercased, without parameters; `undefined` when absent. */
  mediaType: string | undefined;
  header(name: string): string | undefined;
}

export interface RequestOptions {
  method?: string;
  /** Raw body bytes. A string is sent as-is; pass `headers['content-type']` explicitly. */
  body?: string | Uint8Array;
  headers?: Record<string, string>;
}

/**
 * Issues one request. `path` is appended to the base URL verbatim so that trailing slashes,
 * doubled slashes and percent-encoded segments reach the server untouched.
 */
export async function request(baseUrl: string, path: string, options: RequestOptions = {}): Promise<Res> {
  const init: RequestInit = {
    method: options.method ?? 'GET',
    // A documented 3xx is a response to assert on, not one to follow.
    redirect: 'manual',
  };
  if (options.headers !== undefined) init.headers = options.headers;
  if (options.body !== undefined) init.body = options.body as BodyInit;

  const response = await fetch(`${baseUrl}${path}`, init);
  const text = await response.text();

  let json: unknown;
  try {
    json = text === '' ? undefined : JSON.parse(text);
  } catch {
    json = undefined;
  }

  const contentType = response.headers.get('content-type');

  return {
    status: response.status,
    headers: response.headers,
    text,
    json,
    mediaType: contentType === null ? undefined : (contentType.split(';')[0] ?? '').trim().toLowerCase(),
    header: (name: string) => response.headers.get(name) ?? undefined,
  };
}

/** Sends a JSON body with an explicit `Content-Type`. */
export function jsonBody(value: unknown): RequestOptions {
  return { body: JSON.stringify(value), headers: { 'content-type': 'application/json' } };
}

/** The parsed body of a mock error response, for assertions on `code` and `details`. */
export interface MockErrorBody {
  code?: unknown;
  message?: unknown;
  pointer?: unknown;
  details?: unknown;
}

export function errorBody(res: Res): MockErrorBody {
  return (res.json ?? {}) as MockErrorBody;
}

/**
 * The error `details` serialised for substring checks. Returns `''` rather than the string
 * `"undefined"` when there are no details, so a missing field fails the assertion instead of
 * throwing inside the test.
 */
export function detailsText(res: Res): string {
  const details = errorBody(res).details;
  return details === undefined ? '' : JSON.stringify(details);
}

/** Same, for any value — used for the `details` of a load-time rejection. */
export function serialise(value: unknown): string {
  return value === undefined ? '' : JSON.stringify(value);
}

/** Validation `details` entries, as REQ-026 prescribes their shape. */
export interface ViolationDetail {
  location?: unknown;
  name?: unknown;
  message?: unknown;
  schemaPath?: unknown;
  instancePath?: unknown;
}

export function violations(res: Res): ViolationDetail[] {
  const details = errorBody(res).details;
  return Array.isArray(details) ? (details as ViolationDetail[]) : [];
}
