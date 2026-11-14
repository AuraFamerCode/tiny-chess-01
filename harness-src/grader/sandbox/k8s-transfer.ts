// The host side of a claim-less sandbox pod's two house transfers, both over `kubectl exec` and both in the house
// tree stream (tree-stream.ts, makefun-tree/1):
//
//   stageStream    grader -> pod: packTrees piped into `kubectl exec -i <pod> -c <container> -- <the unpacker>`
//   collectMounts  pod -> grader: `kubectl exec <pod> -c watch -- <the packer>` read by readTrees
//
// What runs them is the caller's (k8s.ts): which container takes a stage and how it is released, when a collect may
// start. Neither exec carries a nonce: nothing of an entrant's ever runs in the stage container or in `watch`, and the
// collect exec opens only after everything of the program's is dead, so nothing can forge either side's words.
//
// Staging. The exec runs the unpacker (treeUnpackArgv), or the caller's wrapper of it (StageOptions.command: a umask,
// the container's release after a good ack, all in the one exec; what it wraps it with is the caller's, never built
// here). A wrapper prints nothing on stdout before the unpacker's line. The verdict is that first stdout line, the
// unpacker's ack (parseUnpackAck): `ok <entries> <bytes>`, which must equal what the stream carried, or `no <why>`.
// The exec's exit code is never read: the exec may be killed right after the ack, since the release ends the
// container under it, and its end races that. No ack in time, a `no`, any
// other line or a stream that ends with no line is a SandboxError naming the pod with the stager's words (its `no`
// line, else the exec's stderr and how the exec ended). A failure on the host's side (a tree packTrees refuses) is one
// too, and the exec is killed. Once the ack is in, the exec has STAGE_EXIT_GRACE_MS to end on its own, then is
// killed: StageResult.ended settles when it is gone.
//
// Collect. The packer (in `watch`, as uid 10001) sends each writable mount's tree, held to the mount's `returns` as
// its caps exactly (the packer itself sends the one entry past a cap); readTrees writes each into the mount's host
// directory. That directory is kept, and what it held (the live mirror, the grader's own files) is removed first,
// since readTrees writes only into an empty directory; a host directory that is not a real directory is refused
// before anything is removed. The verdict is the stream's closing frame, its totals and the end of the stream
// (readTrees); a stream with no closing frame, a refused one, or none in time is a SandboxError naming the pod. Which
// of the first two it was is seen on the exec's stdout, not read off the reader's message: a reader that throws once
// it has been handed the stream's end met no closing frame; one that throws before refused what it read. A
// refused or cut stream leaves a partial replica, all of it the grader's own files, mode-000 placeholders among them:
// it is left for the scratch removal, which unlocks before it deletes. Nothing a program leaves in a mount makes the
// packer print a figure the reader refuses (it clamps every size: tree-stream.ts's header), so a mount past its caps,
// a sparse file of an exabyte among them, comes back cut, the program's own breach for the caller's walk to find;
// `was refused` is a broken packer's, the driver's failure.
//
// The exec's stdout is read eagerly, from the moment it starts, into a queue the reader takes from, never at the
// reader's pace: a reader slowed by the host's disk (each entry's mkdir, open, write and chmod on libuv's few threads,
// shared by every transfer in the process) must not leave a whole stream in the pipe when kubectl exits, since the
// stream wrapper closes stdio left open after an exit (kubectlStream, STDIO_GRACE_MS) and the reader would then meet a
// cut. The stream's end is stdout's own end. What waits unread is held to a few MiB: past COLLECT_QUEUE_HIGH_BYTES
// queued, stdout is paused, and resumed once the reader has taken it below COLLECT_QUEUE_LOW_BYTES; so a lagging
// reader of a large mount holds kubectl back instead of its whole stream in memory. A paused stdout is safe from that
// close: kubectl exits only once its last write is in the pipe, so what it leaves unread then is at most the pipe and
// stdout's buffer. Node resumes a child's paused stdout at its exit, so that tail comes into the queue, which pauses
// it again past the high mark; what it leaves in stdout's buffer is safe, since the wrapper never closes a stream
// whose bytes wait in its buffer for a reader, paused or slow, and a paused stdout whose every byte is queued, closed
// a grace after the exit, has its whole stream in the queue, the close its end. The stream's total is
// bounded by what the mounts may return (collectStreamBound:
// their data caps plus each entry's most frame bytes): a stream past it is refused and the exec killed. A stream cut
// with no closing frame, not timed out, not aborted and not refused, is collected again, up to COLLECT_ATTEMPTS in
// all within the one budget counted from the first: `watch` holds the mounts read-only and the collect starts only
// after the program's exec has ended, so a second read is as good as the first. Before it, each host directory is
// emptied again of all the cut attempt wrote (the directory was empty when it began; nothing is followed through a
// link, and every directory is unlocked before it is entered, its placeholders being mode 000). Each retry is one line
// on the driver's warning channel (TransferContext.warn): the bytes the cut attempt read and the ms from kubectl's exit
// to its stdout's end, which tell a stream cut on the host from one kubectl ended short. After the last cut the error
// says `after <n> tries`.
//
// Budgets. Neither transfer is the program's time. Each has a fixed base (the exec's handshake on a busy node) plus
// its bytes over a floor rate well under the 46.7 to 93 MiB/s an exec carried on s18 across the evaluation's two runs
// (E6: 64 MiB into `stage` in 703 ms; the second run: 1 MiB in 287 ms, 16 MiB in 657 ms, 64 MiB at 46.7 MiB/s, and
// 64 MiB out in 1,242 ms), plus a small allowance per entry, which neither run measured and a tree of many small files
// spends on creating them in the pod. A stage's bytes are the stream's bytes sent so far, so its deadline moves with
// the stream and a stall is seen without a walk of the trees first; a whole stage gets exactly base + bytes/rate +
// entries. A collect's are its mounts' caps (`returns.maxBytes`, `maxEntries` plus the one past it), fixed before
// the exec starts. No timer is handed more than Node's longest delay (2^31 - 1 ms, which setTimeout would fire at
// once): a budget past it is waited out in steps.

