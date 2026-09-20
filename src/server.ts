/**
 * Public contract of the mock server.
 *
 * These three entry points — `createServer`, `start`, `stop` — are the ONLY surface the acceptance
 * test suite is allowed to depend on. Everything else (HTTP framework, routing, validation, data
 * generation) is an implementation detail and may be replaced without touching a single acceptance
 * test.
 *
 * `createServer` loads, validates and analyses the specification; `start` only binds the socket
 * (ARCHITECTURE §3, REQ-007).
 */

import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { resolveConfig, type MockServerConfig, type ResolvedConfig } from './config.js';
import { MockError, MOCK_ERROR_MEDIA_TYPE } from './errors.js';
import { generate } from './response/generator.js';
import { parsePrefer, type Preferences } from './response/prefer.js';
import { effectiveSeed, normaliseQuery } from './response/seed.js';
import { selectPayload, selectResponse } from './response/selector.js';
import { Router, decodePathSegments, type RouteOperation } from './routing/router.js';
import { loadSpec } from './spec/loader.js';
import { isHttpMethod } from './spec/types.js';
import { validateRequest, type RequestViolation } from './validation/request-validator.js';

export type { MockServerConfig } from './config.js';

export interface ServerAddress {
  /** Base URL the server is reachable at, e.g. `http://127.0.0.1:4010`. */
  url: string;
  host: string;
  port: number;
}

export interface MockServer {
  /** Binds the port. Resolves with the address actually bound (relevant when port is 0). */
  start(): Promise<ServerAddress>;
  /** Closes the server. Safe to call when not started. */
  stop(): Promise<void>;
  /** Address the server is bound to, or `undefined` while it is not listening. */
  readonly address: ServerAddress | undefined;
}

/**
 * Loads and prepares a mock server for the given specification.
 *
 * Fails fast: an invalid configuration or an unreadable, invalid or unsupported specification
 * rejects here, before any port is bound, with a {@link MockError} carrying a stable code.
 */
export async function createServer(config: MockServerConfig): Promise<MockServer> {
  const resolved = resolveConfig(config);
  const { document, basePath } = await loadSpec(resolved.specPath);
  const router = new Router(document, basePath);

  const app = buildApp(resolved, router);

  let address: ServerAddress | undefined;
  let closed = false;

  return {
    get address(): ServerAddress | undefined {
      return address;
    },

    async start(): Promise<ServerAddress> {
      await app.listen({ port: resolved.port, host: resolved.host });
      const bound = app.server.address();
      if (bound === null || typeof bound === 'string') {
        throw new Error('The server did not report a TCP address after listening.');
      }
      address = { url: `http://${resolved.host}:${bound.port}`, host: resolved.host, port: bound.port };
      return address;
    },

    async stop(): Promise<void> {
      address = undefined;
      if (closed) return;
      closed = true;
      await app.close();
    },
  };
}

function buildApp(config: ResolvedConfig, router: Router): FastifyInstance {
  const app = Fastify({
    logger: config.logLevel === 'silent' ? false : { level: config.logLevel },
    // Routing is decided by the specification, not by the framework (REQ-014 .. REQ-018).
    exposeHeadRoutes: false,
  });

  // The body is validated against the documented schema, so the server needs the bytes, not a
  // framework-parsed value: `MALFORMED_REQUEST_BODY` is ours to report (REQ-024).
  app.removeAllContentTypeParsers();
  app.addContentTypeParser('*', { parseAs: 'buffer' }, (_request, body, done) => {
    done(null, body);
  });

  const handler = (request: FastifyRequest, reply: FastifyReply): void => {
    handleRequest(config, router, request, reply);
  };

  app.all('/', handler);
  app.all('/*', handler);
  app.setNotFoundHandler(handler);
  app.setErrorHandler((error, _request, reply) => {
    sendMockError(reply, asMockError(error));
  });

  // REQ-032: a response with no content sends zero bytes and no Content-Type at all.
  app.addHook('onSend', (_request, reply, payload, done) => {
    if (reply.getHeader('x-mock-payload') === 'none') reply.removeHeader('content-type');
    done(null, payload);
  });

  return app;
}

function handleRequest(
  config: ResolvedConfig,
  router: Router,
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  try {
    respond(config, router, request, reply);
  } catch (error: unknown) {
    sendMockError(reply, asMockError(error));
  }
}

