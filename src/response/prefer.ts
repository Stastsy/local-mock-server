/**
 * `Prefer` is the only control channel the server offers (D-002), so its grammar is specified in
 * full by REQ-035 and parsed strictly: a directive the server knows but cannot understand is an
 * error, while a directive it does not know is ignored.
 */

import { MockError } from '../errors.js';

export interface Preferences {
  /** A three-digit status in 100..599. */
  code?: number;
  /** A non-empty example name. */
  example?: string;
}

const THREE_DIGITS = /^\d{3}$/;

function invalid(message: string): never {
  throw new MockError('INVALID_PREFER_HEADER', message);
}

export function parsePrefer(header: string | string[] | undefined): Preferences {
  if (header === undefined) return {};

  // REQ-035: several field values behave as one comma-separated list.
  const combined = Array.isArray(header) ? header.join(',') : header;
  const preferences: Preferences = {};

  for (const token of splitTopLevel(combined)) {
    const trimmed = token.trim();
    if (trimmed === '') continue;

    const separator = trimmed.indexOf('=');
    const name = (separator === -1 ? trimmed : trimmed.slice(0, separator)).trim().toLowerCase();
    const rawValue = separator === -1 ? undefined : trimmed.slice(separator + 1).trim();

    if (name === 'code') {
      if (preferences.code !== undefined) invalid('The "code" directive appears more than once.');
      preferences.code = parseCode(rawValue);
    } else if (name === 'example') {
      if (preferences.example !== undefined) {
        invalid('The "example" directive appears more than once.');
      }
      preferences.example = parseExample(rawValue);
    }
    // Every other directive — `wait`, `respond-async`, `handling`, ... — is ignored (REQ-035).
  }

  return preferences;
}

function parseCode(rawValue: string | undefined): number {
  const value = unquote(rawValue ?? '');
  if (!THREE_DIGITS.test(value)) {
    invalid(`The "code" directive takes exactly three digits, received "${value}".`);
  }
  const code = Number(value);
  if (code < 100 || code > 599) {
    invalid(`The "code" directive must be in 100..599, received "${value}".`);
  }
  return code;
}

function parseExample(rawValue: string | undefined): string {
  const value = unquote(rawValue ?? '');
  if (value === '') invalid('The "example" directive requires a non-empty name.');
  return value;
}

/** REQ-035: a surrounding pair of double quotes is stripped; everything else is verbatim. */
function unquote(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1);
  }
  return value;
}

/** Splits on commas that are not inside a quoted string. */
function splitTopLevel(value: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quoted = false;

  for (const character of value) {
    if (character === '"') {
      quoted = !quoted;
      current += character;
    } else if (character === ',' && !quoted) {
      tokens.push(current);
      current = '';
    } else {
      current += character;
    }
  }
  tokens.push(current);
  return tokens;
}
