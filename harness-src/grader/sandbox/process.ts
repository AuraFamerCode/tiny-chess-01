// The test sandbox: runs a node22 program directly on the host, `node <codeDir>/<script>`, with the
// same explicit environment the containers get (TZ=UTC, PYTHONHASHSEED=0, LANG=C.UTF-8) and the
// mounts passed as their types.ts MOUNT_POINTS variables (program/v1's MAKEFUN_INPUT_DIR /
// MAKEFUN_OUTPUT_DIR / MAKEFUN_REFERENCE_DIR / MAKEFUN_SCORES_DIR, an agent trial's
// MAKEFUN_ENV_DIR, MAKEFUN_STATE_DIR and the rest). It isolates nothing (no network, memory, CPU or filesystem limits), so it
// refuses to exist unless asked for explicitly: NODE_ENV=test or MAKEFUN_ALLOW_PROCESS_SANDBOX=1
// (server/config.ts's admission for MAKEFUN_SANDBOX=process; `makefun grade-local --driver process`
// sets it), and never under NODE_ENV=production. Dev login (MAKEFUN_DEV_AUTH) admits nothing here.
// python3.13 is refused outright: Python runs only inside Docker. So is a spec with a `launcher`
// (types.ts, a scrape trial's entry): the house launcher's clock and privilege split are the docker
// driver's alone, and running the spec's code here without them would time and isolate nothing.
// On the host the launcher runs as the program itself instead (grader/scrape/launch.ts, uid null).
// Its image digest is null (contracts/score.ts: "null for the process driver used in tests").
//
// An agent trial's spec gets the same environment as in its container: the spec's `env` after the
// three variables, checked by the same allowlist (types.ts checkSandboxEnv), then the mount variables,
// then its `secrets` (types.ts checkSandboxSecrets, which refuses any name of the others, so none
// overrides another), in the child's environment alone: never its argv. Its `network` is
// checked the same way and joins nothing: every program shares the host's loopback, so a trial's
// services listen on 127.0.0.1 ports the harness picks and the others reach them there
// (network.ts serviceEndpoint), where in containers they listen on 0.0.0.0:8080 behind an alias.
//
// A patch/v1 run's spec (its `image`, types.ts's header) runs `/bin/sh <codeDir>/<script>` on the host
// in place of the image's argv, whatever its runtime, so such a spec names its script; its image is
// checked as the docker driver checks it (checkSandboxImage), then never pulled nor run. Its
// /base and /tests come as MAKEFUN_BASE_DIR and MAKEFUN_TESTS_DIR like any mount. A spec's `work`
// (image or not) gets a fresh scratch directory under the host's tmpdir as MAKEFUN_WORK_DIR (types.ts
// WORK_DIR_ENV), held to no size, and removed once the program has exited.

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  checkHostPath,
  checkSandboxEnv,
  checkSandboxImage,
  checkSandboxNetwork,
  checkSandboxSecrets,
  checkSandboxWork,
  MOUNT_POINTS,
  SANDBOX_ENV,
  SandboxError,
  scriptOf,
  WORK_DIR_ENV,
  type Runtime,
  type Sandbox,
  type SandboxExit,
  type SandboxProcess,
  type SandboxSpec,
} from './types.ts';
import { checkSandboxMounts } from './mounts.ts';

/** The host shell an image spec's script runs under. */
export const HOST_SH = '/bin/sh';

export interface ProcessSandboxOptions {
  /** The environment the guard reads (default process.env). Nothing of it reaches the program. */
  env?: Record<string, string | undefined>;
  /** The node binary (default this process's). */
  node?: string;
}

/**
 * Throws unless the environment allows the unisolated process driver: NODE_ENV=test, or
 * MAKEFUN_ALLOW_PROCESS_SANDBOX=1 (or `true`, as server/config.ts reads the flag); never under
 * NODE_ENV=production, whatever else is set.
 */
export function assertProcessSandboxAllowed(env: Record<string, string | undefined> = process.env): void {
  const nodeEnv = env.NODE_ENV ?? '';
  const allow = (env.MAKEFUN_ALLOW_PROCESS_SANDBOX ?? '').toLowerCase();
  if (nodeEnv === 'production') throw new SandboxError('the process sandbox is refused under NODE_ENV=production');
  if (nodeEnv !== 'test' && allow !== '1' && allow !== 'true') {
    throw new SandboxError('the process sandbox runs only under NODE_ENV=test or with MAKEFUN_ALLOW_PROCESS_SANDBOX=1 (it isolates nothing)');
  }
}

