import type { City } from '../types';

interface CityFilterProps {
  cities: City[];
  selectedCityId: string;
  onSelectCity: (cityId: string) => void;
}

export const CityFilter: React.FC<CityFilterProps> = ({
  cities,
  selectedCityId,
  onSelectCity,
}) => {
  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-2.5">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 bg-emerald-500 rounded-none"></span>
          <span className="text-xs font-mono font-bold uppercase tracking-wider text-zinc-300">
            METROPOLITAN TARGET RADAR
          </span>
        </div>
        <span className="text-[11px] font-mono text-zinc-500">
          SELECT HUB TO ENGAGE FILTERS
        </span>
      </div>

      {/* Grid / Horizontal Scroll of City Tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
        <button
          onClick={() => onSelectCity('all')}
          className={`p-2.5 text-left border transition cursor-pointer font-mono ${
            selectedCityId === 'all'
              ? 'bg-zinc-100 text-black border-zinc-100 shadow-[3px_3px_0px_0px_#22c55e]'
              : 'bg-zinc-900/80 text-zinc-300 border-zinc-800 hover:border-zinc-600 hover:bg-zinc-850'
          }`}
        >
          <div className="text-xs font-black uppercase">ALL CITIES</div>
          <div className="text-[10px] text-zinc-500 mt-1">Global Radar</div>
          <div className="text-[11px] font-bold text-emerald-500 mt-1">
            270+ DEALS
          </div>
        </button>

        {cities.map((city) => {
          const isSelected = selectedCityId === city.id;
          return (
            <button
              key={city.id}
              onClick={() => onSelectCity(city.id)}
              className={`p-2.5 text-left border transition cursor-pointer font-mono relative overflow-hidden ${
                isSelected
                  ? 'bg-zinc-100 text-black border-zinc-100 shadow-[3px_3px_0px_0px_#22c55e]'
                  : 'bg-zinc-900/80 text-zinc-300 border-zinc-800 hover:border-zinc-600 hover:bg-zinc-850'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-black uppercase truncate">
                  {city.name}
                </span>
                <span className="text-[10px] opacity-75">{city.country.substring(0, 2).toUpperCase()}</span>
              </div>

              <div className={`text-[10px] mt-1 truncate ${isSelected ? 'text-zinc-700' : 'text-zinc-500'}`}>
                Med: ${city.medianRentUsd}/mo
              </div>

              <div className="flex items-center justify-between mt-1 text-[11px]">
                <span className={`font-bold ${isSelected ? 'text-black' : 'text-emerald-400'}`}>
                  {city.activeDealsCount} Deals
                </span>
                {city.gentrificationRating === 'Severe' && (
                  <span className={`text-[9px] px-1 uppercase font-bold border ${isSelected ? 'border-red-900 text-red-900' : 'border-red-900 text-red-400 bg-red-950/60'}`}>
                    Hot
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};
