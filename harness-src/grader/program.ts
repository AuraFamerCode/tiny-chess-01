// program/v1, the Codabench-style harness: the entry is a program that reads /input (the bundle's
// input_data, read-only) and writes files to /output; a separate scorer container (the competition's
// own program) reads those outputs read-only at /output and the reference data read-only at
// /reference, and writes /scores/scores.json keyed by leaderboard column keys. The grader, never a
// container, turns that file into the score.
//
// Execution (executeProgram): the entry runs with stdin closed, stdout captured (at most
// MAX_PROGRAM_STDOUT_BYTES) and stderr capped like a replay bot's, under the competition's wall
// budget. Its "action log" is the outputs manifest {format, files: [{path, size, sha256}]} (paths
// sorted by UTF-8 bytes): grade-twice compares those manifests byte for byte, and every output file
// is kept in the blob store so an L1 regrade can re-run the scorer on exactly those bytes. Bot
// failures: a non-zero exit, the budget running out (timeout), outputs that are not plain regular
// files (a symlink could point the scorer at /reference) or that the grader cannot read once the
// entry exits (a directory left 0000, a path it cannot reach), more than MAX_OUTPUT_FILES entries
// (every inode: files, directories, links, FIFOs) or MAX_OUTPUT_BYTES bytes (apparent or allocated,
// whichever total is larger), an output nested more than MAX_OUTPUT_DEPTH levels
// deep or with a path longer than MAX_OUTPUT_PATH_BYTES. Those last two keep every output reachable
// by path: an entry can chdir its way past PATH_MAX, where readdir and rm fail with ENAMETOOLONG, and
// that must stay its own violation, never a harness fault (the scratch directory is still deleted:
// grade.ts removeScratch, docker.ts removeTree). The caps are also watched while it runs, every
// OUTPUT_WATCH_MS, by this process over what it can read, and by the sandbox's meter where it has one
// (Sandbox.meterTree: docker's meter container, sandbox/docker.ts; the k8s pod's `watch` container,
// sandbox/k8s.ts). Docker's meter counts all of /output whatever modes the entry left there, so a
// directory the entry closes to the grader (on Linux a 0700 one is) hides nothing from the caps
// (docker.ts's header names the one gap left, a 0000 directory on a Docker Desktop for Mac host path).
// The k8s meter counts as the grader's uid and says how many directories it could not read (TreeUsage
// .unread): one kept unreadable for UNREAD_GRACE_MS (four readings in a row at OUTPUT_WATCH_MS:
// sandbox/k8s-watch.ts UnreadGrace) is a limit, OUTPUT_UNREAD_KEPT, so a hidden directory holds only what
// can be made in that time; one made 0700 (as mkdtemp makes it) and renamed or removed at once passes,
// and every reading in which it is readable counts it against the caps (outputReadingBroken). The
// process sandbox has no meter: there the watch is this process's own as before, skipping what it
// cannot read until the exit. A meter that fails is the sandbox's fault (a SandboxError), never the
// entry's.
//
// Scoring (scoreProgram): the outputs are materialized from the blob store into a fresh read-only
// tree, the scorer runs on them (code = the scorer entrypoint's directory, mounted at /bot), and
// scores.json is validated (program-scores.ts). A scorer may also write /scores/checks.json, its
// per-check rows (program-scores.ts readChecks), which is validated on every scoring whoever asks:
// scoreProgramWithChecks returns them beside the scores (null when there is no file), for the
// run's checks trace (program-scores.ts programChecksTrace; one per trial on agent/v1, agent-score.ts
// agentChecksTrace); scoreProgram returns the scores alone. The checks never move the score. Any
// scorer misbehaviour, a malformed checks.json included, is a ScorerError here. Grading scores through
// harnesses.ts scoreProgramBreakdown instead, which drops a malformed checks.json (its reason kept, the
// scores standing as without it) and throws every other fault as these throw it, so a breakdown never
// fails a grade (program/v1 grades and regrades, agent/v1 trials, scrape/v1 verdicts).
//
// The program's dataset_sha256 is the digest of its input and reference data (programDataSha256),
// so a regrade notices when either changed.
//
// An instance-drawn bundle (contracts/competition.ts ProgramHarness.generator) names no input or
// reference data of its own: each drawn instance supplies both, as ProgramSetup's inputDir and
// referenceDir (its input/ and reference/: grader/instance.ts runGenerator draws them), which
// programPaths prefers to the bundle's own; given none, it refuses the bundle with a ScorerError. The
// scorer is still the bundle's own, from compDir (programScorerDigest), and the dataset digest of an
// instance is programDataSha256 over its two directories: the draw record's instance_sha256.
//
// A pack bundle (ProgramHarness.pack, a code bounty's) names no input or reference data either: each
// phase grades on its pack's trees, which the grader materializes from the house's store, re-hashed
// (server/competitions/load.ts packTreeDir; grader/worker.ts phasePackTrees), and hands in as inputDir
// and referenceDir, as an instance's; given none, programPaths refuses it (NO_PACK_TREES_MESSAGE). Its
// compDir is where its scorer is (load.ts programCompetitionDir: competitions/code-tests-01 for a
// sponsored one), its scorer directory re-hashed against scorer_sha256 by whoever picks it.
//
// One run per case (ProgramHarness.cases 'per-file'): executeProgram runs the entry once for each case of
// the phase's reference manifest (<referenceDir>/manifest.json, server/proposals/packs.ts
// PackReferenceManifest: programCases reads its ids and time caps), as the pack build runs every one
// (packs.ts buildPack runCase): each run in its own work directory, /input a fresh read-only directory
// holding only that case's <id>.in, a fresh /output, the competition's sandbox limits with the case's
// time_cap_ms as its wall budget, everything else as one whole run (executeIn). A case's output is its
// /output/<id>.out, kept when its run ended ok; anything else it wrote is dropped. A crash, a timeout or
// an output violation loses that case alone: it writes no output and its status says why. The action
// log is the outputs manifest with `cases` [{id, status}] in the manifest's order (status ok, timeout or
// failed), so a case that ends otherwise in the two executions makes them differ, as any other output
// does, and the run is nondeterministic. The execution is ok however its cases ended (only a harness
// fault throws); its wall time is the cases' sum, its flags their union, its stderr each case's under a
// line naming it (at most MAX_STDERR_BYTES in all), and it has no single exit.
//
// Where the runs of a run per case are: on a sandbox with sessions (Sandbox.sessions, sandbox/types.ts's header:
// one sandbox pod an execution on k8s) every case of the execution runs in one session, opened labelled
// `<label>-cases` with the cases' spec as its template and closed once the last case has ended or the execution
// throws (each execution its own: never one across the determinism pair, or with the scorer); each case is still
// executeIn's own run, its spec the template's but for its directories, its label and its time cap, given only its
// own input, a fresh /output and /tmp, and none of an earlier case's processes or state. So a case's status, its
// output, its stderr and its wall time (its program's start to its end, never the session's set-up between cases)
// are what a sandbox of its own gives, and so is the action log. On a sandbox without sessions (docker, process, a
// timing sandbox) each case is a spawn of its own on the sandbox, a container or pod each. Either way each case's
// scratch is removed by the sandbox itself (grade.ts removeScratch).
//
// Entry secrets (ProgramExecutionOptions.secrets): the entrant's env-lane entry secrets are variables of
// every run of the entry (each case's, on a run per case; its sandbox spec's `secrets`), never of the
// scorer's. Each run's stderr and error, and the stderr tail a SandboxError quotes, are masked of every
// form of every value (grader/run.ts executionOf, stderrTail), so a run per case's stderr, built of its
// cases' masked ones, is masked too. The outputs never are: they are scored byte for byte, and
// grader/worker.ts scans them for the values instead (secret_in_output).
//
// Entry env (entrySpec): every run of the entry also gets MAKEFUN_BOT_DIR, the bundle's own name for its tree
// (competitions/makefun-coin-launch-01/starter/main.ts reads `process.env.MAKEFUN_BOT_DIR ?? '/bot'`, and its README,
// AGENT.md and the bundled Getting started say to test locally with `mkdir -p out && MAKEFUN_BOT_DIR=.
// MAKEFUN_OUTPUT_DIR=out node main.ts`). It names the tree this run mounts at /bot: the host code directory itself on
// the process driver, where the program's cwd already is, and '/bot' in a container, where the cwd is the image's
// (never the repository). So a program carrying the kit's `process.env.MAKEFUN_BOT_DIR ?? '.'` or `?? '/bot'` finds its
// repository in the grader as it does at home. It is the bundle's convention, not a general sandbox contract: no other
// harness sets it, and no entry secret can share the name (every MAKEFUN_* name is reserved for secrets,
// contracts/entry-secrets.ts reservedSecretName). MAKEFUN_OUTPUT_DIR needs nothing from this file: the process driver
// sets it from the /output mount (types.ts MOUNT_POINTS), and in a container /output is the mount itself; a spec's env
// may not name a mount variable (checkSandboxEnv refuses it on every driver).
//
// The run time (ProgramScoreOptions.run; RUN_FILE): before a grade's scorer starts, the grader writes
// /scores/run.json, {"executions":N,"format":"makefun/program-run/v1","wall_ms":M} in canonical JSON:
// M is the entry's measured wall time per execution (its runs' wall time summed over every instance
// or case, then the executions' mean, rounded to a whole ms) and N how many executions it averages
// (two on a grade: the determinism pair). It is the grader's measurement on the grade's sandbox,
// never the entry's word, so a scorer may write it into a column (a leaderboard tie-break: the
// faster program wins an exact tie) and it stays the scorer's own score. An L1 regrade re-hands the
// stored run's total and count (run.wall_ms, run.exec_count: grader/record.ts loadStoredRun), so the
// same file and the same score come back. A scoring that is no grade's (an agent/v1 trial's state
// export, a scrape verdict, an L1 regrade of a run stored without them) writes no file, and a scorer
// that reads none writes its column null. Every other scorer ignores the extra file.

