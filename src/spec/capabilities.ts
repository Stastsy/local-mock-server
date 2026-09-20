/**
 * Capability checking (REQ-009 .. REQ-011).
 *
 * The walk is over the dereferenced document, in document order, and it collects *every*
 * violation rather than stopping at the first: a user fixes a specification once, not once per
 * construct (REQ-011).
 */

import { childPointer, pointerOf } from './pointer.js';
import {
  HTTP_METHODS,
  isJsonMediaType,
  isRecord,
  type ExampleObject,
  type MediaTypeObject,
  type OpenApiDocument,
  type OperationObject,
  type ParameterObject,
  type PathItemObject,
} from './types.js';

/** The complete token list of REQUIREMENTS §5. */
export type ConstructToken =
  | 'externalRef'
  | 'circularRef'
  | 'cookieParameter'
  | 'parameterContent'
  | 'parameterStyle'
  | 'responseCodeRange'
  | 'externalValue'
  | 'nonJsonRequestBody';

export interface ConstructViolation {
  construct: ConstructToken;
  pointer: string;
}

const RESPONSE_CODE_RANGE = /^[1-5]XX$/;

/** OpenAPI 3.0 §4.7.12.2: the default serialisation style for each parameter location. */
function defaultStyle(location: string): string {
  return location === 'query' || location === 'cookie' ? 'form' : 'simple';
}

/** `explode` defaults to `true` for `form` and to `false` for every other style. */
function defaultExplode(style: string): boolean {
  return style === 'form';
}

export function checkCapabilities(document: OpenApiDocument): ConstructViolation[] {
  const violations: ConstructViolation[] = [];
  const paths = document.paths ?? {};

  for (const [template, pathItem] of Object.entries(paths)) {
    if (!isRecord(pathItem)) continue;
    const pathPointer = pointerOf('paths', template);
    checkParameters(pathItem.parameters, childPointer(pathPointer, 'parameters'), violations);

    for (const method of HTTP_METHODS) {
      const operation = (pathItem as PathItemObject)[method];
      if (!isRecord(operation)) continue;
      checkOperation(operation as OperationObject, childPointer(pathPointer, method), violations);
    }
  }

  return violations;
}

function checkOperation(
  operation: OperationObject,
  pointer: string,
  violations: ConstructViolation[],
): void {
  checkParameters(operation.parameters, childPointer(pointer, 'parameters'), violations);

  const body = operation.requestBody;
  if (isRecord(body)) {
    const bodyPointer = childPointer(pointer, 'requestBody');
    const content = body.content;
    if (isRecord(content)) {
      const mediaTypes = Object.keys(content);
      // REQ-010: a request body the server could never parse is refused at load time.
      if (mediaTypes.length > 0 && !mediaTypes.some(isJsonMediaType)) {
        violations.push({ construct: 'nonJsonRequestBody', pointer: bodyPointer });
      }
      checkContent(content, childPointer(bodyPointer, 'content'), violations);
    }
  }

  const responses = operation.responses;
  if (isRecord(responses)) {
    const responsesPointer = childPointer(pointer, 'responses');
    for (const [status, response] of Object.entries(responses)) {
      const responsePointer = childPointer(responsesPointer, status);
      if (RESPONSE_CODE_RANGE.test(status)) {
        violations.push({ construct: 'responseCodeRange', pointer: responsePointer });
      }
      if (isRecord(response) && isRecord(response.content)) {
        checkContent(response.content, childPointer(responsePointer, 'content'), violations);
      }
    }
  }
}

function checkParameters(
  parameters: unknown,
  pointer: string,
  violations: ConstructViolation[],
): void {
  if (!Array.isArray(parameters)) return;
  parameters.forEach((parameter, index) => {
    if (!isRecord(parameter)) return;
    checkParameter(parameter as ParameterObject, childPointer(pointer, index), violations);
  });
}

function checkParameter(
  parameter: ParameterObject,
  pointer: string,
  violations: ConstructViolation[],
): void {
  const location = typeof parameter.in === 'string' ? parameter.in : '';

  if (location === 'cookie') {
    violations.push({ construct: 'cookieParameter', pointer });
    return;
  }

  if (isRecord(parameter.content)) {
    violations.push({ construct: 'parameterContent', pointer });
    return;
  }

  const style = typeof parameter.style === 'string' ? parameter.style : defaultStyle(location);
  const explode = typeof parameter.explode === 'boolean' ? parameter.explode : defaultExplode(style);
  // One violation per parameter: a non-default style usually drags a non-default explode with it,
  // and reporting both would say the same thing twice.
  if (style !== defaultStyle(location) || explode !== defaultExplode(defaultStyle(location))) {
    violations.push({ construct: 'parameterStyle', pointer });
    return;
  }

  if (isRecord(parameter.examples)) {
    checkExamples(parameter.examples, childPointer(pointer, 'examples'), violations);
  }
}

function checkContent(
  content: Record<string, unknown>,
  pointer: string,
  violations: ConstructViolation[],
): void {
  for (const [mediaType, mediaTypeObject] of Object.entries(content)) {
    if (!isRecord(mediaTypeObject)) continue;
    const examples = (mediaTypeObject as MediaTypeObject).examples;
    if (isRecord(examples)) {
      checkExamples(examples, childPointer(pointer, mediaType, 'examples'), violations);
    }
  }
}

function checkExamples(
  examples: Record<string, unknown> | Record<string, ExampleObject>,
  pointer: string,
  violations: ConstructViolation[],
): void {
  for (const [name, example] of Object.entries(examples)) {
    if (isRecord(example) && typeof example['externalValue'] === 'string') {
      violations.push({ construct: 'externalValue', pointer: childPointer(pointer, name) });
    }
  }
}
