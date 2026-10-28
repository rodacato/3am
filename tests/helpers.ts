import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { caseVariants, resolveVariant, seedsForVariant, validateCase, type CaseData, type CaseDefinition, type CaseInput } from '../src/engine/case-schema';
import type { AppliedMitigation, Scenario } from '../src/engine/state';

const casesDir = join(dirname(fileURLToPath(import.meta.url)), '../src/content/cases');

export async function loadAllCases(): Promise<CaseDefinition[]> {
  const ids = readdirSync(casesDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  const cases: CaseDefinition[] = [];
  for (const id of ids) {
    const mod = (await import(pathToFileURL(join(casesDir, id, 'case.ts')).href)) as { default: CaseInput };
    cases.push(validateCase(mod.default));
  }
  return cases;
}

export async function loadCaseVariant(caseId: string, seed = 1): Promise<CaseData> {
  const def = (await loadAllCases()).find((c) => c.id === caseId);
  if (!def) throw new Error(`no case ${caseId}`);
  return resolveVariant(def, seed);
}

// Every variant of every case, each with several seeds that land on it.
export function everyNight(cases: CaseDefinition[], seedsPerVariant = 3): { data: CaseData; seed: number }[] {
  return cases.flatMap((def) => {
    const variants = caseVariants(def);
    return variants.flatMap((data, index) => seedsForVariant(variants.length, index, seedsPerVariant).map((seed) => ({ data, seed })));
  });
}

export function scenario(data: CaseData, seed = 1, mitigations: AppliedMitigation[] = []): Scenario {
  return { data, seed, mitigations };
}
