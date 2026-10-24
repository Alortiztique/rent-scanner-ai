import React, { useRef, useState } from 'react';
import type { ScoutListing } from '../types';
import { CITIES } from '../data/cities';
import { searchLiveSubletsWithTavily, type TavilyScoutResult } from '../services/tavily';
import {
  formatSourceHost,
  getCitySearchProfile,
  listSupportedCities,
  pickScoutCity,
} from '../services/tavilySearch';
import { Globe, Search, Plus, ExternalLink, X, Zap, TriangleAlert, FlaskConical } from 'lucide-react';

interface TavilyLiveScoutModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImportListings: (candidates: ScoutListing[]) => void;
  defaultCity: string;
}

type ScoutState =
  | { status: 'idle' }
  | { status: 'loading'; cityId: string; cityName: string }
  | { status: 'done'; cityId: string; cityName: string; result: TavilyScoutResult };

const SCOUT_CITIES = listSupportedCities(CITIES);

/**
 * The dialog body mounts on every open, so each opening starts from the parent's currently
 * selected city instead of state left over from an earlier session.
 */
export const TavilyLiveScoutModal: React.FC<TavilyLiveScoutModalProps> = ({ isOpen, ...props }) => {
  if (!isOpen) return null;
  return <TavilyScoutDialog {...props} />;
};

