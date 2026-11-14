// The judge-contender job (server/jobs.ts judge-contender): a screened judged bundle's sealed dev contender rounds
// (grader/judge-contender.ts, agent-fun/judge-contender/v1), played on the graders, sent by the provisional-rejudge
// sweep once a dev phase and 15-minute slot (sendContenderRound). createContenderRoundHandler's job, in order:
//
//   off        the competition carries no provisional verdicts (server/routes/admin/grading.ts
//              provisionalRejudgeTargetOf refuses it, or the job's phase is not its dev phase), its judge is not
//              screened, contender_games is 0, it names no ladder or no one model (namedJudgeAgent), its dev seed is
//              not one this job reads (a pack bundle's is its trees' digest), or its judge directory or ladder does not
//              read: nothing is played, and no retry mends it
//   closed     now is at or past the competition's deadline: the chain's head never moves then
//              (server/grading/contender-select.ts advanceContenderHead), so no round is played
//   the chain  the dev phase's head (contenderHeadOf) and the chain behind it, read as a final's screen reads it
//              (grader/worker.ts contenderChainOf: every record from the blob store back to round 0, each its canonical
//              JSON, of its round, held against the chain before it by judgeContenderHold), unless the fold of the head
//              the row names is kept on disk (the fold memo: one file a head,
//              `<work root>/judge-contender/<phase>/fold/<head sha256>.json`, plain JSON; written only from a chain
//              contenderChainOf read whole, or from the round this job just held and linked, so it is that chain's fold)
//     broken     a chain that does not hold, or a head row that does not read: no round is played on it (the final's
//                screen leaves it out too), the job ends 'broken', and it is paged at most once a dev phase an hour
//                (BROKEN_PAGE_MS; the sweeps between log it), the page sealed. The head is moved only by this job,
//                after its record was stored, so either is the platform's: a lost or damaged blob, a hand-edited row
//   a round    up to contender_every_sweep of them, each built afresh: the field (contenderFieldOf, its record memo
//              under `<work root>/judge-contender/<phase>/field`), the players (contenderPlayersOf), the round's setup
//              (judgeContenderSetup: the bundle's judge and ladder, its design as the final holds a chain to it
//              (grader/judge-screen-inputs.ts judgeContenderDesignOf), round and `prev` from the chain, select from the
//              field, as members only the players entering the chain or whose snapshot changed, the chain's own house
//              text), then its schedule (judgeContenderSchedule)
//     idle       the round is empty (under two players with games left, or none active): nothing is sent or recorded.
//                A player with no contender game is always active (judge-contender.ts's schedule), so a round with a
//                newcomer and another player with games left is never idle: the chain keeps admitting players
//     deferred   the judge planner (GradeWorkerDeps.judge.plan, stage 'provisional', the round's seed) answers a plan for
//                an artifact the round judges, or cannot answer: the overflow switch would move that judging off the
//                bundle's own named judge, and a round is played on nothing else, so it waits for a later sweep. Said
//                once a dev phase an hour
//     played     the pairs' artifacts read from their players' latest dev grade runs' action logs (readOutputFile),
//                the round played (grader/worker.ts playContenderRound: its record stored as a blob, its calls kept
//                as they settle, so a retry asks only the calls still to come), then the head moved from the chain's
//                to it (tryAdvanceContenderHead) once its record holds against the chain (judgeContenderHold, as
//                contenderChainOf holds it). A move refused stops the job and leaves the record unlinked: no head
//                names it, so nothing ever reads it. The head's answer says why: at or past the deadline, by the
//                database's clock or this grader's, ends it 'closed' (a grader whose clock runs behind included);
//                another job moved the head first, or any other refusal, ends it 'unplayed'
//     unplayed   the round recorded nothing for a cause no retry mends (an unpriced judge model, too many calls with no
//                verdict, a setup the chain refuses, an artifact that no longer reads, a record that does not hold
//                against the chain, a field whose line is not the design's): the next sweep's job tries
//                afresh. A platform fault (a call that faulted again, no gateway) throws instead, so the job retries
//                from the calls kept
//
// Sealed (the owner's call: nothing serves a contender record, its sha256 or a figure derived from one before the
// deadline): every log line, the job's answer and every error it fails with carry counts only (the round, players,
// active players, games, calls), every sha256 masked; never a record's sha256 or a member's verdict, rating or rank.
// It writes no run, score, entry_artifact row or run.judge_heat_sha256: only the head row and the record blob. A job
// that dies for good is paged by server/pipeline/index.ts with its phase, its round (contenderRoundOf) and the error;
// a broken chain is paged here (deps.page), never by throwing, so it pages once an hour, not every 15-minute sweep.
//
// It names a new harness_version (grader/version.ts sums every grader/ source).

