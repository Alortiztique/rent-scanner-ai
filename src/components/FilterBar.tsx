import React from 'react';
import { FilterState, ListingType } from '../types';
import { Search, SlidersHorizontal, Sparkles, ShieldCheck, Check } from 'lucide-react';

interface FilterBarProps {
  filters: FilterState;
  onFilterChange: (newFilters: Partial<FilterState>) => void;
  onRunAiSearch: () => void;
  isAiProcessing: boolean;
}

const LISTING_TYPES: { type: ListingType; label: string }[] = [
  { type: 'sublease', label: 'SUBLEASE' },
  { type: 'room', label: 'ROOM / FLATSHARE' },
  { type: 'entire_apartment', label: 'ENTIRE APT' },
  { type: 'studio', label: 'STUDIO' },
];

export const FilterBar: React.FC<FilterBarProps> = ({
  filters,
  onFilterChange,
  onRunAiSearch,
  isAiProcessing,
}) => {
  const toggleType = (type: ListingType) => {
    const exists = filters.types.includes(type);
    const updated = exists
      ? filters.types.filter((t) => t !== type)
      : [...filters.types, type];
    onFilterChange({ types: updated });
  };

  return (
    <div className="border border-zinc-800 bg-zinc-950 p-4 sm:p-5 mb-6 shadow-[4px_4px_0px_0px_#18181b]">
      {/* Natural language AI query input */}
      <div className="mb-4">
        <label className="block text-xs font-mono font-bold text-zinc-300 uppercase mb-1.5 flex items-center justify-between">
          <span className="flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
            NVIDIA NEMOTRON NATURAL LANGUAGE RADAR QUERY
          </span>
          <span className="text-[10px] text-zinc-500 font-normal">
            POWERED BY NEMOTRON-MINI-4B
          </span>
        </label>
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <input
              type="text"
              value={filters.searchQuery}
              onChange={(e) => onFilterChange({ searchQuery: e.target.value })}
              onKeyDown={(e) => e.key === 'Enter' && onRunAiSearch()}
              placeholder="e.g. 2-bed under $1300 with balcony and bills included near train..."
              className="w-full bg-zinc-900 border border-zinc-800 focus:border-emerald-500 focus:outline-none px-3.5 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-600 font-mono"
            />
            {filters.searchQuery && (
              <button
                onClick={() => onFilterChange({ searchQuery: '' })}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-mono text-zinc-500 hover:text-zinc-300"
              >
                CLEAR
              </button>
            )}
          </div>
          <button
            onClick={onRunAiSearch}
            disabled={isAiProcessing}
            className="flex items-center justify-center gap-2 px-5 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-black font-mono font-bold text-xs uppercase transition shadow-[2px_2px_0px_0px_#052e16] cursor-pointer disabled:opacity-50"
          >
            <Search className="w-4 h-4" />
            <span>{isAiProcessing ? 'ROUTING...' : 'PARSE & SCAN'}</span>
          </button>
        </div>
      </div>

      {/* Skyscanner-style Matrix Controls */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-4 pt-3 border-t border-zinc-900">
        {/* Listing Type Selectors */}
        <div className="md:col-span-5">
          <span className="block text-[11px] font-mono text-zinc-400 uppercase font-bold mb-2">
            HOUSING TYPOLOGY
          </span>
          <div className="flex flex-wrap gap-1.5 font-mono">
            {LISTING_TYPES.map(({ type, label }) => {
              const active = filters.types.includes(type);
              return (
                <button
                  key={type}
                  onClick={() => toggleType(type)}
                  className={`px-2.5 py-1 text-xs border transition cursor-pointer flex items-center gap-1 ${
                    active
                      ? 'bg-zinc-200 text-black border-zinc-200 font-bold'
                      : 'bg-zinc-900 text-zinc-400 border-zinc-800 hover:border-zinc-700 hover:text-zinc-200'
                  }`}
                >
                  {active && <Check className="w-3 h-3 text-black" />}
                  <span>{label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Max Budget Slider */}
        <div className="md:col-span-3">
          <div className="flex items-center justify-between text-[11px] font-mono mb-2">
            <span className="text-zinc-400 uppercase font-bold">MAX BUDGET</span>
            <span className="text-emerald-400 font-bold">${filters.maxPriceUsd} USD</span>
          </div>
          <input
            type="range"
            min={300}
            max={3500}
            step={50}
            value={filters.maxPriceUsd}
            onChange={(e) => onFilterChange({ maxPriceUsd: Number(e.target.value) })}
            className="w-full accent-emerald-500 bg-zinc-800 h-1 cursor-pointer"
          />
          <div className="flex justify-between text-[9px] font-mono text-zinc-600 mt-1">
            <span>$300</span>
            <span>$1,800</span>
            <span>$3,500</span>
          </div>
        </div>

        {/* Essential Anti-Gentrification Toggles */}
        <div className="md:col-span-4 flex flex-wrap items-center gap-2 font-mono">
          <button
            onClick={() => onFilterChange({ noBrokerFeeOnly: !filters.noBrokerFeeOnly })}
            className={`px-2.5 py-1.5 text-[11px] border transition cursor-pointer flex items-center gap-1.5 ${
              filters.noBrokerFeeOnly
                ? 'bg-emerald-950/80 text-emerald-300 border-emerald-600 font-bold'
                : 'bg-zinc-900 text-zinc-400 border-zinc-800 hover:border-zinc-700'
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            <span>0% BROKER FEE</span>
          </button>

          <button
            onClick={() => onFilterChange({ utilitiesIncludedOnly: !filters.utilitiesIncludedOnly })}
            className={`px-2.5 py-1.5 text-[11px] border transition cursor-pointer ${
              filters.utilitiesIncludedOnly
                ? 'bg-emerald-950/80 text-emerald-300 border-emerald-600 font-bold'
                : 'bg-zinc-900 text-zinc-400 border-zinc-800 hover:border-zinc-700'
            }`}
          >
            <span>BILLS INCLUDED</span>
          </button>

          {/* Sort By selector */}
          <div className="flex items-center gap-1.5 ml-auto text-[11px]">
            <span className="text-zinc-500 uppercase">SORT:</span>
            <select
              value={filters.sortBy}
              onChange={(e) => onFilterChange({ sortBy: e.target.value as any })}
              className="bg-zinc-900 border border-zinc-800 text-zinc-200 px-2 py-1 text-xs font-mono focus:outline-none focus:border-zinc-600 cursor-pointer"
            >
              <option value="dealScore">⚡ NEMOTRON DEAL SCORE</option>
              <option value="priceAsc">⬇ LOWEST PRICE</option>
              <option value="savings">🔥 BIGGEST SAVINGS %</option>
              <option value="priceDesc">⬆ HIGHEST PRICE</option>
            </select>
          </div>
        </div>
      </div>
    </div>
  );
};