import { readFileSync, statSync } from 'node:fs';
import { chmod, lstat, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join, posix } from 'node:path';
import { z } from 'zod';
import type { Leaderboard, ProgramHarness } from '../contracts/competition.ts';
import { Sha256Hex } from '../contracts/primitives.ts';
import { canonicalJson, canonicalSha256, sha256Hex } from '../sim/canonical.ts';
import { comparePaths } from '../server/repos/index-tar.ts';
import { readChecks, readScores, scoredColumns, ScorerError, type ProgramScores, type ScorerChecksT } from './program-scores.ts';
import { driverFailure, entrySecretForms, executionOf, MAX_STDERR_BYTES, specSecrets, stderrTail, type Execution, type LimitsT } from './run.ts';
import { describeExit, describeStop, Stopped, Supervisor } from './sandbox/io.ts';
import { UNREAD_GRACE_MS, UnreadGrace } from './sandbox/k8s-watch.ts';
import { SCORES_RETURNS } from './sandbox/mounts.ts';
import { SandboxError, type Runtime, type Sandbox, type SandboxReturns, type SandboxSpec, type TreeMeter, type TreeMeterOptions, type TreeUsage } from './sandbox/types.ts';
import { directoryDigest, directoryDigestAsync, treeFileSums, treeFileSumsAsync, type TreeFileSum } from './version.ts';

export const PROGRAM_OUTPUTS_FORMAT = 'agent-fun/program-outputs/v1';
export const PROGRAM_DATA_FORMAT = 'agent-fun/program-data/v1';
/** Files and directories together: a directory costs what a file does, so an entry cannot make empty ones without end. */
export const MAX_OUTPUT_FILES = 1000;
/** The larger of the outputs' apparent total and allocated total: a sparse file reports more than it holds, a preallocated one holds more than it reports. */
export const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;
/** The deepest an output may sit (one directly in /output is at depth 1): depth is what carries a path past PATH_MAX. */
export const MAX_OUTPUT_DEPTH = 32;
/** The longest output path, in UTF-8 bytes relative to /output: with a work directory's path in front it stays well inside Linux's PATH_MAX (4096). */
export const MAX_OUTPUT_PATH_BYTES = 1024;
/**
 * How much of an entry's /output may come back from its sandbox (SandboxMount.returns): exactly its caps. A copying
 * driver returns the one entry past a cap as well (the entry that breaks it), so collectOutputs still sees the breach in
 * the returned tree and judges it the entry's, in today's words; a cap here plus one would count that entry twice.
 */
