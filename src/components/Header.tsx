import React from 'react';
import { Terminal, Shield, Cpu, Globe, Users, ExternalLink, Zap } from 'lucide-react';

interface HeaderProps {
  onOpenTeamTasks: () => void;
  onOpenLiveScout: () => void;
}

export const Header: React.FC<HeaderProps> = ({ onOpenTeamTasks, onOpenLiveScout }) => {
  return (
    <header className="border-b border-zinc-800 bg-zinc-950/90 backdrop-blur sticky top-0 z-40">
      {/* Top micro-ticker bar */}
      <div className="border-b border-zinc-850 px-4 py-1.5 bg-black/60 text-[11px] font-mono flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-4 text-zinc-400">
          <span className="flex items-center gap-1.5 text-emerald-400">
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            RADAR: ONLINE
          </span>
          <span className="hidden sm:inline text-zinc-600">|</span>
          <span className="hidden sm:flex items-center gap-1 text-zinc-300">
            <Cpu className="w-3.5 h-3.5 text-amber-400" />
            NEBIUS TOKEN FACTORY: ACTIVE
          </span>
          <span className="hidden md:inline text-zinc-600">|</span>
          <span className="hidden md:flex items-center gap-1 text-zinc-300">
            <Shield className="w-3.5 h-3.5 text-emerald-400" />
            NVIDIA NEMOTRON-3-ULTRA: READY
          </span>
          <span className="hidden lg:inline text-zinc-600">|</span>
          <span className="hidden lg:flex items-center gap-1 text-cyan-400">
            <Zap className="w-3.5 h-3.5 text-cyan-400" />
            TAVILY LIVE WEB SCOUT: ARMED
          </span>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={onOpenTeamTasks}
            className="flex items-center gap-1.5 px-2 py-0.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 text-xs font-mono transition cursor-pointer"
          >
            <Users className="w-3 h-3 text-emerald-400" />
            <span>TEAM ROADMAP (6+ COLLABORATORS)</span>
          </button>
        </div>
      </div>

      {/* Main branding header */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-emerald-500 text-black flex items-center justify-center font-black font-mono text-lg border border-emerald-400 shadow-[2px_2px_0px_0px_#052e16]">
              RS
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl sm:text-2xl font-black font-mono tracking-tight text-white m-0">
                  RENTSCANNER<span className="text-emerald-500">.AI</span>
                </h1>
                <span className="px-1.5 py-0.5 text-[10px] font-mono uppercase bg-zinc-850 text-zinc-300 border border-zinc-700">
                  NEBIUS x NVIDIA HACKATHON
                </span>
              </div>
              <p className="text-xs text-zinc-400 font-mono mt-0.5">
                The Open-Source Skyscanner for Cheap Urban Subleases & Anti-Gentrification Housing Intelligence
              </p>
            </div>
          </div>
        </div>

        {/* Action controls */}
        <div className="flex items-center gap-2.5 w-full md:w-auto">
          <button
            onClick={onOpenLiveScout}
            className="flex-1 md:flex-none flex items-center justify-center gap-2 px-3 py-2 bg-zinc-900 hover:bg-zinc-800 text-cyan-400 border border-cyan-800/80 hover:border-cyan-500 text-xs font-mono font-bold transition shadow-[2px_2px_0px_0px_#0e7490] cursor-pointer"
          >
            <Globe className="w-4 h-4" />
            <span>RUN TAVILY WEB SCOUT</span>
          </button>

          <a
            href="https://github.com/Alortiztique/rent-scanner-ai"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-3 py-2 bg-zinc-900 hover:bg-zinc-850 text-zinc-300 border border-zinc-700 text-xs font-mono transition cursor-pointer"
          >
            <Terminal className="w-4 h-4 text-emerald-400" />
            <span className="hidden sm:inline">GITHUB REPO</span>
            <ExternalLink className="w-3 h-3 text-zinc-500" />
          </a>
        </div>
      </div>
    </header>
  );
};
