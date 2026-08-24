/**
 * waypoints_blob v2 — server-side header parse + integrity verification.
 *
 * Mirrors docs/waypoints-blob-v2-spec.md. The server never needs to decode the
 * waypoint columns; it only decompresses the payload to check the SHA-256 that
 * lives in the header, and does structural sanity checks (C-02, AUDIT §10).
 */

import zlib from 'node:zlib';
import crypto from 'node:crypto';

export const BLOB_HEADER_SIZE = 48;
export const FW_RECORD_SIZE = 42; // schema 0 fixed-width canonical record

const MAGIC = Buffer.from([0x54, 0x52, 0x4b, 0x02]); // "TRK\x02"

export const CODEC = { none: 0, brotli: 1, zstd: 2, gzip: 3 } as const;
export const SCHEMA = { fixed_width: 0, columnar: 1 } as const;

const CODEC_NAME: Record<number, string> = {
  0: 'none',
  1: 'brotli',
  2: 'zstd',
  3: 'gzip',
};
const SCHEMA_NAME: Record<number, string> = {
  0: 'fixed_width',
  1: 'columnar',
};

export interface BlobMeta {
  codec: number;
  codecName: string;
  schema: number;
  schemaName: string;
  sampleRateHz: number;
  count: number;
  sha256: string; // hex, from header
  payloadBytes: number; // decompressed
  blobBytes: number; // whole blob
}

export interface BlobVerifyResult {
  ok: boolean;
  code?: string; // machine-readable failure code (422 details.code)
  message?: string;
  expected_sha256?: string;
  actual_sha256?: string;
  meta?: BlobMeta;
}

function decompress(codec: number, payload: Buffer): Buffer {
  switch (codec) {
    case CODEC.none:
      return payload;
    case CODEC.gzip:
      return zlib.gunzipSync(payload);
    case CODEC.brotli:
      return zlib.brotliDecompressSync(payload);
    case CODEC.zstd:
      // Node's stable zstd support is version-dependent; reject explicitly so
      // the client gets a clear "unsupported codec" instead of a crash.
      throw new Error('zstd codec is not supported server-side yet');
    default:
      throw new Error(`unknown codec ${codec}`);
  }
}

/**
 * Verify a blob's header + integrity. Does NOT decode waypoint columns.
 *
 * @param blob            raw blob bytes (header + compressed payload)
 * @param expectedCount   optional Ride.waypoint_count to cross-check
 */
export function verifyBlob(blob: Buffer, expectedCount?: number): BlobVerifyResult {
  if (!Buffer.isBuffer(blob) || blob.length < BLOB_HEADER_SIZE) {
    return { ok: false, code: 'blob_too_short', message: 'Blob shorter than 48-byte header' };
  }
  if (!blob.subarray(0, 4).equals(MAGIC)) {
    return { ok: false, code: 'bad_magic', message: 'Bad magic — expected TRK\\x02' };
  }

  const codec = blob.readUInt8(4);
  const schema = blob.readUInt8(5);
  const sampleRateHz = blob.readUInt16LE(6);
  const count = blob.readUInt32LE(8);
  const reserved = blob.readUInt32LE(12);
  const headerSha = blob.subarray(16, 48).toString('hex');
  const compressedPayload = blob.subarray(BLOB_HEADER_SIZE);

  if (reserved !== 0) {
    return { ok: false, code: 'reserved_nonzero', message: 'Reserved bytes must be zero' };
  }
  if (!(codec in CODEC_NAME)) {
    return { ok: false, code: 'unknown_codec', message: `Unknown codec ${codec}` };
  }
  if (!(schema in SCHEMA_NAME)) {
    return { ok: false, code: 'unknown_schema', message: `Unknown schema ${schema}` };
  }

  let payload: Buffer;
  try {
    payload = decompress(codec, compressedPayload);
  } catch (err: any) {
    return {
      ok: false,
      code: 'decompress_failed',
      message: `Decompression failed: ${err?.message || err}`,
    };
  }

  const actualSha = crypto.createHash('sha256').update(payload).digest('hex');
  if (actualSha !== headerSha) {
    return {
      ok: false,
      code: 'waypoints_blob_integrity_failed',
      message: 'Blob SHA-256 does not match decompressed payload',
      expected_sha256: headerSha,
      actual_sha256: actualSha,
    };
  }

  // Structural count checks. Schema 0 is fully checkable via payload length;
  // schema 1 (columnar) needs a full decode — deferred to the async verify job.
  if (schema === SCHEMA.fixed_width && payload.length !== count * FW_RECORD_SIZE) {
    return {
      ok: false,
      code: 'count_mismatch',
      message: `Payload length ${payload.length} != count(${count}) * ${FW_RECORD_SIZE}`,
    };
  }
  if (typeof expectedCount === 'number' && expectedCount > 0 && expectedCount !== count) {
    return {
      ok: false,
      code: 'count_mismatch_ride',
      message: `Blob count ${count} != Ride.waypoint_count ${expectedCount}`,
    };
  }

  return {
    ok: true,
    meta: {
      codec,
      codecName: CODEC_NAME[codec],
      schema,
      schemaName: SCHEMA_NAME[schema],
      sampleRateHz,
      count,
      sha256: headerSha,
      payloadBytes: payload.length,
      blobBytes: blob.length,
    },
  };
}
