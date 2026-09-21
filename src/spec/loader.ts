/**
 * Loading: read, gate on the version, analyse `$ref`, validate, dereference, check capabilities.
 *
 * The order of those steps is normative, not incidental. REQ-003 requires the version gate to fire
 * before validation and before capability checking, so a 3.1 document is never reported as
 * `SPEC_INVALID`; REQ-005 requires a dangling `$ref` to be its own code rather than a validation
 * failure. Everything here happens before a port is bound (REQ-007).
 */

import { stat } from 'node:fs/promises';
import SwaggerParser from '@apidevtools/swagger-parser';
import { MockError } from '../errors.js';
import { deriveBasePath } from './base-path.js';
import { checkCapabilities, type ConstructViolation } from './capabilities.js';
import { pointerOf } from './pointer.js';
import { analyseRefs, dereference } from './refs.js';
import { isRecord, type OpenApiDocument } from './types.js';

export interface LoadedSpec {
  /** The document with every internal `$ref` inlined. */
  document: OpenApiDocument;
  /** REQ-018: prefixed to every route. Empty when the document contributes none. */
  basePath: string;
}

const SUPPORTED_VERSION = /^3\.0\.\d+$/;

/**
 * Only the YAML parser is enabled: JSON is valid YAML, and the alternative — letting the parser
 * choose by file extension — would read `petstore-as-json.txt` as plain text (REQ-002 requires the
 * format to be detected from the contents, not the extension).
 */
const PARSE_OPTIONS = { parse: { json: false, text: false, binary: false } } as const;

export async function loadSpec(specPath: string): Promise<LoadedSpec> {
  const raw = await readDocument(specPath);
  assertSupportedVersion(raw);

  const { violations, unresolvable } = analyseRefs(raw);
  if (unresolvable !== undefined) {
    throw new MockError(
      'SPEC_REF_UNRESOLVABLE',
      `The reference "${unresolvable.target}" cannot be resolved within the document.`,
      { pointer: unresolvable.pointer },
    );
  }
  if (violations.length > 0) throw unsupportedConstruct(violations);

  await validateDocument(raw, specPath);

  const document = dereference(raw) as OpenApiDocument;
  assertDistinctTemplates(document);

  const constructs = checkCapabilities(document);
  if (constructs.length > 0) throw unsupportedConstruct(constructs);

  return { document, basePath: deriveBasePath(document.servers) };
}

async function readDocument(specPath: string): Promise<OpenApiDocument> {
  let isFile: boolean;
  try {
    isFile = (await stat(specPath)).isFile();
  } catch (error: unknown) {
    throw new MockError('SPEC_NOT_FOUND', `No specification file at "${specPath}".`, {
      cause: error,
    });
  }
  if (!isFile) {
    throw new MockError('SPEC_UNREADABLE', `"${specPath}" is not a readable file.`);
  }

  let parsed: unknown;
  try {
    parsed = await SwaggerParser.parse(specPath, PARSE_OPTIONS);
  } catch (error: unknown) {
    // The reader distinguishes two failures that look alike from the outside. A `SyntaxError` here
    // means the bytes parsed but the document declares no version the parser recognises, which is
    // REQ-003's concern; anything else means the bytes themselves could not be read (REQ-001).
    if (error instanceof SyntaxError) {
      const detected = detectedVersionIn(messageOf(error));
      throw new MockError(
        'UNSUPPORTED_SPEC_VERSION',
        `Only OpenAPI 3.0.x is supported; the document declares ${detected}.`,
        { details: { detectedVersion: detected }, cause: error },
      );
    }
    throw new MockError(
      'SPEC_UNREADABLE',
      `"${specPath}" is neither well-formed YAML nor well-formed JSON: ${messageOf(error)}`,
      { cause: error },
    );
  }

  if (!isRecord(parsed)) {
    throw new MockError('SPEC_UNREADABLE', `"${specPath}" does not contain an OpenAPI document.`);
  }
  return parsed as OpenApiDocument;
}

