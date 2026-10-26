export interface City {
  id: string;
  name: string;
  country: string;
  currency: string;
  currencySymbol: string;
  medianRentUsd: number;
  topAffordableNeighborhoods: string[];
  gentrificationRating: 'Severe' | 'High' | 'Moderate';
  activeDealsCount: number;
}

export type ListingType = 'sublease' | 'room' | 'entire_apartment' | 'studio' | 'loft';

export interface NemotronAudit {
  scamRiskScore: number; // 0-10 (0 = Verified safe, 10 = Scam alert)
  gentrificationIndex: 'Anti-Gentrification Champion' | 'Community Grounded' | 'Corporate Gouging Alert';
  fairRentScore: number; // 0-100
  marketPriceComparison: string;  verifiedPerks: string[];
  auditWarnings: string[];
  negotiationScript: string;
  leaseClauseSummary: string;
  analyzedByModel: string;
}

export const AUDIT_CATEGORIES = [
  'security_deposit',
  'late_fee',
  'rent_increase',
  'termination',
  'fees_and_charges',
  'other',
] as const;
 
export type AuditCategory = (typeof AUDIT_CATEGORIES)[number];
export type AuditSeverity = 'info' | 'warning' | 'illegal';
 
export interface AuditFinding {
  clauseText: string;
  category: AuditCategory;
  severity: AuditSeverity;
  issue: string;
  legalReference: string; // ID from the closed list of the city's legal base (e.g. "CO_BOG.rentIncreases")
  suggestedRevision: string;
  quoteVerified: boolean; // clauseText really appears in the lease
  legalReferenceVerified: boolean; // legalReference exists in the legal base
}
 
export interface ReAuditResult {
  isValid: boolean; // true when there are no findings with severity "illegal"
  language: string;
  summary: string;
  findings: AuditFinding[];
  legalSources: LegalSourceRef[];
  disclaimer: string;
  analyzedByModel: string;
}
 
export interface LegalSourceRef {
  id: string;
  title: string;
  source: string;
}
 
// The unit stored and retrieved by the RAG.
export type LegalCategory =
  | 'summary'
  | 'security_deposit'
  | 'late_fee'
  | 'rent_increase'
  | 'termination';
 
export interface LegalChunk {
  id: string; // citable ID, e.g. "CO_BOG.rentIncreases" or "CO_BOG.rentIncreases.ipc-cap"
  cityCode: string; // LegalContext.code
  cityName: string;
  category: LegalCategory;
  title: string;
  text: string;
  source: string;
  keywords: string[]; // extra multilingual terms to improve matching
}
 
export interface RetrievedChunk {
  chunk: LegalChunk;
  score: number;
  reason: 'always' | 'category' | 'bm25' | 'fallback';
}
 
// One atomic, citable rule nested inside a city of the knowledge base.
export type LegalProvisionCategory = Exclude<LegalCategory, 'summary'>;
 
export interface LegalProvision {
  id: string;
  category: LegalProvisionCategory;
  title: string;
  text: string;
  source: string;
  keywords: string[];
}
 
export interface LegalContext {
  code: string;
  cityName: string;
  aliases: string[]; // alternative spellings or languages of the city name
  summary: string;
  provisions: LegalProvision[];  // Nested statutes, each one becomes a retrieval chunk
}

export interface Listing {
  id: string;
  title: string;
  cityId: string;
  cityName: string;
  neighborhood: string;
  priceLocal: number;
  priceUsd: number;
  currency: string;
  currencySymbol: string;
  originalMarketPriceUsd: number;
  savingsPercentage: number;
  dealScore: number; // 0-100 calculated by Nemotron
  type: ListingType;
  duration: string;
  availableDate: string;
  bedrooms: number;
  bathrooms: number;
  squareMeters: number;
  squareFeet: number;
  furnished: boolean;
  utilitiesIncluded: boolean;
  noBrokerFee: boolean;
  imageUrl: string;
  source: 'Reddit Sublet' | 'Craigslist Stealth' | 'University Board' | 'Direct Tenant' | 'Tavily Web Scout';
  sourceUrl: string;
  description: string;
  nemotronAudit: NemotronAudit;
  tags: string[];
  verifiedDate: string;
}

export interface FilterState {
  cityId: string;
  maxPriceUsd: number;
  minDealScore: number;
  types: ListingType[];
  furnishedOnly: boolean;
  utilitiesIncludedOnly: boolean;
  noBrokerFeeOnly: boolean;
  searchQuery: string;
  sortBy: 'dealScore' | 'priceAsc' | 'priceDesc' | 'savings';
}

export interface ChatMessage {
  id: string;
  sender: 'user' | 'nemotron' | 'system';
  text: string;
  timestamp: string;
  modelUsed?: string;
}

export interface TavilySearchResult {
  title: string;
  url: string;
  content: string;
  score?: number;
  published_date?: string;
}
