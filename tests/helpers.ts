import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validateCase, type CaseData, type CaseInput } from '../src/engine/case-schema';
import type { AppliedMitigation, Scenario } from '../src/engine/state';

const casesDir = join(dirname(fileURLToPath(import.meta.url)), '../src/content/cases');

export async function loadAllCases(): Promise<CaseData[]> {
  const ids = readdirSync(casesDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  const cases: CaseData[] = [];
  for (const id of ids) {
    const mod = (await import(pathToFileURL(join(casesDir, id, 'case.ts')).href)) as { default: CaseInput };
    cases.push(validateCase(mod.default));
  }
  return cases;
}

export function scenario(data: CaseData, seed = 1, mitigations: AppliedMitigation[] = []): Scenario {
  return { data, seed, mitigations };
}
