import React, { useState } from 'react';
import { Users, CheckCircle, Code, GitPullRequest, ArrowRight, X, Cpu, Globe, Map, Sparkles, Terminal } from 'lucide-react';

interface TeamCollaborationBannerProps {
  isOpen: boolean;
  onClose: () => void;
}

interface TeamTask {
  id: string;
  title: string;
  category: 'AI / Nemotron' | 'Frontend / UX' | 'Tavily / Scraping' | 'Cloudflare / DevOps';
  priority: 'High' | 'Medium' | 'Critical';
  targetFiles: string[];
  description: string;
}

const TASKS: TeamTask[] = [
  {
    id: 'TASK-01',
    title: 'Nemotron Few-Shot Fine-Tuned Lease Prompting',
    category: 'AI / Nemotron',
    priority: 'Critical',
    targetFiles: ['src/services/nebius.ts', 'src/prompts/leaseAuditPrompt.ts'],
    description: 'Enhance the prompt engineering for NVIDIA Nemotron-3-Ultra to detect regional-specific illegal clauses (e.g. NYC Good Cause Eviction laws, Berlin Mietpreisbremse exceptions, London AST unfair terms).',
  },
  {
    id: 'TASK-02',
    title: 'Tavily Real-Time Query Expansion for 10+ Cities',
    category: 'Tavily / Scraping',
    priority: 'Critical',
    targetFiles: ['src/services/tavily.ts', 'src/data/cities.ts'],
    description: 'Expand Tavily Search API parameters to target localized forum domains: r/NYCapartments, r/londonhousing, r/bogota, gumtree.co.uk, wg-gesucht.de, and Craigslist API feeds.',
  },
  {
    id: 'TASK-03',
    title: 'Interactive City Heatmap & Geolocation Pins',
    category: 'Frontend / UX',
    priority: 'High',
    targetFiles: ['src/components/Map/RentMap.tsx', 'src/components/ListingCard.tsx'],
    description: 'Implement a brutalist Mapbox GL or Leaflet canvas showing price differential clusters and savings heatmaps across target metropolitan neighborhoods.',
  },
  {
    id: 'TASK-04',
    title: 'Nebius Serverless Job Pipeline (Python Background Worker)',
    category: 'Cloudflare / DevOps',
    priority: 'High',
    targetFiles: ['backend/nebius_serverless_job.py', 'backend/requirements.txt'],
    description: 'Finalize the Nebius Serverless Job script that periodically queries rental RSS feeds, invokes Nemotron-4-340B batch inference, and writes fresh deals to Cloudflare D1 or JSON cache.',
  },
  {
    id: 'TASK-05',
    title: 'Multi-Currency Live FX & Purchasing Power Parity (PPP)',
    category: 'Frontend / UX',
    priority: 'Medium',
    targetFiles: ['src/utils/formatters.ts', 'src/data/cities.ts'],
    description: 'Add live currency exchange rate converter and Local Wage Hours index (how many minimum-wage hours are needed to pay rent in each city).',
  },
  {
    id: 'TASK-06',
    title: 'Instant Telegram / WhatsApp Sublet Deal Alert Bot',
    category: 'Tavily / Scraping',
    priority: 'Medium',
    targetFiles: ['src/services/notifications.ts', 'backend/bot.py'],
    description: 'Allow users to input their budget and get instantaneous alerts when a 90+ Deal Score listing is indexed by Tavily and verified by Nemotron.',
  },
  {
    id: 'TASK-07',
    title: 'Hackathon 3-Minute Demo Video & Pitch Deck Script',
    category: 'Cloudflare / DevOps',
    priority: 'Critical',
    targetFiles: ['docs/DEMO_SCRIPT.md', 'README.md'],
    description: 'Write the 3-minute video recording walkthrough showing live Nebius Token Factory inference, Tavily live web scout, and the anti-gentrification thesis.',
  },
];