import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { and, eq } from 'drizzle-orm';
import { namedJudgeAgent, type ProgramHarnessT, type ProgramJudgeT } from '../contracts/competition.ts';
import { competition, phase } from '../server/db/schema.ts';
import type { ContenderHeadRefusalT } from '../server/grading/contender-select.ts';
import { PermanentJobError, type JobContext, type JobPayload } from '../server/jobs.ts';
import { compareCodeUnits } from '../sim/canonical.ts';
import type { JudgeContenderFoldT, JudgeContenderLadderT, JudgeContenderMemberT } from './judge-contender.ts';
import type { JudgePlannedCallT } from './judge-heat.ts';
import { readOutputFile } from './program.ts';
import { competitionDirOf, competitionSeedKey, contenderChainOf, judgeContenderLadderOf, judgedTreesOf, phaseSeed, playContenderRound, type GradeWorkerDeps, type JudgeWorkerPlan } from './worker.ts';

/** How a judge-contender job ended (the header): the reason its rounds stopped. */
export type ContenderJobEndedT = 'played' | 'idle' | 'off' | 'closed' | 'deferred' | 'unplayed' | 'broken';

/** A judge-contender job's answer: counts only (the header's sealed). */
export interface ContenderJobOutcome {
  phase_id: string;
  /** The rounds this job recorded and linked to the head. */
  rounds_played: number;
  ended: ContenderJobEndedT;
}

/** What the job reads and plays through: the grade jobs' deps (the judge's broker, pool and planner among them; `page` a broken chain's page, default console.error). */
export type ContenderJobDeps = Pick<GradeWorkerDeps, 'db' | 'blobs' | 'workRoot' | 'competitionDir' | 'judge' | 'log' | 'page' | 'now'>;

/** The fold memo's format (the header's chain): a new one when what is kept of a fold changes. */
const FOLD_MEMO_FORMAT = 'makefun/judge-contender-fold-memo/v1';

/** How often a deferral is said, per dev phase (the header's deferred). */
const DEFERRED_SAY_MS = 3_600_000;

/** How long after a dev phase's broken chain was paged it is paged again while it stands (the header's broken). */
const BROKEN_PAGE_MS = 3_600_000;

/** Why a played round's record was left unlinked, by why the head refused to move to it (tryAdvanceContenderHead). */
const HEAD_REFUSED: Readonly<Record<ContenderHeadRefusalT, string>> = {
  closed: 'the deadline passed as it played',
  stale: 'another job moved the head first',
  round: "the head's round is not the one before this round",
  unread: "the head's row does not read",
  gone: 'its dev phase is gone',
};

/** The round each error a job failed with was on (contenderRoundOf). */
const roundOfError = new WeakMap<object, number>();

/**
 * The round a judge-contender job's error was thrown on (the round it was setting up or playing), or null when it was
 * thrown before a round was set up (its chain, its trees) or is no error of the job's.
 */
export function contenderRoundOf(err: unknown): number | null {
  return typeof err === 'object' && err !== null ? (roundOfError.get(err) ?? null) : null;
}

/** `text` with every sha256 in it masked (the header's sealed). */
export function contenderSealedText(text: string): string {
  return text.replace(/[0-9a-f]{64}/gi, '(sha256)');
}

/**
 * `err` as the job fails with it (the header's sealed): itself when its message names no sha256, else an error of its
 * kind (a PermanentJobError stays one, so it still dead-letters) with the message masked and no cause, so neither
 * pg-boss's stored error nor a page carries one. An abort's reason passes as it is.
 */
function sealedError(err: unknown): unknown {
  if (!(err instanceof Error)) return new Error(contenderSealedText(String(err)));
  if (!/[0-9a-f]{64}/i.test(`${err.message}\n${err.stack ?? ''}`)) return err;
  const text = contenderSealedText(err.message);
  const out = err instanceof PermanentJobError ? new PermanentJobError(text) : new Error(text);
  out.stack = `${out.name}: ${text}`;
  return out;
}

/** Where a dev phase's contender memos are kept under the work root. */
function memoRootOf(workRoot: string, phaseId: string): string {
  return join(workRoot, 'judge-contender', phaseId.toLowerCase());
}

