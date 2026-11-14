// A live transcript recording (strict transcripts: contracts/competition.ts SubmissionRule.strict_transcripts).
//
// While the entrant's AI agent works, `makefun record` (cli/record.ts) streams the agent's append-only JSONL
// session logs and the repository's working-tree file hashes to make.fun as hash-chained chunks, and the site
// stamps each chunk with the time it received it (ChunkResponse.received_at). The entry's transcript is then built
// by the site from the sealed recordings alone (server/recordings/assemble.ts), never uploaded, and the gate check
// transcripts_witnessed (server/entries/thinking.ts) holds every session line and every committed file to the
// times the site witnessed them, so a transcript written or edited after the fact fails.
//
//   start     POST /api/competitions/:slug/recordings answers RecordingStartResponse: the recording's id and
//             chain_seed, a random nonce of the server's that chunk 1 chains from.
//   chunks    POST /api/recordings/:id/chunks takes ChunkRequest, strictly in seq order: each names the chain
//             head it extends (prev_chain), the new complete lines of each session file (ChunkFile: the bytes
//             at the file's next offset, or the whole file again with rewrite when its sent prefix changed)
//             and the working tree's change since the last chunk (TreeDelta; the first carries the whole set).
//             The answer, ChunkResponse, is the new head (chainHash) and the server's receipt time.
//   finish    POST /api/recordings/:id/finish seals it: RecordingFinishResponse names every file's assembled
//             sha256, the sha256s an entry message's Transcripts line is computed from
//             (server/entries/manifest.ts transcriptsSha256 over loose files: the sha256 of their sorted sha256s, so file order is irrelevant).
//   list      GET /api/recordings?competition=<slug>: the caller's RecordingSummary list.
//
// Pure: zod and the primitives only, no I/O. It hashes with node:crypto, looked up on first use
// (process.getBuiltinModule, as contracts/dossier.ts does), so the module imports nothing else.

import { z } from 'zod';
import { LOOSE_UPLOAD_NAME } from './transcript-uploads.ts';
import { TranscriptSource } from './bundle.ts';
import { IsoDateTime, Sha256Hex, Slug } from './primitives.ts';

/** The recording wire format this module states. */
export const RECORDING_FORMAT = 'makefun-recording/v1';
/** How often the recorder sends what is new (a chunk only when something is). */
export const FLUSH_INTERVAL_MS = 5000;
/** How often the recorder sends a chunk with nothing new (a heartbeat), so a quiet recording still shows it is live. */
export const HEARTBEAT_INTERVAL_MS = 30000;
/** The largest chunk request body, bytes: transport framing only (the recorder splits a larger flush across chunks). */
export const MAX_CHUNK_REQUEST_BYTES = 8 * 1024 * 1024;
/**
 * The longest a session line may take to reach the site after the time it claims, seconds (the gate's
 * max_witness_lag_sec default, server/entries/policy.ts): a line received later than that was backfilled.
 */
export const DEFAULT_MAX_WITNESS_LAG_SEC = 300;
/** The most files one chunk may carry, and the most tree paths one delta may name. */
export const MAX_CHUNK_FILES = 256;
export const MAX_TREE_PATHS = 200_000;
/** The longest repo-relative path a tree delta names, characters. */
export const MAX_TREE_PATH_CHARS = 4096;

/** A recording's id: a UUID (the schema's UUIDv7, transcript_recording.id). */
export const RecordingId = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, 'expected a recording id (a lowercase UUID)');

/** A session file's key within a recording: `<source>:` and 24 hex of the sha256 of its absolute path (fileKeyOf). */
export const FileKey = z.string().max(80).regex(/^[a-z0-9-]+:[0-9a-f]{24}$/, 'expected <source>:<24 hex>');

/**
 * The name a recorded session file takes in the entry's transcript upload: a loose upload's plain file name (no
 * directory, server/pipeline/ingest.ts TranscriptUploadFile), ending as LOOSE_UPLOAD_NAME takes, in the characters
 * a bundle's SessionPath segment allows (contracts/bundle.ts), at most 255 characters. The recorder uses the session
 * file's own base name (`<uuid>.jsonl`, `rollout-<time>-<uuid>.jsonl`), which the format detection reads.
 */
export const RecordingArchiveName = z
  .string()
  .min(1)
  .max(255)
  .regex(/^[A-Za-z0-9_][A-Za-z0-9._@-]*$/, 'expected a plain file name (letters, digits, . _ @ -)')
  .refine((n) => LOOSE_UPLOAD_NAME.test(n), 'expected a loose transcript file name (.jsonl, .json …)');

