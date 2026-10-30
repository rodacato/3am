import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { SOURCES } from '../src/content/sources';
import { caseVariants } from '../src/engine/case-schema';
import { CASES_DIR, ROOT, caseIds, loadCases, readJson } from './load-cases';

// Fails on any key missing (or orphaned) in any locale, for the UI and for every case.
const problems: string[] = [];
const SOURCE_LOCALE = 'en';

function compareLocales(dir: string, label: string): Record<string, string> {
  const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  const base = readJson(join(dir, `${SOURCE_LOCALE}.json`));
  const baseKeys = new Set(Object.keys(base));
  for (const file of files) {
    if (file === `${SOURCE_LOCALE}.json`) continue;
    const keys = new Set(Object.keys(readJson(join(dir, file))));
    for (const k of baseKeys) if (!keys.has(k)) problems.push(`${label} ${file}: missing "${k}"`);
    for (const k of keys) if (!baseKeys.has(k)) problems.push(`${label} ${file}: "${k}" is not in ${SOURCE_LOCALE}.json`);
  }
  if (files.length < 2) problems.push(`${label}: only ${files.length} locale file(s)`);
  return base;
}

const ui = compareLocales(join(ROOT, 'src/i18n/locales'), 'ui');
const has = (table: Record<string, string>, key: string) => key in table || `${key}.one` in table || `${key}.other` in table;

for (const s of SOURCES) if (!has(ui, `source.${s.id}.note`)) problems.push(`ui: missing note for source ${s.id}`);

// Literal keys used in code must exist in the source locale.
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : /\.(tsx?|ts)$/.test(f) ? [p] : [];
  });
}
for (const file of walk(join(ROOT, 'src'))) {
  const text = readFileSync(file, 'utf8');
  for (const m of text.matchAll(/\bt\('([a-zA-Z0-9_.-]+)'/g)) {
    const key = m[1] as string;
    if (!key.startsWith('case.') && !has(ui, key)) problems.push(`ui: ${file.replace(ROOT + '/', '')} uses missing "${key}"`);
  }
}

const cases = await loadCases();
for (const id of caseIds()) {
  const def = cases.find((c) => c.id === id);
  const text = compareLocales(join(CASES_DIR, id, 'locales'), id);
  if (!def) continue;
  const keys = new Set([
    'title', 'company', 'phoneDate', 'briefing.company', 'briefing.role', 'briefing.tonight', def.alert.summaryKey,
    ...def.tools.dashboards.flatMap((d) => [d.titleKey, ...d.panels.map((p) => p.titleKey)]),
    ...def.tools.runbooks.flatMap((r) => [r.titleKey, r.bodyKey]),
    ...def.stakeholderPrompts.flatMap((p) => [p.fromKey, p.askKey]),
  ]);
  for (const data of caseVariants(def)) {
    [
      data.debriefNoteKey,
      ...data.changes.map((c) => c.messageKey),
      ...data.mitigations.flatMap((m) => ['title', 'what', 'doing'].map((f) => `mitigation.${m.id}.${f}`)),
      ...data.factors.map((f) => f.textKey),
      ...data.distractorFactors.map((d) => d.textKey),
      ...data.causalChain.nodes.map((n) => n.labelKey),
    ].forEach((k) => keys.add(k));
  }
  for (const k of keys) if (!(k in text)) problems.push(`${id}: case data references missing "${k}"`);
  for (const r of def.readNext) if (!SOURCES.some((s) => s.id === r)) problems.push(`${id}: readNext names unknown source ${r}`);
}

if (problems.length) {
  console.error(problems.join('\n'));
  console.error(`\n${problems.length} i18n problem(s).`);
  process.exit(1);
}
console.log(`i18n ok: ${Object.keys(ui).length} UI keys, ${caseIds().length} case(s), every locale complete.`);