/** The fold kept for head `sha256`, or null with none that reads (missing, torn, another format, another head's). */
async function readFoldMemo(dir: string, sha256: string, round: number): Promise<JudgeContenderFoldT | null> {
  let text: string;
  try {
    text = await readFile(join(dir, `${sha256}.json`), 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
  try {
    const raw = JSON.parse(text) as { format?: unknown; fold?: JudgeContenderFoldT };
    if (raw.format !== FOLD_MEMO_FORMAT || raw.fold === undefined || raw.fold.head_sha256 !== sha256 || raw.fold.round !== round) return null;
    return raw.fold;
  } catch {
    return null;
  }
}

/** Keep `fold` whole or not at all, under its head: written beside, then renamed over its name. */
async function writeFoldMemo(dir: string, fold: JudgeContenderFoldT): Promise<void> {
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${fold.head_sha256}.json`);
  const tmp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tmp, `${JSON.stringify({ format: FOLD_MEMO_FORMAT, fold })}\n`);
  await rename(tmp, path);
}

/**
 * The dev phase's chain as the job extends it (the header's chain): the fold kept on disk for the head the row names, or
 * else the chain read and held whole as a final's screen reads it (grader/worker.ts contenderChainOf) and its fold kept
 * under its head. `{ fold: null }` with no head; `{ broken }`, saying why (every sha256 masked), when the chain does not
 * hold or its head's row does not read. A database or disk fault is thrown: a retry may mend it.
 */
async function chainOf(deps: Pick<ContenderJobDeps, 'db' | 'blobs'>, memoDir: string, phaseId: string): Promise<{ fold: JudgeContenderFoldT | null } | { broken: string }> {
  const { contenderHeadOf } = await import('../server/grading/contender-select.ts');
  let head: Awaited<ReturnType<typeof contenderHeadOf>> = null;
  try {
    head = await contenderHeadOf(deps.db, phaseId);
  } catch (err) {
    // A head row that does not read: contenderChainOf says so, as a final reads it.
    if (!(err instanceof TypeError)) throw err;
  }
  if (head !== null) {
    const kept = await readFoldMemo(memoDir, head.head_sha256, head.round);
    if (kept !== null) return { fold: kept };
  }
  const chain = await contenderChainOf(deps, phaseId);
  if ('broken' in chain) return { broken: contenderSealedText(chain.broken) };
  if ('none' in chain) return { fold: null };
  await writeFoldMemo(memoDir, chain.fold);
  return { fold: chain.fold };
}

/** The snapshot fields a member is held to between rounds (judge-contender.ts's continuity rule), as one comparable string. */
function snapshotKey(m: Pick<JudgeContenderMemberT, 'artifact_sha256' | 'artifact_bytes' | 'entries' | 'ladder_record_sha256' | 'ladder_games'>): string {
  return JSON.stringify([m.artifact_sha256, m.artifact_bytes, [...m.entries].sort(compareCodeUnits), m.ladder_record_sha256, m.ladder_games.map((g) => [g.b, g.a_points])]);
}

/**
 * The judge-contender job's handler (the header): `deps` the grade jobs' (its judge's broker, pool and planner). Its
 * answer carries counts only; a platform fault is thrown (the job retries from the calls kept), with its round
 * (contenderRoundOf) and sealed. A chain that does not hold ends the job 'broken', paged at most once an hour a phase.
 */
export function createContenderRoundHandler(deps: ContenderJobDeps): (data: JobPayload<'judge-contender'>, ctx: Pick<JobContext, 'id'> & Partial<Pick<JobContext, 'signal'>>) => Promise<ContenderJobOutcome> {
  const log = (line: string): void => (deps.log ?? ((l: string) => console.log(l)))(contenderSealedText(line));
  const page = (line: string): void => (deps.page ?? ((l: string) => console.error(l)))(contenderSealedText(line));
  const now = deps.now ?? (() => new Date());
  /** When each dev phase's deferral was last said (the header's deferred). */
  const deferredSaid = new Map<string, number>();
  /** When each dev phase's broken chain was last paged (the header's broken). */
  const brokenPaged = new Map<string, number>();

  return async (data, ctx) => {
    const phaseId = data.phase_id.toLowerCase();
    const end = (rounds_played: number, ended: ContenderJobEndedT): ContenderJobOutcome => ({ phase_id: phaseId, rounds_played, ended });
    const [row] = await deps.db
      .select({ comp: competition })
      .from(phase)
      .innerJoin(competition, eq(competition.id, phase.competitionId))
      .where(and(eq(phase.id, phaseId), eq(phase.key, 'dev')));
    if (row === undefined) {
      log(`[contender] dev phase ${phaseId}: no such dev phase, so no contender round is played`);
      return end(0, 'off');
    }
    const comp = row.comp;
    const say = (line: string): void => log(`[contender] ${comp.slug} dev phase ${phaseId}: ${line}`);
    const { provisionalRejudgeTargetOf } = await import('../server/routes/admin/grading.ts');
    const target = await provisionalRejudgeTargetOf(deps.db, comp);
    if ('refused' in target || target.dev.id.toLowerCase() !== phaseId) {
      say(`off: ${'refused' in target ? target.refused : 'it is not the competition\'s dev phase'}`);
      return end(0, 'off');
    }
    const judge: ProgramJudgeT = target.judge;
    const screened = judge.screened;
    const harness = target.bundle.harness as ProgramHarnessT;
    const off =
      screened === undefined
        ? 'its judge is not screened (harness.judge.screened)'
        : screened.contender_games === 0
          ? 'contender_games is 0'
          : judge.ladder === undefined
            ? 'its judge names no ladder'
            : namedJudgeAgent(judge.agent) === null
              ? 'its judge names no one model'
              : harness.pack !== undefined || harness.generator !== undefined
                ? "its dev phase is seeded on its pack's or instance's trees, which this job does not read"
                : null;
    if (off !== null || screened === undefined) {
      say(`off: ${off ?? 'its judge is not screened'}`);
      return end(0, 'off');
    }
    if (now().getTime() >= comp.deadline.getTime()) {
      say('closed: the deadline has passed, so the chain is not extended');
      return end(0, 'closed');
    }
    // The dev phase's seed, as its grades are seeded: a bundle with data of its own seeds on no dataset digest.
    const devSeed = phaseSeed(competitionSeedKey(comp), 'dev', null);
    // The bundle's judge directory and ladder, read as a provisional heat reads them.
    let ladder: JudgeContenderLadderT;
    try {
      const trees = await judgedTreesOf(deps, comp.slug, harness, judge);
      const { readJudgeLadder } = await import('./judge-ladder-tree.ts');
      const rel = judge.ladder!.dir;
      const ladderDir = trees.ladderDir ?? (rel === '.' ? competitionDirOf(deps, comp.slug, harness) : join(competitionDirOf(deps, comp.slug, harness), ...rel.split('/')));
      const read = readJudgeLadder(ladderDir, judge, trees.judgeDir);
      if ('refused' in read) {
        say(`off: its judge's ladder does not read: ${read.refused}`);
        return end(0, 'off');
      }
      ladder = judgeContenderLadderOf(read);
    } catch (err) {
      if (!(err instanceof PermanentJobError)) throw sealedError(err);
      say(`off: ${err.message}`);
      return end(0, 'off');
    }
    const cs = await import('../server/grading/contender-select.ts');
    const jc = await import('./judge-contender.ts');
    const jh = await import('./judge-heat.ts');
    const { judgeContenderDesignOf } = await import('./judge-screen-inputs.ts');
    const memoRoot = memoRootOf(deps.workRoot, phaseId);
    const foldDir = join(memoRoot, 'fold');
    let round: number | null = null;
    let played = 0;
    try {
      const chain = await chainOf(deps, foldDir, phaseId);
      if ('broken' in chain) {
        const t = now().getTime();
        const last = brokenPaged.get(phaseId);
        if (last === undefined || t - last >= BROKEN_PAGE_MS) {
          brokenPaged.set(phaseId, t);
          page(
            `[contender] ALERT: ${comp.slug} dev phase ${phaseId}: its sealed contender chain does not hold (${chain.broken}), so no contender round is played on it, ` +
              "and the final's screen leaves it out (every member rated on its ladder record alone). " +
              'Fix: restore the record the blob store lost or the head row that does not read; the sweep after that reads the chain again. Paged at most once an hour while it stands',
          );
        } else say(`broken: its contender chain does not hold (${chain.broken}), so no round is played on it (paged within the hour)`);
        return end(0, 'broken');
      }
      let fold: JudgeContenderFoldT | null = chain.fold;
      // The bundle's contender design as the final's screen holds the chain to it (judge-screen-inputs.ts judgeScreenContenderOf).
      const design = judgeContenderDesignOf(screened, target.bundle.prizes);
      for (let k = 0; k < screened.contender_every_sweep; k++) {
        ctx.signal?.throwIfAborted();
        if (now().getTime() >= comp.deadline.getTime()) {
          say(`closed after ${played} rounds: the deadline has passed`);
          return end(played, 'closed');
        }
        round = fold === null ? 0 : fold.round + 1;
        const r = round;
        // Who plays: the field as it stands now, its players, and those entering the chain or changed since.
        const field = await cs.contenderFieldOf(deps.db, deps.blobs, target, { cacheDir: join(memoRoot, 'field'), phaseSeed: devSeed });
        if (field.line_places !== design.line_places) {
          say(`round ${r} unplayed: the field reads its line at ${field.line_places} places, not the design's ${design.line_places}`);
          return end(played, 'unplayed');
        }
        const { select, players } = cs.contenderPlayersOf(field, ladder.strengths);
        const known = new Map((fold?.members ?? []).map((m) => [m.artifact_sha256, snapshotKey(m)]));
        const members: JudgeContenderMemberT[] = players
          .filter((p) => known.get(p.artifact_sha256) !== snapshotKey({ ...p.snapshot, artifact_bytes: p.artifact_bytes, entries: p.entries, ladder_record_sha256: p.ladder_record_sha256 }))
          .map((p) => ({ artifact_sha256: p.artifact_sha256, artifact_bytes: p.artifact_bytes, entries: p.entries, ladder_record_sha256: p.ladder_record_sha256, ladder_games: p.snapshot.ladder_games }));
        let setup: ReturnType<typeof jc.judgeContenderSetup>;
        let planned: JudgePlannedCallT[];
        let active: number;
        try {
          setup = jc.judgeContenderSetup({
            phaseSeed: devSeed,
            judge,
            ...(fold === null ? {} : { house: fold.judge.house_text }),
            ladder,
            design,
            round: r,
            prev: fold?.head_sha256 ?? null,
            lineMicro: select.line_micro,
            members,
            players: players.map((p) => p.artifact_sha256),
          });
          const schedule = jc.judgeContenderSchedule(fold, setup);
          planned = schedule.planned;
          active = schedule.active.length;
        } catch (err) {
          if (!(err instanceof jh.JudgeHeatError)) throw err;
          say(`round ${r} unplayed: its setup does not follow the chain or the bundle (${err.message})`);
          return end(played, 'unplayed');
        }
        const counts = `${setup.players.length} players (${members.length} entering or changed), ${active} active`;
        if (planned.length === 0) {
          say(`round ${r} idle: ${counts}, no pair to judge`);
          return end(played, 'idle');
        }
        const artifacts = [...new Set(planned.flatMap((p) => [p.a, p.b]))].sort(compareCodeUnits);
        // Played on the bundle's own named judge alone: a plan for any artifact the round judges defers it.
        const plan = deps.judge?.plan;
        if (plan !== undefined) {
          let moved: string | null = null;
          for (const subject of artifacts) {
            let answer: JudgeWorkerPlan | null;
            try {
              answer = await plan.of({ slug: comp.slug, stage: 'provisional', judge: judge.agent, seed: setup.seed, subject });
            } catch (err) {
              if ((err as { retryable?: unknown } | null)?.retryable !== true) throw err;
              moved = `the judge planner could not answer (${err instanceof Error ? err.message : String(err)})`;
              break;
            }
            if (answer !== null) {
              moved = `the judge planner moves its judging to ${answer.judges.map((j) => j.model).join(', ')}`;
              break;
            }
          }
          if (moved !== null) {
            const hour = Math.floor(now().getTime() / DEFERRED_SAY_MS);
            if (deferredSaid.get(phaseId) !== hour) {
              deferredSaid.set(phaseId, hour);
              say(`round ${r} deferred: ${moved}, and a contender round is judged only by the bundle's own named judge`);
            }
            return end(played, 'deferred');
          }
        }
        // The pairs' artifacts, read from their players' latest dev grade runs.
        const bytes = await artifactsOf(deps, target.dev.id, judge, players, artifacts);
        if ('missing' in bytes) {
          say(`round ${r} unplayed: ${bytes.missing}`);
          return end(played, 'unplayed');
        }
        say(`round ${r}: ${counts}, ${planned.length / 2} games in ${planned.length} calls`);
        const ended = await playContenderRound(deps, { slug: comp.slug, harness, judge, devPhaseId: phaseId, fold, setup, planned, artifacts: bytes.artifacts, ...(ctx.signal === undefined ? {} : { signal: ctx.signal }) });
        if ('unplayed' in ended) {
          if (ended.cause === 'fault') throw new Error(`round ${r} faulted: ${ended.unplayed}`);
          say(`round ${r} unplayed (${ended.cause}): ${ended.unplayed}`);
          return end(played, 'unplayed');
        }
        const record = ended.record;
        // The chain with the record held and folded in as a final's screen reads it (contenderChainOf's
        // judgeContenderHold): a record that would not hold there is never linked.
        let next: JudgeContenderFoldT;
        try {
          next = jc.judgeContenderHold(fold, record);
        } catch (err) {
          if (!(err instanceof jh.JudgeHeatError || err instanceof RangeError)) throw err;
          say(`round ${r} recorded ${record.games.length} games and left unlinked: its record does not hold against the chain (${err.message})`);
          return end(played, 'unplayed');
        }
        // The head's answer says why a move was refused: 'closed' is the deadline by the database's clock or this
        // grader's, so a grader whose clock runs behind still ends closed, never 'another job moved the head first'.
        const moved = await cs.tryAdvanceContenderHead(deps.db, { phaseId, prev: fold?.head_sha256 ?? null, next: ended.sha256, round: r, players: setup.players.length, games: record.games.length, at: now() });
        if (!moved.moved) {
          say(`round ${r} recorded ${record.games.length} games and left unlinked: ${HEAD_REFUSED[moved.why]}`);
          return end(played, moved.why === 'closed' ? 'closed' : 'unplayed');
        }
        fold = next;
        await writeFoldMemo(foldDir, fold);
        played++;
        say(`round ${r} played: ${setup.players.length} players, ${record.games.length} games in ${record.calls.length} calls (${ended.kept_calls} kept from an earlier attempt, ${record.invalid_calls} with no verdict)`);
      }
      return end(played, 'played');
    } catch (err) {
      if (ctx.signal?.aborted === true && err === ctx.signal.reason) throw err;
      const out = sealedError(err);
      if (round !== null && typeof out === 'object' && out !== null) roundOfError.set(out, round);
      throw out;
    }
  };
}

