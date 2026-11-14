// Content-addressed blob store on the local disk: a blob's name is the lowercase hex sha256 of its
// bytes, stored at <root>/<first two hex chars>/<sha256> (default root .data/blobs, BLOB_DIR).
//
//   put(bytes | string)     store and return {sha256, size, created}
//   putStream(stream)       the same for a stream (hashed while written, never buffered whole)
//   stageStream(stream)     the same, hashed into a StagedBlob left in tmp/ until commit() or discard():
//                           for a caller that may still refuse what it read (server/routes/submissions.ts)
//   putFile(path)           putStream of a file on disk
//   get(sha256)             the bytes, or null when absent (verify: true re-hashes and throws on rot)
//   head(sha256)            {sha256, size}, or null when absent
//   has(sha256)             boolean
//   openRead(sha256)        a read stream (throws BlobNotFoundError when absent)
//   pathOf(sha256)          the absolute path a blob lives at (whether or not it exists)
//
// No call holds the event loop for a whole large blob: put() and the stream puts hash and write a chunk over
// HASH_SLICE_BYTES a slice at a time, put() encodes a large string a piece at a time, and get(verify) hashes the bytes it
// read a slice at a time, a turn of the loop between slices (a ~200 MB upload is ~50 of them).
//
// Writes go to <root>/tmp/ first and are renamed into place once the digest is known, so a reader
// never sees a partial blob and concurrent writers of the same content converge on one file. A write
// that finds its bytes already stored sets the file's time to now (unless refresh: false), so a
// deleter sparing recently written blobs (server/profile/avatar.ts) spares it; one deleted meanwhile
// is stored anew.
//
// A power loss leaves a blob whole or absent: a new blob's bytes are forced to disk before the rename and
// its directory after it (one data sync and one directory sync a NEW blob, none for one already stored;
// production's app node went down at 2026-11-14 01:04Z with neither, and 774 blobs kept their names over
// no bytes). And a file under a blob's name counts as that blob only at the size of the bytes being stored
// (the name is their hash, so no file is hashed on the write path): any other, a zero-length one above
// all, is replaced by the bytes in hand through the same rename and answered created: true, so the store
// heals as its blobs are written again. A store made with { durable: false } (a throwaway scratch store, never one
// whose blobs are kept) skips both syncs and keeps the rest.
// A source that fails (a path putFile cannot open, a stream that errors before it is read) rejects the
// put with its error and leaves no temp file; it never surfaces as an uncaught exception.
// Stored blobs are read-only (0444). A name that is not 64 lowercase hex chars is refused before
// any path is built, so a caller cannot reach outside the store through a crafted digest.
// The grader and the gateway forwarder (whose bundle inlines this file) keep runs and cassettes
// here, so this file is a harness source (grader/version.ts HARNESS_SOURCES): any change to it
// names a new harness_version.

import { createHash, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream, type ReadStream } from 'node:fs';
import { mkdir, open, readFile, rename, rm, stat, utimes } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { setImmediate as nextTurn } from 'node:timers/promises';

export const SHA256_RE = /^[0-9a-f]{64}$/;

/**
 * The most bytes hashed (and handed to the temp file) in one go: a larger chunk (put()'s whole buffer, a stream's big
 * chunk) and a verified get() are hashed this many bytes at a time with a turn of the event loop between, so storing or
 * reading back a ~200 MB upload never holds the loop for one sha256 pass over all of it (~2-3 ms a slice). The digest
 * and the bytes stored are the same however they are cut.
 */
export const HASH_SLICE_BYTES = 4 * 1024 * 1024;

/** A string past this many UTF-16 code units is encoded a piece at a time (utf8Pieces) by put(), not in one Buffer.from. */
const STRING_PIECE_UNITS = 1024 * 1024;

export interface BlobInfo {
  sha256: string;
  size: number;
}
export interface PutResult extends BlobInfo {
  /** False when the blob was already stored. */
  created: boolean;
}
export interface PutOptions {
  /**
   * False: a blob already stored keeps its file time. Only for a writer whose rows naming the blob commit under the lock
   * its deleter takes (setAvatar, server/profile/avatar.ts).
   */
  refresh?: boolean;
}

