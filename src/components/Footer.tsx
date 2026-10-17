import React from 'react';
import { Shield, Cpu, Globe, Heart, ExternalLink, Terminal } from 'lucide-react';

export const Footer: React.FC = () => {
  return (
    <footer className="mt-16 border-t border-zinc-850 bg-black/90 font-mono text-xs text-zinc-400">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-10">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-8 pb-8 border-b border-zinc-900">
          {/* Col 1 */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 bg-emerald-500"></span>
              <span className="font-bold text-white text-sm">RENTSCANNER.AI</span>
            </div>
            <p className="text-[11px] text-zinc-500 leading-relaxed font-sans">
              The open-source Skyscanner for ultra-affordable subleases, student rentals, and off-market housing across the world’s major cities.
            </p>
            <div className="text-[10px] text-zinc-600">
              MIT License • Built by Alortiztique & Team
            </div>
          </div>

          {/* Col 2: AI & Infrastructure */}
          <div className="space-y-2">
            <div className="text-white font-bold text-xs uppercase flex items-center gap-1.5">
              <Cpu className="w-3.5 h-3.5 text-amber-400" />
              AI ARCHITECTURE
            </div>
            <ul className="space-y-1.5 text-[11px] text-zinc-400">
              <li>• Nebius Token Factory API</li>
              <li>• NVIDIA Nemotron-3-Ultra</li>
              <li>• NVIDIA Llama-3.1-Nemotron-70B</li>
              <li>• NVIDIA Nemotron-Mini-4B</li>
              <li>• Nebius Serverless Jobs compute</li>
            </ul>
          </div>

          {/* Col 3: Web Intelligence */}
          <div className="space-y-2">
            <div className="text-white font-bold text-xs uppercase flex items-center gap-1.5">
              <Globe className="w-3.5 h-3.5 text-cyan-400" />
              WEB INTELLIGENCE
            </div>
            <ul className="space-y-1.5 text-[11px] text-zinc-400">
              <li>• Tavily Search API ($3,000 Bonus Track)</li>
              <li>• Real-time Reddit & Craigslist crawler</li>
              <li>• Campus housing notice boards</li>
              <li>• Fair Value Index (FVI) algorithm</li>
            </ul>
          </div>

          {/* Col 4: Hackathon Details */}
          <div className="space-y-2">
            <div className="text-white font-bold text-xs uppercase flex items-center gap-1.5">
              <Shield className="w-3.5 h-3.5 text-emerald-400" />
              HACKATHON TRACK
            </div>
            <p className="text-[11px] text-zinc-400">
              Submitted to <strong>Best Apps and Agents Track</strong> at the Nebius x NVIDIA Global AI Hackathon (Devpost).
            </p>
            <div className="pt-2">
              <a
                href="https://nebiusglobalaihackathon.devpost.com"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[11px] text-emerald-400 hover:underline"
              >
                <span>Hackathon Rules & Judging</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 text-[11px] text-zinc-500">
          <div>
            Built with fierce conviction for renters everywhere against predatory speculation and gentrification.
          </div>
          <div className="flex items-center gap-4">
            <span className="text-emerald-500">Cloudflare Pages Ready</span>
            <span>•</span>
            <span className="text-zinc-400">Open Source MIT</span>
          </div>
        </div>
      </div>
    </footer>
  );
};