export const OUTPUT_RETURNS: SandboxReturns = Object.freeze({ maxEntries: MAX_OUTPUT_FILES, maxBytes: MAX_OUTPUT_BYTES });
export const MAX_PROGRAM_STDOUT_BYTES = 1_048_576;
export const OUTPUT_WATCH_MS = 500;

export const ProgramOutputFile = z.strictObject({
  path: z.string().min(1),
  size: z.int().min(0),
  sha256: Sha256Hex,
});

/** A case id: what <id>.in and <id>.out are named by (server/proposals/packs.ts PACK_CASE_ID_RE). */
export const PROGRAM_CASE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
/** How one case's run ended (one run per case: the header). */
export const PROGRAM_CASE_STATUSES = ['ok', 'timeout', 'failed'] as const;

/** One case's run in the action log of a run per case: its id and how it ended. */
export const ProgramCaseRun = z.strictObject({
  id: z.string().regex(PROGRAM_CASE_ID_RE),
  status: z.enum(PROGRAM_CASE_STATUSES),
});

export const ProgramOutputs = z.strictObject({
  format: z.literal(PROGRAM_OUTPUTS_FORMAT),
  files: z.array(ProgramOutputFile),
  /** One run per case (ProgramHarness.cases 'per-file'): every case's run, in the reference manifest's order. Absent on one whole run, so its log keeps its bytes. */
  cases: z.array(ProgramCaseRun).optional(),
});
export type ProgramOutputsT = z.infer<typeof ProgramOutputs>;

/** Where output bytes are kept and read back (server/blobstore.ts BlobStore fits). */
export interface OutputBlobs {
  put(data: Uint8Array): Promise<{ sha256: string }>;
  get(sha256: string, opts?: { verify?: boolean }): Promise<Uint8Array | null>;
}

type ProgramHarnessT = z.infer<typeof ProgramHarness>;
type LeaderboardT = z.infer<typeof Leaderboard>;

export interface ProgramSetup {
  /** Absolute competition directory (holds the scorer, and the input_data and reference_data the bundle names). */
  compDir: string;
  harness: ProgramHarnessT;
  leaderboard: Pick<LeaderboardT, 'columns'>;
  /** Absolute input directory of a drawn instance (its input/), mounted at /input instead of the bundle's input_data. */
  inputDir?: string;
  /** Absolute reference directory of a drawn instance (its reference/), mounted at /reference instead of the bundle's reference_data. */
  referenceDir?: string;
}

const SEGMENT = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/;

/** The message programPaths throws for an instance-drawn bundle given no instance. */
export const NO_INSTANCE_MESSAGE = 'an instance-drawn bundle grades only on an instance';
/** The message programPaths throws for a pack bundle given no pack trees. */
export const NO_PACK_TREES_MESSAGE = "a pack bundle grades only on its phase's pack trees";

/** Absolute path of a bundle path inside the competition directory. */
function bundleAt(setup: ProgramSetup, p: string): string {
  return join(setup.compDir, ...p.split('/'));
}

/** The scorer's directory (mounted at /bot) and script: the bundle's own on every bundle, instance-drawn or not. */
function scorerPaths(setup: ProgramSetup): { scorerDir: string; scorerScript: string } {
  const entry = setup.harness.scorer.entrypoint;
  const dir = posix.dirname(entry);
  return { scorerDir: dir === '.' ? setup.compDir : bundleAt(setup, dir), scorerScript: posix.basename(entry) };
}

/**
 * Absolute paths of the program/v1 pieces: the setup's inputDir and referenceDir (an instance's) when
 * given, else the bundle's input_data and reference_data inside compDir; the scorer always the
 * bundle's. An instance-drawn bundle (a harness generator) names no reference or input data of its
 * own, so it grades only on an instance: given no referenceDir, this throws ScorerError
 * (NO_INSTANCE_MESSAGE); a pack bundle likewise grades only on its phase's pack trees
 * (NO_PACK_TREES_MESSAGE).
 */
export function programPaths(setup: ProgramSetup): { inputDir: string | null; referenceDir: string; scorerDir: string; scorerScript: string } {
  const reference = setup.harness.scorer.reference_data;
  const referenceDir = setup.referenceDir ?? (reference === null ? null : bundleAt(setup, reference));
  if (referenceDir === null) throw new ScorerError(setup.harness.pack !== undefined ? NO_PACK_TREES_MESSAGE : NO_INSTANCE_MESSAGE);
  const input = setup.harness.input_data;
  return {
    inputDir: setup.inputDir ?? (input === null ? null : bundleAt(setup, input)),
    referenceDir,
    ...scorerPaths(setup),
  };
}

/**
 * sha256 over the files under a directory: [{path, size, sha256}] in UTF-8 path order. Each file's sum is kept for the
 * process while its stat holds (version.ts treeFileSums), so a tree digested again reads only its listing.
 */
export function directoryManifest(dir: string): Array<{ path: string; size: number; sha256: string }> {
  return inPathOrder(treeFileSums(dir));
}

/** directoryManifest, its walk and reads on fs/promises (version.ts treeFileSumsAsync). */
export async function directoryManifestAsync(dir: string): Promise<Array<{ path: string; size: number; sha256: string }>> {
  return inPathOrder(await treeFileSumsAsync(dir));
}

/** `files` in UTF-8 path order (index-tar.ts comparePaths), each path encoded once rather than once a comparison. */
function inPathOrder(files: TreeFileSum[]): TreeFileSum[] {
  const keyed = files.map((f) => ({ f, k: Buffer.from(f.path, 'utf8') }));
  keyed.sort((a, b) => Buffer.compare(a.k, b.k));
  return keyed.map((x) => x.f);
}

/** The program's dataset digest: its input data (if any) and reference data. */
export function programDataSha256(setup: ProgramSetup): string {
  const p = programPaths(setup);
  return programDataDigest(p.inputDir === null ? null : directoryManifest(p.inputDir), directoryManifest(p.referenceDir));
}

/** programDataSha256 with both trees walked and read on fs/promises. */
export async function programDataSha256Async(setup: ProgramSetup): Promise<string> {
  const p = programPaths(setup);
  const [input, reference] = await Promise.all([p.inputDir === null ? null : directoryManifestAsync(p.inputDir), directoryManifestAsync(p.referenceDir)]);
  return programDataDigest(input, reference);
}

