import React, { useState, useRef, useEffect } from 'react';
import { ChatMessage } from '../types';
import { askNemotronCopilot } from '../services/nebius';
import { MessageSquare, Send, Cpu, Bot, User, Sparkles, X, Minimize2, Maximize2 } from 'lucide-react';

interface NemotronCopilotProps {
  currentCity: string;
}

const SAMPLE_QUESTIONS = [
  'How do I spot rental scams on Reddit and Craigslist?',
  'What are my legal subletting rights in Berlin?',
  'Draft a 10% discount negotiation message for a sublet.',
  'Can an NYC landlord charge more than 1 month security deposit?',
];

export const NemotronCopilot: React.FC<NemotronCopilotProps> = ({ currentCity }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'init-1',
      sender: 'nemotron',
      text: `Welcome to **Nemotron Rent Copilot**. I am an AI tenant advocate powered by **NVIDIA Nemotron on Nebius Token Factory**.\n\nAsk me anything about urban tenant protections, lease clauses, spot scams, or ask me to draft a negotiation counter-offer for ${currentCity}!`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      modelUsed: 'nvidia/llama-3.1-nemotron-70b-instruct',
    },
  ]);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isOpen]);

  const handleSend = async (textToSend?: string) => {
    const query = (textToSend || input).trim();
    if (!query || isLoading) return;

    const userMsg: ChatMessage = {
      id: `usr-${Date.now()}`,
      sender: 'user',
      text: query,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);

    try {
      const history = [...messages, userMsg].map((m) => ({
        role: (m.sender === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
        content: m.text,
      }));

      const response = await askNemotronCopilot(history, currentCity);

      const aiMsg: ChatMessage = {
        id: `ai-${Date.now()}`,
        sender: 'nemotron',
        text: response.text,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        modelUsed: response.model,
      };

      setMessages((prev) => [...prev, aiMsg]);
    } catch (err) {
      console.error('Copilot error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed bottom-4 right-4 z-40 font-mono">
      {!isOpen ? (
        <button
          onClick={() => setIsOpen(true)}
          className="flex items-center gap-2 px-4 py-3 bg-zinc-950 border-2 border-emerald-500 hover:bg-zinc-900 text-emerald-400 font-bold text-xs uppercase shadow-[4px_4px_0px_0px_#052e16] transition cursor-pointer"
        >
          <div className="w-2.5 h-2.5 bg-emerald-500 animate-ping rounded-full"></div>
          <Cpu className="w-4 h-4 text-emerald-400" />
          {/* Below sm only the dot and icon show, so the button cannot cover the map's OpenStreetMap credit. The name stays for assistive technology. */}
          <span className="sr-only sm:not-sr-only">NEMOTRON TENANT COPILOT</span>
        </button>
      ) : (
        <div className="w-80 sm:w-96 bg-zinc-950 border-2 border-emerald-500 shadow-[6px_6px_0px_0px_#000] flex flex-col h-[520px]">
          {/* Header */}
          <div className="flex items-center justify-between p-3 bg-zinc-900 border-b border-zinc-800">
            <div className="flex items-center gap-2">
              <div className="p-1 bg-emerald-500 text-black">
                <Cpu className="w-3.5 h-3.5" />
              </div>
              <div>
                <div className="text-xs font-bold text-white uppercase tracking-wider">
                  NEMOTRON RENT COPILOT
                </div>
                <div className="text-[10px] text-zinc-400">
                  Via Nebius Token Factory
                </div>
              </div>
            </div>

            <button
              onClick={() => setIsOpen(false)}
              className="p-1 text-zinc-400 hover:text-white transition cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Quick sample prompts */}
          <div className="p-2 bg-zinc-900/60 border-b border-zinc-900 flex gap-1.5 overflow-x-auto text-[10px]">
            {SAMPLE_QUESTIONS.map((q, idx) => (
              <button
                key={idx}
                onClick={() => handleSend(q)}
                className="px-2 py-1 bg-zinc-850 hover:bg-zinc-800 border border-zinc-750 text-zinc-300 whitespace-nowrap transition cursor-pointer"
              >
                {q}
              </button>
            ))}
          </div>

          {/* Messages list */}
          <div className="flex-1 p-3 overflow-y-auto space-y-3 text-xs bg-zinc-950">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex flex-col ${
                  msg.sender === 'user' ? 'items-end' : 'items-start'
                }`}
              >
                <div className="flex items-center gap-1 text-[10px] text-zinc-500 mb-1">
                  {msg.sender === 'user' ? (
                    <>
                      <span>You</span>
                      <User className="w-3 h-3" />
                    </>
                  ) : (
                    <>
                      <Bot className="w-3 h-3 text-emerald-400" />
                      <span className="text-emerald-400 font-bold">Nemotron AI</span>
                    </>
                  )}
                  <span>• {msg.timestamp}</span>
                </div>

                <div
                  className={`p-3 max-w-[90%] leading-relaxed whitespace-pre-line ${
                    msg.sender === 'user'
                      ? 'bg-zinc-900 border border-zinc-750 text-zinc-100'
                      : 'bg-zinc-900/90 border border-emerald-900/60 text-zinc-200'
                  }`}
                >
                  {msg.text}
                </div>

                {msg.modelUsed && (
                  <span className="text-[9px] text-zinc-600 mt-1">
                    ⚡ {msg.modelUsed}
                  </span>
                )}
              </div>
            ))}
            {isLoading && (
              <div className="flex items-center gap-2 text-xs text-emerald-400 p-2 font-mono animate-pulse">
                <Cpu className="w-3.5 h-3.5" />
                <span>Nemotron is formulating tactical legal response...</span>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input Area */}
          <div className="p-2.5 bg-zinc-900 border-t border-zinc-800 flex gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSend()}
              placeholder="Ask about local rent laws, scams, or negotiation..."
              className="flex-1 bg-zinc-950 border border-zinc-800 text-xs text-white px-3 py-2 focus:outline-none focus:border-emerald-500"
            />
            <button
              onClick={() => handleSend()}
              disabled={isLoading || !input.trim()}
              className="px-3 py-2 bg-emerald-500 hover:bg-emerald-400 text-black font-bold transition cursor-pointer disabled:opacity-40"
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
