// Grading one entry: execute it twice, each time from a freshly materialized snapshot in a fresh
// sandbox, and require the two canonical action logs to be byte-equal.
//
//   execution 1 failed or timed out   -> that status, no score (execution 2 is not run)
//   execution 2 failed or timed out   -> that status, no score
//   both ok, logs differ              -> `nondeterministic`: scored from execution 1, never ranked
//   both ok, logs byte-equal          -> `finished`: scored, ranked (eligibility permitting)
//
// The score (score.ts) is built from execution 1's action log by the plan's pure scorer, the cost and
// the authorship summary passed in (under a program/v1 size count, the entry's code size too:
// GradeRequest.size), and the facts recorded on the run: harness_version (harness
// source sha + Node version), the image digest, the dataset digest and the seed. The outcome also
// carries the plan's fail key (the failed-tx draw's key, not in the score JSON: secret on the final
// phase until it is finalized), which the run must keep for its regrades. A replay harness's scorer also
// returns execution 1's trace (harnesses.ts Scored.trace, grader/trace.ts), a program/v1 scorer its
// checks trace when it writes checks.json: the outcome carries it as canonical JSON with the sha256 of
// the blob it is stored as (trace_json, trace_sha256), beside the result and never inside it, so the
// result's bytes do not move with it. A breakdown that makes no trace (Scored.traceIssue: a malformed
// checks.json) never fails the grade: the reason is logged (GradeRequest.onTraceIssue), the outcome
// carries no trace, and the result is what it would be without the breakdown. Under a code-fastest
// timing heat (grader/code-heat.ts) a grade carries no timing: scoreWithTiming builds a program/v1
// score again with a timing verdict (the dev phase's provisional timing, the final's heat), only its
// performance and eligibility moving (grader/worker.ts writes it). Nothing here
// touches the database: record.ts stores the outcome. Harness faults (a dataset the sim refuses, the
// sandbox driver failing, a scorer misbehaving) are thrown so the job is retried, never recorded as
// the entry's failure.
//
// Entry secrets: the entry's source (SnapshotSource) may carry the entrant's env-lane entry secrets
// (SnapshotSource.secrets, NAME to value; grader/worker.ts opens them). executeOnce hands them to the plan's
// execution (harnesses.ts ExecuteContext.secrets), so both of a grade's executions, every case of a run per
// case, an L2 re-execution (regrade.ts) and each run a code heat times (code-heat.ts, its TimedEntry's
// snapshot) run the entry with the same values; the scorer never gets them. Every execution that leaves
// executeOnce is masked of every form of every value (run.ts maskExecution: its stderr SECRET_MARK, its error
// REDACTED_MARK), whatever the plan masked itself, so the outcome's stderr (record.ts putStderr's blob), its
// error (`execution <n>: …`) and its executions' errors hold none; and so is whatever executeOnce or gradeEntry
// throws (redactThrown: a SandboxError's tail, a ScorerError quoting a scorer's stderr over the entry's outputs).
// The action log never is: it is scored and compared byte for byte (grader/worker.ts scans it instead).
//
// Stopping: a grade handed a signal (GradeRequest.signal: its job attempt's, which pg-boss aborts once it
// gives the attempt up at its expiry) stops once it aborts. Every program it starts runs in a sandbox
// bound to the signal (stoppableSandbox): the abort kills the program running (its container with it, on
// the docker driver; a pod it opened closed, on the k8s one-pod view; a session it opened closed, a run per case's on a
// driver with sessions), and nothing starts after it, so a run per case (program.ts executeProgram) stops
// between cases and the second execution and the scorer never start. Its scratch is removed as ever, and
// gradeEntry rejects with the signal's reason, no outcome built: nothing is recorded, and the error is no
// PermanentJobError, so the job's retry grades it afresh.
//
// Scratch: each execution and the scorer work in a fresh private directory under the request's work
// root, removed as they end (removeScratch): `exec-XXXXXX` and `score-XXXXXX`. A process that dies
// mid-grade leaves them behind, and in a work root that outlives the process (the pipeline's,
// server/pipeline/index.ts) nothing can tell a dead grade's from a live one's by name. A grade with
// an owner (GradeRequest.owner: whose grade it is, the same on every attempt of it and no other's,
// e.g. its job's) names them for it, `exec-<owner>-XXXXXX` and `score-<owner>-XXXXXX` (regrade.ts
// ownedScratch, EXEC_SCRATCH_PREFIX, SCORE_SCRATCH_PREFIX), and first removes what an earlier attempt
// of the same owner left (reapGradeScratch); a sweep that knows which owners are live can remove the
// rest by the same names.
//
// Heartbeat: every directory named for an owner carries SCRATCH_HEARTBEAT_FILE, which this process
// rewrites every SCRATCH_HEARTBEAT_MS while the directory's run lasts (keepScratchAlive, started by
// regrade.ts ownedScratch; stopped by removeScratch, or by the directory going). It is a direct entry,
// so the workers' start (server/pipeline/index.ts sweepDeadWork), which removes such a directory only
// once its newest change, its own or a direct entry's, is older than STALE_AFTER_MS's six hours, never
// takes a live run's: not even one on another database sharing the work root whose processes no
// process listing here can see (the docker driver's, in containers).
//
// Releasing (grader/sandbox/docker.ts releaseRemovedTrees, its header's Releasing): on Docker Desktop the VM keeps a
// host file descriptor on every entry of a tree a container looked up until the tree is looked up again from inside the
// VM, a removal on the host notwithstanding, and a host whose vnodes run dry fails every open (ENFILE, #226). So a
// scratch tree removed here is handed to the sandbox to release (releaseScratch: one release container a parent on a
// docker sandbox whose daemon is in a VM, nothing on Linux or another driver), once, after it is gone and after what
// ran in it is settled. Which trees removeScratch releases on its own: the scratch roots this process handed out and
// holds until it removes them, an execution's and a scorer's (scratchDir), every one named for an owner (regrade.ts
// ownedScratch, beating: the hindsight audit's, a trial's, a regrade's) and one its caller holds (holdScratch: a bars
// dev run's, a seeding compile attempt's, an ownerless scrape heat's (worker.ts runScrapeHeatFor), a regrade's
// ownerless one, a CLI command's root once its sandbox is picked, an agent pass's and its scoring's (agent.ts runTrial,
// scoreTrialWithChecks), a scrape trial's and its scoring's (scrape/trial.ts runScrapeTrial, scrape/score.ts
// scoreScrapeTrial), the agent pilot's own world (scripts/agent/pilot.ts prepareWorld)). A tree removed under a root
// still held is left to that root's release, which takes everything the VM cached under it in the same lookup: a run
// per case (program.ts) costs no release container of its own, nor an execution inside a held root, nor a pack build's
// runs inside a compile attempt's, nor an agent pass's or a scrape trial's scratch inside the root its caller holds
// (worker.ts's, a CLI's, the pilot's). Anything else removed (a
// sub-directory, a dead run's leftovers) is released by whoever removed it, as one batch (removeScratch's `released`,
// then releaseScratch): a reap releases what it removed once, at its end, or hands it to its caller (regrade.ts
// reapScratch's `released`); gradeEntry hands its executions' and scorer's scratch, and what it reaped, to one release
// once its outcome is built (or it threw), so a release never runs between a grade's executions, never moves its
// timing or its log, and never fails it (it never throws). A code heat's timer does the same for each run it measures
// (code-heat.ts openCodeTimer's measure): the run's scratch is released once the clock's reading after it is taken (or
// it threw), so no release runs between a run's two readings or moves its CPU time. A trial's and an audit's handlers
// (worker.ts livePass, interrupted, replay, scorePass, hindsight auditOne) hand all they remove to one release in a
// `finally`, once their outcome is recorded (the trial row moved, its void or score written, the audit's record kept)
// or they threw, so no release stands before a recorded end (liveFinishedAt, replayFinishedAt) or between an audit and
// its record.