/** The program-data digest of an input manifest (null: none) and a reference one (programDataSha256's, grader/agent.ts instanceSha256's). */
export function programDataDigest(input: ReturnType<typeof directoryManifest> | null, reference: ReturnType<typeof directoryManifest>): string {
  return canonicalSha256({ format: PROGRAM_DATA_FORMAT, input, reference });
}

/** The scorer directory's digest (scorer_version's ` program@<sha256>`); an instance-drawn bundle's needs no instance. */
export function programScorerDigest(setup: ProgramSetup): string {
  return directoryDigest(scorerPaths(setup).scorerDir);
}

/** programScorerDigest with the scorer directory walked and read on fs/promises. */
export async function programScorerDigestAsync(setup: ProgramSetup): Promise<string> {
  return directoryDigestAsync(scorerPaths(setup).scorerDir);
}

// ---------------------------------------------------------------- execution

export interface ProgramExecutionOptions {
  sandbox: Sandbox;
  runtime: Runtime;
  /** Host directory mounted read-only at /bot: a freshly materialized snapshot. */
  botDir: string;
  setup: ProgramSetup;
  limits: LimitsT;
  /** A fresh, empty directory this execution may use (outputs land under it). */
  workDir: string;
  blobs: OutputBlobs;
  label?: string;
  imageDigest?: string | null;
  /**
   * The entrant's env-lane entry secrets, NAME to value (the header's entry secrets): every run of the entry gets them as
   * its sandbox spec's `secrets` (each case's, on a run per case), masked out of its stderr, its error and every tail a
   * SandboxError quotes; never the scorer. Absent or empty: none.
   */
  secrets?: Readonly<Record<string, string>>;
}

/** One plain file walkOutputs found: its path relative to the output directory (POSIX), where it is, and its size. */
export interface WalkedFile {
  path: string;
  abs: string;
  size: number;
}

const TOO_MANY_OUTPUTS = `more than ${MAX_OUTPUT_FILES} output files and directories`;
const TOO_MANY_OUTPUT_BYTES = `outputs passed ${MAX_OUTPUT_BYTES} bytes`;
/** How much of a path a message shows. */
const SHOWN_PATH_CHARS = 80;

/** The output cap a meter reading of /output breaks, or null: outputReadingBroken's caps (an entry's, a scrape entry's). */
export function outputCapBroken(u: TreeUsage): string | null {
  if (u.entries > MAX_OUTPUT_FILES) return TOO_MANY_OUTPUTS;
  if (u.bytes > MAX_OUTPUT_BYTES) return TOO_MANY_OUTPUT_BYTES;
  if (u.depth > MAX_OUTPUT_DEPTH) return `outputs nested more than ${MAX_OUTPUT_DEPTH} levels deep`;
  if (u.longPaths > 0) return `an output path is longer than ${MAX_OUTPUT_PATH_BYTES} bytes`;
  return null;
}

/** The limit a directory in /output the meter could not read, kept so for the grace, is (the header; the root's D5b). */
export const OUTPUT_UNREAD_KEPT = `a directory in /output stayed unreadable to the grader for ${UNREAD_GRACE_MS / 1000} s`;

/**
 * The limit one meter reading of /output breaks, fed every reading of that meter in order (also grader/instance.ts's and
 * grader/scrape/trial.ts's): a cap `caps` names (outputCapBroken's by default), else OUTPUT_UNREAD_KEPT once `grace`
 * (sandbox/k8s-watch.ts UnreadGrace, the meter's own) says a directory has stayed unreadable for its grace; null otherwise.
 */
export function outputReadingBroken(u: TreeUsage, grace: UnreadGrace, caps: (u: TreeUsage) => string | null = outputCapBroken): string | null {
  const kept = grace.breach(u);
  return caps(u) ?? (kept ? OUTPUT_UNREAD_KEPT : null);
}

/** Which of MAX_OUTPUT_DEPTH and MAX_OUTPUT_PATH_BYTES a path relative to /output (POSIX) breaks, or null. */
export function outputPathBroken(relPath: string): 'depth' | 'length' | null {
  if (relPath.split('/').length > MAX_OUTPUT_DEPTH) return 'depth';
  if (Buffer.byteLength(relPath) > MAX_OUTPUT_PATH_BYTES) return 'length';
  return null;
}

/** A path as a message shows it: its first SHOWN_PATH_CHARS characters, and an ellipsis when it goes on. */
export function shownPath(path: string): string {
  return path.length > SHOWN_PATH_CHARS ? `${path.slice(0, SHOWN_PATH_CHARS)}…` : path;
}

/**
 * Why this process cannot look at an output path, when that is the entry's doing: a mode it left
 * (EACCES, EPERM), a path it nested past PATH_MAX (ENAMETOOLONG) or made a link loop of (ELOOP); null
 * for any other failure, which is this process's own.
 */
export function outputUnreachable(err: unknown): string | null {
  const code = (err as NodeJS.ErrnoException | null)?.code;
  if (code === 'EACCES' || code === 'EPERM') return 'is not readable';
  if (code === 'ENAMETOOLONG' || code === 'ELOOP') return `cannot be reached by its path (${code})`;
  return null;
}

/**
 * Plain files under the output directory; a symlink or special file, a path this process cannot
 * reach, too many entries (directories count), too many bytes (apparent or allocated), too deep or too long a path is the
 * entry's violation. It never descends past the depth and path caps, so no path it hands the kernel
 * is longer than the output directory's own plus MAX_OUTPUT_PATH_BYTES. `running`: the watch while
 * the entry still runs, which skips what it cannot reach yet (the entry may still open it up) and
 * holds the rest to the caps. The output collector of every harness whose entry writes /output
 * (executeProgram here, grader/scrape/trial.ts), with collectOutputs below.
 */