import { chmod, lstat, readdir, rm, rmdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { Writable } from 'node:stream';
import type { K8sContext, KubectlChild, KubectlEnd } from './k8s.ts';
import {
  packTrees,
  parseUnpackAck,
  readTrees,
  type ReturnCaps,
  type ReturnedTree,
  shownBytes,
  type StageTree,
  TREE_MAX_LINE,
  TREE_MAX_LINK_BYTES,
  TREE_MAX_PATH_BYTES,
  TREE_STREAM_FORMAT,
  TreeStreamError,
  treePackArgv,
  treeUnpackArgv,
} from './tree-stream.ts';
import { SandboxError } from './types.ts';

/** The container a collect execs into (the plan's D9b: the house container beside `main`). */
export const WATCH_CONTAINER = 'watch';

/** How long a transfer may take: base + bytes / bytesPerSecond + entries × entryMs. */
export interface TransferBudget {
  /** The fixed part: the exec's handshake and start. */
  baseMs: number;
  /** The floor rate bytes are allowed at. */
  bytesPerSecond: number;
  /** Per entry: a file or directory made in the pod or in the replica. */
  entryMs: number;
}

/**
 * The budgets' figures: a 30 s base (half kubectl's own KUBECTL_TIMEOUT_MS, for an exec that must also start), 8 MiB/s
 * (under a fifth of the slowest the two runs measured, 46.7 MiB/s), 2 ms an entry. A 64 MiB, 1,000-entry tree: 30 + 8 + 2 s.
 */
export const TRANSFER_BUDGET: Readonly<TransferBudget> = Object.freeze({ baseMs: 30_000, bytesPerSecond: 8 * 1024 * 1024, entryMs: 2 });

/** After the ack, how long the staging exec has to end by itself before it is killed. */
export const STAGE_EXIT_GRACE_MS = 5_000;
/** After a failure's kill, or a collect's closing frame, how long the exec has to be gone. */
export const EXEC_END_GRACE_MS = 5_000;
/** The longest ack line the stager may print (the unpacker's longest `no` is well under it). */
export const MAX_ACK_BYTES = 4096;
/** How much of an exec's stderr is kept for its words. */
const STDERR_KEEP_BYTES = 8192;
/** Node's longest timer delay (2^31 - 1 ms): setTimeout fires a longer one at once. */
const MAX_TIMER_MS = 2 ** 31 - 1;

const POD_RE = /^[a-z0-9](?:[-a-z0-9.]{0,251}[a-z0-9])?$/;
const CONTAINER_RE = /^[a-z0-9](?:[-a-z0-9]{0,61}[a-z0-9])?$/;

/** A transfer's budget in ms for `bytes` and `entries`. */
export function transferBudgetMs(bytes: number, entries: number, budget: Readonly<TransferBudget> = TRANSFER_BUDGET): number {
  return budget.baseMs + Math.ceil((bytes * 1000) / budget.bytesPerSecond) + entries * budget.entryMs;
}

/** A collect's budget: its mounts' byte caps, and their entry caps plus the one entry past each. */
export function collectBudgetMs(mounts: readonly { returns: ReturnCaps }[], budget: Readonly<TransferBudget> = TRANSFER_BUDGET): number {
  let bytes = 0;
  let entries = 0;
  for (const m of mounts) {
    bytes += m.returns.maxBytes;
    entries += m.returns.maxEntries + 1;
  }
  return transferBudgetMs(bytes, entries, budget);
}

/** How many times a collect whose stream was cut is run in all (the header's Collect): one try and two more. */
export const COLLECT_ATTEMPTS = 3;
/** The most frame bytes one entry may carry besides its file data: its header line and "\n", its path, a link's target. */
export const COLLECT_ENTRY_FRAME_BYTES = TREE_MAX_LINE + 1 + TREE_MAX_PATH_BYTES + TREE_MAX_LINK_BYTES;
/** What a collect stream may carry past its trees' own figures. */
export const COLLECT_STREAM_SLACK_BYTES = 64 * 1024;
/** Unread bytes a collect queues past which kubectl's stdout is paused (the header's Collect). */
export const COLLECT_QUEUE_HIGH_BYTES = 4 * 1024 * 1024;
/** Unread bytes a collect's queue drains below before a paused stdout is resumed. */
export const COLLECT_QUEUE_LOW_BYTES = 1024 * 1024;

/**
 * The most bytes a collect stream of `mounts` may carry (the header's Collect): its opening and closing frames, and per
 * mount its data cap (`returns.maxBytes`), its tree's M and C frames, and COLLECT_ENTRY_FRAME_BYTES for each entry it
 * may send (`maxEntries` and the one past the cap); then COLLECT_STREAM_SLACK_BYTES.
 */
export function collectStreamBound(mounts: readonly { returns: ReturnCaps }[]): number {
  let bound = TREE_STREAM_FORMAT.length + 1 + (TREE_MAX_LINE + 1) + COLLECT_STREAM_SLACK_BYTES;
  for (const m of mounts) bound += m.returns.maxBytes + 2 * (TREE_MAX_LINE + 1) + (m.returns.maxEntries + 1) * COLLECT_ENTRY_FRAME_BYTES;
  return bound;
}

/** The part of K8sContext a transfer uses: `warn`, the driver's warning channel, takes a collect's retries (the header's Collect). */
export type TransferContext = Pick<K8sContext, 'namespace' | 'stream'> & Partial<Pick<K8sContext, 'warn'>>;

export interface StageOptions {
  pod: string;
  /** The container whose unpacker receives the trees (its mount points read-write). */
  container: string;
  /** Each host directory and the mount point it is staged at; every one must arrive, an empty tree included. */
  trees: readonly StageTree[];
  /** Aborting cuts the stage off: the exec is killed and the stage fails. */
  signal?: AbortSignal;
  /** The budget's figures (default TRANSFER_BUDGET). */
  budget?: Readonly<TransferBudget>;
  /**
   * Maps the unpacker's argv (treeUnpackArgv of the mounts) to the argv the exec runs; absent, the unpacker's own. A
   * wrapper prints nothing on stdout before the unpacker's ack, which stays the first line and the verdict; the exec
   * may be killed right after it (the header). An empty argv, or one whose first element starts with `-`, is refused
   * before any exec.
   */
  command?: (unpack: readonly string[]) => readonly string[];
}

export interface StageResult {
  /** The stager's ack: entries and data bytes written, equal to what the stream carried. */
  entries: number;
  bytes: number;
  /** The stream's own bytes, frames included. */
  streamBytes: number;
  /** From the exec's start to the ack. */
  ms: number;
  /** Settles once the exec has ended (by itself, or killed STAGE_EXIT_GRACE_MS after the ack); never rejects. */
  ended: Promise<void>;
}

export interface CollectMount {
  /** The writable mount point in the pod. */
  mount: string;
  /** Its host directory: kept, its content replaced by the returned tree. */
  dir: string;
  /** How much may come back (SandboxMount.returns), the packer's and the reader's caps as they are. */
  returns: ReturnCaps;
}

export interface CollectOptions {
  pod: string;
  mounts: readonly CollectMount[];
  signal?: AbortSignal;
  budget?: Readonly<TransferBudget>;
}

/** Whether `signal` has aborted, read afresh (not narrowed by an earlier read). */
function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

function checkName(re: RegExp, value: string, what: string): void {
  if (!re.test(value)) throw new SandboxError(`${what} ${JSON.stringify(value)} is not a Kubernetes name`);
}

/**
 * Calls `fn` once `ms` has passed, however long it is: a delay past MAX_TIMER_MS is waited out in steps of it, never
 * handed to setTimeout whole. Returns what cancels it.
 */
function afterMs(ms: number, fn: () => void): () => void {
  let timer: NodeJS.Timeout | undefined;
  const arm = (left: number): void => {
    const step = Math.min(MAX_TIMER_MS, left);
    timer = setTimeout(() => (left > step ? arm(left - step) : fn()), step);
  };
  arm(Math.max(0, ms));
  return () => clearTimeout(timer);
}

/** Resolves true when `p` settles within `ms`, false at `ms`. */
async function within(p: Promise<unknown>, ms: number): Promise<boolean> {
  let cancel: (() => void) | undefined;
  const late = new Promise<false>((resolve) => {
    cancel = afterMs(ms, () => resolve(false));
  });
  try {
    return await Promise.race([p.then(() => true as const), late]);
  } finally {
    cancel?.();
  }
}

/** An exec's stderr, kept up to STDERR_KEEP_BYTES. */
function keepStderr(child: KubectlChild): () => string {
  const kept: Buffer[] = [];
  let size = 0;
  child.stderr.on('data', (b: Buffer) => {
    if (size >= STDERR_KEEP_BYTES) return;
    const part = b.subarray(0, STDERR_KEEP_BYTES - size);
    kept.push(part);
    size += part.length;
  });
  return () => Buffer.concat(kept).toString('utf8');
}

/** How an exec ended, for a message. */
function execEnd(end: KubectlEnd | null): string {
  return end === null ? 'kubectl exec still running' : end.error ?? (end.signal === null ? `kubectl exec exited ${end.code}` : `kubectl exec ended by ${end.signal}`);
}

/** What an exec said and how it ended, for a message: its stderr's lines that are not warnings, and its end. */
function execWords(stderr: string, end: KubectlEnd | null): string {
  const said = stderr
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '' && !l.startsWith('Warning:'))
    .slice(0, 3)
    .join('; ');
  const how = execEnd(end);
  return said === '' ? how : `${said.length > 600 ? `${said.slice(0, 600)}…` : said} (${how})`;
}