import { randomBytes } from 'node:crypto';
import { chmod, lstat, mkdir, mkdtemp, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { ProgramEntryLinkScore, type AuthorshipSummaryT, type CostT, type PerformanceT, type ProgramEntryLinkScoreT, type ScoreSizeT, type ScoreT } from '../contracts/score.ts';
import type { BlobStore } from '../server/blobstore.ts';
import type { EntryLinkRecord } from '../server/db/schema.ts';
import { materializeSnapshot, removeMaterialized, type SnapshotIndex } from '../server/repos/index-tar.ts';
import { scorerVersionOf, type ExecuteContext, type HarnessPlan, type ScoreContext } from './harnesses.ts';
import type { OutputBlobs } from './program.ts';
import type { ScratchReap } from './regrade.ts';
import { entrySecretForms, maskExecution, redactSecrets, type Execution, type LimitsT } from './run.ts';
import { buildScore, scoreDigest, type EligibilityRules, type TimingVerdictT } from './score.ts';
import type { FormSet } from './gateway/secret-mask.ts';
import { releaseRemovedTrees } from './sandbox/docker.ts';
import {
  SandboxError,
  type MeteredProcess,
  type PodMember,
  type Runtime,
  type Sandbox,
  type SandboxPod,
  type SandboxPodPlan,
  type SandboxPods,
  type SandboxProcess,
  type SandboxSession,
  type SandboxSessions,
  type SandboxSpec,
  type TreeMeter,
  type TreeMeterOptions,
} from './sandbox/types.ts';
import { isOwn, unlockOwn } from './sandbox/unlock.ts';
import { encodeTrace } from './trace.ts';
import { harnessVersion } from './version.ts';

export type GradeStatus = 'finished' | 'failed' | 'timeout' | 'nondeterministic';

/**
 * An entry as an execution takes it (executeOnce): its snapshot, and the env-lane entry secrets every execution of it
 * runs with (the header's `Entry secrets`).
 */
export interface SnapshotSource {
  index: SnapshotIndex;
  blobs: BlobStore;
  /**
   * The entrant's env-lane entry secrets, NAME to value (contracts/entry-secrets.ts; grader/worker.ts opens them: a
   * grade the entrant's active ones, an L2 and a code heat its run's recorded ones): each execution's
   * ExecuteContext.secrets, so the entry's own sandbox gets them on every run of it from this source (both of a grade's
   * executions, every case of a run per case, a timed run), and every word of an execution masked of them. Never the
   * scorer's. Absent or empty: none.
   */
  secrets?: Readonly<Record<string, string>>;
}

/**
 * `err` with every form in `forms` redacted out of its message and stack (run.ts redactSecrets): what a grade, an
 * execution or a regrade throws past its entry's secrets (a SandboxError quoting a tail, a ScorerError quoting the
 * scorer's stderr over outputs the entry wrote) says none of them. The same object, so its class and cause stand.
 */
export function redactThrown(err: unknown, forms: FormSet | null): unknown {
  if (forms === null || !(err instanceof Error)) return err;
  const message = redactSecrets(err.message, forms);
  if (message !== err.message) err.message = message;
  if (typeof err.stack === 'string') {
    const stack = redactSecrets(err.stack, forms);
    if (stack !== err.stack) err.stack = stack;
  }
  return err;
}

export interface EntryFacts {
  house: boolean;
  baseline: boolean;
  /**
   * The entry's public link as the entry-link stage resolved it (server/db/schema.ts EntryLinkRecord), the submission's
   * own record, when the bundle's harness names one (contracts/competition.ts ProgramHarness.entry_link): a pump.fun
   * record holding both times fills the score's launch (entryLinkFactsOf, contracts/score.ts
   * ProgramPerformance.entry_link). Absent or null: no launch, and the grade is what it was; a record missing a time or
   * another platform's never fails a grade.
   */
  entry_link?: EntryLinkRecord | null;
}

/**
 * The launch a program/v1 score carries (contracts/score.ts ProgramEntryLinkScore): the entry's pump.fun record
 * (server/db/schema.ts PumpfunEntryLinkRecord, written by the entry-link stage before grading) with its mint,
 * created_ms and elapsed_ms read, and its slot (null when the record holds none: written before the house read it).
 * Null for another platform's record, for a record with either time unread, and for none at all: a grade never fails
 * for it, the score just carries no launch. Exported for record.ts (scoreWithEntryLink) and the regrade
 * (grader/regrade.ts, which re-derives the block from the submission's record as it stands and so fails an L1 whose
 * record moved), and for tests. Structural, because a caller may hold only the record's facts (EntryLinkRecordFacts).
 */
export function entryLinkFactsOf(record: unknown): ProgramEntryLinkScoreT | null {
  if (record === null || typeof record !== 'object') return null;
  const r = record as EntryLinkRecordFacts;
  if (r.platform !== 'pumpfun' || typeof r.created_ms !== 'number' || typeof r.elapsed_ms !== 'number') return null;
  // The record's JSON is the database's (jsonb), so each value is held to the score's own shape: a malformed one is no
  // launch, never a failed grade. A record written before the slot was read carries none: the block names it null.
  const parsed = ProgramEntryLinkScore.safeParse({ mint: r.mint, created_ms: r.created_ms, elapsed_ms: r.elapsed_ms, slot: r.slot ?? null });
  return parsed.success ? parsed.data : null;
}

export interface GradeRequest {
  plan: HarnessPlan;
  sandbox: Sandbox;
  runtime: Runtime;
  snapshot: SnapshotSource;
  limits: LimitsT;
  /** An existing directory; every execution gets a fresh private directory under it, removed after. */
  workRoot: string;
  /** Where program/v1 outputs are kept (usually the same blob store as the snapshot). */
  blobs: OutputBlobs;
  cost: CostT;
  authorship: AuthorshipSummaryT | null;
  entry: EntryFacts;
  rules: EligibilityRules;
  /**
   * The entry's code size (grader/size.ts codeSize over the snapshot's entries and the kit's starter), counted upstream
   * as cost and authorship are: given exactly when the rules name a size count (rules.size), at its version, and absent
   * under none (score.ts buildScore refuses either otherwise, a TypeError).
   */
  size?: ScoreSizeT;
  /** Container name stem (default `grade`). */
  label?: string;
  /**
   * Whose grade this is, as a label value (grader/sandbox/network.ts TRIAL_OWNER_RE), the same on every
   * attempt of the grade and no other grade's (the pipeline's job owner, worker.ts regradeOwner): each
   * execution's and the scorer's scratch is named for it (`exec-<owner>-XXXXXX`, `score-<owner>-XXXXXX`),
   * and what an earlier attempt of it left under `workRoot` is removed before anything runs
   * (reapGradeScratch). Give one only where no other attempt of the owner can be live. Absent: `exec-XXXXXX`,
   * `score-XXXXXX`, as before. A TypeError when it is no label value.
   */
  owner?: string;
  /** Told what the removal of an earlier attempt's scratch took (and could not), each time it ran (an owner given). */
  onScratchReap?: (reaped: ScratchReap) => void;
  /**
   * Told why the scorer's breakdown made no trace (harnesses.ts Scored.traceIssue: a program/v1 scorer's malformed
   * checks.json), the run then storing none and its score standing as without it. Default: a line on stderr
   * (traceIssueLine).
   */
  onTraceIssue?: (issue: string) => void;
  /**
   * The job attempt's signal (server/jobs.ts JobContext.signal; the header's `Stopping`): once it aborts, the program
   * running is killed, nothing more starts, and gradeEntry rejects with its reason, nothing graded. Absent: never stopped.
   */
  signal?: AbortSignal;
}

/**
 * `sandbox` bound to `signal` (the header's `Stopping`): each program it starts is killed once the signal aborts, and once
 * it has, spawn, spawnMetered, meterTree, pods.open and sessions.open throw the signal's reason and start nothing. A pod it
 * opened (Sandbox.pods) is closed once the signal aborts, which kills its members, and once it has, the pod's spawn and
 * meter throw the signal's reason too; a session it opened (Sandbox.sessions) likewise: closed on the abort, its runs
 * killed, its spawn and meterTree then throwing the reason (stoppableSession). Everything else is the sandbox's own (its
 * removeTree too, so a stopped run's scratch is still removed; a driver without spawnMetered, pods or sessions still has
 * none), and it is still an instance of the sandbox's class. `sandbox` itself when there is no signal.
 */
export function stoppableSandbox<S extends Sandbox>(sandbox: S, signal: AbortSignal | undefined): S {
  if (signal === undefined) return sandbox;
  const spawn = (spec: SandboxSpec): SandboxProcess => {
    signal.throwIfAborted();
    return killedOnAbort(sandbox.spawn(spec), signal);
  };
  const metered = sandbox.spawnMetered;
  const spawnMetered =
    metered === undefined
      ? undefined
      : (spec: SandboxSpec, dir: string, meterOpts: TreeMeterOptions): MeteredProcess => {
          signal.throwIfAborted();
          const started = metered.call(sandbox, spec, dir, meterOpts);
          killedOnAbort(started.process, signal);
          return started;
        };
  const meter = sandbox.meterTree;
  const meterTree =
    meter === undefined
      ? undefined
      : (dir: string, opts: TreeMeterOptions): TreeMeter => {
          signal.throwIfAborted();
          return meter.call(sandbox, dir, opts);
        };
  const own = sandbox.pods;
  const pods: SandboxPods | undefined =
    own === undefined
      ? undefined
      : Object.freeze({
          open: (plan: SandboxPodPlan): SandboxPod => {
            signal.throwIfAborted();
            return stoppablePod(own.open(plan), signal);
          },
        });
  const ownSessions = sandbox.sessions;
  const sessions: SandboxSessions | undefined =
    ownSessions === undefined
      ? undefined
      : Object.freeze({
          open: (template: SandboxSpec): SandboxSession => {
            signal.throwIfAborted();
            return stoppableSession(ownSessions.open(template), signal);
          },
        });
  return new Proxy(sandbox, {
    get(target, prop) {
      if (prop === 'spawn') return spawn;
      if (prop === 'spawnMetered') return spawnMetered;
      if (prop === 'meterTree') return meterTree;
      if (prop === 'pods') return pods;
      if (prop === 'sessions') return sessions;
      const value: unknown = Reflect.get(target, prop, target);
      // Bound to the sandbox itself, so a driver's private fields are its own.
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

/** `proc`, killed once `signal` aborts (at once when it already has: aborted while the driver started it, as the listener would have). */
function killedOnAbort<P extends SandboxProcess>(proc: P, signal: AbortSignal): P {
  const stop = (): void => void proc.kill().catch(() => undefined);
  if (signal.aborted) {
    stop();
    return proc;
  }
  signal.addEventListener('abort', stop, { once: true });
  const off = (): void => signal.removeEventListener('abort', stop);
  proc.exited.then(off, off);
  return proc;
}

/**
 * `pod` bound to `signal` (stoppableSandbox's pods): closed once the signal aborts (at once when it already has), which
 * kills what its members run; once it has, spawn and meter throw the signal's reason and start nothing. Its own close()
 * drops the listener. Everything else is the pod's own, read on the pod itself (its private fields are its own).
 */
function stoppablePod(pod: SandboxPod, signal: AbortSignal): SandboxPod {
  const stop = (): void => void pod.close().catch(() => undefined);
  if (signal.aborted) stop();
  else signal.addEventListener('abort', stop, { once: true });
  const spawn = (member: PodMember) => {
    signal.throwIfAborted();
    return pod.spawn(member);
  };
  const meter = (opts: TreeMeterOptions): TreeMeter => {
    signal.throwIfAborted();
    return pod.meter(opts);
  };
  const close = (): Promise<void> => {
    signal.removeEventListener('abort', stop);
    return pod.close();
  };
  return new Proxy(pod, {
    get(target, prop) {
      if (prop === 'spawn') return spawn;
      if (prop === 'meter') return meter;
      if (prop === 'close') return close;
      const value: unknown = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

/**
 * `session` bound to `signal` (stoppableSandbox's sessions): closed once the signal aborts (at once when it already has),
 * which kills its live run, and each run it starts killed on the abort too; once it has, spawn and meterTree throw the
 * signal's reason and start nothing. Its own close() drops the listener. Everything else is the session's own, read on the
 * session itself (its private fields are its own); a session without meterTree still has none.
 */
function stoppableSession(session: SandboxSession, signal: AbortSignal): SandboxSession {
  const stop = (): void => void session.close().catch(() => undefined);
  if (signal.aborted) stop();
  else signal.addEventListener('abort', stop, { once: true });
  const spawn = (spec: SandboxSpec): SandboxProcess => {
    signal.throwIfAborted();
    return killedOnAbort(session.spawn(spec), signal);
  };
  const meter = session.meterTree;
  const meterTree =
    meter === undefined
      ? undefined
      : (dir: string, opts: TreeMeterOptions): TreeMeter => {
          signal.throwIfAborted();
          return meter.call(session, dir, opts);
        };
  const close = (): Promise<void> => {
    signal.removeEventListener('abort', stop);
    return session.close();
  };
  return new Proxy(session, {
    get(target, prop) {
      if (prop === 'spawn') return spawn;
      if (prop === 'meterTree') return meterTree;
      if (prop === 'close') return close;
      const value: unknown = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

/** `err`, or the signal's reason when the signal has aborted (the header's `Stopping`): what a stopped run threw is the stop's doing. */
function stoppedOr(err: unknown, signal: AbortSignal | undefined): unknown {
  return signal?.aborted === true ? signal.reason : err;
}

/** The prefix of an execution's scratch under its work root (executeOnce): `exec-XXXXXX`, with an owner `exec-<owner>-XXXXXX`. */
export const EXEC_SCRATCH_PREFIX = 'exec-';

/** The prefix of a scorer's scratch under its work root (scoreOnce): `score-XXXXXX`, with an owner `score-<owner>-XXXXXX`. */
export const SCORE_SCRATCH_PREFIX = 'score-';

/** Every prefix a grade's scratch is named with under its work root: an execution's and the scorer's. */
export const GRADE_SCRATCH_PREFIXES = [EXEC_SCRATCH_PREFIX, SCORE_SCRATCH_PREFIX] as const;

/** `owner` when it is a label value (grader/sandbox/network.ts TRIAL_OWNER_RE), else a TypeError: a caller's mistake, never the entry's or the sandbox's. */
async function checkGradeOwner(owner: string): Promise<string> {
  const { TRIAL_OWNER_RE } = await import('./sandbox/network.ts');
  if (typeof owner !== 'string' || !TRIAL_OWNER_RE.test(owner)) {
    throw new TypeError(`grade owner ${JSON.stringify(owner)} is no label value: lowercase [a-z0-9._-], at most 128 characters`);
  }
  return owner;
}

/**
 * The file a live run's owned scratch carries (the header's `Heartbeat`): rewritten every SCRATCH_HEARTBEAT_MS while
 * the run lasts, so its change time says the directory is in use however long the run goes untouched elsewhere.
 */
export const SCRATCH_HEARTBEAT_FILE = '.alive';

/** How often a live run's heartbeat file is rewritten: ten minutes, well inside STALE_AFTER_MS's six hours. */
export const SCRATCH_HEARTBEAT_MS = 10 * 60_000;

/** One directory's heartbeat: its timer, the write in flight (one at a time), and whether it was stopped. */
interface Heartbeat {
  timer: ReturnType<typeof setInterval> | null;
  beat: Promise<void> | null;
  stopped: boolean;
}

/** Every heartbeat this process keeps, by the directory's absolute path. */
const heartbeats = new Map<string, Heartbeat>();

/**
 * The scratch roots this process holds beside the beating ones (the header's Releasing), by absolute path: an
 * execution's and a scorer's made for no owner (scratchDir) and each one a caller holds (holdScratch), until
 * removeScratch takes it or anything above it.
 */
const held = new Set<string>();

/** Whether `key` (an absolute path) is a scratch root this process holds now: beating, or held. */
function holdsRoot(key: string): boolean {
  return heartbeats.has(key) || held.has(key);
}

/** Whether a scratch root this process holds lies above `dir` (not `dir` itself): that root's release takes `dir` with it. */
function heldAbove(dir: string): boolean {
  let at = resolve(dir);
  for (let up = dirname(at); up !== at; at = up, up = dirname(at)) if (holdsRoot(up)) return true;
  return false;
}

/** Let go of the hold on `key` (an absolute path) and on every root held under it: removeScratch is taking them. */
function dropHeld(key: string): void {
  const below = key.endsWith(sep) ? key : `${key}${sep}`;
  for (const d of [...held]) if (d === key || d.startsWith(below)) held.delete(d);
}

/**
 * Hold `dir`, a scratch root its caller made and removes with removeScratch (the header's Releasing): until then
 * nothing removed under it (a grade's executions and scorer, say) is released on its own, and its removal releases it,
 * everything under it in the same lookup.
 */
export function holdScratch(dir: string): void {
  held.add(resolve(dir));
}

/**
 * Release `dirs`, scratch trees this process removed, from the sandbox's daemon (docker.ts releaseRemovedTrees, the
 * header's Releasing), but each under a root this process still holds, which that root's release takes: a docker
 * sandbox whose daemon is in a VM runs one release container a parent, any other sandbox nothing. Never throws.
 */
export async function releaseScratch(sandbox: Sandbox, dirs: readonly string[]): Promise<void> {
  await releaseRemovedTrees(sandbox, dirs.filter((d) => !heldAbove(d)));
}

/**
 * Rewrite `dir`'s heartbeat file (this process's pid and the time, so a look at it says whose run it is). Never throws:
 * `gone` when the directory is not there any more (its run removed it, or someone else did), `failed` on anything else
 * (the next beat tries again; meanwhile the directory only ages as it would without one).
 */
async function writeHeartbeat(dir: string): Promise<'ok' | 'gone' | 'failed'> {
  try {
    await writeFile(join(dir, SCRATCH_HEARTBEAT_FILE), `${process.pid} ${new Date().toISOString()}\n`, { mode: 0o600 });
    return 'ok';
  } catch (err) {
    const code = errno(err);
    return code === 'ENOENT' || code === 'ENOTDIR' ? 'gone' : 'failed';
  }
}

/** Stop `hb`, `dir`'s: no beat after this one starts, and the map forgets it. */
function dropHeartbeat(dir: string, hb: Heartbeat): void {
  hb.stopped = true;
  if (hb.timer !== null) clearInterval(hb.timer);
  if (heartbeats.get(dir) === hb) heartbeats.delete(dir);
}

/**
 * Give `dir` a heartbeat (the header's `Heartbeat`): its file written now, before the directory is handed out, then
 * every SCRATCH_HEARTBEAT_MS on a timer that never keeps the process up, until removeScratch takes the directory (or
 * anything under which it lies) or a beat finds it gone. A directory already beating keeps its one heartbeat.
 */
export async function keepScratchAlive(dir: string): Promise<void> {
  const key = resolve(dir);
  if (heartbeats.has(key)) return;
  const hb: Heartbeat = { timer: null, beat: null, stopped: false };
  heartbeats.set(key, hb);
  const first = writeHeartbeat(key);
  hb.beat = first.then(() => undefined);
  const wrote = await first;
  hb.beat = null;
  if (wrote === 'gone') {
    dropHeartbeat(key, hb);
    return;
  }
  if (hb.stopped) return;
  hb.timer = setInterval(() => {
    if (hb.stopped || hb.beat !== null) return;
    hb.beat = writeHeartbeat(key).then((r) => {
      hb.beat = null;
      if (r === 'gone') dropHeartbeat(key, hb);
    });
  }, SCRATCH_HEARTBEAT_MS);
  hb.timer.unref();
}

/**
 * Stop the heartbeat of `dir` and of every directory under it, each beat in flight awaited, so nothing writes into
 * the tree once this returns (removeScratch, before it removes anything).
 */
export async function stopScratchHeartbeats(dir: string): Promise<void> {
  const top = resolve(dir);
  const below = top.endsWith(sep) ? top : `${top}${sep}`;
  const inFlight: Promise<void>[] = [];
  for (const [key, hb] of [...heartbeats]) {
    if (key !== top && !key.startsWith(below)) continue;
    dropHeartbeat(key, hb);
    if (hb.beat !== null) inFlight.push(hb.beat);
  }
  await Promise.all(inFlight);
}

/** The directories this process keeps a heartbeat for now, sorted (absolute paths). */
export function beatingScratch(): string[] {
  return [...heartbeats.keys()].sort();
}

/**
 * A fresh private scratch directory under `root`, a root this process holds until removeScratch takes it (the header's
 * Releasing): `<prefix>XXXXXX`, or with an owner `<prefix><owner>-XXXXXX` (regrade.ts ownedScratch, beating).
 */
async function scratchDir(root: string, prefix: string, owner: string | undefined): Promise<string> {
  if (owner === undefined) {
    const dir = await mkdtemp(join(root, prefix));
    held.add(resolve(dir));
    return dir;
  }
  const checked = await checkGradeOwner(owner);
  // Loaded when used: regrade.ts imports this module.
  const { ownedScratch } = await import('./regrade.ts');
  return ownedScratch(root, prefix, checked);
}

/**
 * What an earlier attempt of `owner`'s grade left under `workRoot`, removed: every execution's and scorer's
 * scratch named for it (`exec-<owner>-XXXXXX`, `score-<owner>-XXXXXX`; regrade.ts reapScratch, each removed as
 * its run would have removed it). Never another owner's, an ownerless one, or a link. Run it only while no
 * attempt of `owner` is live (a job's attempt, once it holds the job). What it removed is released from the sandbox's
 * daemon in one go (releaseScratch; the header's Releasing), or, given `released`, handed there for the caller to
 * release with the rest (gradeEntry). Never throws for what it finds: what it could not list or remove is in `errors`;
 * a TypeError when `owner` is no label value.
 */
export async function reapGradeScratch(sandbox: Sandbox, workRoot: string, owner: string, released?: string[]): Promise<ScratchReap> {
  const checked = await checkGradeOwner(owner);
  const { reapScratch } = await import('./regrade.ts');
  const out: ScratchReap = { owner: checked, dirs: [], errors: [] };
  // Each prefix's removals handed here (reapScratch's `released`), for the one release below or the caller's.
  const removed: string[] = [];
  for (const prefix of GRADE_SCRATCH_PREFIXES) {
    const r = await reapScratch(sandbox, workRoot, prefix, checked, null, removed);
    out.dirs.push(...r.dirs);
    out.errors.push(...r.errors);
  }
  if (released !== undefined) released.push(...removed);
  else await releaseScratch(sandbox, removed);
  return out;
}

export interface ExecutionSummary {
  status: Execution['status'];
  error: string | null;
  wall_ms: number;
  flags: string[];
  action_log_sha256: string | null;
  exit_code: number | null;
  stderr_bytes: number;
}

export interface GradeOutcome {
  status: GradeStatus;
  error: string | null;
  executions: ExecutionSummary[];
  /** Execution 1's canonical action log (stored as a blob named by its sha256). */
  action_log_json: string | null;
  action_log_sha256: string | null;
  result: ScoreT | null;
  result_sha256: string | null;
  /**
   * The run's trace (contracts/breakdown.ts; grader/trace.ts) as canonical JSON: execution 1's run row by row, what
   * the scorer returned beside the score (harnesses.ts Scored.trace; program/v1: its scorer's checks trace). Null
   * when nothing was scored, the harness makes none (a program/v1 scorer that writes no checks.json) or the
   * breakdown made none (GradeRequest.onTraceIssue). Never part of result.
   */
  trace_json: string | null;
  /** sha256 of the blob the trace is stored as (grader/trace.ts traceBlob: the gzip of trace_json): what run.trace_sha256 names. */
  trace_sha256: string | null;
  /** Flags the executions raised (run.flags). */
  flags: string[];
  /** Total wall time of the executions. */
  wall_ms: number;
  /** stderr of the execution that decided the status (the failing one, else execution 1). */
  stderr: Buffer;
  image_digest: string | null;
  harness_version: string;
  scorer_version: string;
  dataset_sha256: string | null;
  seed: string;
  /**
   * The failed-tx draw's key the executions and the scorer used (u64 decimal; null for program/v1):
   * an execution fact a regrade needs (the action log does not carry it). Secret on the final phase
   * until it is finalized: stored with the run; published once the phase is finalized (or the
   * competition resolved), so anyone can then L1-regrade a final run
   * (server/routes/_lib/visibility.ts runFailKeyFor).
   */
  fail_key: string | null;
  exec_count: number;
  started_at: Date;
  finished_at: Date;
}

function summarize(e: Execution): ExecutionSummary {
  return {
    status: e.status,
    error: e.error,
    wall_ms: e.wall_ms,
    flags: e.flags,
    action_log_sha256: e.log_sha256,
    exit_code: e.exit?.code ?? null,
    stderr_bytes: e.stderr.length,
  };
}

/**
 * The directories under `dir` (itself included) the sandbox user could write into, none inside
 * another: this process's own world-writable ones (the writable mounts, /output and /scores, made
 * 0777 for that user) and any directory that is not this process's (one that user made). Everything
 * else is this process's own, with nothing of the sandbox user's in it. Never follows a link.
 */
async function sandboxWritable(dir: string): Promise<string[]> {
  const found: string[] = [];
  const walk = async (d: string): Promise<void> => {
    let st;
    try {
      st = await lstat(d);
    } catch {
      return;
    }
    if (!st.isDirectory()) return;
    if (!isOwn(st) || (st.mode & 0o002) !== 0) {
      found.push(d);
      return;
    }
    for (const e of await readdir(d, { withFileTypes: true }).catch(() => [])) if (e.isDirectory()) await walk(join(d, e.name));
  };
  await walk(dir);
  return found;
}

/**
 * Remove a scratch directory the sandbox may have written into. This process's own directories in it
 * get their rwx back first (sandbox/unlock.ts); then only the directories the sandbox user could write
 * go to sandbox.removeTree (on Linux the docker driver deletes what that user made from a container
 * running as that user, which can enter those directories and no other of ours; the k8s driver's
 * trees came back as this process's own, so its removeTree is unlockOwn and rm, no pod; removeWritable); the
 * rest is this process's own and goes with removeOwnTree. A tree the program nested past PATH_MAX is
 * deleted all the same, never a harness fault. Every private (0700) scratch root goes through here,
 * never to removeTree itself: an execution's and a scorer's (below), the hindsight audit's (worker.ts)
 * and the pipeline's own work root (server/pipeline/index.ts). The heartbeat of `dir` and of anything
 * under it stops first (stopScratchHeartbeats; the header's `Heartbeat`): its run is over, and a removal
 * that fails part-way leaves what it could not take to age as a dead run's. Once it is gone the sandbox's daemon is
 * told (releaseScratch; the header's Releasing): given `released`, `dir` goes there whatever it is, for the caller to
 * release with the rest of what it removes; else `dir` is released here when it is a scratch root this process
 * holds (scratchDir, ownedScratch, holdScratch) and no root it still holds lies above it, and not otherwise. Every
 * hold on `dir` and on what is under it ends here, the removal failing or not.
 */
export async function removeScratch(sandbox: Sandbox, dir: string, released?: string[]): Promise<void> {
  const key = resolve(dir);
  const root = holdsRoot(key);
  dropHeld(key);
  await stopScratchHeartbeats(dir);
  await unlockOwn(dir);
  for (const writable of await sandboxWritable(dir)) await removeWritable(sandbox, writable);
  await removeOwnTree(dir);
  if (released !== undefined) released.push(dir);
  else if (root) await releaseScratch(sandbox, [dir]);
}

/**
 * sandbox.removeTree(dir) for a directory the sandbox user could write. Where the driver deleted with
 * this process's own rm and met a tree nested past PATH_MAX (ENAMETOOLONG: the process driver, whose
 * program ran as this process's user, or the k8s driver, whose trees came back through the collect's
 * reader as this process's own; either way the tree is this process's own), removeOwnTree instead;
 * the docker driver takes such a tree to its reclaim container itself.
 */
export async function removeWritable(sandbox: Sandbox, dir: string): Promise<void> {
  try {
    await sandbox.removeTree(dir);
  } catch (err) {
    if (errno(err) !== 'ENAMETOOLONG') throw err;
    await removeOwnTree(dir);
  }
}

/**
 * The longest path removeOwnTree hands readdir, chmod and rename while it lifts a deep tree: half of
 * macOS's PATH_MAX (1024, the shorter platform's), so an entry's name (at most 255 bytes) still fits
 * after it.
 */
const LIFT_AT_BYTES = 512;

/**
 * rm -r for a tree of this process's own, however deep. Where rm meets a path past PATH_MAX
 * (ENAMETOOLONG: a program chdir'd its way down), every directory whose path passes LIFT_AT_BYTES is
 * renamed up to a fresh name directly under `dir`, and each of this process's own directories on the
 * way gets its owner's rwx back (a program running as this user may have left one read-only); then
 * rm runs again over what is now a shallow tree. Every other failure is rm's own, thrown; so is
 * ENAMETOOLONG when `dir` itself is too long to lift anything under.
 */
export async function removeOwnTree(dir: string): Promise<void> {
  try {
    await rm(dir, { recursive: true, force: true });
    return;
  } catch (err) {
    if (errno(err) !== 'ENAMETOOLONG' || Buffer.byteLength(dir) >= LIFT_AT_BYTES) throw err;
  }
  const tag = randomBytes(6).toString('hex');
  let lifted = 0;
  const stack = [dir];
  while (stack.length > 0) {
    const d = stack.pop()!;
    await ownerRwx(d);
    for (const e of await readdir(d, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      let p = join(d, e.name);
      if (Buffer.byteLength(p) > LIFT_AT_BYTES) {
        // A directory moving to another parent needs its own write bit too (Linux).
        await ownerRwx(p);
        const up = join(dir, `.lifted-${tag}-${++lifted}`);
        await rename(p, up);
        p = up;
      }
      stack.push(p);
    }
  }
  await rm(dir, { recursive: true, force: true });
}

/** Give `dir`, when it is this process's own directory, its owner's rwx (every other bit kept). */
async function ownerRwx(dir: string): Promise<void> {
  const st = await lstat(dir);
  if (st.isDirectory() && isOwn(st) && (st.mode & 0o700) !== 0o700) await chmod(dir, (st.mode & 0o7777) | 0o700);
}

function errno(err: unknown): string | undefined {
  return (err as NodeJS.ErrnoException | null)?.code;
}

export interface ExecuteOnceOptions {
  plan: HarnessPlan;
  sandbox: Sandbox;
  runtime: Runtime;
  snapshot: SnapshotSource;
  limits: LimitsT;
  workRoot: string;
  blobs: OutputBlobs;
  label: string;
  imageDigest: string | null;
  /** Whose execution this is (GradeRequest.owner): its scratch is `exec-<owner>-XXXXXX`; absent `exec-XXXXXX`. */
  owner?: string;
  /** Stops it (GradeRequest.signal; the header's `Stopping`): the program killed, nothing more started, and the signal's reason thrown, never an execution. */
  signal?: AbortSignal;
  /**
   * Where its scratch goes once removed, for the caller to release with the rest (gradeEntry: once its outcome is
   * built; code-heat.ts openCodeTimer: once the clock's reading after the run is taken; the header's Releasing).
   * Absent: released from the sandbox's daemon as it is removed (removeScratch).
   */
  released?: string[];
}

/**
 * One execution from a freshly materialized snapshot in a fresh scratch directory (removed after, then released: the
 * header's Releasing). Under a signal that aborts before it ends (the header's `Stopping`) it throws the signal's
 * reason, its scratch removed all the same.
 */
export async function executeOnce(o: ExecuteOnceOptions): Promise<Execution> {
  o.signal?.throwIfAborted();
  const secrets = o.snapshot.secrets;
  const forms = entrySecretForms(secrets);
  const dir = await scratchDir(o.workRoot, EXEC_SCRATCH_PREFIX, o.owner);
  const botDir = join(dir, 'bot');
  const workDir = join(dir, 'work');
  try {
    await materializeSnapshot(o.snapshot.index, o.snapshot.blobs, botDir);
    await mkdir(workDir, { mode: 0o700 });
    const ctx: ExecuteContext = {
      sandbox: stoppableSandbox(o.sandbox, o.signal),
      runtime: o.runtime,
      botDir,
      limits: o.limits,
      workDir,
      blobs: o.blobs,
      label: o.label,
      imageDigest: o.imageDigest,
      ...(secrets === undefined || forms === null ? {} : { secrets }),
    };
    const execution = await o.plan.execute(ctx);
    // A run the stop cut short (its program killed: a failed case, a failed execution) is no execution.
    o.signal?.throwIfAborted();
    // Masked however the plan ran it (the header's `Entry secrets`): no execution leaves here holding a form of a value.
    return maskExecution(execution, forms);
  } catch (err) {
    throw redactThrown(stoppedOr(err, o.signal), forms);
  } finally {
    await removeMaterialized(botDir).catch(() => undefined);
    await removeScratch(o.sandbox, dir, o.released);
  }
}

/**
 * Score a log in a fresh scratch directory (removed after, then released as executeOnce's is, or handed to `released`:
 * the header's Releasing): `score-XXXXXX`, with an owner (GradeRequest.owner) `score-<owner>-XXXXXX`. Under a signal
 * that aborts before it ends (the header's `Stopping`) the scorer is killed and this throws the signal's reason.
 */
export async function scoreOnce<Log>(plan: HarnessPlan<Log>, base: Omit<ScoreContext, 'workDir'>, workRoot: string, log: Log, owner?: string, signal?: AbortSignal, released?: string[]) {
  signal?.throwIfAborted();
  const dir = await scratchDir(workRoot, SCORE_SCRATCH_PREFIX, owner);
  try {
    const scored = await plan.score({ ...base, sandbox: stoppableSandbox(base.sandbox, signal), workDir: dir }, log);
    signal?.throwIfAborted();
    return scored;
  } catch (err) {
    throw stoppedOr(err, signal);
  } finally {
    await removeScratch(base.sandbox, dir, released);
  }
}

/** The line a grade logs when its scorer's breakdown made no trace (GradeRequest.onTraceIssue's default). */
export function traceIssueLine(label: string, issue: string): string {
  return `[grade] ${label}: no trace is stored, the score standing as without one: ${issue}`;
}

/** Every runtime image the plan needs is present (or the driver refuses), before anything runs. */
export async function preflight(plan: HarnessPlan, sandbox: Sandbox, runtime: Runtime, imageDigest: string | null): Promise<void> {
  if (!plan.runtimes.includes(runtime)) throw new SandboxError(`the competition does not accept ${runtime} (accepts ${plan.runtimes.join(', ')})`);
  await sandbox.preflight(runtime, imageDigest);
  for (const r of plan.extraRuntimes) await sandbox.preflight(r);
}

/** A grade that fails before anything runs (no entrypoint, a runtime the competition refuses): the entry's failure, recorded like any other. */
export function refusedGrade(plan: HarnessPlan, error: string): GradeOutcome {
  const at = new Date();
  return {
    status: 'failed',
    error,
    executions: [],
    action_log_json: null,
    action_log_sha256: null,
    result: null,
    result_sha256: null,
    trace_json: null,
    trace_sha256: null,
    flags: [],
    wall_ms: 0,
    stderr: Buffer.alloc(0),
    image_digest: null,
    harness_version: harnessVersion(),
    scorer_version: plan.scorerVersion,
    dataset_sha256: plan.datasetSha256,
    seed: plan.seed,
    fail_key: plan.failKey,
    exec_count: 0,
    started_at: at,
    finished_at: at,
  };
}

/**
 * Grade an entry: execute twice, compare the canonical action logs, score execution 1's. With an owner, what an
 * earlier attempt of it left under the work root goes first (reapGradeScratch), and this one's scratch is named for it.
 * Under a signal that aborts before it ends (GradeRequest.signal; the header's `Stopping`) it rejects with the signal's
 * reason, the program running killed and nothing more run: no outcome, so nothing to record. Everything of its
 * scratch it removed (its executions', its scorer's, what it reaped) is released from the sandbox's daemon in one go
 * once the outcome is built or the grade threw (releaseScratch; the header's Releasing), and a release changes
 * neither: it never throws.
 */
export async function gradeEntry(req: GradeRequest): Promise<GradeOutcome> {
  const removed: string[] = [];
  try {
    return await gradeIn(req, removed);
  } catch (err) {
    // Whatever stopped it (its scorer's fault quoting outputs the entry wrote, say) says none of the entry's secrets.
    throw redactThrown(err, entrySecretForms(req.snapshot.secrets));
  } finally {
    await releaseScratch(req.sandbox, removed);
  }
}

/** gradeEntry's grade, every scratch dir it removes handed to `removed` (for its one release). */
async function gradeIn(req: GradeRequest, removed: string[]): Promise<GradeOutcome> {
  const { signal } = req;
  signal?.throwIfAborted();
  const startedAt = new Date();
  const label = req.label ?? 'grade';
  const owner = req.owner === undefined ? undefined : await checkGradeOwner(req.owner);
  if (owner !== undefined) {
    const reaped = await reapGradeScratch(req.sandbox, req.workRoot, owner, removed);
    req.onScratchReap?.(reaped);
  }
  await preflight(req.plan, req.sandbox, req.runtime, null);
  // The entry's verified launch (entryLinkFactsOf), read once: a program/v1 score carries it
  // (contracts/score.ts ProgramPerformance.entry_link), so the board reads the launch off the score. Null for every
  // other record and for none at all: nothing changes.
  const launch = entryLinkFactsOf(req.entry.entry_link);
  const base = {
    plan: req.plan,
    sandbox: req.sandbox,
    runtime: req.runtime,
    snapshot: req.snapshot,
    limits: req.limits,
    workRoot: req.workRoot,
    blobs: req.blobs,
    imageDigest: null,
    ...(owner === undefined ? {} : { owner }),
    ...(signal === undefined ? {} : { signal }),
    released: removed,
  };
  const executions: Execution[] = [];
  const first = await executeOnce({ ...base, label: `${label}-1` });
  executions.push(first);
  if (first.status === 'ok') executions.push(await executeOnce({ ...base, label: `${label}-2` }));

  const outcome = (status: GradeStatus, error: string | null, stderr: Buffer): Omit<GradeOutcome, 'result' | 'result_sha256' | 'trace_json' | 'trace_sha256'> => ({
    status,
    error,
    executions: executions.map(summarize),
    action_log_json: first.log_json,
    action_log_sha256: first.log_sha256,
    flags: [...new Set(executions.flatMap((e) => e.flags))].sort(),
    wall_ms: executions.reduce((s, e) => s + e.wall_ms, 0),
    stderr,
    // A plan naming its own image (patch/v1's bounty image) ran in that one; the process driver runs in none.
    image_digest: req.sandbox.imageDigest(req.runtime) === null ? null : (req.plan.imageDigest ?? req.sandbox.imageDigest(req.runtime)),
    harness_version: harnessVersion(),
    scorer_version: scorerVersionOf(req.plan, req.sandbox),
    dataset_sha256: req.plan.datasetSha256,
    seed: req.plan.seed,
    fail_key: req.plan.failKey,
    exec_count: executions.length,
    started_at: startedAt,
    finished_at: new Date(),
  });

  const bad = executions.find((e) => e.status !== 'ok');
  if (bad !== undefined) {
    const n = executions.indexOf(bad) + 1;
    // No score, and no action log either: a run carries one exactly when it was scored.
    return {
      ...outcome(bad.status === 'timeout' ? 'timeout' : 'failed', `execution ${n}: ${bad.error}`, bad.stderr),
      action_log_json: null,
      action_log_sha256: null,
      result: null,
      result_sha256: null,
      trace_json: null,
      trace_sha256: null,
    };
  }
  const second = executions[1]!;
  const deterministic = first.log_json === second.log_json;
  const status: GradeStatus = deterministic ? 'finished' : 'nondeterministic';
  const error = deterministic ? null : `the two executions' action logs differ (${first.log_sha256} vs ${second.log_sha256})`;
  const log = req.plan.parseLog(first.log);
  // The run time the scorer may read (program.ts RUN_FILE): the executions' total and count, as record.ts stores them
  // (run.wall_ms, run.exec_count), so an L1 regrade hands the scorer the same (regrade.ts rescore).
  const run = { wall_ms_total: executions.reduce((s, e) => s + e.wall_ms, 0), executions: executions.length };
  const scored = await scoreOnce(req.plan, { sandbox: req.sandbox, blobs: req.blobs, limits: req.limits, run }, req.workRoot, log, owner, signal, removed);
  const partial = outcome(status, error, first.stderr);
  const result = buildScore(
    {
      harness: { kind: req.plan.kind, version: partial.harness_version },
      image_digest: partial.image_digest,
      dataset_sha256: partial.dataset_sha256,
      seed: partial.seed,
      deterministic,
      execution_flags: partial.flags,
      house: req.entry.house,
      baseline: req.entry.baseline,
    },
    {
      action_log_sha256: first.log_sha256!,
      // The entry's launch (contracts/score.ts ProgramEntryLinkScore), which the score carries: a house fact read from
      // the submission's record before grading, so the board reads it off the score and an L1 regrade rebuilds it
      // (regrade.ts rescore).
      performance: launch === null || scored.performance.kind !== 'program/v1' ? scored.performance : { ...scored.performance, entry_link: launch },
      performance_flags: scored.flags,
      cost: req.cost,
      authorship: req.authorship,
      size: req.size,
    },
    req.rules,
    partial.scorer_version,
  );
  // The trace is encoded apart from the score: buildScore never sees it, so result and result_sha256 are what they were without it.
  const trace = scored.trace === undefined ? null : encodeTrace(scored.trace);
  // A breakdown that made no trace never fails the grade (harnesses.ts Scored.traceIssue): said, and the run stores none.
  if (scored.traceIssue !== undefined) (req.onTraceIssue ?? ((issue: string) => console.warn(traceIssueLine(label, issue))))(scored.traceIssue);
  return { ...partial, finished_at: new Date(), result, result_sha256: scoreDigest(result).sha256, trace_json: trace?.json ?? null, trace_sha256: trace?.sha256 ?? null };
}

// ---------------------------------------------------------------- the entry's launch block
//
// performance.entry_link (contracts/score.ts ProgramEntryLinkScore) is the entry's own fact, never the
// scorer's: the submission's stored entry-link record (server/db/schema.ts EntryLinkRecord, written once at
// intake by the entry-link stage) is read here into the score a run stores (gradeEntry, from EntryFacts
// .entry_link; record.ts recordGrade fills one still absent from the row it records; regrade.ts rescore, from
// the record it is handed or the stored run's). A record that is no pumpfun record, or whose launch was not
// verified (created_ms or elapsed_ms null), leaves the score without the key: no grade, regrade or verify
// fails for a missing record.

/**
 * What the grader reads of a submission's stored entry-link record (server/db/schema.ts EntryLinkRecord): the
 * platform, and a pumpfun record's house-verified launch facts. Structural and all-optional, because the
 * record is a union by platform and a record stored before it carries none of these fields.
 */
export interface EntryLinkRecordFacts {
  platform?: unknown;
  mint?: unknown;
  created_ms?: unknown;
  elapsed_ms?: unknown;
  /** The create transaction's slot (see EntryLinkRecord): absent on a record written before the house read it. */
  slot?: unknown;
}

/**
 * `performance` with its entry's launch block (contracts/score.ts ProgramEntryLinkScore at performance.entry_link),
 * a program/v1 performance's alone: the same value when there is none, one is already there, or the performance
 * is another harness kind's. Every score before the key keeps its bytes.
 */
export function withEntryLink(performance: PerformanceT, entryLink: ProgramEntryLinkScoreT | null | undefined): PerformanceT {
  if (entryLink === undefined || entryLink === null || performance.kind !== 'program/v1' || performance.entry_link !== undefined) return performance;
  return { ...performance, entry_link: entryLink };
}

/** The launch block a stored score carries (performance.entry_link), when it is a program/v1 score's: undefined when it carries none, or it does not read. */
export function entryLinkOfScore(score: unknown): ProgramEntryLinkScoreT | undefined {
  const performance = (score as { performance?: unknown } | null | undefined)?.performance;
  if (performance === null || typeof performance !== 'object') return undefined;
  const p = performance as { kind?: unknown; entry_link?: unknown };
  if (p.kind !== 'program/v1') return undefined;
  const parsed = ProgramEntryLinkScore.safeParse(p.entry_link);
  return parsed.success ? parsed.data : undefined;
}

/**
 * `score` with performance.entry_link filled from the submission's stored entry-link record (withEntryLink), and the
 * digest it had when there was nothing to fill: the same score and result_sha256 then, byte for byte. What
 * record.ts recordGrade stores (the record is read from the row it records) so a grade's score carries the block
 * without any scorer seeing it; a null score stays null. A record that does not read changes nothing.
 */
export function scoreWithEntryLink(score: ScoreT | null, resultSha256: string | null, record: unknown): { result: ScoreT | null; result_sha256: string | null } {
  if (score === null) return { result: null, result_sha256: null };
  const performance = withEntryLink(score.performance, entryLinkFactsOf(record));
  if (performance === score.performance) return { result: score, result_sha256: resultSha256 };
  const result: ScoreT = { ...score, performance };
  return { result, result_sha256: scoreDigest(result).sha256 };
}

/**
 * A program/v1 score built again with a timing verdict (score.ts ScoredInputs.timing: grader/code-heat.ts's heat, or
 * the dev phase's provisional timing): the score's own facts and inputs as they were (its performance's scores and
 * entry-link block, without the passed and the timing it was built with; its cost, authorship and size; its flags),
 * the entry's facts and the rules given, so only performance.passed, performance.timing and the eligibility move.
 * buildScore's TypeError for a verdict on an entry that did not pass. What grader/worker.ts writes on a timed run.
 */
export function scoreWithTiming(score: ScoreT, timing: TimingVerdictT, entry: EntryFacts, rules: EligibilityRules): { result: ScoreT; result_sha256: string } {
  const perf = score.performance;
  if (perf.kind !== 'program/v1') throw new TypeError(`a timing verdict is a program/v1 score's, and this score is ${perf.kind}`);
  const result = buildScore(
    {
      harness: score.harness,
      image_digest: score.image_digest,
      dataset_sha256: score.dataset_sha256,
      seed: score.seed,
      deterministic: !score.flags.includes('nondeterministic'),
      execution_flags: score.flags.filter((f) => f !== 'nondeterministic'),
      house: entry.house,
      baseline: entry.baseline,
    },
    {
      action_log_sha256: score.action_log_sha256,
      // The entry's launch block rides with the performance: the timing rebuild moves passed, timing and eligibility
      // alone, so a timed run's score keeps it (contracts/score.ts ProgramPerformance.entry_link).
      performance: { kind: perf.kind, scores: perf.scores, ...(perf.entry_link === undefined ? {} : { entry_link: perf.entry_link }) },
      performance_flags: [],
      cost: score.cost,
      authorship: score.authorship,
      ...(score.size === undefined ? {} : { size: score.size }),
      timing,
    },
    rules,
    score.scorer_version,
  );
  return { result, result_sha256: scoreDigest(result).sha256 };
}