export async function walkOutputs(root: string, running = false): Promise<{ files: WalkedFile[]; bytes: number } | { violation: string }> {
  const files: WalkedFile[] = [];
  let bytes = 0;
  let allocated = 0;
  let count = 0;
  const stack = [''];
  while (stack.length > 0) {
    const rel = stack.pop()!;
    let entries;
    try {
      entries = await readdir(join(root, rel), { withFileTypes: true });
    } catch (err) {
      const why = outputUnreachable(err);
      if (why === null) throw err;
      if (running) continue;
      return { violation: rel === '' ? `/output ${why}` : `output ${JSON.stringify(shownPath(rel))} ${why}` };
    }
    for (const e of entries) {
      const relPath = rel === '' ? e.name : `${rel}/${e.name}`;
      if (!SEGMENT.test(e.name)) return { violation: `output path ${JSON.stringify(shownPath(relPath))} is not a plain relative name` };
      const shape = outputPathBroken(relPath);
      if (shape === 'depth') return { violation: `output ${JSON.stringify(shownPath(relPath))} is nested more than ${MAX_OUTPUT_DEPTH} levels deep` };
      if (shape === 'length') return { violation: `output path ${JSON.stringify(shownPath(relPath))} is longer than ${MAX_OUTPUT_PATH_BYTES} bytes` };
      count += 1;
      if (count > MAX_OUTPUT_FILES) return { violation: TOO_MANY_OUTPUTS };
      if (e.isDirectory()) {
        stack.push(relPath);
        continue;
      }
      if (!e.isFile()) return { violation: `output ${JSON.stringify(shownPath(relPath))} is not a regular file` };
      let st;
      try {
        st = await lstat(join(root, relPath));
      } catch (err) {
        const why = outputUnreachable(err);
        if (why === null) throw err;
        if (running) continue;
        return { violation: `output ${JSON.stringify(shownPath(relPath))} ${why}` };
      }
      if (!st.isFile()) return { violation: `output ${JSON.stringify(shownPath(relPath))} is not a regular file` };
      files.push({ path: relPath, abs: join(root, relPath), size: st.size });
      bytes += st.size;
      allocated += st.blocks * 512;
      if (bytes > MAX_OUTPUT_BYTES || allocated > MAX_OUTPUT_BYTES) return { violation: TOO_MANY_OUTPUT_BYTES };
    }
  }
  return { files, bytes };
}

/**
 * The outputs under `outputDir` once their program has exited: walkOutputs, then each file read and
 * stored in `blobs`, as the program-outputs manifest (paths in UTF-8 byte order); or the entry's
 * violation (walkOutputs', or a file it cannot read). What the blob store throws is thrown.
 */
export async function collectOutputs(outputDir: string, blobs: Pick<OutputBlobs, 'put'>): Promise<{ outputs: ProgramOutputsT } | { violation: string }> {
  const walked = await walkOutputs(outputDir);
  if ('violation' in walked) return { violation: walked.violation };
  const files: ProgramOutputsT['files'] = [];
  for (const f of walked.files) {
    let bytes: Buffer;
    try {
      bytes = await readFile(f.abs);
    } catch {
      return { violation: `${f.path} is not readable` };
    }
    const put = await blobs.put(bytes);
    files.push({ path: f.path, size: bytes.length, sha256: put.sha256 });
  }
  files.sort((a, b) => comparePaths(a.path, b.path));
  return { outputs: { format: PROGRAM_OUTPUTS_FORMAT, files } };
}

/**
 * Execute a program/v1 entry: once over the whole input, or under a harness with one run per case
 * (cases 'per-file') once per case (the header). Entry failures and timeouts are returned; harness faults thrown.
 */
export async function executeProgram(opts: ProgramExecutionOptions): Promise<Execution<ProgramOutputsT>> {
  if (opts.setup.harness.cases === 'per-file') return executePerCase(opts);
  const paths = programPaths(opts.setup);
  return executeIn(opts, { inputDir: paths.inputDir, outputDir: join(opts.workDir, 'output'), limits: opts.limits, label: opts.label ?? 'program' });
}

/** One case of a run per case, as the reference manifest names it. */
export interface ProgramCase {
  id: string;
  time_cap_ms: number;
}

/**
 * The longest reference manifest programCases reads, in bytes (1 MiB): a longer one fails every grade on its phase.
 * proposal_pack refuses a test pack whose reference manifest is longer (server/proposals/checks.ts
 * PACK_MANIFEST_MAX_BYTES, held equal to this by proposal-packs.test.ts).
 */
export const MAX_CASES_MANIFEST_BYTES = 1024 * 1024;

const CasesManifest = z.object({
  cases: z.array(z.object({ id: z.string().regex(PROGRAM_CASE_ID_RE), time_cap_ms: z.int().min(1) })),
});

/**
 * The cases of a run per case: <referenceDir>/manifest.json's cases (server/proposals/packs.ts
 * PackReferenceManifest, which the house writes and the pack's tree digest seals), their ids and time caps,
 * in its order, each id once (letter case ignored). Anything else is the competition's fault: ScorerError.
 */
export function programCases(referenceDir: string): ProgramCase[] {
  const file = join(referenceDir, 'manifest.json');
  let raw: unknown;
  try {
    const st = statSync(file);
    if (!st.isFile() || st.size > MAX_CASES_MANIFEST_BYTES) throw new Error(`not a regular file of at most ${MAX_CASES_MANIFEST_BYTES} bytes`);
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    throw new ScorerError(`one run per case reads its cases from the reference's manifest.json, which does not read: ${(err as Error).message}`);
  }
  const parsed = CasesManifest.safeParse(raw);
  if (!parsed.success) throw new ScorerError(`the reference's manifest.json names no cases a run per case can take: ${parsed.error.issues[0]?.message ?? 'malformed'}`);
  const seen = new Set<string>();
  for (const c of parsed.data.cases) {
    if (seen.has(c.id.toLowerCase())) throw new ScorerError(`the reference's manifest.json names case ${c.id} twice (letter case ignored)`);
    seen.add(c.id.toLowerCase());
  }
  return parsed.data.cases.map((c) => ({ id: c.id, time_cap_ms: c.time_cap_ms }));
}

/**
 * One run per case (the header): every case of the reference manifest, each in its own work directory under opts.workDir;
 * all of them in one session of the sandbox's when it has sessions, closed however the execution ends.
 */
