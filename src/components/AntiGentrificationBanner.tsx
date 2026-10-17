import React from 'react';
import { Flame, ShieldAlert, ArrowDownRight, DollarSign } from 'lucide-react';

export const AntiGentrificationBanner: React.FC = () => {
  return (
    <div className="border border-zinc-800 bg-zinc-900/60 p-4 sm:p-5 relative overflow-hidden mb-6 shadow-[4px_4px_0px_0px_#18181b]">
      {/* Subtle background radar ring decoration */}
      <div className="absolute -right-16 -top-16 w-64 h-64 border border-zinc-800/40 rounded-full pointer-events-none"></div>
      <div className="absolute -right-8 -top-8 w-48 h-48 border border-zinc-800/30 rounded-full pointer-events-none"></div>

      <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6 relative z-10">
        <div className="max-w-2xl">
          <div className="flex items-center gap-2 mb-2">
            <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-red-950/80 text-red-400 border border-red-800 text-[11px] font-mono uppercase font-bold tracking-wider">
              <Flame className="w-3.5 h-3.5 text-red-500" />
              CIVIC MISSION: FIGHT RUNAWAY RENT GOUGING
            </span>
            <span className="text-zinc-500 font-mono text-xs hidden sm:inline">// ANTI-GENTRIFICATION PROTOCOL</span>
          </div>

          <h2 className="text-lg sm:text-xl font-bold font-mono tracking-tight text-white mb-1.5">
            RECLAIMING CITIES FOR THE PEOPLE WHO ACTUALLY MAKE THEM CULTURE
          </h2>
          <p className="text-xs sm:text-sm text-zinc-400 leading-relaxed">
            In NYC, London, Bogotá, Tokyo, and Paris, speculative algorithmic pricing and corporate landlord syndicates have locked youth, artists, and working people out.
            <strong className="text-zinc-200"> RentScanner AI uses NVIDIA Nemotron on Nebius Token Factory</strong> to crawl stealth sublets, audit predatory clauses, identify illegal fees, and arm renters with algorithmic leverage.
          </p>
        </div>

        {/* Live Impact Counters */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 w-full lg:w-auto font-mono">
          <div className="border border-zinc-800 bg-black/60 p-3">
            <div className="flex items-center gap-1 text-[10px] text-zinc-500 uppercase">
              <ArrowDownRight className="w-3 h-3 text-emerald-400" />
              AVG. SAVINGS
            </div>
            <div className="text-xl sm:text-2xl font-black text-emerald-400 mt-0.5">
              47.4%
            </div>
            <div className="text-[10px] text-zinc-500 mt-0.5">vs. median metro ask</div>
          </div>

          <div className="border border-zinc-800 bg-black/60 p-3">
            <div className="flex items-center gap-1 text-[10px] text-zinc-500 uppercase">
              <DollarSign className="w-3 h-3 text-amber-400" />
              BROKER FEES SAVED
            </div>
            <div className="text-xl sm:text-2xl font-black text-amber-400 mt-0.5">
              $2,340
            </div>
            <div className="text-[10px] text-zinc-500 mt-0.5">per tenant match</div>
          </div>

          <div className="border border-zinc-800 bg-black/60 p-3 col-span-2 sm:col-span-1">
            <div className="flex items-center gap-1 text-[10px] text-zinc-500 uppercase">
              <ShieldAlert className="w-3 h-3 text-cyan-400" />
              NEMOTRON AUDITS
            </div>
            <div className="text-xl sm:text-2xl font-black text-cyan-400 mt-0.5">
              1,840+
            </div>
            <div className="text-[10px] text-zinc-500 mt-0.5">leases scrutinized</div>
          </div>
        </div>
      </div>
    </div>
  );
};