/** Whether `p` is a repo-relative POSIX path: not empty, no leading slash, no NUL, no empty, `.` or `..` segment. */
function isRepoPath(p: string): boolean {
  if (p === '' || p.length > MAX_TREE_PATH_CHARS || p.startsWith('/') || p.includes('\0')) return false;
  return p.split('/').every((s) => s !== '' && s !== '.' && s !== '..');
}

/** A path relative to the repository root, POSIX separators. */
export const RepoPath = z.string().refine(isRepoPath, 'expected a repo-relative POSIX path (no leading /, no empty, . or .. segment)');

export const RecordingStartResponse = z.strictObject({
  recording_id: RecordingId,
  competition: Slug,
  started_at: IsoDateTime,
  /** The server's random nonce (32 bytes, hex): chunk 1's prev_chain. */
  chain_seed: Sha256Hex,
});

/** The new complete lines of one session file (or, with rewrite, the whole file again). */
export const ChunkFile = z
  .strictObject({
    file_key: FileKey,
    source: TranscriptSource,
    archive_path: RecordingArchiveName,
    /** Where these bytes start in the file: the bytes already sent for it (0 with rewrite). */
    offset: z.int().min(0),
    /** The bytes, standard base64: complete lines only, ending in \n (the recorder holds back a trailing partial line). */
    bytes_b64: z.string().regex(/^[A-Za-z0-9+/]*={0,2}$/, 'expected standard base64'),
    /** sha256 of the decoded bytes. */
    sha256: Sha256Hex,
    /** The file's already-sent prefix changed (truncated or rewritten): these bytes replace its whole content (offset 0). Strict mode fails a rewritten file. */
    rewrite: z.boolean().default(false),
  })
  .refine((f) => !f.rewrite || f.offset === 0, { message: 'a rewrite starts at offset 0', path: ['offset'] });

/** One working-tree file and the sha256 of its content. */
export const TreeFile = z.strictObject({ path: RepoPath, sha256: Sha256Hex });

/**
 * The working tree's change since the last chunk (the first chunk's: the whole tree): files whose content is new or
 * changed (`set`) and files gone (`removed`). The tree is `git ls-files -co --exclude-standard` in the repository.
 * Each sha256 is defined exactly as server/repos/index-tar.ts SnapshotIndex.files sha256 is, which the gate compares it
 * with: the sha256 of the file's raw bytes for a regular file, and of the link's target path bytes for a symlink.
 */
export const TreeDelta = z.strictObject({
  set: z.array(TreeFile).max(MAX_TREE_PATHS),
  removed: z.array(RepoPath).max(MAX_TREE_PATHS),
});

export const ChunkRequest = z.strictObject({
  /** 1 for the first chunk, then one more each: the recording's last stored seq plus one. */
  seq: z.int().min(1),
  /** The chain head this chunk extends: chain_seed for chunk 1, else the previous chunk's ChunkResponse.chain. */
  prev_chain: Sha256Hex,
  /** The session files with new bytes, in the order chainHash hashes them; none for a heartbeat. */
  files: z.array(ChunkFile).max(MAX_CHUNK_FILES),
  /** The working tree's change since the last chunk, or null for none. */
  tree: TreeDelta.nullable(),
});

export const ChunkResponse = z.strictObject({
  seq: z.int().min(1),
  /** chainHash(prev_chain, the request): the recording's new head. */
  chain: Sha256Hex,
  /** When the site received the chunk: the receipt the gate holds each line and tree hash to. */
  received_at: IsoDateTime,
});

/** One sealed file of a recording: its whole assembled content's size and sha256. */
export const RecordingFinishFile = z.strictObject({
  file_key: FileKey,
  source: TranscriptSource,
  archive_path: RecordingArchiveName,
  bytes: z.int().min(0),
  sha256: Sha256Hex,
  /** Some chunk replaced the file's content (ChunkFile.rewrite): strict mode fails its sessions. */
  rewritten: z.boolean(),
});

export const RecordingFinishResponse = z.strictObject({
  recording_id: RecordingId,
  head_chain: Sha256Hex,
  started_at: IsoDateTime,
  sealed_at: IsoDateTime,
  chunks: z.int().min(0),
  files: z.array(RecordingFinishFile),
});

