// The transcript bundle: a .tar.gz the CLI (`makefun bundle`) writes and the server ingests.
// It holds manifest.json (this schema) at the archive root plus every raw original session file
// under sessions/, byte for byte, and the instruction files the agent ran under (system prompt,
// AGENTS.md / CLAUDE.md, agent definitions, skills, settings…) under context/. The server re-derives everything from the originals (parsing,
// usage, redaction, pricing, authorship); the manifest only says what each file is and where it
// came from, so nothing client-normalized is ever trusted. A packed entrypoint (one `makefun compress`
// wrote) travels with the readable source it was packed from under packs/, each listed in the
// manifest's packs: the server re-packs that source and compares the bytes with the committed entry.

import { z } from 'zod';
import { GitSha, IsoDateTime, Sha256Hex } from './primitives.ts';

export const BUNDLE_FORMAT = 'agent-fun/transcript-bundle/v1';
export const BUNDLE_MANIFEST_PATH = 'manifest.json';
export const BUNDLE_SESSIONS_DIR = 'sessions/';
export const BUNDLE_CONTEXT_DIR = 'context/';
export const BUNDLE_PACKS_DIR = 'packs/';
/**
 * The packer a pack names: the kit's `makefun compress`, version 1 (transcripts/compress.ts states the
 * same string; contracts import nothing from transcripts/).
 */
export const PACK_FORMAT = 'makefun-compress/v1';
/** The packs one bundle may list. */
export const MAX_PACKS = 16;
/** The largest pack source, bytes. */
export const MAX_PACK_SOURCE_BYTES = 256 * 1024;
/** The longest repo-relative path a pack names (its entry, its source), characters. */
export const MAX_PACK_REPO_PATH_CHARS = 512;
/** A context file over this is left out at ingest (a warning, never a refusal). */
export const MAX_CONTEXT_FILE_BYTES = 1024 * 1024;
/** The context files of one bundle, together: a file that would pass this is left out at ingest. */
export const MAX_CONTEXT_TOTAL_BYTES = 8 * 1024 * 1024;
export const MAX_CONTEXT_FILES = 400;
/** Largest accepted upload (bundle or loose files), bytes. */
export const MAX_TRANSCRIPT_UPLOAD_BYTES = 200 * 1024 * 1024;

export const TRANSCRIPT_SOURCES = [
  'claude-code',
  'codex',
  'cursor',
  'specstory',
  'chatgpt-export',
  'claude-export',
  'copilot-cli',
  'copilot-vscode',
  'gemini-cli',
  'opencode',
  'cline',
  'aider',
  'atif',
  'pi',
  'omp',
  'dsh',
  'zed',
  'continue',
  'amazon-q',
  'devin',
  'grok-build',
  'zazen',
  'hermes',
  'openclaw',
  't3code',
  'codex-cloud',
  'cursor-cloud',
  'devin-cloud',
  'copilot-agent',
  'ollama',
  'lmstudio',
  'omlx',
  'jan',
  'open-webui',
  'anythingllm',
  'cherry-studio',
  'chatbox',
  'deepseek-export',
  'perplexity',
  'kiro',
  'goose',
  'kimi-code',
  'factory-droid',
  'junie',
  'antigravity',
  'openhands',
  'mistral-vibe',
  'crush',
  'codebuddy',
  'muse-code',
  'muse-app',
  'qoder',
  'superbot',
  'jules-cloud',
  'openhands-cloud',
  'warp-cloud',
  'amp',
  'jan-agent',
  'chat-log',
  'claude-stream',
] as const;
export const TranscriptSource = z.enum(TRANSCRIPT_SOURCES);

/** A file inside the archive under sessions/: relative, POSIX, no `..`, no empty or dot segments. */
export const SessionPath = z
  .string()
  .max(512)
  .regex(/^sessions\/[A-Za-z0-9_][A-Za-z0-9._@-]*(\/[A-Za-z0-9_][A-Za-z0-9._@-]*)*$/, 'expected sessions/<relative path>');

/** A file inside the archive under context/, by SessionPath's rules. */
export const ContextPath = z
  .string()
  .max(512)
  .regex(/^context\/[A-Za-z0-9_][A-Za-z0-9._@-]*(\/[A-Za-z0-9_][A-Za-z0-9._@-]*)*$/, 'expected context/<relative path>');

/** A file inside the archive under packs/, by SessionPath's rules. */
export const PackPath = z
  .string()
  .max(512)
  .regex(/^packs\/[A-Za-z0-9_][A-Za-z0-9._@-]*(\/[A-Za-z0-9_][A-Za-z0-9._@-]*)*$/, 'expected packs/<relative path>');

