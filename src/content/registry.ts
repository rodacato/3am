import { validateCase, type CaseDefinition, type CaseInput } from '../engine/case-schema';

// Each case is its own chunk: nothing loads until a reader opens that case.
const caseModules = import.meta.glob<{ default: CaseInput }>('./cases/*/case.ts');
const caseMessages = import.meta.glob<{ default: Record<string, string> }>('./cases/*/locales/*.json');

const idFromPath = (path: string) => path.split('/')[2] ?? '';

export const CASE_IDS: readonly string[] = Object.keys(caseModules).map(idFromPath).sort();

const loaded = new Map<string, Promise<CaseDefinition>>();

export function loadCase(caseId: string): Promise<CaseDefinition> {
  let pending = loaded.get(caseId);
  if (!pending) {
    const load = caseModules[`./cases/${caseId}/case.ts`];
    if (!load) return Promise.reject(new Error(`unknown case ${caseId}`));
    pending = load().then((m) => validateCase(m.default));
    loaded.set(caseId, pending);
  }
  return pending;
}

export async function loadCaseMessages(caseId: string, locale: string, fallback = 'en'): Promise<Record<string, string>> {
  const load = caseMessages[`./cases/${caseId}/locales/${locale}.json`] ?? caseMessages[`./cases/${caseId}/locales/${fallback}.json`];
  if (!load) return {};
  return (await load()).default;
}
