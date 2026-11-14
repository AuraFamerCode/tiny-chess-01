// The pricing tables this server holds besides the bundled one (pricing/price.ts): each a rows.json an earlier release
// bundled, kept byte for byte as pricing/revs/<pricing_rev>.json. An entry is priced under the revision its receipt
// names (server/repos/receipt.ts pricing_rev), and an entry received before a deploy is ingested after it, so a change
// to rows.json ships with the table it replaces kept here (pricing/port-from-cosmos.ts writes the file; it is listed in
// HELD below with the revision that replaced it). Each is validated and its revision recomputed at load: a file whose
// content does not hash to its name throws here, and the server does not start.
// A held table may be dropped once no entry received under it is still unpriced.

import { createPricer, pricingRev as bundledPricingRev, priceUsage as bundledPriceUsage, type Pricer } from './price.ts';
import rev1ea1b8ea from './revs/1ea1b8ea1c4a66de7ef740880c266a2c0e119de11f1651873f3b1a55f3caeec9.json' with { type: 'json' };
import rev69078b05 from './revs/69078b05507d9cba63e9ad6c57d47dd8983a943336be350318027f20f106ebdc.json' with { type: 'json' };
import reve5434d8a from './revs/e5434d8a7e0120d3859eabcee31ea34bddd76c7d9f6356192e528eba454aaf93.json' with { type: 'json' };
import revdcb80a1b from './revs/dcb80a1bb9517e245c6e2e44e2f19b68000c8508c58f8d207e8e4532cbaedae0.json' with { type: 'json' };

/** What prices an entry's usage and authorship under one revision. */
export type RevPricer = Pick<Pricer, 'pricingRev' | 'priceUsage'>;

/** A held table: its revision (its file's name), the revision that replaced it in rows.json, and the document. */
interface HeldTable {
  rev: string;
  replacedBy: string;
  doc: unknown;
}

/** Oldest first; each one's `replacedBy` is the next one's `rev`, the last one's the bundled revision. */
const HELD: readonly HeldTable[] = [
  { rev: '1ea1b8ea1c4a66de7ef740880c266a2c0e119de11f1651873f3b1a55f3caeec9', replacedBy: '69078b05507d9cba63e9ad6c57d47dd8983a943336be350318027f20f106ebdc', doc: rev1ea1b8ea },
  { rev: '69078b05507d9cba63e9ad6c57d47dd8983a943336be350318027f20f106ebdc', replacedBy: 'e5434d8a7e0120d3859eabcee31ea34bddd76c7d9f6356192e528eba454aaf93', doc: rev69078b05 },
  { rev: 'e5434d8a7e0120d3859eabcee31ea34bddd76c7d9f6356192e528eba454aaf93', replacedBy: 'dcb80a1bb9517e245c6e2e44e2f19b68000c8508c58f8d207e8e4532cbaedae0', doc: reve5434d8a },
  { rev: 'dcb80a1bb9517e245c6e2e44e2f19b68000c8508c58f8d207e8e4532cbaedae0', replacedBy: '472b48ba54ffaf5d3f3c9230050ef16360d2fb9280d6b299e549e2bd8e0b6393', doc: revdcb80a1b },
];

/** The pricer of held table `doc`, kept as pricing/revs/<rev>.json: validated, and refused unless it prices under `rev`. */
export function heldPricerOf(rev: string, doc: unknown): Pricer {
  const pricer = createPricer(doc);
  if (pricer.pricingRev !== rev) throw new Error(`pricing/revs/${rev}.json prices under ${pricer.pricingRev}, not the revision its name says`);
  return pricer;
}

const heldPricers = new Map(HELD.map((t) => [t.rev, heldPricerOf(t.rev, t.doc)]));

/** The held revisions (never the bundled one), oldest first, each with the revision that replaced it. */
export const HELD_PRICING_REVS: readonly { rev: string; replacedBy: string }[] = Object.freeze(HELD.map((t) => Object.freeze({ rev: t.rev, replacedBy: t.replacedBy })));

const bundled: RevPricer = Object.freeze({ pricingRev: bundledPricingRev, priceUsage: bundledPriceUsage });

/** The pricer of revision `rev`: the bundled table's for the bundled revision, a held table's for a held one, null for any other. */
export function pricerOfRev(rev: string): RevPricer | null {
  if (rev === bundledPricingRev) return bundled;
  return heldPricers.get(rev) ?? null;
}

/** Whether this server can price under `rev` (pricerOfRev is not null). */
export function holdsPricingRev(rev: string): boolean {
  return pricerOfRev(rev) !== null;
}

/** Every revision this server can price under: the bundled one, then the held ones oldest first. */
export function heldPricingRevs(): string[] {
  return [bundledPricingRev, ...HELD.map((t) => t.rev).filter((rev) => rev !== bundledPricingRev)];
}