/** Kill `child` and wait, bounded, for its end: how it ended, or null when it did not in time. */
async function killAndWait(child: KubectlChild): Promise<KubectlEnd | null> {
  child.kill();
  let end: KubectlEnd | null = null;
  await within(
    child.closed.then((e) => {
      end = e;
    }),
    EXEC_END_GRACE_MS,
  );
  return end;
}

/** The first line of `child`'s stdout (without its "\n"), or null when stdout ends first or passes MAX_ACK_BYTES. */
function firstLine(child: KubectlChild): { line: Promise<string | null>; overlong: () => boolean } {
  let buf = Buffer.alloc(0);
  let done = false;
  let over = false;
  let resolve!: (l: string | null) => void;
  const line = new Promise<string | null>((r) => (resolve = r));
  const settle = (l: string | null): void => {
    if (done) return;
    done = true;
    resolve(l);
  };
  child.stdout.on('data', (b: Buffer) => {
    if (done) return;
    buf = Buffer.concat([buf, b]);
    const i = buf.indexOf(0x0a);
    if (i >= 0 && i <= MAX_ACK_BYTES) return settle(buf.subarray(0, i).toString('latin1'));
    if (buf.length > MAX_ACK_BYTES) {
      over = true;
      settle(null);
    }
  });
  child.stdout.once('end', () => settle(null));
  child.stdout.once('close', () => settle(null));
  child.stdout.once('error', () => settle(null));
  // `closed` comes after stdout has ended; a kubectl that never started may end no stream at all.
  void child.closed.then(() => setImmediate(() => settle(null)));
  return { line, overlong: () => over };
}

