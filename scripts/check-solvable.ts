import { caseVariants, seedsForVariant } from '../src/engine/case-schema';
import { clockLabel } from '../src/engine/time';
import { checkSolvable } from '../src/engine/solvability';
import { loadCases } from './load-cases';

// Every variant of every case must close within budget on several of its own nights, or the build fails.
const SEEDS_PER_VARIANT = 3;

const cases = await loadCases();
let failed = false;
for (const def of cases) {
  const variants = caseVariants(def);
  variants.forEach((data, index) => {
    for (const seed of seedsForVariant(variants.length, index, SEEDS_PER_VARIANT)) {
      const r = checkSolvable(data, seed);
      const stable = r.stableAt === null ? 'never' : `${clockLabel(r.stableAt)} (+${r.stableAt - data.page.at} min)`;
      console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${data.id}/${data.variantId} seed=${seed} stable=${stable} evidence=${r.evidence.length}`);
      for (const p of r.problems) console.log(`     - ${p}`);
      failed ||= !r.ok;
    }
  });
}
if (failed) {
  console.error('\nAt least one case is not solvable within its budget.');
  process.exit(1);
}
