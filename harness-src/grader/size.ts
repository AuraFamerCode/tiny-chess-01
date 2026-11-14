// The entry's code size (contracts/score.ts Score.size): what a program/v1 harness's size count
// (contracts/competition.ts ProgramSize, 'bytes-all-files') ranks a Smallest code bounty's passing
// entries by, the fewest bytes winning. Pure and versioned: a function of the entry's snapshot index
// (server/repos/index-tar.ts SnapshotEntry: each entry's path, kind, size and sha256, never its bytes)
// and the kit's starter, at the count's version. Nothing is read and nothing is timed, so a grade and
// every regrade fed the same snapshot and starter count the same bytes.
//
// Version 1 (PROGRAM_SIZE_VERSION), codeSize:
//   bytes   for every entry of the snapshot, its size (a regular file's bytes; a symlink's, the bytes
//           of its target text, which the program reads as easily: readlink) plus the UTF-8 bytes of
//           its path (each directory it sits under spelled out again), less every entry byte-identical
//           to the kit's starter: a regular file at the very path of a starter file, with its sha256
//           and size, so a file the entrant was handed and left as it was
//   files   the entries counted (every one but those)
//
// Why every byte of every file, names included (the size attacks this count was tried against): a
// count that leaves anything out gets the program moved into what it leaves out. Lines are joined
// (lines -92%). A token count weighs a string, a comment or a regex literal as a token or a few,
// and a file it calls generated as nothing, so `require('./s.min.js')` counted 6, a payload in a
// comment read back through Function#toString 20 and an `eval` of the program as a string 37, under
// the minified program's 81. The names of files (readdirSync) and a symlink's target (readlinkSync)
// carry a payload as well as a file's bytes do. Counted byte for byte, every such loader costs the
// bytes it loads plus its own, so none beats the program written small (an `eval` of the minified
// program as a string counts its quotes and its call more); tests/unit/grader-size.test.ts replays
// every trick and asserts it. A packer that compresses the program is no trick: its bytes are what
// the program needs, and code golf counts them alike.
//
// The starter is left out only where it stands unchanged, by path and bytes together: a file at a
// starter file's path with that file's bytes carries nothing the entrant chose. Matched on bytes
// alone, a copy of a starter file under a path of the entrant's choosing would carry that path free.
//
// Who counts: whoever holds the snapshot index, once per grade, handing the count to the score
// builders as the entry's cost and authorship are handed (grader/grade.ts GradeRequest.size,
// grader/regrade.ts RegradeL1Request.size): grader/worker.ts against the competition's starter as its
// kit hands it out (competitionStarter), cli/grade-local.ts against the kit.json listing
// (kitStarterFiles), so both count the same bytes. This module is scoring source (grader/version.ts
// SCORER_SOURCES): a change to the count names a new scorer_version.

import { PROGRAM_SIZE_VERSION, type ProgramSizeT } from '../contracts/competition.ts';
import type { ScoreSizeT } from '../contracts/score.ts';
import { KIT_STARTER_DIR } from '../server/competitions/kit-dirs.ts';

/** One entry of the snapshot as the count reads it (server/repos/index-tar.ts SnapshotEntry has these and more). */
export interface SizedEntry {
  readonly path: string;
  readonly kind: 'file' | 'symlink';
  /** Bytes of the file, or of the symlink's target text. */
  readonly size: number;
  readonly sha256: string;
}

/** One regular file of the kit's starter, its path relative to the starter's root (the root of an entrant's repository). */
export interface StarterFile {
  readonly path: string;
  readonly size: number;
  readonly sha256: string;
}

const UTF8 = new TextEncoder();

/** The UTF-8 bytes of `s` (a lone surrogate as U+FFFD's three, as TextEncoder and Buffer write it). */
export function utf8ByteLength(s: string): number {
  return UTF8.encode(s).length;
}

function checkEntry(e: SizedEntry | StarterFile, what: string): void {
  if (typeof e.path !== 'string' || e.path === '') throw new TypeError(`${what} has no path`);
  if (!Number.isSafeInteger(e.size) || e.size < 0) throw new TypeError(`${what} ${e.path} has size ${String(e.size)}: a size is a whole number of bytes`);
  if (typeof e.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(e.sha256)) throw new TypeError(`${what} ${e.path} has no sha256`);
}

/**
 * The entry's code size under size count `count` (the header): its snapshot's `entries` counted, less
 * each one byte-identical to the kit's `starter` file at its path ([] when the competition hands out
 * no starter). A count or version this module does not take, a path named twice, a size that is not a
 * whole number of bytes or an entry of another kind is the caller's TypeError.
 */
export function codeSize(count: ProgramSizeT, entries: readonly SizedEntry[], starter: readonly StarterFile[] = []): ScoreSizeT {
  if (count.count !== 'bytes-all-files' || count.version !== PROGRAM_SIZE_VERSION) {
    throw new TypeError(`size count ${String(count.count)} v${String(count.version)}: this grader counts bytes-all-files at version ${PROGRAM_SIZE_VERSION} only`);
  }
  const handed = new Map<string, StarterFile>();
  for (const f of starter) {
    checkEntry(f, 'starter file');
    if (handed.has(f.path)) throw new TypeError(`the starter names ${f.path} twice`);
    handed.set(f.path, f);
  }
  const seen = new Set<string>();
  let bytes = 0;
  let files = 0;
  for (const e of entries) {
    checkEntry(e, 'snapshot entry');
    if (e.kind !== 'file' && e.kind !== 'symlink') throw new TypeError(`snapshot entry ${e.path} is a ${String(e.kind)}: an entry is a file or a symlink`);
    if (seen.has(e.path)) throw new TypeError(`the snapshot names ${e.path} twice`);
    seen.add(e.path);
    const s = handed.get(e.path);
    if (e.kind === 'file' && s !== undefined && s.sha256 === e.sha256 && s.size === e.size) continue;
    bytes += e.size + utf8ByteLength(e.path);
    files += 1;
  }
  return { bytes, files, version: PROGRAM_SIZE_VERSION };
}

/**
 * The kit's starter as codeSize takes it, from the files a kit lists (cli/kit.ts KitFile: path, sha256,
 * size): those under starter/ (server/competitions/kit-dirs.ts KIT_STARTER_DIR), each path relative to
 * it, as an entrant's repository holds the file. Every other kit file is left out; a kit without a
 * starter gives [].
 */
export function kitStarterFiles(kitFiles: readonly StarterFile[]): StarterFile[] {
  const prefix = `${KIT_STARTER_DIR}/`;
  return kitFiles.filter((f) => f.path.startsWith(prefix) && f.path.length > prefix.length).map((f) => ({ path: f.path.slice(prefix.length), size: f.size, sha256: f.sha256 }));
}