export const RecordingSummary = z.strictObject({
  recording_id: RecordingId,
  competition: Slug,
  started_at: IsoDateTime,
  /** null while the recording is open. */
  sealed_at: IsoDateTime.nullable(),
  chunks: z.int().min(0),
  files: z.int().min(0),
});

export const RecordingList = z.strictObject({ recordings: z.array(RecordingSummary) });

export type RecordingStartResponseT = z.infer<typeof RecordingStartResponse>;
export type ChunkFileT = z.infer<typeof ChunkFile>;
export type ChunkFileInputT = z.input<typeof ChunkFile>;
export type TreeFileT = z.infer<typeof TreeFile>;
export type TreeDeltaT = z.infer<typeof TreeDelta>;
export type ChunkRequestT = z.infer<typeof ChunkRequest>;
export type ChunkRequestInputT = z.input<typeof ChunkRequest>;
export type ChunkResponseT = z.infer<typeof ChunkResponse>;
export type RecordingFinishFileT = z.infer<typeof RecordingFinishFile>;
export type RecordingFinishResponseT = z.infer<typeof RecordingFinishResponse>;
export type RecordingSummaryT = z.infer<typeof RecordingSummary>;
export type RecordingListT = z.infer<typeof RecordingList>;

// ---------------------------------------------------------------- hashing

/** The sha256 of `data` (UTF-8 for a string), lowercase hex (node:crypto, looked up on first use). */
export function sha256Hex(data: Uint8Array | string): string {
  const crypto = process.getBuiltinModule('node:crypto');
  return crypto.createHash('sha256').update(data).digest('hex');
}

/** The JSON values the recording hashes: plain data, no undefined. */
type Json = null | boolean | number | string | readonly Json[] | { readonly [k: string]: Json };

/**
 * Canonical JSON of `v`: object keys sorted by UTF-16 code units, no whitespace, strings and numbers as
 * JSON.stringify writes them. For the plain data chainHash hashes (strings, integers, booleans, null) this is RFC 8785
 * and equals sim/canonical.ts canonicalJson (tests/unit/recording-contract.test.ts holds them equal).
 */
export function recordingCanonicalJson(v: Json): string {
  if (v === null || typeof v === 'boolean') return JSON.stringify(v);
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error('recordingCanonicalJson: a number that is not finite');
    return JSON.stringify(v === 0 ? 0 : v);
  }
  if (typeof v === 'string') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${(v as readonly Json[]).map(recordingCanonicalJson).join(',')}]`;
  const o = v as { readonly [k: string]: Json };
  const keys = Object.keys(o).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${recordingCanonicalJson(o[k]!)}`).join(',')}}`;
}

/** What chainHash reads of a chunk request: its seq, its files' keys, offsets, sha256s and rewrite flags, and its tree. */
export interface ChainedChunk {
  readonly seq: number;
  readonly files: readonly { readonly file_key: string; readonly offset: number; readonly sha256: string; readonly rewrite?: boolean }[];
  readonly tree: TreeDeltaT | null;
}

/** sha256 of the canonical JSON of a tree delta (chainHash's tree_sha256). */
export function treeSha256(tree: TreeDeltaT): string {
  return sha256Hex(recordingCanonicalJson({ set: tree.set.map((f) => ({ path: f.path, sha256: f.sha256 })), removed: [...tree.removed] }));
}

/**
 * The chain head a chunk makes: sha256 hex over the canonical JSON of
 * { v: 1, seq, prev_chain, files: [{ file_key, offset, sha256, rewrite }] in request order, tree_sha256 }, tree_sha256
 * being treeSha256(tree) or null. Chunk 1's prevChain is the recording's chain_seed; each later one's the head before it.
 * The request's own prev_chain is not read: the head it extends is the caller's to name.
 */
export function chainHash(prevChain: string, req: ChainedChunk): string {
  return sha256Hex(
    recordingCanonicalJson({
      v: 1,
      seq: req.seq,
      prev_chain: prevChain,
      files: req.files.map((f) => ({ file_key: f.file_key, offset: f.offset, sha256: f.sha256, rewrite: f.rewrite === true })),
      tree_sha256: req.tree === null ? null : treeSha256(req.tree),
    }),
  );
}

/** A session file's key within a recording: `${source}:` and the first 24 hex of sha256(absolutePath). */
export function fileKeyOf(source: string, absolutePath: string): string {
  return `${source}:${sha256Hex(absolutePath).slice(0, 24)}`;
}
