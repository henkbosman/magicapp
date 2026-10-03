import { Buffer } from 'node:buffer';

const MEBIBYTE = 1024 * 1024;

export const DEFAULT_ATOMIC_CARDS_LIMITS = Object.freeze({
  maxDocumentBytes: 512 * MEBIBYTE,
  maxMetaBytes: 1 * MEBIBYTE,
  maxCardGroupBytes: 8 * MEBIBYTE,
  maxUnknownValueBytes: 1 * MEBIBYTE,
  maxCardNameBytes: 2048,
  maxCardGroups: 100_000,
  maxCards: 500_000,
  maxCardsPerGroup: 2_000,
  maxNestingDepth: 128,
  maxTopLevelProperties: 16
});

export class AtomicCardsParseError extends Error {
  constructor(message, { code = 'INVALID_ATOMIC_CARDS_JSON', offset = null } = {}) {
    super(offset == null ? message : `${message} (tekenpositie ${offset})`);
    this.name = 'AtomicCardsParseError';
    this.code = code;
    this.offset = offset;
  }
}

function positiveInteger(value, fallback, name) {
  if (value == null) return fallback;
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive safe integer`);
  }
  return value;
}

export function normalizeAtomicCardsLimits(overrides = {}) {
  if (overrides == null || typeof overrides !== 'object' || Array.isArray(overrides)) {
    throw new TypeError('limits must be an object');
  }

  const result = {};
  for (const [name, fallback] of Object.entries(DEFAULT_ATOMIC_CARDS_LIMITS)) {
    result[name] = positiveInteger(overrides[name], fallback, `limits.${name}`);
  }
  return Object.freeze(result);
}

function parseFailure(message, cursor, code) {
  return new AtomicCardsParseError(message, { code, offset: cursor.offset });
}

async function* sourceChunks(source) {
  if (typeof source === 'string' || source instanceof Uint8Array || source instanceof ArrayBuffer) {
    yield source;
    return;
  }

  if (source && typeof source[Symbol.asyncIterator] === 'function') {
    yield* source;
    return;
  }

  if (source && typeof source[Symbol.iterator] === 'function') {
    yield* source;
    return;
  }

  throw new TypeError('AtomicCards source must be a string, byte array, iterable, or async iterable');
}

function asBytes(chunk) {
  if (chunk instanceof Uint8Array) return chunk;
  if (chunk instanceof ArrayBuffer) return new Uint8Array(chunk);
  if (ArrayBuffer.isView(chunk)) {
    return new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
  }
  return null;
}

async function* decodedChunks(source, limits, counters) {
  let decoder = new TextDecoder('utf-8', { fatal: true });
  let decoderHasBytes = false;

  const accountBytes = (amount) => {
    counters.bytesRead += amount;
    if (counters.bytesRead > limits.maxDocumentBytes) {
      throw new AtomicCardsParseError(
        `AtomicCards document exceeds maxDocumentBytes (${limits.maxDocumentBytes})`,
        { code: 'ATOMIC_CARDS_LIMIT_EXCEEDED' }
      );
    }
  };

  try {
    for await (const chunk of sourceChunks(source)) {
      if (typeof chunk === 'string') {
        if (decoderHasBytes) {
          const tail = decoder.decode();
          if (tail) yield tail;
          decoder = new TextDecoder('utf-8', { fatal: true });
          decoderHasBytes = false;
        }
        accountBytes(Buffer.byteLength(chunk, 'utf8'));
        if (chunk) yield chunk;
        continue;
      }

      const bytes = asBytes(chunk);
      if (!bytes) {
        throw new TypeError('AtomicCards iterable may only yield strings or byte arrays');
      }
      accountBytes(bytes.byteLength);
      decoderHasBytes = true;
      const text = decoder.decode(bytes, { stream: true });
      if (text) yield text;
    }

    if (decoderHasBytes) {
      const tail = decoder.decode();
      if (tail) yield tail;
    }
  } catch (error) {
    if (error instanceof AtomicCardsParseError || error instanceof TypeError && !decoderHasBytes) {
      throw error;
    }
    if (error instanceof TypeError) {
      throw new AtomicCardsParseError('AtomicCards contains invalid UTF-8', {
        code: 'INVALID_ATOMIC_CARDS_UTF8'
      });
    }
    throw error;
  }
}

class ChunkCursor {
  constructor(chunks) {
    this.iterator = chunks[Symbol.asyncIterator]();
    this.chunk = '';
    this.index = 0;
    this.offset = 0;
    this.done = false;
    this.started = false;
  }

  hasChar() {
    return this.index < this.chunk.length;
  }

  async fill() {
    while (!this.hasChar() && !this.done) {
      const next = await this.iterator.next();
      if (next.done) {
        this.done = true;
        this.chunk = '';
        this.index = 0;
        return false;
      }
      this.chunk = next.value;
      this.index = 0;
    }
    return this.hasChar();
  }

  take() {
    const char = this.chunk[this.index];
    this.index += 1;
    this.offset += 1;
    this.started = true;
    return char;
  }

  async peek() {
    return await this.fill() ? this.chunk[this.index] : null;
  }

  async skipWhitespace() {
    while (await this.fill()) {
      while (this.hasChar()) {
        const char = this.chunk[this.index];
        if (!/\s/u.test(char) && !(char === '\uFEFF' && !this.started)) return;
        this.take();
      }
    }
  }

  async expect(expected, description = JSON.stringify(expected)) {
    await this.skipWhitespace();
    const actual = await this.peek();
    if (actual !== expected) {
      throw parseFailure(
        actual == null
          ? `Unexpected end of JSON; expected ${description}`
          : `Expected ${description}, received ${JSON.stringify(actual)}`,
        this,
        'INVALID_ATOMIC_CARDS_JSON'
      );
    }
    this.take();
  }
}

class RawCollector {
  constructor(maxBytes, label, cursor) {
    this.maxBytes = maxBytes;
    this.label = label;
    this.cursor = cursor;
    this.parts = [];
    this.fragment = '';
    this.bytes = 0;
  }

  append(char) {
    this.fragment += char;
    if (this.fragment.length >= 8192) this.flush();
  }

  flush() {
    if (!this.fragment) return;
    this.bytes += Buffer.byteLength(this.fragment, 'utf8');
    if (this.bytes > this.maxBytes) {
      throw parseFailure(
        `${this.label} exceeds its ${this.maxBytes}-byte limit`,
        this.cursor,
        'ATOMIC_CARDS_LIMIT_EXCEEDED'
      );
    }
    this.parts.push(this.fragment);
    this.fragment = '';
  }

  finish() {
    this.flush();
    return this.parts.join('');
  }
}

async function readJsonString(cursor, maxBytes, label) {
  await cursor.skipWhitespace();
  if (await cursor.peek() !== '"') {
    throw parseFailure(`Expected ${label} to be a JSON string`, cursor, 'INVALID_ATOMIC_CARDS_JSON');
  }

  const raw = new RawCollector(maxBytes, label, cursor);
  raw.append(cursor.take());
  let escaped = false;

  while (await cursor.fill()) {
    while (cursor.hasChar()) {
      const char = cursor.take();
      raw.append(char);
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        try {
          return JSON.parse(raw.finish());
        } catch {
          throw parseFailure(`Invalid JSON escape or character in ${label}`, cursor, 'INVALID_ATOMIC_CARDS_JSON');
        }
      }
    }
  }

  throw parseFailure(`Unexpected end of JSON in ${label}`, cursor, 'INVALID_ATOMIC_CARDS_JSON');
}

function closingFor(opening) {
  return opening === '{' ? '}' : ']';
}

async function readRawJsonValue(cursor, maxBytes, label, maxNestingDepth) {
  await cursor.skipWhitespace();
  const first = await cursor.peek();
  if (first == null) {
    throw parseFailure(`Unexpected end of JSON before ${label}`, cursor, 'INVALID_ATOMIC_CARDS_JSON');
  }

  const raw = new RawCollector(maxBytes, label, cursor);
  if (first === '{' || first === '[') {
    const stack = [];
    let inString = false;
    let escaped = false;

    while (await cursor.fill()) {
      while (cursor.hasChar()) {
        const char = cursor.take();
        raw.append(char);

        if (inString) {
          if (escaped) escaped = false;
          else if (char === '\\') escaped = true;
          else if (char === '"') inString = false;
          continue;
        }

        if (char === '"') {
          inString = true;
        } else if (char === '{' || char === '[') {
          stack.push(closingFor(char));
          if (stack.length > maxNestingDepth) {
            throw parseFailure(
              `${label} exceeds maxNestingDepth (${maxNestingDepth})`,
              cursor,
              'ATOMIC_CARDS_LIMIT_EXCEEDED'
            );
          }
        } else if (char === '}' || char === ']') {
          const expected = stack.pop();
          if (char !== expected) {
            throw parseFailure(`Mismatched bracket in ${label}`, cursor, 'INVALID_ATOMIC_CARDS_JSON');
          }
          if (stack.length === 0) return raw.finish();
        }
      }
    }
    throw parseFailure(`Unexpected end of JSON in ${label}`, cursor, 'INVALID_ATOMIC_CARDS_JSON');
  }

  if (first === '"') {
    let escaped = false;
    while (await cursor.fill()) {
      while (cursor.hasChar()) {
        const char = cursor.take();
        raw.append(char);
        if (raw.parts.length === 0 && raw.fragment.length === 1) continue;
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') return raw.finish();
      }
    }
    throw parseFailure(`Unexpected end of JSON in ${label}`, cursor, 'INVALID_ATOMIC_CARDS_JSON');
  }

  while (await cursor.fill()) {
    while (cursor.hasChar()) {
      const char = cursor.chunk[cursor.index];
      if (char === ',' || char === '}' || char === ']' || /\s/u.test(char)) {
        const result = raw.finish();
        if (!result) throw parseFailure(`Missing ${label}`, cursor, 'INVALID_ATOMIC_CARDS_JSON');
        return result;
      }
      raw.append(cursor.take());
    }
  }
  const result = raw.finish();
  if (!result) throw parseFailure(`Missing ${label}`, cursor, 'INVALID_ATOMIC_CARDS_JSON');
  return result;
}

function parseRawValue(raw, label, cursor) {
  try {
    return JSON.parse(raw);
  } catch {
    throw parseFailure(`Invalid JSON in ${label}`, cursor, 'INVALID_ATOMIC_CARDS_JSON');
  }
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

async function parseDataObject(cursor, options, limits, counters) {
  await cursor.expect('{', 'an object for "data"');
  await cursor.skipWhitespace();
  if (await cursor.peek() === '}') {
    cursor.take();
    return;
  }

  while (true) {
    const name = await readJsonString(cursor, limits.maxCardNameBytes, 'AtomicCards card name');
    if (!name.trim()) {
      throw parseFailure('AtomicCards contains an empty card name', cursor, 'INVALID_ATOMIC_CARDS_STRUCTURE');
    }
    await cursor.expect(':');

    const raw = await readRawJsonValue(
      cursor,
      limits.maxCardGroupBytes,
      `card array for ${JSON.stringify(name)}`,
      limits.maxNestingDepth
    );
    const cards = parseRawValue(raw, `card array for ${JSON.stringify(name)}`, cursor);
    if (!Array.isArray(cards)) {
      throw parseFailure(
        `AtomicCards data entry ${JSON.stringify(name)} must be an array`,
        cursor,
        'INVALID_ATOMIC_CARDS_STRUCTURE'
      );
    }
    if (cards.length > limits.maxCardsPerGroup) {
      throw parseFailure(
        `AtomicCards data entry ${JSON.stringify(name)} exceeds maxCardsPerGroup (${limits.maxCardsPerGroup})`,
        cursor,
        'ATOMIC_CARDS_LIMIT_EXCEEDED'
      );
    }
    if (cards.some((card) => !isRecord(card))) {
      throw parseFailure(
        `AtomicCards data entry ${JSON.stringify(name)} may only contain card objects`,
        cursor,
        'INVALID_ATOMIC_CARDS_STRUCTURE'
      );
    }

    counters.groupCount += 1;
    counters.cardCount += cards.length;
    if (counters.groupCount > limits.maxCardGroups || counters.cardCount > limits.maxCards) {
      throw parseFailure('AtomicCards card count exceeds the configured import limits', cursor, 'ATOMIC_CARDS_LIMIT_EXCEEDED');
    }

    await options.onCardGroup(name, cards);

    await cursor.skipWhitespace();
    const separator = await cursor.peek();
    if (separator === ',') {
      cursor.take();
      continue;
    }
    if (separator === '}') {
      cursor.take();
      return;
    }
    throw parseFailure('Expected a comma or closing brace in AtomicCards data', cursor, 'INVALID_ATOMIC_CARDS_JSON');
  }
}

/**
 * Parses MTGJSON AtomicCards.json without retaining the complete document.
 * Only one name's card array is materialized at a time and the callback is
 * awaited before parsing continues, providing natural backpressure.
 */
export async function parseAtomicCards(source, {
  onCardGroup = async () => {},
  onMeta = async () => {},
  limits: limitOverrides = {}
} = {}) {
  if (typeof onCardGroup !== 'function') throw new TypeError('onCardGroup must be a function');
  if (typeof onMeta !== 'function') throw new TypeError('onMeta must be a function');

  const limits = normalizeAtomicCardsLimits(limitOverrides);
  const counters = { bytesRead: 0, groupCount: 0, cardCount: 0 };
  const cursor = new ChunkCursor(decodedChunks(source, limits, counters));
  const seen = new Set();
  let meta = null;

  await cursor.expect('{', 'the AtomicCards root object');
  await cursor.skipWhitespace();
  if (await cursor.peek() === '}') {
    throw parseFailure('AtomicCards root object is empty', cursor, 'INVALID_ATOMIC_CARDS_STRUCTURE');
  }

  while (true) {
    if (seen.size >= limits.maxTopLevelProperties) {
      throw parseFailure('AtomicCards has too many top-level properties', cursor, 'ATOMIC_CARDS_LIMIT_EXCEEDED');
    }
    const key = await readJsonString(cursor, 256, 'AtomicCards top-level property name');
    if (seen.has(key)) {
      throw parseFailure(`Duplicate AtomicCards top-level property ${JSON.stringify(key)}`, cursor, 'INVALID_ATOMIC_CARDS_STRUCTURE');
    }
    seen.add(key);
    await cursor.expect(':');

    if (key === 'meta') {
      const raw = await readRawJsonValue(cursor, limits.maxMetaBytes, 'AtomicCards meta', limits.maxNestingDepth);
      meta = parseRawValue(raw, 'AtomicCards meta', cursor);
      if (!isRecord(meta)) {
        throw parseFailure('AtomicCards "meta" must be an object', cursor, 'INVALID_ATOMIC_CARDS_STRUCTURE');
      }
      await onMeta(meta);
    } else if (key === 'data') {
      await parseDataObject(cursor, { onCardGroup }, limits, counters);
    } else {
      await readRawJsonValue(cursor, limits.maxUnknownValueBytes, `unsupported property ${JSON.stringify(key)}`, limits.maxNestingDepth);
      throw parseFailure(
        `Unsupported AtomicCards top-level property ${JSON.stringify(key)}`,
        cursor,
        'INVALID_ATOMIC_CARDS_STRUCTURE'
      );
    }

    await cursor.skipWhitespace();
    const separator = await cursor.peek();
    if (separator === ',') {
      cursor.take();
      continue;
    }
    if (separator === '}') {
      cursor.take();
      break;
    }
    throw parseFailure('Expected a comma or closing brace in AtomicCards root', cursor, 'INVALID_ATOMIC_CARDS_JSON');
  }

  if (!seen.has('meta') || !seen.has('data')) {
    throw parseFailure('AtomicCards requires both "meta" and "data" objects', cursor, 'INVALID_ATOMIC_CARDS_STRUCTURE');
  }

  await cursor.skipWhitespace();
  if (await cursor.peek() !== null) {
    throw parseFailure('Unexpected content after AtomicCards root object', cursor, 'INVALID_ATOMIC_CARDS_JSON');
  }

  return Object.freeze({
    meta,
    groupCount: counters.groupCount,
    cardCount: counters.cardCount,
    bytesRead: counters.bytesRead
  });
}