async function executePerCase(opts: ProgramExecutionOptions): Promise<Execution<ProgramOutputsT>> {
  const paths = programPaths(opts.setup);
  if (paths.inputDir === null) throw new ScorerError('one run per case reads each case from the input data, and there is none');
  const cases = programCases(paths.referenceDir);
  // Loaded here, not with this module: grade.ts reaches this module as it loads (through harnesses.ts).
  const { removeScratch } = await import('./grade.ts');
  const label = opts.label ?? 'program';
  const files: ProgramOutputsT['files'] = [];
  const runs: NonNullable<ProgramOutputsT['cases']> = [];
  const flags = new Set<string>();
  const stderr: Buffer[] = [];
  let stderrBytes = 0;
  let wall = 0;
  const caseDirOf = (i: number): string => join(opts.workDir, `case-${i}`);
  // On a sandbox with sessions, every case runs in one session (the header): its template the cases' spec, here with the
  // first case's directories (a run's host directories are its own). Its scratch is still removed by the sandbox itself.
  const sessions = opts.sandbox.sessions;
  const session =
    sessions === undefined
      ? null
      : sessions.open(entrySpec(opts, { inputDir: join(caseDirOf(0), 'input'), outputDir: join(caseDirOf(0), 'output'), limits: opts.limits, label: `${label}-cases` }));
  const runOn = session === null ? opts : { ...opts, sandbox: session };
  try {
    for (const [i, c] of cases.entries()) {
      const caseDir = caseDirOf(i);
      await mkdir(caseDir, { mode: 0o700 });
      try {
        // Only this case's input, read-only, where the sandbox user can read it.
        const inputDir = join(caseDir, 'input');
        await mkdir(inputDir, { mode: 0o755 });
        let bytes: Buffer;
        try {
          bytes = await readFile(join(paths.inputDir, `${c.id}.in`));
        } catch (err) {
          throw new ScorerError(`case ${c.id} has no input: ${(err as NodeJS.ErrnoException).code ?? (err as Error).message} reading ${c.id}.in`);
        }
        await writeFile(join(inputDir, `${c.id}.in`), bytes, { flag: 'wx', mode: 0o444 });
        await chmod(inputDir, 0o555);
        const e = await executeIn(runOn, {
          inputDir,
          outputDir: join(caseDir, 'output'),
          limits: { ...opts.limits, wall_budget_sec: c.time_cap_ms / 1000 },
          label: `${label}-c${i}`,
        });
        runs.push({ id: c.id, status: e.status });
        wall += e.wall_ms;
        if (e.status === 'ok') {
          for (const f of e.flags) flags.add(f);
          const out = e.log?.files.find((f) => f.path === `${c.id}.out`);
          if (out !== undefined) files.push(out);
        }
        const head = Buffer.from(`--- case ${c.id}: ${e.status}${e.error === null ? '' : ` (${e.error})`} ---\n`, 'utf8');
        for (const part of [head, e.stderr]) {
          const room = MAX_STDERR_BYTES - stderrBytes;
          if (room <= 0) break;
          const kept = part.subarray(0, room);
          stderr.push(kept);
          stderrBytes += kept.length;
        }
      } finally {
        await removeScratch(opts.sandbox, caseDir);
      }
    }
  } finally {
    await session?.close();
  }
  files.sort((a, b) => comparePaths(a.path, b.path));
  const log: ProgramOutputsT = { format: PROGRAM_OUTPUTS_FORMAT, files, cases: runs };
  const json = canonicalJson(log);
  return { status: 'ok', error: null, log, log_json: json, log_sha256: sha256Hex(json), wall_ms: wall, flags: [...flags].sort(), stderr: Buffer.concat(stderr), exit: null };
}

/**
 * The entry's own environment (the header's entry env): MAKEFUN_BOT_DIR, the bundle's name for its tree, set to the tree
 * this spec mounts at /bot — the host code directory on the process driver (whose program's cwd is there already), and
 * '/bot' in a container, where the cwd is the image's. No entry secret can share the name: every MAKEFUN_* name is
 * reserved for secrets (contracts/entry-secrets.ts reservedSecretName), so the entry's variables never collide with it.
 * No other variable here: a mount variable is each driver's own (types.ts MOUNT_POINTS, checkSandboxEnv).
 */
function entryEnv(opts: Pick<ProgramExecutionOptions, 'sandbox' | 'botDir'>): Pick<SandboxSpec, 'env'> {
  return { env: { MAKEFUN_BOT_DIR: opts.sandbox.kind === 'process' ? opts.botDir : '/bot' } };
}

/** What one run of the entry is spawned with (executeIn): `inputDir` (null: none) read-only at /input, `outputDir` writable at /output, under `limits`. */
function entrySpec(
  opts: Pick<ProgramExecutionOptions, 'sandbox' | 'runtime' | 'botDir' | 'imageDigest' | 'secrets'>,
  run: { inputDir: string | null; outputDir: string; limits: LimitsT; label: string },
): SandboxSpec {
  return {
    runtime: opts.runtime,
    codeDir: opts.botDir,
    mounts: [
      ...(run.inputDir === null ? [] : [{ host: run.inputDir, at: '/input' as const, readOnly: true }]),
      { host: run.outputDir, at: '/output' as const, readOnly: false, returns: OUTPUT_RETURNS },
    ],
    limits: run.limits,
    label: run.label,
    imageDigest: opts.imageDigest ?? null,
    ...entryEnv(opts),
    ...specSecrets(opts.secrets),
  };
}