export const TeamCollaborationBanner: React.FC<TeamCollaborationBannerProps> = ({
  isOpen,
  onClose,
}) => {
  const [selectedCategory, setSelectedCategory] = useState<string>('All');

  if (!isOpen) return null;

  const filteredTasks = selectedCategory === 'All'
    ? TASKS
    : TASKS.filter((t) => t.category === selectedCategory);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/90 backdrop-blur-md overflow-y-auto font-mono">
      <div className="relative w-full max-w-4xl bg-zinc-950 border-2 border-emerald-500 shadow-[8px_8px_0px_0px_#052e16] my-8 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 bg-zinc-900 border-b border-zinc-800">
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-emerald-400" />
            <div>
              <h2 className="text-sm font-bold text-white uppercase tracking-wider">
                COLLABORATIVE WORKSPACE // 6+ TEAMMATES MISSION BOARD
              </h2>
              <p className="text-[11px] text-zinc-400">
                Choose a task, open the referenced files, commit & push to main for live Cloudflare deployment!
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-zinc-400 hover:text-white transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Instructions Bar */}
        <div className="p-4 bg-zinc-900/40 border-b border-zinc-850 text-xs text-zinc-300">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div>
              <strong className="text-emerald-400 uppercase">Adding Collaborators: </strong>
              The repository owner (<code className="text-white">Alortiztique</code>) can invite teammates via GitHub:
              <br />
              <span className="text-zinc-400 text-[11px]">
                Repo Settings &gt; Collaborators &gt; Add people (Full Push/Pull access).
              </span>
            </div>
            <div className="p-2 bg-black border border-zinc-800 text-[11px] shrink-0">
              <span className="text-zinc-500">Live Preview: </span>
              <strong className="text-cyan-400">Cloudflare Pages Auto-Deploy</strong>
            </div>
          </div>
        </div>

        {/* Task Category Tabs */}
        <div className="px-4 py-2 bg-zinc-950 border-b border-zinc-900 flex gap-2 overflow-x-auto text-xs">
          {['All', 'AI / Nemotron', 'Tavily / Scraping', 'Frontend / UX', 'Cloudflare / DevOps'].map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`px-3 py-1 border transition cursor-pointer uppercase ${
                selectedCategory === cat
                  ? 'bg-zinc-200 text-black border-zinc-200 font-bold'
                  : 'bg-zinc-900 text-zinc-400 border-zinc-850 hover:border-zinc-700'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Task Grid */}
        <div className="p-4 sm:p-6 max-h-[60vh] overflow-y-auto space-y-3">
          {filteredTasks.map((task) => (
            <div
              key={task.id}
              className="p-4 bg-zinc-900/60 border border-zinc-800 hover:border-zinc-650 transition space-y-2"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5">
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 bg-black border border-zinc-700 text-zinc-300 text-[10px] font-bold">
                    {task.id}
                  </span>
                  <span className="text-xs font-bold text-white uppercase">
                    {task.title}
                  </span>
                </div>

                <div className="flex items-center gap-2 text-[10px]">
                  <span className="px-1.5 py-0.5 bg-zinc-800 text-zinc-300 border border-zinc-700 uppercase">
                    {task.category}
                  </span>
                  <span
                    className={`px-1.5 py-0.5 uppercase font-bold border ${
                      task.priority === 'Critical'
                        ? 'bg-red-950 text-red-300 border-red-800'
                        : 'bg-amber-950 text-amber-300 border-amber-800'
                    }`}
                  >
                    {task.priority} Priority
                  </span>
                </div>
              </div>

              <p className="text-xs text-zinc-300 font-sans leading-relaxed">
                {task.description}
              </p>

              {/* Referenced Target Files */}
              <div className="pt-2 border-t border-zinc-850 flex flex-wrap items-center gap-2 text-[11px]">
                <span className="text-zinc-500 uppercase text-[10px]">Files to edit:</span>
                {task.targetFiles.map((file) => (
                  <code
                    key={file}
                    className="px-1.5 py-0.5 bg-black border border-zinc-800 text-emerald-400 text-[10px]"
                  >
                    {file}
                  </code>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Modal Footer */}
        <div className="p-4 bg-zinc-900 border-t border-zinc-800 flex items-center justify-between">
          <span className="text-[11px] text-zinc-500">
            Internal Team Guide — see <code className="text-zinc-400">COLLABORATION_TASKS.md</code> for full details
          </span>
          <button
            onClick={onClose}
            className="px-5 py-2 bg-emerald-500 hover:bg-emerald-400 text-black text-xs font-bold uppercase transition cursor-pointer"
          >
            GOT IT, LET'S BUILD!
          </button>
        </div>
      </div>
    </div>
  );
};
