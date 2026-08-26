/**
 * scripts/lib/zip.mjs
 *
 * Minimal, dependency-free, deterministic ZIP writer (Node >=20, built-in
 * modules only). Written for release archives, not as a general-purpose
 * ZIP library.
 *
 * Determinism properties:
 *   - Entries are written in the order given (callers sort them).
 *   - Every entry uses a fixed MS-DOS timestamp (1980-01-01 00:00:00),
 *     so archive bytes never depend on filesystem mtimes.
 *   - No extra fields, no data descriptors, no archive comment, no
 *     directory entries; external attributes are fixed (0644).
 *   - Compression is chosen per entry and is either "store" (byte-exact
 *     across every Node build) or raw deflate at a fixed level.
 *
 * Deliberate limitations (a release archive that hits any of these should
 * fail loudly rather than emit a subtly wrong archive):
 *   - No ZIP64: archives, entries and entry counts must stay under the
 *     32-bit / 65535 limits. Enforced with explicit errors.
 *   - Names must be relative POSIX paths without "..", drive letters or
 *     leading slashes. Enforced.
 */

import { deflateRawSync } from 'node:zlib';

const LOCAL_HEADER_SIG = 0x04034b50;
const CENTRAL_HEADER_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;

/** MS-DOS epoch: 1980-01-01 00:00:00, the earliest value the format allows. */
const DOS_DATE = 0x0021;
const DOS_TIME = 0x0000;

const FLAG_UTF8 = 0x0800;
const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;
const VERSION_NEEDED_STORE = 10;
const VERSION_NEEDED_DEFLATE = 20;
/** version made by: UNIX (3) << 8 | ZIP spec 2.0 */
const VERSION_MADE_BY = (3 << 8) | 20;
/** regular file, mode 0644, shifted into the high 16 bits */
const EXTERNAL_ATTRS = (0o100644 << 16) >>> 0;

const MAX_UINT32 = 0xffffffff;
const MAX_ENTRIES = 0xffff;

let crcTable = null;

function getCrcTable() {
  if (crcTable) return crcTable;
  crcTable = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    crcTable[n] = c;
  }
  return crcTable;
}

export function crc32(buffer) {
  const table = getCrcTable();
  let crc = -1;
  for (let i = 0; i < buffer.length; i += 1) {
    crc = (crc >>> 8) ^ table[(crc ^ buffer[i]) & 0xff];
  }
  return (crc ^ -1) >>> 0;
}

function assertSafeName(name) {
  if (typeof name !== 'string' || name.length === 0) {
    throw new Error('zip entry name must be a non-empty string');
  }
  if (name.includes('\\')) throw new Error(`zip entry name must use "/" separators: ${name}`);
  if (name.startsWith('/')) throw new Error(`zip entry name must be relative: ${name}`);
  if (/^[A-Za-z]:/.test(name)) throw new Error(`zip entry name must not contain a drive letter: ${name}`);
  if (name.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new Error(`zip entry name must not contain empty or traversal segments: ${name}`);
  }
  if (Buffer.byteLength(name, 'utf8') > 0xffff) throw new Error(`zip entry name is too long: ${name}`);
}

/**
 * Build a ZIP archive.
 *
 * @param {Array<{name: string, data: Buffer|string}>} entries Already sorted.
 * @param {{compression?: 'deflate'|'store', level?: number}} options
 * @returns {{buffer: Buffer, entries: Array<{name: string, size: number, compressedSize: number, method: number, crc32: string}>}}
 */
