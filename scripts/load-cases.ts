import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validateCase, type CaseData, type CaseInput } from '../src/engine/case-schema';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const CASES_DIR = join(ROOT, 'src/content/cases');

export function caseIds(): string[] {
  return readdirSync(CASES_DIR, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
}

export async function loadCases(): Promise<CaseData[]> {
  const out: CaseData[] = [];
  for (const id of caseIds()) {
    const mod = (await import(pathToFileURL(join(CASES_DIR, id, 'case.ts')).href)) as { default: CaseInput };
    out.push(validateCase(mod.default));
  }
  return out;
}

export function readJson(path: string): Record<string, string> {
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, string>;
}
