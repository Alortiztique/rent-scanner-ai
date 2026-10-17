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
  marketPriceComparison: string;
  verifiedPerks: string[];
  auditWarnings: string[];
  negotiationScript: string;
  leaseClauseSummary: string;
  analyzedByModel: string;
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
