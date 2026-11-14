// The runtime images the docker sandbox runs entries in, pinned by digest in grader/images.json:
//
//   node22       node:22-slim     `node /bot/main.ts` (Node >= 22.18 strips types natively)
//   python3.13   python:3.13-slim `python3 -P -s /bot/main.py` with PYTHONHASHSEED=0
//
// Each digest is the OCI image INDEX digest (multi-arch: the same pin runs on arm64 and amd64), as
// `docker pull <image>:<tag>` then `docker image inspect --format '{{json .Descriptor}}'` report it;
// the sandbox runs `<image>@<digest>` with `--pull never`, so a grading never fetches anything and a
// missing image fails loudly (DockerSandbox.preflight) instead of resolving a moving tag. To move a
// pin: pull the tag, inspect it, update the entry (digest, version, resolved_at) and re-run
// tests/integration/docker-sandbox.test.ts, which checks the interpreter version inside each image.

import { z } from 'zod';
import { IsoDateTime } from '../contracts/primitives.ts';
import { RUNTIMES } from '../contracts/competition.ts';
import type { Runtime } from './sandbox/types.ts';
import imagesJson from './images.json' with { type: 'json' };

export const IMAGES_FORMAT = 'agent-fun/images/v1';

export const ImageDigest = z.string().regex(/^sha256:[0-9a-f]{64}$/, 'expected sha256:<64 hex>');

export const ImageEntry = z.strictObject({
  /** Repository, e.g. `node` (Docker Hub library images) or `ghcr.io/org/name`. */
  image: z.string().regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)*$/, 'expected a lowercase image repository'),
  /** The tag the digest was resolved from (documentation only: the sandbox never runs a tag). */
  tag: z.string().regex(/^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/),
  digest: ImageDigest,
  /** The interpreter version inside the image (node --version without the v; python3 --version). */
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  resolved_at: IsoDateTime,
});

export const ImageTable = z.strictObject({
  format: z.literal(IMAGES_FORMAT),
  images: z.strictObject(Object.fromEntries(RUNTIMES.map((r) => [r, ImageEntry])) as Record<Runtime, typeof ImageEntry>),
});

export type ImageEntryT = z.infer<typeof ImageEntry>;
export type ImageTableT = z.infer<typeof ImageTable>;

/** grader/images.json, validated at load. */
export const IMAGES: ImageTableT = ImageTable.parse(imagesJson);

/** The pinned image of a runtime. */
export function imageFor(runtime: Runtime, table: ImageTableT = IMAGES): ImageEntryT {
  return table.images[runtime];
}

/** `<image>@sha256:<hex>`: the only form the sandbox runs (a digest, never a tag). */
export function imageRef(entry: Pick<ImageEntryT, 'image'>, digest: string): string {
  ImageDigest.parse(digest);
  return `${entry.image}@${digest}`;
}

/** The lowest Node the node22 runtime may carry: type stripping is on by default from 22.18. */
export const MIN_NODE_VERSION = [22, 18, 0] as const;

/** True when `version` ("22.23.4" or "v22.23.4") is at least `min`. */
export function versionAtLeast(version: string, min: readonly [number, number, number]): boolean {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(version.trim());
  if (!m) return false;
  const v = [Number(m[1]), Number(m[2]), Number(m[3])];
  for (let i = 0; i < 3; i++) {
    if (v[i]! !== min[i]!) return v[i]! > min[i]!;
  }
  return true;
}