export class InvalidBlobNameError extends Error {
  constructor(name: string) {
    super(`not a sha256 blob name: ${JSON.stringify(name.slice(0, 80))}`);
    this.name = 'InvalidBlobNameError';
  }
}

export class BlobNotFoundError extends Error {
  readonly sha256: string;
  constructor(sha256: string) {
    super(`blob not found: ${sha256}`);
    this.name = 'BlobNotFoundError';
    this.sha256 = sha256;
  }
}

export class BlobCorruptError extends Error {
  readonly sha256: string;
  readonly actual: string;
  constructor(sha256: string, actual: string) {
    super(`blob ${sha256} hashes to ${actual}`);
    this.name = 'BlobCorruptError';
    this.sha256 = sha256;
    this.actual = actual;
  }
}

/** Lowercase hex sha256 of bytes or a UTF-8 string. */
export function sha256Hex(data: Uint8Array | string): string {
  return createHash('sha256').update(data).digest('hex');
}

/** sha256Hex of bytes, HASH_SLICE_BYTES at a time with a turn of the event loop between: the same digest. */
export async function sha256HexYielding(bytes: Uint8Array): Promise<string> {
  const hash = createHash('sha256');
  for (let at = 0; at < bytes.byteLength; at += HASH_SLICE_BYTES) {
    if (at > 0) await nextTurn();
    hash.update(bytes.subarray(at, at + HASH_SLICE_BYTES));
  }
  return hash.digest('hex');
}

/**
 * A string's UTF-8 bytes, as Buffer.from(s, 'utf8') gives them, in pieces of at most STRING_PIECE_UNITS code units, so
 * a large one is encoded a piece at a time as it is stored. A piece never ends between the two halves of a surrogate
 * pair: a high surrogate ending one is left for the next, so each piece encodes as its part of the whole does (a lone
 * surrogate, at an edge or not, is the same lone one there, U+FFFD's bytes either way).
 */
function* utf8Pieces(s: string): Generator<Buffer> {
  for (let at = 0; at < s.length; ) {
    let end = Math.min(s.length, at + STRING_PIECE_UNITS);
    if (end < s.length && end - 1 > at) {
      const last = s.charCodeAt(end - 1);
      if (last >= 0xd800 && last <= 0xdbff) end--;
    }
    yield Buffer.from(s.slice(at, end), 'utf8');
    at = end;
  }
}

export interface BlobStoreOptions {
  /**
   * False for a throwaway store whose blobs nobody keeps past a power loss (a snapshot's scratch store,
   * server/repos/fetch.ts): a new blob skips its data and directory syncs. Everything else is the same (temp
   * file and rename, the size check, read-only blobs). Default true.
   */
  durable?: boolean;
}

export class BlobStore {
  readonly root: string;
  /** Whether a new blob is synced, file then directory, before its put answers (BlobStoreOptions.durable). */
  readonly durable: boolean;
  readonly #tmp: string;

  constructor(root: string, opts: BlobStoreOptions = {}) {
    this.root = resolve(root);
    this.durable = opts.durable !== false;
    this.#tmp = join(this.root, 'tmp');
  }

  /** The absolute path of a blob (validated name; the file may not exist). */
  pathOf(sha256: string): string {
    if (typeof sha256 !== 'string' || !SHA256_RE.test(sha256)) throw new InvalidBlobNameError(String(sha256));
    return join(this.root, sha256.slice(0, 2), sha256);
  }