/** Resolves once `w` can take more, or is gone, or `stop` aborts. */
function drained(w: Writable, stop: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const done = (): void => {
      w.off('drain', done);
      w.off('error', done);
      w.off('close', done);
      stop.removeEventListener('abort', done);
      resolve();
    };
    w.once('drain', done);
    w.once('error', done);
    w.once('close', done);
    stop.addEventListener('abort', done, { once: true });
    if (stop.aborted) done();
  });
}

/**
 * Stage `trees` into `pod`'s `container` (the header's Staging): resolves at the stager's `ok`, once it equals what
 * the stream carried; a SandboxError naming the pod otherwise.
 */
export async function stageStream(ctx: TransferContext, opts: StageOptions): Promise<StageResult> {
  checkName(POD_RE, opts.pod, 'pod');
  checkName(CONTAINER_RE, opts.container, 'container');
  const budget = opts.budget ?? TRANSFER_BUDGET;
  const at = `pod ${opts.pod}: staging into ${opts.container}`;
  let argv: readonly string[];
  try {
    argv = treeUnpackArgv(opts.trees.map((t) => t.mount));
  } catch (err) {
    throw new SandboxError(`${at}: ${(err as Error).message}`, { cause: err });
  }
  if (opts.command !== undefined) {
    let wrapped: unknown;
    try {
      wrapped = opts.command(Object.freeze([...argv]));
    } catch (err) {
      throw new SandboxError(`${at}: the staging command threw: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
    }
    if (!Array.isArray(wrapped) || wrapped.length === 0 || !wrapped.every((a) => typeof a === 'string')) throw new SandboxError(`${at}: the staging command is no argv`);
    if ((wrapped[0] as string).startsWith('-')) throw new SandboxError(`${at}: the staging command ${JSON.stringify(wrapped[0])} starts with -`);
    argv = [...(wrapped as string[])];
  }
  let pack: ReturnType<typeof packTrees>;
  try {
    pack = packTrees(opts.trees);
  } catch (err) {
    throw new SandboxError(`${at}: ${(err as Error).message}`, { cause: err });
  }
  if (isAborted(opts.signal)) throw new SandboxError(`${at}: cut off before it started`);

  const started = Date.now();
  const child = ctx.stream(['-n', ctx.namespace, 'exec', '-i', opts.pod, '-c', opts.container, '--', ...argv]);
  child.stdin.on('error', () => undefined);
  child.stdout.on('error', () => undefined);
  child.stderr.on('error', () => undefined);
  const stderr = keepStderr(child);
  const ack = firstLine(child);

  let sent = 0;
  let timedOut = false;
  let aborted = false;
  let packError: unknown = null;
  let packDone = false;
  const stopPump = new AbortController();
  const allowed = (): number => transferBudgetMs(sent, pack.totals.entries, budget);
  let timer: NodeJS.Timeout | undefined;
  const arm = (): void => {
    timer = setTimeout(
      () => {
        if (Date.now() - started < allowed()) return arm();
        timedOut = true;
        stopPump.abort();
        child.kill();
      },
      // Held to MAX_TIMER_MS: a longer budget re-arms when this fires, as a deadline the bytes moved does.
      Math.min(MAX_TIMER_MS, Math.max(1, allowed() - (Date.now() - started))),
    );
  };
  arm();
  const onAbort = (): void => {
    aborted = true;
    stopPump.abort();
    child.kill();
  };
  opts.signal?.addEventListener('abort', onAbort, { once: true });
  // An abort may come while the exec starts (its listener is added after).
  if (isAborted(opts.signal)) onAbort();

  const pump = (async () => {
    try {
      for await (const chunk of pack) {
        if (stopPump.signal.aborted || child.stdin.destroyed || child.stdin.writableEnded) return;
        sent += chunk.length;
        if (!child.stdin.write(chunk)) await drained(child.stdin, stopPump.signal);
      }
    } catch (err) {
      packError = err;
      stopPump.abort();
      child.kill();
      return;
    }
    packDone = !stopPump.signal.aborted;
    if (!child.stdin.destroyed && !child.stdin.writableEnded) child.stdin.end();
  })();

  /** Fail with `why`, given the exec's words (its stderr and its end) once it is gone. */
  const fail = async (why: (exec: string) => string, cause?: unknown): Promise<never> => {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onAbort);
    stopPump.abort();
    const end = await killAndWait(child);
    await within(pump, EXEC_END_GRACE_MS);
    throw new SandboxError(`${at}: ${why(execWords(stderr(), end))}`, cause === undefined ? undefined : { cause });
  };

  const line = await ack.line;
  if (line !== null) {
    const verdict = parseUnpackAck(line);
    if (verdict === null) return await fail((exec) => `the stager answered ${shownBytes(line)}, no ack (${exec})`);
    if (!verdict.ok) return await fail(() => `the stager refused the stream: ${verdict.why}`);
    // The ack comes once the closing frame is read: the pump is at its end, or about to be.
    await within(pump, Math.max(EXEC_END_GRACE_MS, allowed() - (Date.now() - started)));
    if (packError !== null) return await fail(() => `the host trees could not be staged: ${(packError as Error).message}`, packError);
    if (!packDone) return await fail((exec) => `the stager acknowledged before the whole stream was sent (${sent} bytes; ${exec})`);
    const t = pack.totals;
    if (verdict.entries !== t.entries || verdict.bytes !== t.bytes) {
      return await fail(() => `the stager acknowledged ${verdict.entries} entries and ${verdict.bytes} bytes, but the stream carried ${t.entries} and ${t.bytes}`);
    }
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onAbort);
    const ms = Date.now() - started;
    const ended = (async () => {
      if (!(await within(child.closed, STAGE_EXIT_GRACE_MS))) await killAndWait(child);
    })();
    return { entries: verdict.entries, bytes: verdict.bytes, streamBytes: sent, ms, ended };
  }
  if (packError !== null) return await fail(() => `the host trees could not be staged: ${(packError as Error).message}`, packError);
  if (timedOut) return await fail((exec) => `no ack within ${allowed()} ms (${sent} bytes sent; ${exec})`);
  if (aborted) return await fail((exec) => `cut off before the ack (${exec})`);
  if (ack.overlong()) return await fail((exec) => `the stager printed more than ${MAX_ACK_BYTES} bytes with no line (${exec})`);
  return await fail((exec) => `the stream ended with no ack (${exec})`);
}

/** Remove everything in `dir`, keeping `dir`, which must be a real directory (never a link to one). */
async function emptyDir(dir: string): Promise<void> {
  const st = await lstat(dir);
  if (!st.isDirectory()) throw new Error(`${dir} is not a directory`);
  for (const name of await readdir(dir)) await rm(join(dir, name), { recursive: true, force: true });
}

/**
 * Collect `mounts` from `pod`'s `watch` (the header's Collect) into their host directories: resolves to readTrees'
 * report per mount, in `mounts`' order, once the stream's closing frame and end are read; a SandboxError naming the
 * pod otherwise. Call it only once the program's exec has ended.
 */
export async function collectMounts(ctx: TransferContext, opts: CollectOptions): Promise<ReturnedTree[]> {
  checkName(POD_RE, opts.pod, 'pod');
  const shown = opts.mounts.map((m) => m.mount).join(', ');
  const at = `pod ${opts.pod}: the collect of ${shown}`;
  let argv: string[];
  try {
    argv = treePackArgv(opts.mounts.map((m) => ({ mount: m.mount, caps: m.returns })));
  } catch (err) {
    throw new SandboxError(`${at}: ${(err as Error).message}`, { cause: err });
  }
  for (const m of opts.mounts) {
    const st = await lstat(m.dir).catch((err: NodeJS.ErrnoException) => {
      throw new SandboxError(`${at}: host directory ${m.dir}: ${err.code ?? err.message}`, { cause: err });
    });
    if (!st.isDirectory()) throw new SandboxError(`${at}: host directory ${m.dir} (for ${m.mount}) is not a directory`);
  }
  for (const m of opts.mounts) {
    try {
      await emptyDir(m.dir);
    } catch (err) {
      throw new SandboxError(`${at}: could not empty ${m.dir} (for ${m.mount}): ${(err as NodeJS.ErrnoException).code ?? (err as Error).message}`, { cause: err });
    }
  }
  if (isAborted(opts.signal)) throw new SandboxError(`${at}: cut off before it started`);

  const budgetMs = collectBudgetMs(opts.mounts, opts.budget ?? TRANSFER_BUDGET);
  const bound = collectStreamBound(opts.mounts);
  const trees = opts.mounts.map((m) => ({ mount: m.mount, dir: m.dir, caps: m.returns }));
  const execArgs = ['-n', ctx.namespace, 'exec', opts.pod, '-c', WATCH_CONTAINER, '--', ...argv];
  // One budget for every attempt, counted from the first.
  const started = Date.now();
  for (let attempt = 1; ; attempt++) {
    const r = await collectOnce(ctx, execArgs, trees, opts.signal, bound, budgetMs, started);
    if (r.ok) return r.reports;
    const { words, err } = r;
    if (r.kind === 'timedOut') throw new SandboxError(`${at} sent no closing frame within ${budgetMs} ms (${words})`, { cause: err });
    if (r.kind === 'aborted') throw new SandboxError(`${at} was cut off (${words})`, { cause: err });
    if (r.kind === 'refused') throw new SandboxError(`${at} was refused: ${err instanceof Error ? err.message : String(err)} (${words})`, { cause: err });
    if (attempt >= COLLECT_ATTEMPTS) throw new SandboxError(`${at} ended without its closing frame after ${attempt} tries (${words})`, { cause: err });
    if (isAborted(opts.signal)) throw new SandboxError(`${at} was cut off (${words})`, { cause: err });
    // Once per retry, so a log tells a stream cut on the host (its end long after the exit) from one kubectl ended short.
    ctx.warn?.(`k8s sandbox: collect of ${shown} in pod ${opts.pod} was cut after ${r.bytes} bytes, ${r.afterExitMs ?? '?'} ms after the exec ended (${execEnd(r.end)}): try ${attempt + 1} of ${COLLECT_ATTEMPTS}`);
    try {
      for (const m of opts.mounts) await clearReplica(Buffer.from(m.dir));
    } catch (cleared) {
      // The replica cannot be made empty for another read: this attempt's cut is the answer.
      throw new SandboxError(`${at} ended without its closing frame (${words})`, { cause: cleared });
    }
  }
}

/**
 * Remove everything in `dir`, a real directory a cut collect attempt wrote into after it was emptied (so all of it
 * is the attempt's), keeping `dir`: never following a link, each directory given its owner's rwx back before it is
 * entered (a placeholder directory is mode 000). Names are taken as bytes, as the replica's may be any.
 */
async function clearReplica(dir: Buffer): Promise<void> {
  for (const name of await readdir(dir, { encoding: 'buffer' })) {
    const p = Buffer.concat([dir, Buffer.from('/'), name]);
    if ((await lstat(p)).isDirectory()) {
      await chmod(p, 0o700);
      await clearReplica(p);
      await rmdir(p);
    } else {
      await unlink(p);
    }
  }
}

type CollectAttempt =
  | { ok: true; reports: ReturnedTree[] }
  | {
      ok: false;
      kind: 'timedOut' | 'aborted' | 'cut' | 'refused';
      words: string;
      err: unknown;
      end: KubectlEnd | null;
      /** The stream's bytes read. */
      bytes: number;
      /** From kubectl's exit to the end of its stdout; null when the stand-in cannot tell, or stdout had not ended. */
      afterExitMs: number | null;
    };

/**
 * One collect exec read into `trees` (the header's Collect): its stdout queued eagerly, paused while more than
 * COLLECT_QUEUE_HIGH_BYTES wait unread until the reader takes them below COLLECT_QUEUE_LOW_BYTES, its total bounded by
 * `bound`, the exec killed when the budget counted from `started` is spent or `signal` aborts. Its reports, or how it failed with
 * the exec's words.
 */
async function collectOnce(
  ctx: TransferContext,
  args: readonly string[],
  trees: { mount: string; dir: string; caps: ReturnCaps }[],
  signal: AbortSignal | undefined,
  bound: number,
  budgetMs: number,
  started: number,
): Promise<CollectAttempt> {
  const child = ctx.stream(args);
  child.stdin.on('error', () => undefined);
  child.stdout.on('error', () => undefined);
  child.stderr.on('error', () => undefined);
  child.stdin.end();
  const stderr = keepStderr(child);
  let timedOut = false;
  let aborted = false;
  const cancelTimer = afterMs(budgetMs - (Date.now() - started), () => {
    timedOut = true;
    child.kill();
  });
  const onAbort = (): void => {
    aborted = true;
    child.kill();
  };
  signal?.addEventListener('abort', onAbort, { once: true });
  // An abort may come while the exec starts (its listener is added after).
  if (isAborted(signal)) onAbort();
  // stdout is read as it comes, never at the reader's pace (the header): queued here, the reader fed from the queue,
  // stdout paused while more than COLLECT_QUEUE_HIGH_BYTES of it wait unread. Whether it is paused is read off stdout
  // itself (readableFlowing false), never kept here: Node resumes a child's paused stdout at its exit.
  const queue: Buffer[] = [];
  let queued = 0;
  let received = 0;
  let ended = false;
  let over = false;
  let wake: (() => void) | null = null;
  const notify = (): void => {
    const w = wake;
    wake = null;
    w?.();
  };
  child.stdout.on('data', (b: Buffer) => {
    if (ended) return;
    received += b.length;
    if (received > bound) {
      over = true;
      ended = true;
      queue.length = 0;
      queued = 0;
      child.kill();
    } else {
      queue.push(b);
      queued += b.length;
      if (queued > COLLECT_QUEUE_HIGH_BYTES && child.stdout.readableFlowing !== false) child.stdout.pause();
    }
    notify();
  });
  // The stream's end is stdout's own; a stdout closed or failed with no end (destroyed after the exit) is one too.
  let endedAt: number | null = null;
  const finish = (): void => {
    endedAt ??= Date.now();
    ended = true;
    notify();
  };
  child.stdout.once('end', finish);
  child.stdout.once('close', finish);
  child.stdout.once('error', finish);
  // Whether the reader was handed the end of the exec's stdout: then a reader that throws met a stream with no
  // closing frame, and one that throws before it refused what it read. Seen here, never read off the reader's words.
  let readerSawEnd = false;
  const source = (async function* (): AsyncGenerator<Buffer> {
    for (;;) {
      const b = queue.shift();
      if (b !== undefined) {
        queued -= b.length;
        if (queued < COLLECT_QUEUE_LOW_BYTES && child.stdout.readableFlowing === false) child.stdout.resume();
        yield b;
        continue;
      }
      if (over) throw new TreeStreamError(`the stream ran past ${bound} bytes, more than its mounts' returns can carry`);
      if (ended) break;
      await new Promise<void>((resolve) => (wake = resolve));
    }
    readerSawEnd = true;
  })();
  try {
    const reports = await readTrees(source, trees);
    // The closing frame and the stream's end are in: the exec has what is left of its budget to be gone.
    if (!(await within(child.closed, Math.max(EXEC_END_GRACE_MS, budgetMs - (Date.now() - started))))) await killAndWait(child);
    return { ok: true, reports };
  } catch (err) {
    const cut = readerSawEnd;
    const streamEndAt = endedAt;
    // What the reader left unread would hold the exec's end back (a child's close waits for its stdout): drop it first.
    child.stdout.destroy();
    queue.length = 0;
    const end = await killAndWait(child);
    const words = execWords(stderr(), end);
    const exitAt = child.exitedAt?.() ?? null;
    const afterExitMs = exitAt === null || streamEndAt === null ? null : streamEndAt - exitAt;
    return { ok: false, kind: timedOut ? 'timedOut' : aborted ? 'aborted' : cut ? 'cut' : 'refused', words, err, end, bytes: received, afterExitMs };
  } finally {
    cancelTimer();
    signal?.removeEventListener('abort', onAbort);
  }
}