/**
 * Why `p` is not a repo-relative POSIX path a pack may name, or null when it is: no leading slash,
 * backslash, drive letter or NUL, no empty, `.` or `..` segment, no `.git` segment (any case), at most
 * MAX_PACK_REPO_PATH_CHARS. Any other character a real file name holds (spaces, unicode) is kept, so a
 * real source is never unsendable.
 */
export function packRepoPathIssue(p: string): string | null {
  if (p === '') return 'is empty';
  if (p.length > MAX_PACK_REPO_PATH_CHARS) return `is longer than ${MAX_PACK_REPO_PATH_CHARS} characters`;
  if (p.startsWith('/')) return 'is absolute';
  if (/^[A-Za-z]:/.test(p)) return 'starts with a drive letter';
  if (p.includes('\\')) return 'holds a backslash';
  if (p.includes('\0')) return 'holds a NUL';
  for (const seg of p.split('/')) {
    if (seg === '..') return 'holds a `..` segment';
    if (seg === '' || seg === '.') return 'holds an empty or `.` segment';
    if (seg.toLowerCase() === '.git') return 'is .git or under it';
  }
  return null;
}

/** A path inside the repository, by packRepoPathIssue's rules. */
const PackRepoPath = z.string().superRefine((p, ctx) => {
  const why = packRepoPathIssue(p);
  if (why !== null) ctx.addIssue({ code: 'custom', message: `a repo-relative path: this one ${why}` });
});

/** Where a path the CLI found sits, home-relative (`~/...`); never an absolute home path. */
const OriginalPath = z.string().min(1).refine((p) => !/^(\/Users\/|\/home\/|[A-Za-z]:\\)/.test(p), 'original_path must not reveal a home directory');

export const CONTEXT_KINDS = ['system-prompt', 'instructions', 'agent-definition', 'skill', 'command', 'settings', 'memory', 'other'] as const;
export const ContextKind = z.enum(CONTEXT_KINDS);

/** An instruction file the agent ran under, raw as found (ingest redacts it). */
export const BundleContextFile = z.strictObject({
  path: ContextPath,
  kind: ContextKind,
  /** repo: inside the repository; user: the user's own config (`~/.claude/…`); explicit: named on the command line. */
  scope: z.enum(['repo', 'user', 'explicit']),
  /** The harness the file configures (`claude-code`, `codex`…), null when it is shared (AGENTS.md). */
  harness: z.string().min(1).max(64).nullable(),
  sha256: Sha256Hex,
  bytes: z.int().min(0),
  original_path: OriginalPath,
  collected_by: z.enum(['explicit', 'discovered']),
});

/**
 * The readable source a packed entrypoint was written from (`makefun compress`), uploaded beside the
 * sessions and never redacted or published: ingest re-packs it and compares the bytes with the entry.
 */
export const BundlePack = z.strictObject({
  /** Where the source sits in the archive. */
  path: PackPath,
  /** The packed entrypoint, a snapshot path (`main.py`). */
  entry: PackRepoPath,
  /** Where the source sits in the repository, repo-relative (`src/bot.py`). */
  source_path: PackRepoPath,
  format: z.literal(PACK_FORMAT),
  /** The source's, as archived. */
  sha256: Sha256Hex,
  bytes: z.int().min(0).max(MAX_PACK_SOURCE_BYTES),
});

export const BundleSession = z.strictObject({
  /** Where the original sits in the archive. */
  path: SessionPath,
  source: TranscriptSource,
  sha256: Sha256Hex,
  bytes: z.int().min(0),
  /** The tool's own session id, when the file names one. */
  session_id: z.string().min(1).nullable(),
  /** Set for subagent transcripts (Claude Code `<sessionId>/subagents/agent-*.jsonl`). */
  parent_session_id: z.string().min(1).nullable(),
  agent_id: z.string().min(1).nullable(),
  /** Where the CLI found it, home-relative (`~/...`); never an absolute home path. */
  original_path: OriginalPath,
  /**
   * explicit: named with --session; repo-match: found by its cwd's git common dir; repo-reference: a
   * session started in a directory above the repository that names the repository in a tool call;
   * family: the parent or a subagent of a collected session, taken with it.
   */
  collected_by: z.enum(['explicit', 'repo-match', 'repo-reference', 'family']),
  first_at: IsoDateTime.nullable(),
  last_at: IsoDateTime.nullable(),
});

/** Turns the entrant asks to leave out (e.g. a manager's brief to a subagent), by message id. */
export const ExcludedTurns = z.strictObject({
  path: SessionPath,
  turns: z.array(z.string().min(1)).min(1),
  reason: z.string().min(1),
});

/** How the entrant says the agent was run (`makefun bundle`'s flags); unverified. */
export const BundleDeclared = z.strictObject({
  harness: z.string().max(64).nullable(),
  harness_version: z.string().max(64).nullable(),
  model: z.string().max(128).nullable(),
  provider: z.string().max(128).nullable(),
  reasoning_effort: z.string().max(32).nullable(),
  notes: z.string().max(2000).nullable(),
});