/** One run of the entry: `inputDir` (null: none) at /input, a fresh `outputDir` at /output, under `limits`. */
async function executeIn(
  opts: Pick<ProgramExecutionOptions, 'sandbox' | 'runtime' | 'botDir' | 'blobs' | 'imageDigest' | 'secrets'>,
  run: { inputDir: string | null; outputDir: string; limits: LimitsT; label: string },
): Promise<Execution<ProgramOutputsT>> {
  const { outputDir } = run;
  // The entrant's env-lane secrets (the header's entry secrets): the entry's own variables, masked out of all it says here.
  const forms = entrySecretForms(opts.secrets);
  await mkdir(outputDir, { mode: 0o700 });
  // The sandbox user (65534) writes here; the work dir above stays private to this process.
  await chmod(outputDir, 0o777);
  const spec = entrySpec(opts, run);
  // The sandbox's own count of /output (the header: docker's whatever its modes, k8s's with its unread directories); null on the process driver.
  let meter: TreeMeter | null = null;
  // Its fault: the sandbox's, never the entry's.
  let meterFault: string | null = null;
  const unmetered = () => (meterFault === null ? null : new SandboxError(`the sandbox could not meter /output: ${meterFault}`));
  const grace = new UnreadGrace(OUTPUT_WATCH_MS);
  // What the meter reports goes to the program's supervisor, made as soon as the program is: a driver reports from its
  // meter's output, never inside the call that starts it, so `live.sup` is set by the time a report arrives.
  const live: { sup: Supervisor | null } = { sup: null };
  const meterOpts: TreeMeterOptions = {
    runtime: opts.runtime,
    imageDigest: opts.imageDigest ?? null,
    label: run.label,
    budgetMs: run.limits.wall_budget_sec * 1000,
    intervalMs: OUTPUT_WATCH_MS,
    maxEntries: MAX_OUTPUT_FILES,
    maxBytes: MAX_OUTPUT_BYTES,
    maxDepth: MAX_OUTPUT_DEPTH,
    maxPathBytes: MAX_OUTPUT_PATH_BYTES,
    onUsage: (u) => {
      const running = live.sup;
      const broken = outputReadingBroken(u, grace);
      if (running !== null && broken !== null && running.exit === null) running.violate(broken);
    },
    onFault: (why) => {
      const running = live.sup;
      if (running === null || running.exit !== null || running.stopped !== null) return;
      meterFault = why;
      void running.kill();
    },
  };
  // The program, then (below) its meter.
  const proc = opts.sandbox.spawn(spec);
  const sup = new Supervisor(proc, {
    budgetMs: run.limits.wall_budget_sec * 1000,
    maxStderrBytes: MAX_STDERR_BYTES,
    stdout: { mode: 'capture', maxBytes: MAX_PROGRAM_STDOUT_BYTES },
  });
  live.sup = sup;
  sup.closeStdin();
  let watching = false;
  // The host walker judges only while the program runs: from its end (sup.endedAt: the process's `finished` where the
  // driver has one, else its exit) a tick does nothing and a walk in flight is dropped. On k8s the driver fills the host
  // directory with /output's replica after `finished` and before `exited`: that replica is the collector's to judge
  // (`output violation: …`), never a live `limit: …`.
  const watcher = setInterval(() => {
    if (watching || sup.endedAt !== null || sup.stopped !== null) return;
    watching = true;
    void walkOutputs(outputDir, true)
      .then((w) => {
        if ('violation' in w && sup.endedAt === null) sup.violate(w.violation);
      })
      .catch(() => undefined)
      .finally(() => {
        watching = false;
      });
  }, OUTPUT_WATCH_MS);
  try {
    meter = opts.sandbox.meterTree?.(outputDir, meterOpts) ?? null;
    const exit = await sup.waitExit(Math.max(0, sup.remainingMs()));
    await meter?.stop();
    const fault = unmetered();
    if (fault !== null) throw fault;
    if (exit === 'grace') {
      await sup.kill();
      return executionOf<ProgramOutputsT>('timeout', 'the wall budget ran out', null, sup, [], forms);
    }
    if (opts.sandbox.isDriverFailure(exit)) throw driverFailure(proc, `the sandbox failed (${describeExit(exit)}): ${stderrTail(sup.stderr(), undefined, forms)}`);
    if (exit.code !== 0) return executionOf<ProgramOutputsT>('failed', `the program exited with ${describeExit(exit)}`, null, sup, [], forms);
    const collected = await collectOutputs(outputDir, opts.blobs);
    if ('violation' in collected) return executionOf<ProgramOutputsT>('failed', `output violation: ${collected.violation}`, null, sup, [], forms);
    return executionOf('ok', null, collected.outputs, sup, [], forms);
  } catch (err) {
    await sup.kill();
    await meter?.stop();
    if (!(err instanceof Stopped)) throw err;
    const fault = unmetered();
    if (fault !== null) throw fault;
    const r = err.reason;
    if (r.kind === 'timeout') return executionOf<ProgramOutputsT>('timeout', 'the wall budget ran out', null, sup, [], forms);
    if (r.kind === 'violation') return executionOf<ProgramOutputsT>('failed', `limit: ${r.message}`, null, sup, [], forms);
    if (opts.sandbox.isDriverFailure(r.exit)) throw driverFailure(proc, `the sandbox failed (${describeExit(r.exit)}): ${stderrTail(sup.stderr(), undefined, forms)}`);
    return executionOf<ProgramOutputsT>('failed', describeStop(r), null, sup, [], forms);
  } finally {
    clearInterval(watcher);
    await meter?.stop();
  }
}

// ---------------------------------------------------------------- scoring

export interface ProgramScoreOptions {
  sandbox: Sandbox;
  setup: ProgramSetup;
  outputs: ProgramOutputsT;
  blobs: OutputBlobs;
  limits: LimitsT;
  /** A fresh, empty directory (the outputs and scores land under it). */
  workDir: string;
  label?: string;
  /** The graded entry's measured run time, written to /scores/run.json for the scorer (the header); none writes no file. */
  run?: ProgramRunTime | null;
}

/** The file a grade's scorer finds its entry's run time in, under /scores (the header). */
export const RUN_FILE = 'run.json';
export const PROGRAM_RUN_FORMAT = 'makefun/program-run/v1';

/** A graded run's measured wall time: its executions' total, and how many there were. */
export interface ProgramRunTime {
  /** The executions' wall time summed (GradeOutcome.wall_ms, run.wall_ms), in ms. */
  wall_ms_total: number;
  /** How many executions that sums (GradeOutcome.exec_count, run.exec_count): at least 1. */
  executions: number;
}

/** The run time as /scores/run.json holds it, or null when there is none to state (no execution, or no finite total). */
export function programRunFile(run: ProgramRunTime | null | undefined): string | null {
  if (run === null || run === undefined) return null;
  if (!Number.isInteger(run.executions) || run.executions < 1 || !Number.isFinite(run.wall_ms_total) || run.wall_ms_total < 0) return null;
  return canonicalJson({ executions: run.executions, format: PROGRAM_RUN_FORMAT, wall_ms: Math.round(run.wall_ms_total / run.executions) });
}

