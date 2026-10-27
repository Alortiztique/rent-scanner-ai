import { LEGAL_KNOWLEDGE_BASE } from "../data/legalContext";
import { LegalChunk, LegalContext, LegalProvisionCategory, RetrievedChunk } from "../types";

// Folds accents and case for matching: decomposes, drops combining marks, lowercases.
// City names, tokens, and lexicon terms all go through this first, then add their own stages.
function foldText(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

export function normalizeCityName(name: string): string {
  return foldText(name).replace(/[^a-z0-9\u3040-\u30ff\u4e00-\u9faf]/g, '');
}
 
const CITY_INDEX: Map<string, LegalContext> = (() => {
  const index = new Map<string, LegalContext>();
  for (const ctx of Object.values(LEGAL_KNOWLEDGE_BASE)) {
    for (const name of [ctx.cityName, ...ctx.aliases]) {
      index.set(normalizeCityName(name), ctx);
    }
  }
  return index;
})();

export function findLegalContext(cityName: string): LegalContext | null {
  return CITY_INDEX.get(normalizeCityName(cityName)) ?? null;
}

export type CoreCategory = LegalProvisionCategory;

// Detects which topics a lease clause touches, and enriches each chunk's index so a 
// Spanish/French/German clause can match an English chunk.

export const CATEGORY_LEXICON: Record<CoreCategory, string[]> = {
  security_deposit: [
    'deposit', 'security deposit', 'holding deposit', 'bond', 'cleaning fee', 'key money',
    'deposito', 'fianza', 'garantia', 'caucion', 'arras', 'coarrendatario', 'codeudor', 'fiador', 'aval',
    'depot de garantie', 'caution', 'cautionnement',
    'kaution', 'mietkaution',
    'shikikin', 'reikin',
    'caucao',
  ],
  late_fee: [
    'late fee', 'late payment', 'penalty', 'default interest', 'grace period', 'interest on arrears',
    'mora', 'multa', 'penalidad', 'recargo', 'sancion', 'retraso', 'demora', 'intereses', 'clausula penal',
    'penalite', 'retard', 'majoration',
    'verzug', 'verzugszinsen', 'mahngebuhr', 'vertragsstrafe',
  ],
  rent_increase: [
    'rent increase', 'increase', 'rent review', 'indexation', 'escalation', 'cap on rent',
    'incremento', 'aumento', 'reajuste', 'ajuste', 'canon', 'ipc', 'actualizacion', 'indexacion', 'revision',
    'irl', 'augmentation', 'loyer', 'revision du loyer', 'encadrement',
    'mieterhohung', 'mietspiegel', 'staffelmiete', 'indexmiete', 'mietpreisbremse',
  ],
  termination: [
    'terminate', 'termination', 'evict', 'eviction', 'notice', 'renewal', 'break clause', 'early exit',
    'sublet', 'sublease', 'vacate',
    'terminacion', 'rescision', 'desahucio', 'desalojo', 'preaviso', 'vencimiento', 'prorroga', 'renovacion',
    'permanencia', 'indemnizacion', 'subarriendo', 'subarrendar', 'cesion',
    'conge', 'resiliation', 'preavis', 'expulsion',
    'kundigung', 'kundigungsfrist', 'raumung', 'untervermietung',
  ],
};
 
 
function buildCorpus(): LegalChunk[] {
  const chunks: LegalChunk[] = [];
  const ids = new Set<string>();
  const codes = new Set<string>();
 
  const push = (chunk: LegalChunk) => {
    if (ids.has(chunk.id)) throw new Error(`Legal knowledge base: duplicate id "${chunk.id}".`);
    ids.add(chunk.id);
    chunks.push(chunk);
  };
 
  for (const ctx of Object.values(LEGAL_KNOWLEDGE_BASE)) {
    if (codes.has(ctx.code)) throw new Error(`Legal knowledge base: duplicate city code "${ctx.code}".`);
    codes.add(ctx.code);
 
    // The city's legal framework is always a citable chunk.
    push({
      id: `${ctx.code}.summary`,
      cityCode: ctx.code,
      cityName: ctx.cityName,
      category: 'summary',
      title: `${ctx.cityName}: legal framework`,
      text: ctx.summary,
      source: '',
      keywords: [],
    });
 
    for (const p of ctx.provisions) {
      if (!p.id.startsWith(`${ctx.code}.`)) {
        throw new Error(`Legal knowledge base: provision "${p.id}" must start with "${ctx.code}.".`);
      }
      push({
        id: p.id,
        cityCode: ctx.code,
        cityName: ctx.cityName,
        category: p.category,
        title: p.title,
        text: p.text,
        source: p.source,
        keywords: [...CATEGORY_LEXICON[p.category], ...p.keywords],
      });
    }
  }
 
  return chunks;
}
 
const CORPUS: LegalChunk[] = buildCorpus();
const BY_CITY = new Map<string, LegalChunk[]>();
for (const c of CORPUS) {
  const list = BY_CITY.get(c.cityCode) ?? [];
  list.push(c);
  BY_CITY.set(c.cityCode, list);
}
 
export function getCorpusForCity(cityCode: string): LegalChunk[] {
  return BY_CITY.get(cityCode) ?? [];
}
 
// Retrieval strategy:
// 1. HARD FILTER by jurisdiction: only chunks of the listing's city are ever considered.
// 2. ROUTING: a multilingual lexicon detects which topics and guarantees the best chunk
// of each is included.
// 3. BM25 over chunk title + text + keywords fills the remaining slots.
// 4. If the clause gives no signal, return the core rules so the model is never left without law.
 
const CORE_CATEGORIES = Object.keys(CATEGORY_LEXICON) as CoreCategory[];
 
const DEFAULT_TOP_K = 5;
const DEFAULT_MAX_CHARS = 6000;
 
const STOPWORDS = new Set([
  'the', 'and', 'for', 'of', 'to', 'in', 'an', 'is', 'be', 'by', 'or', 'on', 'at', 'as', 'it',
  'el', 'la', 'los', 'las', 'de', 'del', 'y', 'o', 'que', 'en', 'por', 'con', 'un', 'una', 'se', 'al',
  'le', 'les', 'des', 'du', 'et', 'der', 'die', 'das', 'und',
]);

 
function tokenize(s: string): string[] {
  return foldText(s)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
 
const LEXICON_REGEX: Record<CoreCategory, RegExp[]> = Object.fromEntries(
  CORE_CATEGORIES.map((cat) => [
    cat,
    CATEGORY_LEXICON[cat].map((term) => {
      const t = escapeRe(foldText(term).trim());
      return new RegExp(t.length <= 4 ? `\\b${t}\\b` : `\\b${t}`);
    }),
  ]),
) as Record<CoreCategory, RegExp[]>;
 
export function detectCategories(text: string): { category: CoreCategory; hits: number }[] {
  const folded = foldText(text);
  return CORE_CATEGORIES.map((category) => ({
    category,
    hits: LEXICON_REGEX[category].filter((re) => re.test(folded)).length,
  }))
    .filter((d) => d.hits > 0)
    .sort((a, b) => b.hits - a.hits);
}

//BM25

interface CityIndex {
  chunks: LegalChunk[];
  docs: string[][];
  df: Map<string, number>;
  avgdl: number;
}
 
const indexCache = new Map<string, CityIndex>();
 
function getIndex(cityCode: string): CityIndex {
  const cached = indexCache.get(cityCode);
  if (cached) return cached;
 
  const chunks = getCorpusForCity(cityCode);
  const docs = chunks.map((c) => tokenize(`${c.title} ${c.text} ${c.keywords.join(' ')}`));
  const df = new Map<string, number>();
  for (const doc of docs) {
    for (const term of new Set(doc)) df.set(term, (df.get(term) ?? 0) + 1);
  }
  const avgdl = docs.reduce((sum, d) => sum + d.length, 0) / Math.max(1, docs.length);
 
  const index = { chunks, docs, df, avgdl };
  indexCache.set(cityCode, index);
  return index;
}
 
function bm25(index: CityIndex, queryTerms: string[], docIdx: number, k1 = 1.5, b = 0.75): number {
  const doc = index.docs[docIdx];
  const N = index.docs.length;
  const tf = new Map<string, number>();
  for (const t of doc) tf.set(t, (tf.get(t) ?? 0) + 1);
 
  let score = 0;
  for (const term of queryTerms) {
    const f = tf.get(term);
    if (!f) continue;
    const n = index.df.get(term) ?? 0;
    const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
    score += (idf * (f * (k1 + 1))) / (f + k1 * (1 - b + (b * doc.length) / index.avgdl));
  }
  return score;
}

export interface RetrievalOptions {
  topK?: number;     // max chunks returned (default 5)
  maxChars?: number; // max total characters of chunk text (default 6000)
}
 
export interface RetrievalResult {
  chunks: RetrievedChunk[];
  detectedCategories: CoreCategory[];
}
 
export function retrieveLegalChunks(
  cityCode: string,
  leaseText: string,
  options: RetrievalOptions = {},
): RetrievalResult {
  const { topK = DEFAULT_TOP_K, maxChars = DEFAULT_MAX_CHARS } = options;
  const index = getIndex(cityCode);
  const detected = detectCategories(leaseText);
 
  const queryTerms = [...new Set(tokenize(leaseText))];
  const scored = index.chunks
    .map((chunk, i) => ({ chunk, score: bm25(index, queryTerms, i) }))
    .sort((a, b) => b.score - a.score);
 
  const selected = new Map<string, RetrievedChunk>();
  const add = (chunk: LegalChunk, score: number, reason: RetrievedChunk['reason']) => {
    if (selected.size < topK && !selected.has(chunk.id)) {
      selected.set(chunk.id, { chunk, score, reason });
    }
  };
 
  // 1. The jurisdiction's legal framework is always present (also keeps a valid fallback citation).
  const summary = index.chunks.find((c) => c.category === 'summary');
  if (summary) add(summary, 0, 'always');
 
  // 2. Best chunk of every topic the clause touches.
  for (const { category } of detected) {
    const best = scored.find((s) => s.chunk.category === category);
    if (best) add(best.chunk, best.score, 'category');
  }
 
  // 3. Fill the remaining slots by lexical relevance.
  for (const s of scored) {
    if (s.score > 0) add(s.chunk, s.score, 'bm25');
  }
 
  // 4. No signal at all: give the model the core rules rather than nothing.
  if (selected.size <= 1) {
    for (const category of CORE_CATEGORIES) {
      const first = index.chunks.find((c) => c.category === category);
      if (first) add(first, 0, 'fallback');
    }
  }
 
  // Respect the character budget (the summary is never dropped).
  let used = 0;
  const result: RetrievedChunk[] = [];
  for (const r of selected.values()) {
    used += r.chunk.text.length;
    if (used > maxChars && r.chunk.category !== 'summary') continue;
    result.push(r);
  }
 
  return { chunks: result, detectedCategories: detected.map((d) => d.category) };
}
 
// Serializes retrieved chunks for the prompt, each labelled with its citable ID.
export function formatRetrievedChunks(retrieved: RetrievedChunk[]): string {
  return retrieved
    .map(({ chunk: c }) => {
      const source = c.source ? `\n(Source: ${c.source})` : '';
      return `[${c.id}] ${c.title}\n${c.text}${source}`;
    })
    .join('\n\n');
}