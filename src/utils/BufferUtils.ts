const BASE64_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const BASE64_LOOKUP = new Map<string, number>(
  Array.from(BASE64_ALPHABET).map((char, index) => [char, index]),
);

function assertByte(value: number): void {
  if (!Number.isInteger(value) || value < 0 || value > 255) {
    throw new Error(`[BufferUtils] Invalid byte value: ${String(value)}`);
  }
}

export function bytesToBase64(bytes: Uint8Array): string {
  let output = '';

  for (let i = 0; i < bytes.length; i += 3) {
    const first = bytes[i];
    const second = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const third = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const chunk = (first << 16) | (second << 8) | third;

    output += BASE64_ALPHABET[(chunk >> 18) & 0x3f];
    output += BASE64_ALPHABET[(chunk >> 12) & 0x3f];
    output +=
      i + 1 < bytes.length ? BASE64_ALPHABET[(chunk >> 6) & 0x3f] : '=';
    output += i + 2 < bytes.length ? BASE64_ALPHABET[chunk & 0x3f] : '=';
  }

  return output;
}

export function base64ToBytes(base64: string): Uint8Array {
  const normalized = base64.replace(/\s/g, '');
  if (normalized.length % 4 !== 0) {
    throw new Error('[BufferUtils] Invalid base64 length.');
  }

  const padding =
    normalized.endsWith('==') ? 2 : normalized.endsWith('=') ? 1 : 0;
  const outputLength = (normalized.length / 4) * 3 - padding;
  const output = new Uint8Array(outputLength);
  let outputOffset = 0;

  for (let i = 0; i < normalized.length; i += 4) {
    const chars = normalized.slice(i, i + 4);
    const values = Array.from(chars).map((char) => {
      if (char === '=') {
        return 0;
      }
      const value = BASE64_LOOKUP.get(char);
      if (value === undefined) {
        throw new Error('[BufferUtils] Invalid base64 character.');
      }
      return value;
    });

    const chunk =
      (values[0] << 18) |
      (values[1] << 12) |
      (values[2] << 6) |
      values[3];

    if (outputOffset < outputLength) {
      output[outputOffset++] = (chunk >> 16) & 0xff;
    }
    if (outputOffset < outputLength) {
      output[outputOffset++] = (chunk >> 8) & 0xff;
    }
    if (outputOffset < outputLength) {
      output[outputOffset++] = chunk & 0xff;
    }
  }

  return output;
}

export function bytesToHex(bytes: Uint8Array): string {
  let output = '';
  for (const byte of bytes) {
    assertByte(byte);
    output += byte.toString(16).padStart(2, '0');
  }
  return output;
}

export function hexToBytes(hex: string): Uint8Array {
  const normalized = hex.trim();
  if (normalized.length % 2 !== 0 || /[^a-fA-F0-9]/.test(normalized)) {
    throw new Error('[BufferUtils] Invalid hex string.');
  }

  const output = new Uint8Array(normalized.length / 2);
  for (let i = 0; i < normalized.length; i += 2) {
    output[i / 2] = Number.parseInt(normalized.slice(i, i + 2), 16);
  }
  return output;
}

export function float32ToBase64(arr: Float32Array): string {
  if (arr.length !== 128) {
    throw new Error(
      `[BufferUtils] Expected 128 float32 embedding values, got ${arr.length}.`,
    );
  }

  const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
  return bytesToBase64(bytes);
}

export function base64ToFloat32(base64: string): Float32Array {
  const bytes = base64ToBytes(base64);
  if (bytes.byteLength !== 512) {
    throw new Error(
      `[BufferUtils] Expected 512 embedding bytes, got ${bytes.byteLength}.`,
    );
  }

  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Float32Array(copy.buffer);
}

export function utf8ToBytes(value: string): Uint8Array {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(value);
  }

  const encoded = encodeURIComponent(value);
  const bytes: number[] = [];
  for (let i = 0; i < encoded.length; i += 1) {
    if (encoded[i] === '%') {
      bytes.push(Number.parseInt(encoded.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      bytes.push(encoded.charCodeAt(i));
    }
  }
  return new Uint8Array(bytes);
}

export function utf8FromBytes(bytes: Uint8Array): string {
  if (typeof TextDecoder !== 'undefined') {
    return new TextDecoder().decode(bytes);
  }

  let encoded = '';
  for (const byte of bytes) {
    assertByte(byte);
    encoded += `%${byte.toString(16).padStart(2, '0')}`;
  }
  return decodeURIComponent(encoded);
}

export function concatBytes(parts: Uint8Array[]): Uint8Array {
  const totalLength = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const output = new Uint8Array(totalLength);
  let offset = 0;

  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }

  return output;
}
