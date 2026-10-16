import { clockLabel } from '../src/engine/time';
import { checkSolvable } from '../src/engine/solvability';
import { loadCases } from './load-cases';

// Every case must close within budget for several seeds, or the build fails.
const SEEDS = [1, 2, 3, 7, 42];

const cases = await loadCases();
let failed = false;
for (const data of cases) {
  for (const seed of SEEDS) {
    const r = checkSolvable(data, seed);
    const stable = r.stableAt === null ? 'never' : `${clockLabel(r.stableAt)} (+${r.stableAt - data.page.at} min)`;
    console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${data.id} seed=${seed} stable=${stable} evidence=${r.evidence.length}`);
    for (const p of r.problems) console.log(`     - ${p}`);
    failed ||= !r.ok;
  }
}
if (failed) {
  console.error('\nAt least one case is not solvable within its budget.');
  process.exit(1);
}
