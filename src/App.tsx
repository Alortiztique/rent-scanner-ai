import { useState, useMemo } from 'react';
import { CITIES } from './data/cities';
import { MOCK_LISTINGS } from './data/mockListings';
import type { Listing, FilterState } from './types';
import { Header } from './components/Header';
import { AntiGentrificationBanner } from './components/AntiGentrificationBanner';
import { CityFilter } from './components/CityFilter';
import { FilterBar } from './components/FilterBar';
import { ListingCard } from './components/ListingCard';
import { ListingModal } from './components/ListingModal';
import { TavilyLiveScoutModal } from './components/TavilyLiveScoutModal';
import { NemotronCopilot } from './components/NemotronCopilot';
import { TeamCollaborationBanner } from './components/TeamCollaborationBanner';
import { Footer } from './components/Footer';
import { callNebiusTokenFactory } from './services/nebius';
import { RefreshCw, AlertCircle } from 'lucide-react';

export function App() {
  const [selectedCityId, setSelectedCityId] = useState<string>('all');
  const [listings, setListings] = useState<Listing[]>(MOCK_LISTINGS);
  const [selectedListing, setSelectedListing] = useState<Listing | null>(null);
  const [isTeamTasksOpen, setIsTeamTasksOpen] = useState(false);
  const [isLiveScoutOpen, setIsLiveScoutOpen] = useState(false);
  const [isAiProcessing, setIsAiProcessing] = useState(false);

  const [filters, setFilters] = useState<FilterState>({
    cityId: 'all',
    maxPriceUsd: 2500,
    minDealScore: 70,
    types: [],
    furnishedOnly: false,
    utilitiesIncludedOnly: false,
    noBrokerFeeOnly: false,
    searchQuery: '',
    sortBy: 'dealScore',
  });

  const handleCitySelect = (cityId: string) => {
    setSelectedCityId(cityId);
    setFilters((prev) => ({ ...prev, cityId }));
  };

  const handleFilterChange = (newFilters: Partial<FilterState>) => {
    setFilters((prev) => ({ ...prev, ...newFilters }));
  };

  const handleImportTavilyListings = (newListings: Listing[]) => {
    setListings((prev) => [...newListings, ...prev]);
  };

  // Natural language query router using NVIDIA Nemotron
  const handleRunAiSearch = async () => {
    if (!filters.searchQuery.trim()) return;
    setIsAiProcessing(true);

    try {
      const response = await callNebiusTokenFactory([
        {
          role: 'system',
          content: `You are a query parsing agent for an urban housing platform.
Given a user search prompt, extract:
1. "maxPriceUsd": number or null
2. "types": array of 'sublease' | 'room' | 'entire_apartment' | 'studio'
3. "city": string matching "nyc", "london", "tokyo", "bogota", "dubai", "paris", "berlin", "sf" or null
4. "noBrokerFee": boolean
5. "utilitiesIncluded": boolean
Return strictly JSON matching this structure.`,
        },
        {
          role: 'user',
          content: filters.searchQuery,
        },
      ]);

      if (response) {
        try {
          const jsonStart = response.indexOf('{');
          const jsonEnd = response.lastIndexOf('}');
          if (jsonStart !== -1 && jsonEnd !== -1) {
            const parsed = JSON.parse(response.substring(jsonStart, jsonEnd + 1));
            const updates: Partial<FilterState> = {};
            if (parsed.maxPriceUsd) updates.maxPriceUsd = parsed.maxPriceUsd;
            if (parsed.types && parsed.types.length > 0) updates.types = parsed.types;
            if (parsed.noBrokerFee) updates.noBrokerFeeOnly = true;
            if (parsed.utilitiesIncluded) updates.utilitiesIncludedOnly = true;
            if (parsed.city) {
              setSelectedCityId(parsed.city);
              updates.cityId = parsed.city;
            }
            setFilters((prev) => ({ ...prev, ...updates }));
          }
        } catch (e) {
          console.warn('Could not parse JSON from AI router, using fuzzy text match', e);
        }
      }
    } catch (err) {
      console.error('AI search router error:', err);
    } finally {
      setIsAiProcessing(false);
    }
  };

  // Filter & Sort Logic
  const filteredListings = useMemo(() => {
    return listings
      .filter((listing) => {
        // City match
        if (selectedCityId !== 'all' && listing.cityId !== selectedCityId) {
          return false;
        }

        // Max price in USD
        if (listing.priceUsd > filters.maxPriceUsd) {
          return false;
        }

        // Room types
        if (filters.types.length > 0 && !filters.types.includes(listing.type)) {
          return false;
        }

        // No broker fee
        if (filters.noBrokerFeeOnly && !listing.noBrokerFee) {
          return false;
        }

        // Utilities included
        if (filters.utilitiesIncludedOnly && !listing.utilitiesIncluded) {
          return false;
        }

        // Search text
        if (filters.searchQuery.trim()) {
          const q = filters.searchQuery.toLowerCase();
          const matchTitle = listing.title.toLowerCase().includes(q);
          const matchDesc = listing.description.toLowerCase().includes(q);
          const matchNeigh = listing.neighborhood.toLowerCase().includes(q);
          const matchTags = listing.tags.some((t) => t.toLowerCase().includes(q));
          if (!matchTitle && !matchDesc && !matchNeigh && !matchTags) {
            return false;
          }
        }

        return true;
      })
      .sort((a, b) => {
        if (filters.sortBy === 'dealScore') return b.dealScore - a.dealScore;
        if (filters.sortBy === 'priceAsc') return a.priceUsd - b.priceUsd;
        if (filters.sortBy === 'priceDesc') return b.priceUsd - a.priceUsd;
        if (filters.sortBy === 'savings') return b.savingsPercentage - a.savingsPercentage;
        return 0;
      });
  }, [listings, selectedCityId, filters]);

  const currentCityName = useMemo(() => {
    if (selectedCityId === 'all') return 'Global Metropolises';
    return CITIES.find((c) => c.id === selectedCityId)?.name || 'Global';
  }, [selectedCityId]);

  return (
    <div className="min-h-screen bg-black text-zinc-100 flex flex-col font-sans selection:bg-emerald-500 selection:text-black">
      {/* Top Header */}
      <Header
        onOpenTeamTasks={() => setIsTeamTasksOpen(true)}
        onOpenLiveScout={() => setIsLiveScoutOpen(true)}
      />

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 pt-6">
        {/* Anti-Gentrification Mission & Metrics Banner */}
        <AntiGentrificationBanner />

        {/* Global Metropolitan Hub Selector */}
        <CityFilter
          cities={CITIES}
          selectedCityId={selectedCityId}
          onSelectCity={handleCitySelect}
        />

        {/* Search & Filter Matrix */}
        <FilterBar
          filters={filters}
          onFilterChange={handleFilterChange}
          onRunAiSearch={handleRunAiSearch}
          isAiProcessing={isAiProcessing}
        />

        {/* Results Header Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4 pb-3 border-b border-zinc-800 font-mono text-xs">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 bg-emerald-500"></span>
            <span className="font-bold text-white uppercase">
              RADAR FEED: {currentCityName.toUpperCase()}
            </span>
            <span className="px-2 py-0.5 bg-zinc-900 border border-zinc-800 text-zinc-400">
              {filteredListings.length} STEALTH OPPORTUNITIES LOCATED
            </span>
          </div>

          <div className="flex items-center gap-3 text-zinc-400">
            <span>AUDITED BY NVIDIA NEMOTRON</span>
            <span>•</span>
            <button
              onClick={() => {
                setFilters({
                  cityId: 'all',
                  maxPriceUsd: 3500,
                  minDealScore: 70,
                  types: [],
                  furnishedOnly: false,
                  utilitiesIncludedOnly: false,
                  noBrokerFeeOnly: false,
                  searchQuery: '',
                  sortBy: 'dealScore',
                });
                setSelectedCityId('all');
              }}
              className="text-emerald-400 hover:underline flex items-center gap-1 cursor-pointer"
            >
              <RefreshCw className="w-3 h-3" />
              <span>RESET RADAR</span>
            </button>
          </div>
        </div>

        {/* Listings Grid */}
        {filteredListings.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredListings.map((listing) => (
              <ListingCard
                key={listing.id}
                listing={listing}
                onSelect={(item) => setSelectedListing(item)}
              />
            ))}
          </div>
        ) : (
          <div className="border border-zinc-800 bg-zinc-950 p-12 text-center my-8 font-mono">
            <AlertCircle className="w-8 h-8 text-amber-400 mx-auto mb-3" />
            <h3 className="text-base font-bold text-white uppercase mb-1">
              NO VERIFIED LISTINGS MATCH CURRENT RADAR PARAMETERS
            </h3>
            <p className="text-xs text-zinc-400 max-w-md mx-auto mb-4 font-sans">
              Try adjusting your maximum budget or unchecking room filters. Alternatively, run the Tavily Live Web Scout to crawl fresh off-market deals in real time!
            </p>
            <div className="flex justify-center gap-3">
              <button
                onClick={() => setIsLiveScoutOpen(true)}
                className="px-4 py-2 bg-cyan-500 hover:bg-cyan-400 text-black font-bold text-xs uppercase cursor-pointer"
              >
                RUN TAVILY WEB SCOUT
              </button>
              <button
                onClick={() => {
                  setFilters((prev) => ({
                    ...prev,
                    maxPriceUsd: 3500,
                    types: [],
                    searchQuery: '',
                  }));
                }}
                className="px-4 py-2 bg-zinc-900 border border-zinc-700 hover:bg-zinc-800 text-zinc-300 text-xs font-bold uppercase cursor-pointer"
              >
                EXPAND BUDGET & RESET
              </button>
            </div>
          </div>
        )}
      </main>

      {/* Floating Nemotron Tenant Copilot */}
      <NemotronCopilot currentCity={currentCityName} />

      {/* Modals */}
      <ListingModal
        listing={selectedListing}
        onClose={() => setSelectedListing(null)}
      />

      <TavilyLiveScoutModal
        isOpen={isLiveScoutOpen}
        onClose={() => setIsLiveScoutOpen(false)}
        onImportListings={handleImportTavilyListings}
        defaultCity={currentCityName}
      />

      <TeamCollaborationBanner
        isOpen={isTeamTasksOpen}
        onClose={() => setIsTeamTasksOpen(false)}
      />

      {/* Footer */}
      <Footer />
    </div>
  );
}

export default App;