function respond(
  config: ResolvedConfig,
  router: Router,
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  const [rawPath = '/', rawQuery = ''] = splitUrl(request.url);
  const query = new URLSearchParams(rawQuery);
  const decodedPath = decodePathSegments(rawPath);

  const match = router.match(decodedPath);
  if (match === undefined) {
    throw new MockError('ROUTE_NOT_FOUND', `No operation is documented for ${request.method} ${rawPath}.`);
  }

  const method = request.method.toLowerCase();
  const target = isHttpMethod(method) ? match.route.operations.get(method) : undefined;
  if (target === undefined) {
    const allow = match.route.methodOrder.map((documented) => documented.toUpperCase()).join(', ');
    reply.header('allow', allow);
    throw new MockError(
      'METHOD_NOT_ALLOWED',
      `The path "${match.route.template}" documents no ${request.method} operation.`,
      { details: { allow: match.route.methodOrder.map((documented) => documented.toUpperCase()) } },
    );
  }

  const violations = validateRequest(target, {
    pathParams: match.pathParams,
    query,
    headers: request.headers,
    body: Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0),
    contentType: typeof request.headers['content-type'] === 'string'
      ? request.headers['content-type']
      : undefined,
  });
  if (violations.length > 0) throw validationError(target, violations);

  // REQ-035: the control channel is read only once the request itself is known to be valid.
  const preferences = parsePrefer(request.headers['prefer']);

  const selection = selectResponse(target, preferences);
  const plan = selectPayload(selection, preferences);

  reply.header('x-mock-source', 'specification');
  reply.header('x-mock-payload', plan.kind);
  applyPreferenceApplied(reply, preferences);
  if (target.operation.deprecated === true) reply.header('deprecation', 'true');

  if (plan.kind === 'none') {
    reply.code(selection.status).send();
    return;
  }

  const mediaType = selection.mediaType ?? 'application/json';
  let payload: unknown;

  if (plan.kind === 'example') {
    payload = plan.value;
  } else {
    const seed = effectiveSeed({
      seed: config.seed,
      method: request.method,
      path: `/${decodedPath.join('/')}`,
      query: normaliseQuery(query),
      status: selection.status,
      mediaType,
    });
    reply.header('x-mock-seed', String(seed));
    payload = generate(plan.schema ?? {}, seed, plan.pointer);
  }

  reply
    .code(selection.status)
    .header('content-type', mediaType)
    .send(Buffer.from(JSON.stringify(payload) ?? 'null', 'utf8'));
}

/** REQ-036: only the directives the server acted on, in the order `code`, `example`. */
function applyPreferenceApplied(reply: FastifyReply, preferences: Preferences): void {
  const applied: string[] = [];
  if (preferences.code !== undefined) applied.push(`code=${preferences.code}`);
  if (preferences.example !== undefined) applied.push(`example=${preferences.example}`);
  if (applied.length > 0) reply.header('preference-applied', applied.join(', '));
}

function validationError(target: RouteOperation, violations: RequestViolation[]): MockError {
  return new MockError(
    'REQUEST_VALIDATION_FAILED',
    `The request does not match the specification: ${violations.length} violation(s).`,
    { pointer: target.pointer, details: violations },
  );
}

function splitUrl(url: string): [string, string] {
  const separator = url.indexOf('?');
  return separator === -1 ? [url, ''] : [url.slice(0, separator), url.slice(separator + 1)];
}

function asMockError(error: unknown): MockError {
  if (error instanceof MockError) return error;
  return new MockError(
    'GENERATION_FAILED',
    error instanceof Error ? error.message : String(error),
    { cause: error },
  );
}

/** REQ-042 / REQ-043 / REQ-044: a mock error declares its origin and carries no payload headers. */
function sendMockError(reply: FastifyReply, error: MockError): void {
  reply.removeHeader('x-mock-payload');
  reply.removeHeader('x-mock-seed');
  reply.removeHeader('preference-applied');
  reply.removeHeader('deprecation');
  reply
    .code(error.status)
    .header('x-mock-source', 'mock')
    .header('content-type', MOCK_ERROR_MEDIA_TYPE)
    .send(Buffer.from(JSON.stringify(error.toBody()), 'utf8'));
}