const TavilyScoutDialog: React.FC<Omit<TavilyLiveScoutModalProps, 'isOpen'>> = ({
  onClose,
  onImportListings,
  defaultCity,
}) => {
  const [initial] = useState(() => pickScoutCity(defaultCity, SCOUT_CITIES));
  const [cityId, setCityId] = useState(initial?.city.id ?? '');
  const [customQuery, setCustomQuery] = useState('');
  const [search, setSearch] = useState<ScoutState>({ status: 'idle' });
  const requestSeq = useRef(0);

  const city = SCOUT_CITIES.find((c) => c.id === cityId);
  const profile = city ? getCitySearchProfile(city.id) : undefined;
  const domains = profile ? profile.includeDomains.join(', ') : '';

  // Only state produced for the currently selected city is ever displayed.
  const current = search.status !== 'idle' && search.cityId === cityId ? search : null;
  const isLoading = current?.status === 'loading';
  const result = current?.status === 'done' ? current.result : null;
  const results = result?.listings ?? [];
  const cityName = current?.cityName ?? city?.name ?? '';

  const handleCityChange = (nextCityId: string) => {
    requestSeq.current += 1; // invalidate any in-flight response for the previous city
    setCityId(nextCityId);
    setSearch({ status: 'idle' });
  };

  const handleExecuteSearch = async () => {
    if (!city || isLoading) return;
    const requestId = ++requestSeq.current;
    const target = { id: city.id, name: city.name };
    setSearch({ status: 'loading', cityId: target.id, cityName: target.name });

    let next: TavilyScoutResult;
    try {
      next = await searchLiveSubletsWithTavily(target.name, customQuery);
    } catch (err) {
      console.error('Tavily search failure:', err);
      next = { listings: [], mode: 'unavailable', error: 'Scout search failed unexpectedly.' };
    }

    if (requestId !== requestSeq.current) return; // a newer search or city change superseded this one
    setSearch({ status: 'done', cityId: target.id, cityName: target.name, result: next });
  };

  const handleImportAll = () => {
    if (results.length > 0) {
      onImportListings(results);
      onClose();
    }
  };

  const renderStatus = () => {
    if (!city || !profile) {
      return (
        <div className="p-4 border border-red-800 bg-red-950/30 text-xs text-red-300">
          No supported Scout city is configured.
        </div>
      );
    }

    if (isLoading) {
      return (
        <div className="p-8 text-center border border-zinc-900 bg-zinc-900/30 text-xs text-cyan-400 animate-pulse">
          SEARCHING {domains.toUpperCase()} FOR {cityName.toUpperCase()} VIA TAVILY API...
        </div>
      );
    }

    if (!result) {
      return (
        <div className="p-8 text-center border border-zinc-900 bg-zinc-900/30 text-xs text-zinc-500">
          No search has run yet. Click "RUN SCOUT" to search {domains} for {city.name}.
        </div>
      );
    }

    if (result.mode === 'demo') {
      return (
        <div className="p-3 border border-amber-700 bg-amber-950/30 text-xs text-amber-200 flex gap-2">
          <FlaskConical className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <div>
            <span className="font-bold block mb-1 uppercase">Demo mode — not a live search</span>
            <p className="font-sans leading-relaxed">{result.rawAnswer}</p>
          </div>
        </div>
      );
    }

    if (result.mode === 'unavailable' || result.mode === 'unsupported') {
      return (
        <div className="p-3 border border-red-800 bg-red-950/30 text-xs text-red-200 flex gap-2">
          <TriangleAlert className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
          <div>
            <span className="font-bold block mb-1 uppercase">
              {result.mode === 'unsupported' ? 'Unsupported city' : 'Search unavailable'}
            </span>
            <p className="font-sans leading-relaxed">{result.error}</p>
            <p className="font-sans leading-relaxed text-red-300/80 mt-1">
              No results are shown and no sample data was substituted.
            </p>
          </div>
        </div>
      );
    }

    if (results.length === 0) {
      return (
        <div className="p-3 border border-zinc-700 bg-zinc-900/60 text-xs text-zinc-300">
          <span className="font-bold block mb-1 uppercase text-zinc-100">Live search completed — 0 results</span>
          <p className="font-sans leading-relaxed">
            Tavily returned no matching pages for {cityName} on {domains}. Try a different query.
          </p>
        </div>
      );
    }

    return (
      <div className="p-3 border border-cyan-800 bg-cyan-950/30 text-xs text-zinc-200">
        <span className="font-bold block mb-1 uppercase text-cyan-300">
          Live search — {results.length} {results.length === 1 ? 'result' : 'results'} for {cityName}
        </span>
        <p className="font-sans leading-relaxed">
          These are unverified search hits, not confirmed available rentals. Check availability, price,
          and terms on the original source.
        </p>
      </div>
    );
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
            type="button"
            onClick={onClose}
            aria-label="Close Tavily Scout"
            className="p-1 hover:bg-zinc-800 text-zinc-400 hover:text-white transition cursor-pointer"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-4 sm:p-6 max-h-[75vh] overflow-y-auto space-y-5">
          {/* Prize Banner */}
          <div className="p-3 bg-cyan-950/40 border border-cyan-800/80 text-xs text-zinc-300 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-cyan-400 shrink-0" />
              <span>
                <strong>Best Use of Tavily ($3,000 Bonus Award Track):</strong> Scout searches each city's local
                listing boards and forums with localized terms. Results are unverified search hits.
              </span>
            </div>
          </div>

          {/* Search Inputs */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label htmlFor="tavily-scout-city" className="block text-[11px] text-zinc-400 uppercase font-bold mb-1">
                TARGET CITY
              </label>
              <select
                id="tavily-scout-city"
                value={cityId}
                onChange={(e) => handleCityChange(e.target.value)}
                className="w-full bg-zinc-900 border border-zinc-800 px-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-500"
              >
                {SCOUT_CITIES.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="tavily-scout-query" className="block text-[11px] text-zinc-400 uppercase font-bold mb-1">
                SEARCH QUERY OVERRIDE (OPTIONAL)
              </label>
              <div className="flex gap-2">
                <input
                  id="tavily-scout-query"
                  type="text"
                  value={customQuery}
                  onChange={(e) => setCustomQuery(e.target.value)}
                  placeholder={city ? `Leave blank for the localized ${city.name} default` : ''}
                  className="w-full bg-zinc-900 border border-zinc-800 px-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-500"
                />
                <button
                  onClick={() => void handleExecuteSearch()}
                  disabled={isLoading || !city}
                  className="px-4 py-2 bg-cyan-500 hover:bg-cyan-400 text-black font-bold text-xs uppercase flex items-center gap-1.5 transition cursor-pointer disabled:opacity-50 shrink-0"
                >
                  <Search className="w-3.5 h-3.5" />
                  <span>{isLoading ? 'SCOUTING...' : 'RUN SCOUT'}</span>
                </button>
              </div>
            </div>
          </div>

          {/* Search configuration for the selected city */}
          {city && profile && (
            <div className="text-[11px] text-zinc-500 space-y-1">
              {initial?.isFallback && cityId === initial.city.id && (
                <p className="text-amber-300">
                  Radar view "{defaultCity}" is not a single city, so Scout starts with {initial.city.name}. Pick
                  another city above if needed.
                </p>
              )}
              <p>
                Sources for {city.name}: <span className="text-zinc-300">{domains}</span>
              </p>
              <p>
                Default query: <code className="text-zinc-400 break-words">{profile.defaultQuery}</code>
              </p>
            </div>
          )}

          {renderStatus()}

          {result?.query && (
            <p className="text-[11px] text-zinc-500">
              {result.mode === 'demo' ? 'Query (not sent in demo mode): ' : 'Query sent: '}
              <code className="text-zinc-300 break-words">{result.query}</code>
            </p>
          )}

          {/* Generated summary from Tavily (live only) */}
          {result?.mode === 'live' && result.rawAnswer && (
            <div className="p-3 bg-zinc-900 border border-zinc-800 text-xs text-zinc-300">
              <span className="text-cyan-400 font-bold block mb-1 uppercase">
                Tavily generated summary (unverified):
              </span>
              <p className="leading-relaxed font-sans">{result.rawAnswer}</p>
            </div>
          )}

          {/* Results List */}
          {results.length > 0 && result && (
            <div>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 mb-2">
                <span className="text-xs font-bold text-zinc-300 uppercase">
                  {result.mode === 'demo' ? 'DEMO SAMPLE' : 'SEARCH HITS'} ({results.length})
                </span>
                <button
                  type="button"
                  onClick={handleImportAll}
                  className="text-xs text-emerald-400 hover:underline flex items-center gap-1 cursor-pointer font-bold"
                >
                  <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>
                    {result.mode === 'demo'
                      ? 'IMPORT DEMO SAMPLE INTO RADAR'
                      : `IMPORT ${results.length} ${results.length === 1 ? 'HIT' : 'HITS'} INTO RADAR`}
                  </span>
                </button>
              </div>
              <p className="text-[10px] text-zinc-500 mb-2 font-sans">
                {result.mode === 'demo'
                  ? 'Imported demo samples stay labelled Demo in the Radar. They are not real postings.'
                  : 'Imported hits appear in the Radar as unverified search hits, without price, availability, property details, deal score, or audit.'}
              </p>

              <div className="space-y-3">
                {results.map((item) => (
                  <div
                    key={item.id}
                    className="p-3 bg-zinc-900/80 border border-zinc-800 hover:border-cyan-800 transition flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        {item.mode === 'demo' ? (
                          <span className="px-1.5 py-0.5 text-[9px] font-bold bg-amber-950 text-amber-300 border border-amber-700 uppercase">
                            DEMO
                          </span>
                        ) : (
                          <span className="px-1.5 py-0.5 text-[9px] font-bold bg-zinc-800 text-zinc-300 border border-zinc-600 uppercase">
                            UNVERIFIED
                          </span>
                        )}
                        <span className="text-[10px] text-zinc-400 truncate">{formatSourceHost(item.sourceUrl)}</span>
                      </div>
                      <h5 className="text-xs font-bold text-white line-clamp-2 break-words">{item.title}</h5>
                      <p className="text-[11px] text-zinc-400 line-clamp-3 mt-0.5 font-sans break-words">
                        {item.description}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <a
                        href={item.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={
                          item.mode === 'demo'
                            ? `Open demo source site ${formatSourceHost(item.sourceUrl)} (opens in a new tab)`
                            : `Open original source for "${item.title}" on ${formatSourceHost(item.sourceUrl)} (opens in a new tab)`
                        }
                        className="px-2 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700 transition flex items-center gap-1 text-[10px] font-bold uppercase"
                        title={item.sourceUrl}
                      >
                        <span>{item.mode === 'demo' ? 'Source site' : 'Open source'}</span>
                        <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 bg-zinc-900 border-t border-zinc-800 flex items-center justify-between">
          <span className="text-[11px] text-zinc-500">
            Endpoint: <code className="text-zinc-400">https://api.tavily.com/search</code>
          </span>
          <button
            type="button"
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