  async put(data: Uint8Array | string, opts?: PutOptions): Promise<PutResult> {
    // A large string is encoded a piece at a time as it is written; bytes go whole, stageStream hashing them in slices.
    if (typeof data === 'string' && data.length > STRING_PIECE_UNITS) return this.putStream(Readable.from(utf8Pieces(data)), opts);
    const bytes = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
    return this.putStream(Readable.from([Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)]), opts);
  }

  async putFile(path: string, opts?: PutOptions): Promise<PutResult> {
    // Opened before the store is touched: a path that will not open rejects this call with its own error.
    const file = await open(path, 'r');
    try {
      return await this.putStream(file.createReadStream(), opts);
    } finally {
      await file.close(); // a no-op once the stream has closed it
    }
  }

  async putStream(source: Readable | AsyncIterable<Uint8Array>, opts: PutOptions = {}): Promise<PutResult> {
    return (await this.stageStream(source)).commit(opts);
  }

  /**
   * Stream `source` into a file of the store's tmp directory, hashed as it is written (never buffered
   * whole), and return it as a StagedBlob: the bytes are in the store's hands but no reader sees a blob
   * until commit(). A caller that refuses what it read discards it instead, so a refused upload leaves
   * nothing in the store.
   */
  async stageStream(source: Readable | AsyncIterable<Uint8Array>): Promise<StagedBlob> {
    // pipeline() listens for a stream's errors only once the temp dir is made. One that fails sooner (a file stream
    // whose open fails, an upload cut off) would emit 'error' to no listener, an uncaught exception that ends the
    // process: its error is held here and rejects this call instead, and an unread stream is destroyed (its file
    // closed) when the call fails before pipeline() runs.
    const stream = source instanceof Readable ? source : null;
    const early: unknown[] = [];
    const hold = (err: unknown): void => void early.push(err);
    stream?.on('error', hold);
    try {
      await mkdir(this.#tmp, { recursive: true });
      if (early.length > 0) throw early[0];
    } catch (err) {
      stream?.destroy(); // `hold` stays on: anything its teardown emits has a listener
      throw err;
    }
    stream?.off('error', hold); // nothing is awaited from here to pipeline(), whose own listener takes over
    const tmp = join(this.#tmp, `${process.pid}-${randomBytes(8).toString('hex')}.part`);
    const hash = createHash('sha256');
    let size = 0;
    try {
      await pipeline(
        source,
        async function* (chunks: AsyncIterable<Uint8Array | string>) {
          for await (const chunk of chunks) {
            const buf = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk;
            if (buf.byteLength <= HASH_SLICE_BYTES) {
              hash.update(buf);
              size += buf.byteLength;
              yield buf;
              continue;
            }
            // A large chunk is hashed and written a slice at a time, a turn of the event loop between (HASH_SLICE_BYTES).
            for (let at = 0; at < buf.byteLength; at += HASH_SLICE_BYTES) {
              if (at > 0) await nextTurn();
              const slice = buf.subarray(at, at + HASH_SLICE_BYTES);
              hash.update(slice);
              size += slice.byteLength;
              yield slice;
            }
          }
        },
        createWriteStream(tmp, { flags: 'wx', mode: 0o600 }),
      );
    } catch (err) {
      await rm(tmp, { force: true });
      throw err;
    }
    return new StagedBlob(this, tmp, hash.digest('hex'), size);
  }

  async get(sha256: string, opts: { verify?: boolean } = {}): Promise<Buffer | null> {
    const path = this.pathOf(sha256);
    let bytes: Buffer;
    try {
      bytes = await readFile(path);
    } catch (err) {
      if (isMissing(err)) return null;
      throw err;
    }
    if (opts.verify) {
      const actual = await sha256HexYielding(bytes);
      if (actual !== sha256) throw new BlobCorruptError(sha256, actual);
    }
    return bytes;
  }

  async head(sha256: string): Promise<BlobInfo | null> {
    const path = this.pathOf(sha256);
    try {
      const s = await stat(path);
      return s.isFile() ? { sha256, size: s.size } : null;
    } catch (err) {
      if (isMissing(err)) return null;
      throw err;
    }
  }

  async has(sha256: string): Promise<boolean> {
    return (await this.head(sha256)) !== null;
  }

  /** A read stream over the blob (optionally one inclusive byte range). */
  async openRead(sha256: string, range?: { start: number; end: number }): Promise<ReadStream> {
    const path = this.pathOf(sha256);
    if (!(await exists(path))) throw new BlobNotFoundError(sha256);
    return createReadStream(path, range);
  }
}

/**
 * A stream put into the store's tmp directory (BlobStore.stageStream): its digest and size known, and
 * no blob a reader can see until commit(). Its temp file holds its bytes (mode 0600) until then.
 */
export class StagedBlob implements BlobInfo {
  readonly store: BlobStore;
  /** The part's file under the store's tmp/ directory; removed by commit() and discard() alike. */
  readonly path: string;
  readonly sha256: string;
  readonly size: number;
  #settled = false;

  constructor(store: BlobStore, path: string, sha256: string, size: number) {
    this.store = store;
    this.path = path;
    this.sha256 = sha256;
    this.size = size;
  }

  /** Whether its file is no longer the caller's to commit or discard (commit() ran). */
  get settled(): boolean {
    return this.#settled;
  }

  /**
   * Put the staged bytes in place as their blob, as putStream ends: a blob already stored (a file under its
   * name of this size) has its file time renewed (unless refresh: false) and is answered created: false; a
   * file there of any other size is replaced. A new blob is on disk, bytes and name, when this answers (see
   * the header). A failed put rejects and leaves no temp file. Only the caller that staged it may commit
   * it, once.
   */
  async commit(opts: PutOptions = {}): Promise<PutResult> {
    if (this.#settled) throw new Error(`staged blob ${this.sha256} is already settled`);
    this.#settled = true;
    const final = this.store.pathOf(this.sha256);
    try {
      if ((await sizeOf(final)) === this.size && (opts.refresh === false || (await touch(final)))) {
        await rm(this.path, { force: true });
        return { sha256: this.sha256, size: this.size, created: false };
      }
      const dir = join(this.store.root, this.sha256.slice(0, 2));
      const made = await mkdir(dir, { recursive: true });
      const durable = this.store.durable;
      await seal(this.path, durable);
      await rename(this.path, final);
      if (durable) {
        await syncDir(dir);
        if (made !== undefined) await syncDir(this.store.root); // the fan-out directory's own name is new
      }
      return { sha256: this.sha256, size: this.size, created: true };
    } catch (err) {
      await rm(this.path, { force: true });
      throw err;
    }
  }

  /** Remove the staged file: the bytes were refused, or are no longer needed (a no-op once committed). */
  async discard(): Promise<void> {
    if (this.#settled) return;
    this.#settled = true;
    await rm(this.path, { force: true });
  }
}

/** Set a stored blob's file time to now; false when it is not there (never stored, or deleted meanwhile). */
async function touch(path: string): Promise<boolean> {
  const now = new Date();
  try {
    await utimes(path, now, now);
    return true;
  } catch (err) {
    if (isMissing(err)) return false;
    throw err;
  }
}

async function exists(path: string): Promise<boolean> {
  return (await sizeOf(path)) !== null;
}

/** The size of the file at `path`; null when no file is there. */
async function sizeOf(path: string): Promise<number | null> {
  try {
    const s = await stat(path);
    return s.isFile() ? s.size : null;
  } catch (err) {
    if (isMissing(err)) return null;
    throw err;
  }
}

/**
 * Make a staged file read-only and (when `sync`) force its bytes and mode to disk: renamed after this, it is a whole
 * blob through a power loss.
 */
async function seal(path: string, sync: boolean): Promise<void> {
  const file = await open(path, 'r+');
  try {
    await file.chmod(0o444);
    if (sync) await file.sync();
  } finally {
    await file.close();
  }
}

/**
 * Force a directory's entries to disk, so a name just renamed into it survives a power loss. Nothing to force where a
 * directory has no sync: Windows opens none, and a filesystem without one answers EINVAL or ENOTSUP. Any other failure
 * is thrown.
 */
async function syncDir(path: string): Promise<void> {
  if (process.platform === 'win32') return;
  const dir = await open(path, 'r');
  try {
    await dir.sync();
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | null)?.code;
    if (code !== 'EINVAL' && code !== 'ENOTSUP') throw err;
  } finally {
    await dir.close();
  }
}

function isMissing(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException | null)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}
