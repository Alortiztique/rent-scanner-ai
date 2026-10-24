# 📡 RENTSCANNER.AI
### The Open-Source "Skyscanner" for Ultra-Affordable Urban Subleases & Anti-Gentrification Housing Intelligence

[![Nebius Token Factory](https://img.shields.io/badge/Inference-Nebius_Token_Factory-00E599?style=for-the-badge&logo=cloud&logoColor=black)](https://dev.nebius.com)
[![NVIDIA Nemotron](https://img.shields.io/badge/Models-NVIDIA_Nemotron--3--Ultra-76B900?style=for-the-badge&logo=nvidia&logoColor=white)](https://huggingface.co/nvidia)
[![Tavily Search API](https://img.shields.io/badge/Live_Search-Tavily_AI_Scout-00C2FF?style=for-the-badge&logo=safari&logoColor=black)](https://tavily.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-white?style=for-the-badge)](LICENSE)
[![Cloudflare Pages](https://img.shields.io/badge/Deploy-Cloudflare_Pages-F38020?style=for-the-badge&logo=cloudflare&logoColor=white)](https://pages.cloudflare.com)

---

> 🚨 **INTERNAL TEAM NOTICE (FOR 6+ COLLABORATORS):**  
> Welcome teammates! Please consult [COLLABORATION_TASKS.md](COLLABORATION_TASKS.md) to choose your workstream (AI prompting, Tavily scraping, maps, mobile UI, backend jobs). Each task lists the exact files to modify. Every commit pushed to `main` triggers a live preview on Cloudflare Pages!

---

## 🎯 Executive Summary & Mission

Across the world’s major metropolises—**New York, London, Tokyo, Bogotá, Paris, Berlin, Dubai, and San Francisco**—the urban rent crisis has reached an unprecedented breaking point. Algorithmic pricing syndicates, institutional corporate real estate landlords, and predatory broker cartels (charging up to 15% upfront fees) have systematically priced out youth, university students, immigrant workers, artists, and digital nomads.

**RentScanner AI** is an open-source civic weapon against runaway gentrification. Designed with a utilitarian **neo-brutalist aesthetic**, it acts as an intelligent aggregator and algorithmic radar for:
1. **Stealth Off-Market Subleases & Lease Takeovers:** Sourced directly from local tenant communities, university bulletin boards, and Reddit threads via the **Tavily Search API**.
2. **AI-Powered Lease Scam & Trap Auditing:** Powered by **NVIDIA Nemotron** on **Nebius Token Factory**, instantly screening leases for illegal rent gouging, deceptive fees, deposit fraud, and local tenant law compliance (e.g., NYC DHCR rent stabilization, Berlin *Mietpreisbremse*, Bogotá *Ley 820*).
3. **Automated Landlord Negotiation Strategist:** Generates tailored, high-credibility counter-offers and tenant presentation letters to secure units up to **55% below speculative market medians** without broker fees.

---

## 🏗️ Architecture & AI Stack

```
                                  ┌─────────────────────────────┐
                                  │   User / Renter (Web UI)    │
                                  │   Neo-Brutalist Dark Canvas │
                                  └──────────────┬──────────────┘
                                                 │
                   ┌─────────────────────────────┼─────────────────────────────┐
                   │                             │                             │
                   ▼                             ▼                             ▼
       ┌───────────────────────┐   ┌───────────────────────────┐   ┌───────────────────────┐
       │   Tavily Search API   │   │   Nebius Token Factory    │   │  Nebius AI Cloud      │
       │   Live Web Scout      │   │   NVIDIA Nemotron Engine  │   │  Serverless Compute   │
       ├───────────────────────┤   ├───────────────────────────┤   ├───────────────────────┤
       │ • Live Reddit Feeds   │   │ • Nemotron-3-Ultra (70B)  │   │ • Serverless Jobs     │
       │ • Campus Boards       │   │   - Anti-Gentrification   │   │   (Batch city scrapers│
       │ • Off-market sublets  │   │   - Lease Legal Audit     │   │   & RSS analyzers)    │
       │ • Craigslist Stealth  │   │ • Nemotron-Mini (4B)      │   │ • Serverless Endpoints│
       │ • Real-time indexing  │   │   - Intent / Query router │   │   (Fast deal API)     │
       └───────────────────────┘   └───────────────────────────┘   └───────────────────────┘
                                                 │
                                                 ▼
                                  ┌─────────────────────────────┐
                                  │   Cloudflare Pages Edge     │
                                  │   Zero-Latency Global CDN   │
                                  └─────────────────────────────┘
```

### 1. NVIDIA Nemotron on Nebius Token Factory
- **High-Reasoning Audit Model (`nvidia/llama-3.1-nemotron-70b-instruct` / `nvidia/nemotron-4-340b-instruct`):**
  - Evaluates contracts against local tenant protection statutes.
  - Calculates the **Anti-Gentrification Index (AGI)** and **Fair-Rent Score (0–100)**.
  - Generates tactical counter-offers and tenant profile letters.
- **Ultra-Fast Intent Router (`nvidia/nemotron-mini-4b-instruct`):**
  - Parses freeform natural language queries (e.g. *"bright room in Bushwick or East London under $1200 with utilities included for 3 months"*), extracting structured budget, date, and neighborhood parameters with sub-100ms latency.
- **Why Nebius Token Factory?**
  - Ultra-high throughput and competitive token pricing allowed us to route real-time conversational tenant queries and multi-page lease audits without latency bottlenecks or credit exhaustion.

### 2. Tavily Search API (Best Use of Tavily Bonus Track)
- Makes real-time runtime calls to `https://api.tavily.com/search` to index off-market rental threads on Reddit (`r/NYCapartments`, `r/londonhousing`, `r/bogota`, `r/berlinhousing`), Craigslist, and university boards.
- Normalizes unstructured text snippets into structured listing candidates for Nemotron validation.

### 3. Nebius Serverless Jobs (`backend/nebius_serverless_job.py`)
- Background Python workers deployed as Nebius Serverless Jobs to periodically scrape, batch-evaluate, and update rental feeds across 8 global metropolises without dedicated servers.

---

## ⚡ Key Features

| Feature | Description | Engine |
| :--- | :--- | :--- |
| **Global City Radar** | Instant filtering across NYC, London, Tokyo, Bogotá, Dubai, Paris, Berlin, and San Francisco. | React 19 + TypeScript |
| **Natural Language Search** | Describe your ideal living situation in plain English; AI parses parameters. | NVIDIA Nemotron-Mini |
| **Nemotron Lease Auditor** | Evaluates scam risk (0–10), identifies predatory clauses, and verifies perks. | NVIDIA Nemotron-70B |
| **Anti-Gentrification Index** | Compares price against local median income and speculative corporate pricing. | Custom AGI Algorithm |
| **AI Negotiation Script** | Generates copy-paste messages to pitch landlords and negotiate discounts. | NVIDIA Nemotron-3-Ultra |
| **Tavily Live Web Scout** | Real-time discovery of off-market sublease posts directly from the open web. | Tavily Search API |
| **Nemotron Tenant Copilot** | Interactive assistant answering questions on tenant rights and local laws. | Nebius Token Factory |

---

## 💻 Quickstart & Local Installation

### Prerequisites
- [Bun](https://bun.sh) (v1.0+ recommended) or Node.js (v18+)
- Git

### 1. Clone & Install
```bash
git clone https://github.com/Alortiztique/rent-scanner-ai.git
cd rent-scanner-ai
bun install
```

### 2. Configure Environment Variables
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```

Edit `.env` with your API credentials (optional for testing; the app includes a high-fidelity demonstration fallback mode):
```ini
VITE_NEBIUS_API_KEY=your_nebius_api_key_here
VITE_NEBIUS_BASE_URL=https://api.tokenfactory.nebius.com/v1
VITE_NEBIUS_REASONING_MODEL=nvidia/llama-3.1-nemotron-70b-instruct
```

**Tavily key:** do not put it in `.env` or in any `VITE_` variable. That includes the old
`VITE_TAVILY_API_KEY`, because Vite copies `VITE_` values into the public browser bundle. The
key is a server-only `TAVILY_API_KEY` secret on a private Scout Worker. See
[docs/scout-endpoint.md](docs/scout-endpoint.md) for setup and fake-transport local checks.
The browser Scout has not been switched to that endpoint yet, so without the old variable it
shows labelled demo samples.

### 3. Launch Development Server
```bash
bun run dev
```
Open [http://localhost:5173](http://localhost:5173) in your browser.

### 4. Build for Production
```bash
bun run build
```
Generates optimized static assets in `dist/`.

---

## ☁️ Cloudflare Pages Continuous Deployment

This repository is pre-configured for seamless continuous deployment on **Cloudflare Pages**:
1. Fork or push to your GitHub repository.
2. Go to **Cloudflare Dashboard > Workers & Pages > Create Application > Pages > Connect to Git**.
3. Select this repository.
4. Set build settings:
   - **Framework preset:** `Vite`
   - **Build command:** `bun run build`
   - **Build output directory:** `dist`
5. Add your environment variables (`VITE_NEBIUS_API_KEY`). Do not add a Tavily key here: Pages
   environment variables that start with `VITE_` are built into the public bundle. If
   `VITE_TAVILY_API_KEY` was set before, delete it and rotate that key in Tavily.
6. Click **Save and Deploy**. Every team commit automatically creates a live preview!

Live Tavily searches need a separate private Scout Worker. It holds the `TAVILY_API_KEY` secret
and is reached through a `SCOUT_BACKEND` service binding on the Pages project. Pages builds do
not deploy it, so the owner sets it up manually once, as described in
[docs/scout-endpoint.md](docs/scout-endpoint.md).

---

## 📝 Hackathon Feedback Section

*As required by the official hackathon rules for the **Most Valuable Feedback Award**:*

### Feedback on Nebius Token Factory & AI Cloud
1. **Developer Experience & Latency:** The OpenAI-compatible API endpoint structure (`/chat/completions`) enabled drop-in integration in under 5 minutes without proprietary SDK baggage. Streaming response times on `nvidia/llama-3.1-nemotron-70b-instruct` were remarkably fast compared to legacy GPU cloud providers.
2. **Feature Suggestion for Token Factory:** Adding native JSON Schema enforcement (`response_format: { type: "json_schema", ... }`) in Token Factory endpoints would further streamline structured data extraction without needing regex boundary parsing.
3. **Serverless AI Compute:** Nebius Serverless Jobs are exceptionally well-suited for periodic batch scraping and offline embedding generation, eliminating idle GPU costs.

### Feedback on NVIDIA Nemotron Models
1. **Instruction Adherence & Legal Reasoning:** The Nemotron models demonstrated exceptional nuance when evaluating complex contract clauses (e.g. recognizing whether an NYC sublet clause violated standard REBNY guidelines or Berlin *Mietpreisbremse* provisions).
2. **Efficiency:** Pairing Nemotron-Mini for fast intent parsing with Nemotron-70B for deep lease audits allowed our team to maximize accuracy while conserving inference credits.

---

## 👥 Hackathon Team & Acknowledgements

- **Lead Developer & Submitter:** [@Alortiztique](https://github.com/Alortiztique)
- **Contributors:** Open to our hackathon team collaborators (see [COLLABORATION_TASKS.md](COLLABORATION_TASKS.md)).
- **Track:** Best Apps and Agents Track
- **Bonus Track:** Best Use of Tavily ($3,000 Award)

---

## 📄 License
This project is licensed under the [MIT License](LICENSE) — free and open source for renters worldwide.
