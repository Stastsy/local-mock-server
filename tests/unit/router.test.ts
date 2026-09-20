/**
 * Route ordering is the one piece of routing whose failures are hard to read over HTTP: a wrong
 * order shows up as "the wrong operation answered", with no indication of which comparison went
 * wrong. These cases drive the table directly.
 */

import { describe, expect, it } from 'vitest';
import { Router, decodePathSegments } from '../../src/routing/router.js';
import type { OpenApiDocument } from '../../src/spec/types.js';

function documentOf(templates: Record<string, string[]>): OpenApiDocument {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const [template, methods] of Object.entries(templates)) {
    const item: Record<string, unknown> = {};
    for (const method of methods) item[method] = { responses: { '200': { description: 'ok' } } };
    paths[template] = item;
  }
  return { openapi: '3.0.3', paths } as OpenApiDocument;
}

function matchedTemplate(router: Router, path: string): string | undefined {
  return router.match(decodePathSegments(path))?.route.template;
}

describe('Router', () => {
  it('prefers a literal segment over a template segment', () => {
    const router = new Router(documentOf({ '/pets/{petId}': ['get'], '/pets/mine': ['get'] }), '');
    expect([matchedTemplate(router, '/pets/mine'), matchedTemplate(router, '/pets/7')]).toEqual([
      '/pets/mine',
      '/pets/{petId}',
    ]);
  });

  it('decides specificity at the first segment where two templates differ', () => {
    const router = new Router(
      documentOf({
        '/pets/{petId}/toys/{toyId}': ['get'],
        '/pets/mine/toys/{toyId}': ['get'],
        '/pets/{petId}/toys/first': ['get'],
      }),
      '',
    );
    // The second segment decides before the fourth one is ever considered.
    expect(matchedTemplate(router, '/pets/mine/toys/first')).toBe('/pets/mine/toys/{toyId}');
  });

  it('is independent of the order the templates appear in the document', () => {
    const forwards = new Router(documentOf({ '/a/mine': ['get'], '/a/{id}': ['get'] }), '');
    const backwards = new Router(documentOf({ '/a/{id}': ['get'], '/a/mine': ['get'] }), '');
    expect([matchedTemplate(forwards, '/a/mine'), matchedTemplate(backwards, '/a/mine')]).toEqual([
      '/a/mine',
      '/a/mine',
    ]);
  });

  it('matches a template segment against exactly one non-empty segment', () => {
    const router = new Router(documentOf({ '/pets/{petId}': ['get'] }), '');
    expect([
      matchedTemplate(router, '/pets/1'),
      matchedTemplate(router, '/pets/'),
      matchedTemplate(router, '/pets/1/toys'),
      matchedTemplate(router, '/pets'),
    ]).toEqual(['/pets/{petId}', undefined, undefined, undefined]);
  });

  it('treats a segment that is only partly a template as a literal', () => {
    const router = new Router(documentOf({ '/files/{name}.{ext}': ['get'] }), '');
    expect([
      matchedTemplate(router, '/files/report.txt'),
      matchedTemplate(router, '/files/{name}.{ext}'),
    ]).toEqual([undefined, '/files/{name}.{ext}']);
  });

  it('matches case-sensitively and treats a trailing slash as significant', () => {
    const router = new Router(documentOf({ '/pets': ['get'] }), '');
    expect([
      matchedTemplate(router, '/pets'),
      matchedTemplate(router, '/PETS'),
      matchedTemplate(router, '/pets/'),
    ]).toEqual(['/pets', undefined, undefined]);
  });

  it('prefixes every route with the base path, which is then not optional', () => {
    const router = new Router(documentOf({ '/pets': ['get'] }), '/v1');
    expect([
      matchedTemplate(router, '/v1/pets'),
      matchedTemplate(router, '/pets'),
      matchedTemplate(router, '/v1//pets'),
    ]).toEqual(['/pets', undefined, undefined]);
  });

  it('exposes the documented methods in document order for the Allow header', () => {
    const router = new Router(documentOf({ '/pets': ['post', 'get'] }), '');
    expect(router.match(decodePathSegments('/pets'))?.route.methodOrder).toEqual(['post', 'get']);
  });

  it('percent-decodes each path segment before matching', () => {
    const router = new Router(documentOf({ '/pets/{petId}': ['get'] }), '');
    expect(router.match(decodePathSegments('/pets/%31'))?.pathParams).toEqual({ petId: '1' });
  });

  it('keeps a segment verbatim when it is not valid percent-encoding', () => {
    expect(decodePathSegments('/pets/%zz')).toEqual(['pets', '%zz']);
  });
});

describe('parameter inheritance', () => {
  const document = {
    openapi: '3.0.3',
    paths: {
      '/items': {
        parameters: [{ name: 'filter', in: 'query', required: true, schema: { type: 'string' } }],
        get: { responses: { '200': { description: 'ok' } } },
        post: {
          parameters: [{ name: 'filter', in: 'query', required: false, schema: { type: 'string' } }],
          responses: { '201': { description: 'created' } },
        },
      },
    },
  } as unknown as OpenApiDocument;

  it('applies a path-item parameter to an operation that declares none', () => {
    const router = new Router(document, '');
    const operation = router.match(decodePathSegments('/items'))?.route.operations.get('get');
    expect(operation?.parameters).toEqual([
      { name: 'filter', in: 'query', required: true, schema: { type: 'string' } },
    ]);
  });

  it('lets an operation parameter with the same name and location replace the inherited one', () => {
    const router = new Router(document, '');
    const operation = router.match(decodePathSegments('/items'))?.route.operations.get('post');
    expect(operation?.parameters).toEqual([
      { name: 'filter', in: 'query', required: false, schema: { type: 'string' } },
    ]);
  });
});