/** Write the outputs back from the blob store into `dir` (verified), then make the tree read-only. */
export async function materializeOutputs(outputs: ProgramOutputsT, blobs: OutputBlobs, dir: string): Promise<void> {
  const parsed = ProgramOutputs.parse(outputs);
  await mkdir(dir, { mode: 0o700 });
  const dirs = new Set<string>();
  for (const f of parsed.files) {
    const segs = f.path.split('/');
    if (segs.some((s) => !SEGMENT.test(s))) throw new ScorerError(`output path ${JSON.stringify(f.path)} is not a plain relative path`);
    for (let i = 1; i < segs.length; i++) {
      const d = segs.slice(0, i).join('/');
      if (!dirs.has(d)) {
        await mkdir(join(dir, d), { mode: 0o700 });
        dirs.add(d);
      }
    }
    const bytes = await blobs.get(f.sha256, { verify: true });
    if (bytes === null || bytes.byteLength !== f.size) throw new ScorerError(`output ${f.path} (${f.sha256}) is missing from the blob store`);
    await writeFile(join(dir, f.path), bytes, { flag: 'wx', mode: 0o444 });
  }
  for (const d of [...dirs].sort((a, b) => b.split('/').length - a.split('/').length)) await chmod(join(dir, d), 0o555);
  await chmod(dir, 0o555);
}

/** One output file read back: its manifest row and its bytes, verified against it. */
export interface ProgramOutputRead {
  path: string;
  size: number;
  sha256: string;
  bytes: Uint8Array;
}

/**
 * The output file at `path` of the run whose action log (its ProgramOutputs, canonical JSON) is blob `actionLogSha256`,
 * read back from the blob store and verified: what a judge heat judges (contracts/competition.ts ProgramJudge.artifact;
 * grader/worker.ts judgeHeatOf). Null when the outputs hold no file at `path`. An Error when the action log is missing,
 * corrupt or no program's outputs, or the file's bytes are missing or are not the manifest's.
 */
export async function readOutputFile(blobs: Pick<OutputBlobs, 'get'>, actionLogSha256: string, path: string): Promise<ProgramOutputRead | null> {
  const log = await blobs.get(actionLogSha256, { verify: true });
  if (log === null) throw new Error(`action log ${actionLogSha256} is missing from the blob store`);
  if (sha256Hex(log) !== actionLogSha256) throw new Error(`action log ${actionLogSha256} is corrupt: its bytes hash to ${sha256Hex(log)}`);
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(log).toString('utf8'));
  } catch {
    throw new Error(`action log ${actionLogSha256} is not JSON`);
  }
  const parsed = ProgramOutputs.safeParse(raw);
  if (!parsed.success) throw new Error(`action log ${actionLogSha256} is no program's outputs: ${parsed.error.issues[0]?.message ?? 'malformed'}`);
  const f = parsed.data.files.find((x) => x.path === path);
  if (f === undefined) return null;
  const bytes = await blobs.get(f.sha256, { verify: true });
  if (bytes === null || bytes.byteLength !== f.size || sha256Hex(bytes) !== f.sha256) throw new Error(`output ${f.path} (${f.sha256}) of action log ${actionLogSha256} is missing from the blob store, or is not its bytes`);
  return { path: f.path, size: f.size, sha256: f.sha256, bytes };
}

/** What one scorer run wrote, validated: its scores.json, and its checks.json (null when it wrote none). */
export interface ProgramScored {
  scores: ProgramScores;
  checks: ScorerChecksT | null;
}

/**
 * Run the competition's scorer on stored outputs and return the validated scores. A malformed checks.json fails it all the
 * same (scoreProgramWithChecks); grading drops one instead (harnesses.ts scoreProgramBreakdown).
 */
export async function scoreProgram(opts: ProgramScoreOptions): Promise<ProgramScores> {
  return (await scoreProgramWithChecks(opts)).scores;
}

/** Run the competition's scorer on stored outputs and return the validated scores and per-check rows (the header). */
export async function scoreProgramWithChecks(opts: ProgramScoreOptions): Promise<ProgramScored> {
  const paths = programPaths(opts.setup);
  const outputDir = join(opts.workDir, 'outputs');
  const scoresDir = join(opts.workDir, 'scores');
  await materializeOutputs(opts.outputs, opts.blobs, outputDir);
  await mkdir(scoresDir, { mode: 0o700 });
  await chmod(scoresDir, 0o777);
  const runFile = programRunFile(opts.run);
  if (runFile !== null) await writeFile(join(scoresDir, RUN_FILE), runFile, { flag: 'wx', mode: 0o444 });
  const runtime = opts.setup.harness.scorer.runtime;
  const proc = opts.sandbox.spawn({
    runtime,
    codeDir: paths.scorerDir,
    script: paths.scorerScript,
    mounts: [
      { host: outputDir, at: '/output', readOnly: true },
      { host: paths.referenceDir, at: '/reference', readOnly: true },
      { host: scoresDir, at: '/scores', readOnly: false, returns: SCORES_RETURNS },
    ],
    limits: opts.limits,
    label: opts.label ?? 'scorer',
  });
  const sup = new Supervisor(proc, {
    budgetMs: opts.limits.wall_budget_sec * 1000,
    maxStderrBytes: MAX_STDERR_BYTES,
    stdout: { mode: 'capture', maxBytes: MAX_PROGRAM_STDOUT_BYTES },
  });
  sup.closeStdin();
  try {
    const exit = await sup.waitExit(Math.max(0, sup.remainingMs()));
    if (exit === 'grace') throw new ScorerError('the scorer ran out of wall budget');
    if (opts.sandbox.isDriverFailure(exit)) throw driverFailure(proc, `the sandbox failed running the scorer (${describeExit(exit)}): ${stderrTail(sup.stderr())}`);
    if (exit.code !== 0) throw new ScorerError(`the scorer exited with ${describeExit(exit)}: ${stderrTail(sup.stderr())}`);
  } catch (err) {
    await sup.kill();
    if (err instanceof Stopped) throw new ScorerError(`the scorer was stopped: ${describeStop(err.reason)}: ${stderrTail(sup.stderr())}`);
    throw err;
  }
  const scores = await readScores(scoresDir, scoredColumns(opts.setup.leaderboard));
  return { scores, checks: await readChecks(scoresDir) };
}
