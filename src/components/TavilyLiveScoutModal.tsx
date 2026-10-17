import React, { useState } from 'react';
import { Listing } from '../types';
import { searchLiveSubletsWithTavily } from '../services/tavily';
import { Globe, Search, Plus, ExternalLink, X, Zap, ShieldCheck } from 'lucide-react';

interface TavilyLiveScoutModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImportListings: (listings: Listing[]) => void;
  defaultCity: string;
}

export const TavilyLiveScoutModal: React.FC<TavilyLiveScoutModalProps> = ({
  isOpen,
  onClose,
  onImportListings,
  defaultCity,
}) => {
  const [city, setCity] = useState(defaultCity || 'New York City');
  const [customQuery, setCustomQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [results, setResults] = useState<Listing[]>([]);
  const [rawAnswer, setRawAnswer] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleExecuteSearch = async () => {
    setIsLoading(true);
    try {
      const res = await searchLiveSubletsWithTavily(city, customQuery);
      setResults(res.listings);
      setRawAnswer(res.rawAnswer || null);
    } catch (err) {
      console.error('Tavily search failure:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleImportAll = () => {
    if (results.length > 0) {
      onImportListings(results);
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/85 backdrop-blur-sm overflow-y-auto">
      <div className="relative w-full max-w-3xl bg-zinc-950 border-2 border-cyan-800 shadow-[8px_8px_0px_0px_#0e7490] my-8 overflow-hidden font-mono">
        {/* Top Header */}
        <div className="flex items-center justify-between px-4 py-3 bg-zinc-900 border-b border-zinc-800">
          <div className="flex items-center gap-2">
            <Globe className="w-4 h-4 text-cyan-400" />
            <span className="text-xs font-bold text-zinc-100 uppercase tracking-wider">
              TAVILY AI REAL-TIME WEB SCOUT // RUNTIME INTEGRATION
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-zinc-800 text-zinc-400 hover:text-white transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-4 sm:p-6 max-h-[75vh] overflow-y-auto space-y-5">
          {/* Prize Banner */}
          <div className="p-3 bg-cyan-950/40 border border-cyan-800/80 text-xs text-zinc-300 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-cyan-400 shrink-0" />
              <span>
                <strong>Best Use of Tavily ($3,000 Bonus Award Track):</strong> Live web scouting extracts unstructured Reddit, Craigslist & student listings in real time.
              </span>
            </div>
          </div>

          {/* Search Inputs */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-[11px] text-zinc-400 uppercase font-bold mb-1">
                TARGET CITY
              </label>
              <input
                type="text"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="e.g. New York, London, Bogotá"
                className="w-full bg-zinc-900 border border-zinc-800 px-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-500"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-[11px] text-zinc-400 uppercase font-bold mb-1">
                SEARCH QUERY OVERRIDE (OPTIONAL)
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={customQuery}
                  onChange={(e) => setCustomQuery(e.target.value)}
                  placeholder="e.g. cheap sublet under market rent site:reddit.com/r/NYCapartments"
                  className="w-full bg-zinc-900 border border-zinc-800 px-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-500"
                />
                <button
                  onClick={handleExecuteSearch}
                  disabled={isLoading}
                  className="px-4 py-2 bg-cyan-500 hover:bg-cyan-400 text-black font-bold text-xs uppercase flex items-center gap-1.5 transition cursor-pointer disabled:opacity-50 shrink-0"
                >
                  <Search className="w-3.5 h-3.5" />
                  <span>{isLoading ? 'SCOUTING...' : 'RUN SCOUT'}</span>
                </button>
              </div>
            </div>
          </div>

          {/* AI Synthesis from Tavily */}
          {rawAnswer && (
            <div className="p-3 bg-zinc-900 border border-zinc-800 text-xs text-zinc-300">
              <span className="text-cyan-400 font-bold block mb-1 uppercase">
                Tavily Live Web Synthesis:
              </span>
              <p className="leading-relaxed font-sans">{rawAnswer}</p>
            </div>
          )}

          {/* Results List */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-zinc-300 uppercase">
                DISCOVERED OFF-MARKET POSTINGS ({results.length})
              </span>
              {results.length > 0 && (
                <button
                  onClick={handleImportAll}
                  className="text-xs text-emerald-400 hover:underline flex items-center gap-1 cursor-pointer font-bold"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>IMPORT ALL DISCOVERIES INTO RADAR</span>
                </button>
              )}
            </div>

            {results.length === 0 && !isLoading && (
              <div className="p-8 text-center border border-zinc-900 bg-zinc-900/30 text-xs text-zinc-500">
                Click "RUN SCOUT" to trigger Tavily Search API across live student and local subletting boards.
              </div>
            )}

            {isLoading && (
              <div className="p-8 text-center border border-zinc-900 bg-zinc-900/30 text-xs text-cyan-400 animate-pulse">
                SCANNING REAL-TIME WEB POSTINGS ACROSS REDDIT, CRAIGSLIST, AND CAMPUS BULLETIN BOARDS VIA TAVILY API...
              </div>
            )}

            <div className="space-y-3">
              {results.map((item) => (
                <div
                  key={item.id}
                  className="p-3 bg-zinc-900/80 border border-zinc-800 hover:border-cyan-800 transition flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3"
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="px-1.5 py-0.5 text-[9px] font-bold bg-cyan-950 text-cyan-300 border border-cyan-800 uppercase">
                        {item.source}
                      </span>
                      <span className="text-[11px] text-emerald-400 font-bold">
                        ${item.priceUsd}/mo
                      </span>
                      <span className="text-[10px] text-zinc-500">
                        ({item.savingsPercentage}% below area median)
                      </span>
                    </div>
                    <h5 className="text-xs font-bold text-white line-clamp-1">
                      {item.title}
                    </h5>
                    <p className="text-[11px] text-zinc-400 line-clamp-2 mt-0.5 font-sans">
                      {item.description}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <a
                      href={item.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700 transition"
                      title="View original link"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 bg-zinc-900 border-t border-zinc-800 flex items-center justify-between">
          <span className="text-[11px] text-zinc-500">
            Endpoint: <code className="text-zinc-400">https://api.tavily.com/search</code>
          </span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-bold uppercase transition cursor-pointer"
          >
            CLOSE
          </button>
        </div>
      </div>
    </div>
  );
};