export function createZip(entries, { compression = 'deflate', level = 9 } = {}) {
  if (!Array.isArray(entries)) throw new Error('entries must be an array');
  if (entries.length > MAX_ENTRIES) {
    throw new Error(`too many zip entries (${entries.length}); this writer does not implement ZIP64`);
  }

  const seen = new Set();
  const localChunks = [];
  const centralChunks = [];
  const summary = [];
  let offset = 0;

  for (const entry of entries) {
    assertSafeName(entry.name);
    if (seen.has(entry.name)) throw new Error(`duplicate zip entry name: ${entry.name}`);
    seen.add(entry.name);

    const raw = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(String(entry.data), 'utf8');
    if (raw.length > MAX_UINT32) throw new Error(`entry too large for a non-ZIP64 archive: ${entry.name}`);

    const checksum = crc32(raw);
    let method = METHOD_STORE;
    let payload = raw;
    if (compression === 'deflate' && raw.length > 0) {
      const deflated = deflateRawSync(raw, { level });
      // Only accept compression when it actually helps; this also keeps
      // tiny files byte-identical regardless of the zlib build in use.
      if (deflated.length < raw.length) {
        method = METHOD_DEFLATE;
        payload = deflated;
      }
    }

    const nameBuf = Buffer.from(entry.name, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL_HEADER_SIG, 0);
    local.writeUInt16LE(method === METHOD_DEFLATE ? VERSION_NEEDED_DEFLATE : VERSION_NEEDED_STORE, 4);
    local.writeUInt16LE(FLAG_UTF8, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    localChunks.push(local, nameBuf, payload);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(CENTRAL_HEADER_SIG, 0);
    central.writeUInt16LE(VERSION_MADE_BY, 4);
    central.writeUInt16LE(method === METHOD_DEFLATE ? VERSION_NEEDED_DEFLATE : VERSION_NEEDED_STORE, 6);
    central.writeUInt16LE(FLAG_UTF8, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(payload.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30); // extra field length
    central.writeUInt16LE(0, 32); // comment length
    central.writeUInt16LE(0, 34); // disk number start
    central.writeUInt16LE(0, 36); // internal attributes
    central.writeUInt32LE(EXTERNAL_ATTRS, 38);
    central.writeUInt32LE(offset, 42);
    centralChunks.push(central, nameBuf);

    summary.push({
      name: entry.name,
      size: raw.length,
      compressedSize: payload.length,
      method,
      crc32: checksum.toString(16).padStart(8, '0'),
    });

    offset += local.length + nameBuf.length + payload.length;
    if (offset > MAX_UINT32) throw new Error('archive exceeds 4 GiB; this writer does not implement ZIP64');
  }

  const centralBuf = Buffer.concat(centralChunks);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(EOCD_SIG, 0);
  eocd.writeUInt16LE(0, 4); // this disk
  eocd.writeUInt16LE(0, 6); // disk with central directory
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20); // comment length

  return { buffer: Buffer.concat([...localChunks, centralBuf, eocd]), entries: summary };
}

/**
 * Minimal structural self-check of an archive this module produced: walks
 * the central directory, re-reads each local header, and verifies stored
 * sizes and CRCs line up. Used by build-release.mjs so a broken archive is
 * caught before it is ever published.
 */
export function verifyZip(buffer) {
  const eocdOffset = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocdOffset === -1) throw new Error('no end-of-central-directory record found');
  const count = buffer.readUInt16LE(eocdOffset + 10);
  const centralSize = buffer.readUInt32LE(eocdOffset + 12);
  const centralOffset = buffer.readUInt32LE(eocdOffset + 16);
  if (centralOffset + centralSize !== eocdOffset) throw new Error('central directory bounds are inconsistent');

  const names = [];
  let pointer = centralOffset;
  for (let i = 0; i < count; i += 1) {
    if (buffer.readUInt32LE(pointer) !== CENTRAL_HEADER_SIG) {
      throw new Error(`central directory entry ${i} has a bad signature`);
    }
    const method = buffer.readUInt16LE(pointer + 10);
    const checksum = buffer.readUInt32LE(pointer + 16);
    const compressedSize = buffer.readUInt32LE(pointer + 20);
    const uncompressedSize = buffer.readUInt32LE(pointer + 24);
    const nameLen = buffer.readUInt16LE(pointer + 28);
    const extraLen = buffer.readUInt16LE(pointer + 30);
    const commentLen = buffer.readUInt16LE(pointer + 32);
    const localOffset = buffer.readUInt32LE(pointer + 42);
    const name = buffer.subarray(pointer + 46, pointer + 46 + nameLen).toString('utf8');

    if (buffer.readUInt32LE(localOffset) !== LOCAL_HEADER_SIG) {
      throw new Error(`local header for ${name} has a bad signature`);
    }
    if (buffer.readUInt16LE(localOffset + 8) !== method) throw new Error(`method mismatch for ${name}`);
    if (buffer.readUInt32LE(localOffset + 14) !== checksum) throw new Error(`crc mismatch for ${name}`);
    if (buffer.readUInt32LE(localOffset + 18) !== compressedSize) throw new Error(`compressed size mismatch for ${name}`);
    if (buffer.readUInt32LE(localOffset + 22) !== uncompressedSize) {
      throw new Error(`uncompressed size mismatch for ${name}`);
    }
    names.push(name);
    pointer += 46 + nameLen + extraLen + commentLen;
  }
  return { entryCount: count, names };
}