export class ProcessSandbox implements Sandbox {
  readonly kind = 'process' as const;
  readonly node: string;

  constructor(opts: ProcessSandboxOptions = {}) {
    assertProcessSandboxAllowed(opts.env ?? process.env);
    this.node = opts.node ?? process.execPath;
  }

  imageDigest(_runtime: Runtime): null {
    return null;
  }

  async preflight(runtime: Runtime, imageDigest: string | null = null): Promise<void> {
    if (runtime !== 'node22') throw new SandboxError(`the process sandbox runs node22 only (${runtime} runs only inside Docker)`);
    if (imageDigest !== null) throw new SandboxError(`the process sandbox has no image; cannot run digest ${imageDigest}`);
  }

  isDriverFailure(exit: SandboxExit): boolean {
    return exit.error !== undefined;
  }

  async removeTree(dir: string): Promise<void> {
    await rm(dir, { recursive: true, force: true });
  }

  spawn(spec: SandboxSpec): SandboxProcess {
    // A spec is a launcher spec whenever it carries the key, as docker.ts dockerRunArgs reads it.
    if (spec.launcher !== undefined) {
      throw new SandboxError('the process sandbox runs no launcher (a launcher spec runs only inside Docker: there is no root here to drop the entry from)');
    }
    // An image spec runs its script under the host's sh (the header), never the runtime's interpreter.
    const image = spec.image === undefined ? null : checkSandboxImage(spec);
    if (image === null && spec.runtime !== 'node22') throw new SandboxError(`the process sandbox runs node22 only (${spec.runtime} runs only inside Docker)`);
    if (image !== null && spec.script === undefined) throw new SandboxError(`the process sandbox runs an image spec as ${HOST_SH} <codeDir>/<script>, so the spec names its script`);
    if (spec.imageDigest !== undefined && spec.imageDigest !== null) throw new SandboxError(`the process sandbox has no image; cannot run digest ${spec.imageDigest}`);
    const codeDir = checkHostPath(spec.codeDir);
    const script = join(codeDir, scriptOf(spec));
    if (spec.network !== undefined) checkSandboxNetwork(spec.network);
    const secrets = checkSandboxSecrets(spec);
    const work = spec.work === undefined ? null : checkSandboxWork(spec.work);
    const env: Record<string, string> = { ...SANDBOX_ENV };
    for (const [k, v] of checkSandboxEnv(spec.env)) env[k] = v;
    // The program reads and writes the host directory itself: every file of a writable mount is live and all of it is
    // back at the exit (types.ts's Mounts), so `live` and `returns` are checked and need nothing more.
    for (const m of checkSandboxMounts(spec.mounts)) env[MOUNT_POINTS[m.at]] = m.host;
    for (const [k, v] of secrets) env[k] = v;
    const workDir = work === null ? null : mkdtempSync(join(tmpdir(), 'makefun-work-'));
    if (workDir !== null) env[WORK_DIR_ENV] = workDir;
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(image === null ? this.node : HOST_SH, [script], { cwd: codeDir, env, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (err) {
      if (workDir !== null) rmSync(workDir, { recursive: true, force: true });
      throw err;
    }
    return new HostProcess(child, workDir);
  }
}

class HostProcess implements SandboxProcess {
  readonly stdin;
  readonly stdout;
  readonly stderr;
  readonly exited: Promise<SandboxExit>;
  readonly #child: ChildProcessWithoutNullStreams;

  /** `workDir`, a spec's scratch /work, is removed once the program has exited, before `exited` settles. */
  constructor(child: ChildProcessWithoutNullStreams, workDir: string | null = null) {
    this.#child = child;
    this.stdin = child.stdin;
    this.stdout = child.stdout;
    this.stderr = child.stderr;
    const ended = new Promise<SandboxExit>((resolve) => {
      child.once('error', (err) => resolve({ code: null, signal: null, error: `spawn: ${err.message}` }));
      child.once('close', (code, signal) => resolve({ code, signal }));
    });
    // What rm cannot take (a directory the program left 0555) stays under the host's tmpdir: this driver isolates nothing.
    this.exited = workDir === null ? ended : ended.then(async (exit) => rm(workDir, { recursive: true, force: true }).then(() => exit, () => exit));
  }

  async kill(): Promise<void> {
    if (this.#child.exitCode === null && this.#child.signalCode === null) this.#child.kill('SIGKILL');
    await this.exited;
  }
}