/** REQ-003 — the gate that runs before everything else. */
function assertSupportedVersion(document: OpenApiDocument): void {
  const openapi = document['openapi'];
  const swagger = document['swagger'];

  if (typeof openapi === 'string' && SUPPORTED_VERSION.test(openapi)) return;

  const detected =
    openapi !== undefined ? String(openapi) : swagger !== undefined ? String(swagger) : 'none';

  throw new MockError(
    'UNSUPPORTED_SPEC_VERSION',
    `Only OpenAPI 3.0.x is supported; the document declares ${detected}.`,
    { details: { detectedVersion: detected } },
  );
}

function detectedVersionIn(message: string): string {
  return /Unsupported OpenAPI version: (\S+?)\./.exec(message)?.[1] ?? message;
}

async function validateDocument(document: OpenApiDocument, specPath: string): Promise<void> {
  try {
    // swagger-parser dereferences the copy it is given; the copy exists so that ours stays intact.
    await SwaggerParser.validate(relaxExampleExclusivity(structuredClone(document)) as never);
  } catch (error: unknown) {
    throw new MockError(
      'SPEC_INVALID',
      `"${specPath}" is not a valid OpenAPI 3.0 document: ${messageOf(error)}`,
      { pointer: pointerFromValidationError(error), cause: error },
    );
  }
}

/**
 * The OpenAPI 3.0 meta-schema declares `example` and `examples` mutually exclusive on a Media Type
 * Object, but REQ-033 requires a media type that declares both to be served, with `example`
 * winning. The requirement is the authority here, so the copy handed to the validator drops the
 * member the requirement says is redundant; the document the server serves from keeps both.
 *
 * REQ-004 grants that tolerance to the Media Type Object alone — "no other meta-schema constraint
 * is relaxed" — and the same `ExampleXORExamples` constraint also governs Parameter and Header
 * Objects, where it stays enforced. The walk therefore relaxes a node only where the document's
 * shape proves it is a media type: a value of a `content` map under a media-type key. Everything
 * else, including a Parameter Object that happens to sit beside such a map, is handed to the
 * validator untouched.
 */
function relaxExampleExclusivity(document: OpenApiDocument): OpenApiDocument {
  const walk = (node: unknown, isMediaType: boolean): void => {
    if (Array.isArray(node)) {
      for (const item of node) walk(item, false);
      return;
    }
    if (!isRecord(node)) return;
    if (isMediaType && Object.hasOwn(node, 'example') && isRecord(node['examples'])) {
      delete node['example'];
    }

    for (const [member, value] of Object.entries(node)) {
      if (member === 'content' && isRecord(value)) {
        // A media type key is a media type or range, so it always carries a `/`; a Schema Object
        // whose `properties` happen to include a `content` member never does.
        for (const [key, entry] of Object.entries(value)) walk(entry, key.includes('/'));
        continue;
      }
      walk(value, false);
    }
  };

  walk(document, false);
  return document;
}

/**
 * REQ-004 — two path templates that differ only in the names of their variables describe the same
 * route, so the document is ambiguous. The OpenAPI meta-schema does not catch this.
 */
function assertDistinctTemplates(document: OpenApiDocument): void {
  const seen = new Map<string, string>();
  for (const template of Object.keys(document.paths ?? {})) {
    const normalised = template.replace(/\{[^/{}]*\}/g, '{}');
    const previous = seen.get(normalised);
    if (previous !== undefined) {
      throw new MockError(
        'SPEC_INVALID',
        `Path templates "${previous}" and "${template}" differ only in their variable names.`,
        { pointer: pointerOf('paths', template) },
      );
    }
    seen.set(normalised, template);
  }
}

function unsupportedConstruct(violations: ConstructViolation[]): MockError {
  const tokens = [...new Set(violations.map((violation) => violation.construct))].join(', ');
  const options: { pointer?: string; details: ConstructViolation[] } = { details: violations };
  const first = violations[0];
  if (first !== undefined) options.pointer = first.pointer;
  return new MockError(
    'UNSUPPORTED_CONSTRUCT',
    `The document uses ${violations.length} unsupported construct(s): ${tokens}.`,
    options,
  );
}

/** swagger-parser reports the offending location inside its message, as `#/paths/~1pets/get ...`. */
function pointerFromValidationError(error: unknown): string {
  const match = /#\/\S*/.exec(messageOf(error));
  return match?.[0] ?? '#/';
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
