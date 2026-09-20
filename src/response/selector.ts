/**
 * Response selection (REQ-027 .. REQ-034).
 *
 * The order is fixed and each step is decided independently: status code, then media type, then
 * payload. Only `Prefer` may steer it; the request's `Accept` header and its query parameters
 * never do.
 */

import { MockError } from '../errors.js';
import type { RouteOperation } from '../routing/router.js';
import { childPointer } from '../spec/pointer.js';
import {
  isJsonMediaType,
  isRecord,
  type MediaTypeObject,
  type ResponseObject,
  type SchemaObject,
} from '../spec/types.js';
import type { Preferences } from './prefer.js';

const NUMERIC_STATUS = /^\d{3}$/;
const JSON_MEDIA_TYPE = 'application/json';

export interface ResponseSelection {
  /** The status actually served — `200` for a `default` response (REQ-027). */
  status: number;
  /** The `responses` key the payload comes from. */
  responseKey: string;
  response: ResponseObject;
  mediaType: string | undefined;
  mediaTypeObject: MediaTypeObject | undefined;
  pointer: string;
}

export type PayloadKind = 'example' | 'generated' | 'none';

export interface PayloadPlan {
  kind: PayloadKind;
  /** Present for `example`: the value to serve verbatim. */
  value?: unknown;
  /** Present for `generated`: the schema to generate from. */
  schema?: SchemaObject;
  pointer: string;
}

export function selectResponse(
  target: RouteOperation,
  preferences: Preferences,
): ResponseSelection {
  const responses = isRecord(target.operation.responses) ? target.operation.responses : {};
  const keys = Object.keys(responses);
  const responsesPointer = childPointer(target.pointer, 'responses');

  const responseKey = chooseResponseKey(keys, preferences, responsesPointer);
  const response = (responses[responseKey] ?? {}) as ResponseObject;
  const status = responseKey === 'default' ? 200 : Number(responseKey);
  const pointer = childPointer(responsesPointer, responseKey);

  const content = isRecord(response.content) ? response.content : undefined;
  if (content === undefined || Object.keys(content).length === 0) {
    // REQ-032: no content member, or an empty one, is an empty body — not an error.
    return { status, responseKey, response, mediaType: undefined, mediaTypeObject: undefined, pointer };
  }

  const mediaType = chooseMediaType(Object.keys(content));
  if (mediaType === undefined) {
    throw new MockError(
      'NO_SUPPORTED_MEDIA_TYPE',
      'The selected response declares no JSON media type.',
      { pointer: childPointer(pointer, 'content'), details: { documented: Object.keys(content) } },
    );
  }

  return {
    status,
    responseKey,
    response,
    mediaType,
    mediaTypeObject: content[mediaType] as MediaTypeObject,
    pointer,
  };
}

function chooseResponseKey(
  keys: string[],
  preferences: Preferences,
  responsesPointer: string,
): string {
  if (preferences.code !== undefined) {
    const requested = String(preferences.code);
    if (!keys.includes(requested)) {
      // REQ-029: an unsatisfiable preference fails loudly rather than falling back silently.
      throw new MockError(
        'NO_RESPONSE_FOR_STATUS',
        `The operation does not document a ${requested} response.`,
        { pointer: responsesPointer, details: { documented: keys } },
      );
    }
    return requested;
  }

  const numeric = keys.filter((key) => NUMERIC_STATUS.test(key)).sort((a, b) => Number(a) - Number(b));
  const lowest2xx = numeric.find((key) => Number(key) >= 200 && Number(key) <= 299);
  if (lowest2xx !== undefined) return lowest2xx;
  const lowest = numeric[0];
  if (lowest !== undefined) return lowest;
  // REQ-027: `default` is used only when no numeric status is documented.
  if (keys.includes('default')) return 'default';

  throw new MockError('NO_RESPONSE_FOR_STATUS', 'The operation documents no response at all.', {
    pointer: responsesPointer,
    details: { documented: keys },
  });
}

/** REQ-030: `application/json` if documented, otherwise the first JSON media type in order. */
function chooseMediaType(documented: string[]): string | undefined {
  const exact = documented.find((mediaType) => mediaType.toLowerCase() === JSON_MEDIA_TYPE);
  return exact ?? documented.find(isJsonMediaType);
}

export function selectPayload(
  selection: ResponseSelection,
  preferences: Preferences,
): PayloadPlan {
  const { mediaType, mediaTypeObject } = selection;
  const contentPointer =
    mediaType === undefined ? selection.pointer : childPointer(selection.pointer, 'content', mediaType);

  if (preferences.example !== undefined) {
    return namedExample(mediaTypeObject, preferences.example, contentPointer);
  }

  if (mediaType === undefined || mediaTypeObject === undefined) {
    return { kind: 'none', pointer: selection.pointer };
  }

  // REQ-033, level 1.
  if (Object.hasOwn(mediaTypeObject, 'example')) {
    return {
      kind: 'example',
      value: mediaTypeObject.example,
      pointer: childPointer(contentPointer, 'example'),
    };
  }

  // REQ-033, level 2: the first entry of `examples`, in document order.
  if (isRecord(mediaTypeObject.examples)) {
    const first = Object.entries(mediaTypeObject.examples)[0];
    if (first !== undefined) {
      const [name, example] = first;
      return {
        kind: 'example',
        value: isRecord(example) ? example['value'] : undefined,
        pointer: childPointer(contentPointer, 'examples', name),
      };
    }
  }

  const schema = isRecord(mediaTypeObject.schema) ? (mediaTypeObject.schema as SchemaObject) : undefined;
  const schemaPointer = childPointer(contentPointer, 'schema');

  // REQ-033, level 3.
  if (schema !== undefined && Object.hasOwn(schema, 'example')) {
    return { kind: 'example', value: schema['example'], pointer: childPointer(schemaPointer, 'example') };
  }

  // REQ-033, level 4.
  return { kind: 'generated', schema: schema ?? {}, pointer: schemaPointer };
}

function namedExample(
  mediaTypeObject: MediaTypeObject | undefined,
  name: string,
  contentPointer: string,
): PayloadPlan {
  const examples = isRecord(mediaTypeObject?.examples) ? mediaTypeObject.examples : undefined;
  const example = examples?.[name];
  if (example === undefined) {
    // REQ-034: matched case-sensitively and exactly; the available names are listed.
    throw new MockError(
      'EXAMPLE_NOT_FOUND',
      `The selected media type documents no example named "${name}".`,
      {
        pointer: childPointer(contentPointer, 'examples'),
        details: { available: Object.keys(examples ?? {}) },
      },
    );
  }
  return {
    kind: 'example',
    value: isRecord(example) ? example['value'] : undefined,
    pointer: childPointer(contentPointer, 'examples', name),
  };
}