/**
 * Each of `artifacts` (sha256s of players' artifacts) read from a player's entries' latest dev grade runs: the first
 * finished run of one of its entries whose action log's `judge.artifact` is that artifact. The runs are read narrow
 * (server/grading/dev-scrutiny-line.ts latestDevGradeRunsOf: the latest attempt alone, its status and action log among
 * a few columns, a 5,000-entry slice a statement), never every attempt's whole row. Missing, said in counts only, when
 * a player has none: an entry graded again since the field was read, or a store that lost its output.
 */
async function artifactsOf(
  deps: Pick<ContenderJobDeps, 'db' | 'blobs'>,
  devId: string,
  judge: Pick<ProgramJudgeT, 'artifact'>,
  players: readonly { artifact_sha256: string; entries: readonly string[] }[],
  artifacts: readonly string[],
): Promise<{ artifacts: Map<string, Uint8Array> } | { missing: string }> {
  const { latestDevGradeRunsOf } = await import('../server/grading/dev-scrutiny-line.ts');
  const by = new Map(players.map((p) => [p.artifact_sha256, p]));
  const wanted = artifacts.map((a) => by.get(a)!);
  const runs = await latestDevGradeRunsOf(deps.db, devId, wanted.flatMap((p) => p.entries));
  const out = new Map<string, Uint8Array>();
  let missing = 0;
  for (const p of wanted) {
    for (const entry of p.entries) {
      const r = runs.get(entry);
      if (r === undefined || r.status !== 'finished' || r.actionLogSha256 === null) continue;
      try {
        const art = await readOutputFile(deps.blobs, r.actionLogSha256, judge.artifact);
        if (art !== null && art.sha256 === p.artifact_sha256) {
          out.set(p.artifact_sha256, art.bytes);
          break;
        }
      } catch {
        // An action log or output the store does not hold whole: another entry of the artifact may.
      }
    }
    if (!out.has(p.artifact_sha256)) missing++;
  }
  return missing === 0 ? { artifacts: out } : { missing: `${missing} of the round's ${artifacts.length} players' ${judge.artifact} no longer read from their latest dev grade` };
}
