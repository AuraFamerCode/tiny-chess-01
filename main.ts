// agency-poem-01 entry: writes one poem about agency to /output/entry.txt.
// Node 22, standard library only. Outside the grader's container,
// MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// The judge reads exactly the bytes written, line ends included, so the poem
// is joined with plain line feeds and given no trailing line end.
const POEM = [
  'Power of Attorney',
  '',
  'Her signature went first:',
  'the loops let go,',
  'the name sat down',
  'in the middle of itself.',
  '',
  'All spring I practised it',
  'on the backs of envelopes',
  'until the bank stopped calling.',
  '',
  'Then the notary turned the page —',
  'Attorney-in-Fact, a blank',
  'the width of my whole name —',
  'and she watched me lift the pen',
  'the way you watch a nurse',
  'lift the tray away.',
  '',
  'Now the cable bill comes addressed to her',
  'and answers to me.',
  'I pay it from the account',
  'that still says MOTHER AND DAUGHTER.',
  '',
  'Some nights I practise her name',
  'the way you practise a language',
  'you might have to speak at a border.',
  '',
  "The fact is the part I'm learning.",
  'Not the power. The power',
  'is a pen she handed me',
  'and is still holding.',
].join('\n');

writeFileSync(join(OUTPUT_DIR, 'entry.txt'), POEM);