/** What the CLI detected about where it ran when it bundled. */
export const BundleClient = z.strictObject({
  /** The agent harness the CLI ran inside, when its environment names one. */
  harness: z.string().max(32).nullable(),
  /** The environment markers that named it. */
  markers: z.array(z.string().max(64)).max(32),
  os: z.string().max(32),
  node: z.string().max(32),
  build: z.string().max(64).nullable(),
  ci: z.boolean(),
  tty: z.boolean(),
});

/** What collection found and took, by how; its warnings are the CLI's own notes. */
export const BundleCollection = z.strictObject({
  explicit: z.int().min(0),
  discovered: z.int().min(0),
  family: z.int().min(0),
  unmatched: z.int().min(0),
  vanished_cwds: z.int().min(0),
  context_files: z.int().min(0),
  warnings: z.array(z.string().max(400)).max(50),
});

/**
 * Kits already downloaded keep writing the manifest they shipped with, so a field added after v1 is
 * optional here and the format string stays as it is: a required one would refuse their bundles.
 */
export const BundleManifest = z
  .strictObject({
    format: z.literal(BUNDLE_FORMAT),
    created_at: IsoDateTime,
    tool: z.strictObject({
      name: z.literal('makefun-cli'),
      version: z.string().min(1),
      client: BundleClient.optional(),
    }),
    repo: z.strictObject({
      /** The remote the entry is submitted from, if the checkout has one. */
      remote_url: z.string().min(1).nullable(),
      commit: GitSha.nullable(),
      /** Uncommitted changes in the checkout at bundling time. */
      dirty: z.boolean(),
    }),
    sessions: z.array(BundleSession).min(1),
    excluded_turns: z.array(ExcludedTurns).default([]),
    declared: BundleDeclared.optional(),
    context: z.array(BundleContextFile).max(MAX_CONTEXT_FILES).optional(),
    collection: BundleCollection.optional(),
    /** The sources of the packed entrypoints, one an entry; a kit from before level 6 writes none. */
    packs: z.array(BundlePack).max(MAX_PACKS).optional(),
  })
  .superRefine((m, ctx) => {
    const paths = new Set<string>();
    m.sessions.forEach((s, i) => {
      if (paths.has(s.path)) ctx.addIssue({ code: 'custom', path: ['sessions', i, 'path'], message: `duplicate path ${s.path}` });
      paths.add(s.path);
      if (s.first_at !== null && s.last_at !== null && Date.parse(s.first_at) > Date.parse(s.last_at)) {
        ctx.addIssue({ code: 'custom', path: ['sessions', i, 'last_at'], message: 'last_at is before first_at' });
      }
    });
    m.excluded_turns.forEach((e, i) => {
      if (!paths.has(e.path)) ctx.addIssue({ code: 'custom', path: ['excluded_turns', i, 'path'], message: `no session at ${e.path}` });
    });
    const contextPaths = new Set<string>();
    m.context?.forEach((c, i) => {
      if (contextPaths.has(c.path)) ctx.addIssue({ code: 'custom', path: ['context', i, 'path'], message: `duplicate path ${c.path}` });
      contextPaths.add(c.path);
    });
    // One pack an entry and an archive file a pack (PackPath keeps each under packs/); one source may
    // feed two entries, but only as the same bytes.
    const packPaths = new Set<string>();
    const packEntries = new Set<string>();
    const sourceSha = new Map<string, string>();
    m.packs?.forEach((p, i) => {
      if (packPaths.has(p.path)) ctx.addIssue({ code: 'custom', path: ['packs', i, 'path'], message: `duplicate path ${p.path}` });
      packPaths.add(p.path);
      if (packEntries.has(p.entry)) ctx.addIssue({ code: 'custom', path: ['packs', i, 'entry'], message: `duplicate entry ${p.entry}` });
      packEntries.add(p.entry);
      const seen = sourceSha.get(p.source_path);
      if (seen !== undefined && seen !== p.sha256) ctx.addIssue({ code: 'custom', path: ['packs', i, 'sha256'], message: `${p.source_path} is named with two different sha256` });
      if (seen === undefined) sourceSha.set(p.source_path, p.sha256);
    });
  });

export type BundleManifestT = z.infer<typeof BundleManifest>;
export type BundleSessionT = z.infer<typeof BundleSession>;
export type TranscriptSourceT = z.infer<typeof TranscriptSource>;
export type ContextKindT = z.infer<typeof ContextKind>;
export type BundleContextFileT = z.infer<typeof BundleContextFile>;
export type BundleDeclaredT = z.infer<typeof BundleDeclared>;
export type BundleClientT = z.infer<typeof BundleClient>;
export type BundleCollectionT = z.infer<typeof BundleCollection>;
export type BundlePackT = z.infer<typeof BundlePack>;
