import React from 'react';
import type { Listing, ScoutListing } from '../types';
import { formatCurrency, formatUsd } from '../utils/formatters';
import { formatSourceHost } from '../services/tavilySearch';
import { FairRentMetrics } from './FairRentMetrics';
import {
  ShieldCheck,
  ShieldAlert,
  Sparkles,
  ExternalLink,
  Calendar,
  MapPin,
  Bed,
  Bath,
  Maximize,
  FlaskConical,
  SearchCheck,
} from 'lucide-react';

interface ListingCardProps {
  listing: Listing;
  onSelect: (listing: Listing) => void;
  /** Gross hourly pay text the user entered for this listing's city. Without it the city default applies. */
  payOverride?: string;
}

export const ListingCard: React.FC<ListingCardProps> = ({ listing, onSelect, payOverride }) => {
  const isExceptional = listing.dealScore >= 90;

  return (
    <div className="border border-zinc-800 bg-zinc-950/80 hover:border-zinc-600 transition flex flex-col justify-between shadow-[4px_4px_0px_0px_#141416] group">
      <div>
        {/* Top Image + Badges Container */}
        <div className="relative h-48 overflow-hidden border-b border-zinc-800 bg-zinc-900">
          <img
            src={listing.imageUrl}
            alt={listing.title}
            className="w-full h-full object-cover grayscale-[20%] group-hover:scale-102 transition duration-300 group-hover:grayscale-0"
            loading="lazy"
          />

          {/* Deal Score Ribbon */}
          <div className="absolute top-2.5 left-2.5 flex items-center gap-1.5">
            <span
              className={`px-2 py-0.5 font-mono text-xs font-black uppercase tracking-wider border shadow-[2px_2px_0px_0px_#000] ${
                isExceptional
                  ? 'bg-emerald-400 text-black border-emerald-300'
                  : 'bg-amber-400 text-black border-amber-300'
              }`}
            >
              ⚡ {listing.dealScore}/100 SCORE
            </span>
            <span className="px-1.5 py-0.5 bg-black/80 backdrop-blur text-emerald-400 border border-emerald-900/60 font-mono text-[11px] font-bold">
              -{listing.savingsPercentage}% MKT
            </span>
          </div>

          {/* Source Tag */}
          <div className="absolute top-2.5 right-2.5">
            <span className="px-2 py-0.5 bg-zinc-950/90 text-zinc-300 border border-zinc-700 font-mono text-[10px] uppercase">
              {listing.source}
            </span>
          </div>

          {/* Bottom Duration Overlay */}
          <div className="absolute bottom-2 left-2.5 right-2.5 flex items-center justify-between text-[11px] font-mono text-zinc-300 bg-black/80 px-2 py-1 border border-zinc-800">
            <span className="flex items-center gap-1">
              <Calendar className="w-3 h-3 text-zinc-400" />
              {listing.duration}
            </span>
            <span className="text-zinc-400">Available: {listing.availableDate}</span>
          </div>
        </div>

        {/* Content Body */}
        <div className="p-4">
          {/* Complete Listing rows are the bundled demonstration fixtures (src/data/mockListings.ts). */}
          <div className="mb-2 font-mono text-[10px] uppercase">
            <span className="px-1.5 py-0.5 bg-amber-950/60 text-amber-300 border border-amber-800 font-bold">
              Demo fixture · sample data
            </span>
          </div>

          {/* Location & Typology */}
          <div className="flex items-center justify-between text-xs font-mono text-zinc-400 mb-1">
            <span className="flex items-center gap-1 text-zinc-300 truncate font-semibold">
              <MapPin className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              {listing.neighborhood}, {listing.cityName}
            </span>
            <span className="uppercase text-[10px] bg-zinc-900 px-1.5 py-0.5 border border-zinc-800">
              {listing.type.replace('_', ' ')}
            </span>
          </div>

          {/* Title */}
          <h3
            onClick={() => onSelect(listing)}
            className="text-sm font-bold font-mono text-zinc-100 hover:text-emerald-400 transition cursor-pointer line-clamp-2 mt-1 leading-snug"
          >
            {listing.title}
          </h3>

          {/* Pricing & Anti-Gentrification Breakdown */}
          <div className="mt-3 pt-3 border-t border-zinc-900 flex items-baseline justify-between font-mono">
            <div>
              <div className="flex items-baseline gap-1.5">
                <span className="text-xl font-black text-white">
                  {formatCurrency(listing.priceLocal, listing.currency, listing.currencySymbol)}
                </span>
                <span className="text-xs text-zinc-400">/mo</span>
              </div>
              {listing.currency !== 'USD' && (
                <div className="text-[11px] text-zinc-500">
                  ≈ {formatUsd(listing.priceUsd)} USD
                </div>
              )}
            </div>

            <div className="text-right">
              <div className="text-[10px] text-zinc-500 uppercase">Demo reference rent</div>
              <div className="text-xs text-zinc-400 line-through">
                {formatUsd(listing.originalMarketPriceUsd)}/mo
              </div>
            </div>
          </div>

          {/* Illustrative AGI and gross-pay hours. The pay itself is edited in the dossier. */}
          <FairRentMetrics
            variant="card"
            listing={listing}
            payOverride={payOverride}
            onEditPay={() => onSelect(listing)}
          />

          {/* Spec details: Bed / Bath / SqM */}
          <div className="grid grid-cols-3 gap-1 py-2 my-2.5 bg-zinc-900/60 border border-zinc-900 text-center font-mono text-[11px] text-zinc-400">
            <div className="flex items-center justify-center gap-1">
              <Bed className="w-3 h-3 text-zinc-500" />
              <span>{listing.bedrooms} Bed</span>
            </div>
            <div className="flex items-center justify-center gap-1 border-x border-zinc-800">
              <Bath className="w-3 h-3 text-zinc-500" />
              <span>{listing.bathrooms} Bath</span>
            </div>
            <div className="flex items-center justify-center gap-1">
              <Maximize className="w-3 h-3 text-zinc-500" />
              <span>{listing.squareMeters} m²</span>
            </div>
          </div>

          {/* Nemotron Intelligence Pill */}
          <div className="p-2 bg-zinc-900/90 border border-zinc-800 text-[11px] font-mono mb-3">
            <div className="flex items-center justify-between text-zinc-300 font-semibold mb-1">
              <span className="flex items-center gap-1 text-emerald-400">
                <Sparkles className="w-3 h-3 text-emerald-400" />
                NEMOTRON AUDIT
              </span>
              <span className="text-[10px] text-zinc-500">
                SCAM RISK: {listing.nemotronAudit.scamRiskScore}/10
              </span>
            </div>
            <p className="text-[11px] text-zinc-400 line-clamp-1">
              {listing.nemotronAudit.marketPriceComparison}
            </p>
          </div>
        </div>
      </div>

      {/* Action Footer */}
      <div className="p-4 pt-0 grid grid-cols-2 gap-2 font-mono text-xs">
        <button
          onClick={() => onSelect(listing)}
          className="w-full py-2 bg-emerald-500 hover:bg-emerald-400 text-black font-bold uppercase transition flex items-center justify-center gap-1 shadow-[2px_2px_0px_0px_#052e16] cursor-pointer"
        >
          <span>AUDIT & NEGOTIATE</span>
        </button>

        <a
          href={listing.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="w-full py-2 bg-zinc-900 hover:bg-zinc-850 text-zinc-300 border border-zinc-700 hover:border-zinc-500 transition flex items-center justify-center gap-1 text-center cursor-pointer"
        >
          <span>VIEW SOURCE</span>
          <ExternalLink className="w-3 h-3 text-zinc-500" />
        </a>
      </div>
    </div>
  );
};

interface ScoutCandidateCardProps {
  candidate: ScoutListing;
  onSelect: (candidate: ScoutListing) => void;
}

/**
 * Card for an unverified Scout candidate. It shows only the source title, snippet, link, and
 * selected city: no price, image, property facts, deal score, or audit.
 */
export const ScoutCandidateCard: React.FC<ScoutCandidateCardProps> = ({ candidate, onSelect }) => {
  const isDemo = candidate.mode === 'demo';
  const host = formatSourceHost(candidate.sourceUrl);
  const kindLabel = isDemo ? 'demo sample' : 'search hit';

  return (
    <article
      aria-label={`${isDemo ? 'Demo sample' : 'Unverified search hit'}: ${candidate.title}`}
      className="border border-dashed border-cyan-900 bg-zinc-950/80 hover:border-cyan-700 transition flex flex-col justify-between"
    >
      <div className="p-4">
        <div className="flex flex-wrap items-center gap-1.5 mb-2 font-mono text-[10px] uppercase">
          {isDemo ? (
            <span className="px-1.5 py-0.5 bg-amber-950 text-amber-300 border border-amber-700 font-bold flex items-center gap-1">
              <FlaskConical className="w-3 h-3" aria-hidden="true" />
              Demo sample
            </span>
          ) : (
            <span className="px-1.5 py-0.5 bg-zinc-800 text-zinc-200 border border-zinc-600 font-bold flex items-center gap-1">
              <SearchCheck className="w-3 h-3" aria-hidden="true" />
              Unverified search hit
            </span>
          )}
          <span className="px-1.5 py-0.5 bg-zinc-900 text-zinc-400 border border-zinc-800">{candidate.source}</span>
        </div>

        <div className="flex items-center gap-1 text-xs font-mono text-zinc-400 min-w-0">
          <MapPin className="w-3.5 h-3.5 text-cyan-400 shrink-0" aria-hidden="true" />
          <span className="truncate">
            {candidate.cityName} · {host}
          </span>
        </div>

        <h3 className="text-sm font-bold font-mono text-zinc-100 line-clamp-3 mt-1 leading-snug break-words">
          {candidate.title}
        </h3>

        <p className="text-xs text-zinc-400 font-sans line-clamp-4 mt-2 break-words">
          {candidate.description || 'The source returned no snippet.'}
        </p>

        <p className="mt-3 text-[10px] font-mono text-zinc-500">
          {isDemo
            ? 'Local demo sample. No live search ran.'
            : 'Price, availability, and property details unknown. Not deal-scored or audited.'}
        </p>
      </div>

      <div className="p-4 pt-0 grid grid-cols-2 gap-2 font-mono text-xs">
        <button
          type="button"
          onClick={() => onSelect(candidate)}
          aria-label={`View details for ${kindLabel} "${candidate.title}"`}
          className="w-full py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-100 border border-zinc-600 font-bold uppercase transition cursor-pointer"
        >
          VIEW DETAILS
        </button>
        <a
          href={candidate.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={
            isDemo
              ? `Open demo source site ${host} (opens in a new tab)`
              : `Open original source for "${candidate.title}" on ${host} (opens in a new tab)`
          }
          className="w-full py-2 bg-zinc-900 hover:bg-zinc-850 text-zinc-300 border border-zinc-700 hover:border-zinc-500 transition flex items-center justify-center gap-1 text-center cursor-pointer"
        >
          <span>{isDemo ? 'SOURCE SITE' : 'OPEN SOURCE'}</span>
          <ExternalLink className="w-3 h-3 text-zinc-500" aria-hidden="true" />
        </a>
      </div>
    </article>
  );
};
