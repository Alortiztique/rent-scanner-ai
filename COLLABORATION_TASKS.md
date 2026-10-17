# 🛠️ TEAM COLLABORATION ROADMAP & TASKS (6+ CONTRIBUTORS)

> **IMPORTANT NOTICE:**  
> This file is the **Internal Team Working Document**. All 6+ teammates should use this guide to claim tasks, branch off, make commits, and verify live previews on Cloudflare Pages.  
> *Before the final Devpost submission on October 30, you can either delete this file or move it to `docs/archive/`.*

---

## 🚀 How Our Team Works Together

### 1. Adding Collaborators on GitHub (Team Leader Action)
The repository owner (`Alortiztique`) can add all 6+ team members so they have full push and branch permissions:
- **Via GitHub Web UI:**
  1. Go to: `https://github.com/Alortiztique/rent-scanner-ai/settings/access`
  2. Click **"Add people"**.
  3. Enter each teammate's GitHub username or email and select **"Write"** or **"Admin"** access.
  4. Each teammate accepts the invite email or visits `https://github.com/Alortiztique/rent-scanner-ai/invitations`.

- **Via GitHub CLI (Fast batch invite):**
  ```bash
  gh api -X PUT /repos/Alortiztique/rent-scanner-ai/collaborators/<GITHUB_USERNAME> -f permission=push
  ```

### 2. Live Cloudflare Continuous Deployment (Instant Previews)
Every commit pushed to GitHub automatically triggers a live build on Cloudflare:
- **Cloudflare Pages Setup (5 minutes):**
  1. Open [dash.cloudflare.com](https://dash.cloudflare.com/) > **Workers & Pages** > **Create application** > **Pages** > **Connect to Git**.
  2. Select `Alortiztique/rent-scanner-ai`.
  3. Configure build settings:
     - **Framework preset:** `Vite`
     - **Build command:** `bun run build` (or `npm run build`)
     - **Build output directory:** `dist`
     - **Environment variables:** Add `VITE_NEBIUS_API_KEY` and `VITE_TAVILY_API_KEY`.
  4. Click **"Save and Deploy"**.
  5. *Done!* Every Pull Request and commit gets its own unique live preview URL so the whole team sees changes instantly.

### 3. Git Workflow
To avoid merge conflicts between 6+ people:
```bash
# 1. Clone the repository
git clone https://github.com/Alortiztique/rent-scanner-ai.git
cd rent-scanner-ai

# 2. Create your own feature branch for your task
git checkout -b feature/task-02-tavily-crawling

# 3. Install and run locally
bun install
bun run dev

# 4. Commit and push your changes
git add .
git commit -m "feat(tavily): expand multi-city search queries"
git push -u origin feature/task-02-tavily-crawling

# 5. Open a Pull Request on GitHub to merge into main!
```

---

## 📋 Mission Workstreams: Pick Your Task!

Below are 10 distinct, parallelizable tasks. Each teammate can pick 1 or 2 tasks without conflicting with other teammates.

---

### [TASK-01] Nemotron Few-Shot Lease Legal Prompts & Local Law Knowledge
- **Category:** AI / Prompt Engineering
- **Difficulty:** Medium
- **Target Files:**
  - `src/services/nebius.ts`
  - `src/prompts/leaseAuditPrompt.ts` (create this file)
  - `src/components/ListingModal.tsx`
- **Objective:**
  Improve the system prompt and few-shot examples for `nvidia/llama-3.1-nemotron-70b-instruct` on Nebius Token Factory. Teach Nemotron about city-specific rental regulations:
  - **New York:** NYC DHCR rent-stabilization riders, the Housing Stability and Tenant Protection Act (HSTPA), Good Cause Eviction laws, and legal caps on application fees ($20 max).
  - **Berlin:** *Mietpreisbremse* (rent brake law), *Wohnungsgeberbestätigung* for *Anmeldung* (city registration), and sublet rights (*Untermietvertrag*).
  - **Bogotá:** *Ley 820 de 2003* (regulación de arrendamiento de vivienda urbana, depósitos y pólizas).
  - **London:** Assured Shorthold Tenancy (AST) requirements, Tenancy Deposit Scheme (DPS) compliance, and Tenant Fees Act 2019 (banning unfair admin fees).
  - **Tokyo:** *Teiki Shakuya* fixed-term contracts and elimination of *Reikin* (gift money).
- **Definition of Done:** Nemotron returns hyper-accurate legal clause warnings and accurate tenant advice when auditing listings in any of these 5 hubs.

---

### [TASK-02] Tavily Multi-City Search Expansion & Real-Time Aggregator
- **Category:** Tavily / Web Scraping
- **Difficulty:** Medium
- **Target Files:**
  - `src/services/tavily.ts`
  - `src/components/TavilyLiveScoutModal.tsx`
  - `src/data/cities.ts`
- **Objective:**
  Expand the Tavily Search API client to query localized subreddits and forums with precision boolean search operators:
  - Examples: `site:reddit.com/r/NYCapartments "sublet" OR "lease takeover" "2026"`
  - `site:spareroom.co.uk OR site:gumtree.com "bills included" "Deptford"`
  - `site:wg-gesucht.de "Zwischenmiete" "Neukölln"`
  - `site:craigslist.org/sub "direct tenant" "no broker"`
- **Definition of Done:** Clicking "RUN SCOUT" returns at least 4-5 high-relevance live postings per city, parsed into cards with functional links.

---

### [TASK-03] Interactive Map Visualization (Mapbox / Leaflet)
- **Category:** Frontend / GIS
- **Difficulty:** High
- **Target Files:**
  - `src/components/Map/RentMap.tsx` (create this)
  - `src/components/ListingCard.tsx`
  - `src/App.tsx`
- **Objective:**
  Add a togglable **"Radar Map View"** next to the Grid View. When activated, it renders an interactive dark/brutalist map centered on the selected city with color-coded pins:
  - Green pins: 90+ Deal Score (Stealth savings >40%)
  - Amber pins: 75-89 Deal Score (Market fair)
  - Red pins: Gentrification warning zones
- **Definition of Done:** Users can toggle between Grid View and Map View; clicking a pin highlights or opens the corresponding listing modal.

---

### [TASK-04] Nebius Serverless Job Deployment & Automated Cron Pipeline
- **Category:** Cloud / DevOps & Python
- **Difficulty:** High
- **Target Files:**
  - `backend/nebius_serverless_job.py`
  - `backend/requirements.txt`
  - `backend/Dockerfile` (create this)
  - `backend/README.md`
- **Objective:**
  Package `backend/nebius_serverless_job.py` into a container ready to deploy as a **Nebius Serverless Job**. Set up a script that triggers a batch run, calls Nebius Token Factory, and writes the output feed to a public JSON URL or Cloudflare Worker endpoint.
- **Definition of Done:** A tested script that demonstrates runtime batch processing on Nebius AI Cloud compute, directly satisfying the hackathon criteria for Judge Mikhail Rozhkov (Nebius Serverless TPM).

---

### [TASK-05] Anti-Gentrification Index (AGI) Algorithm & Wage Parity Calculator
- **Category:** Data Science / Economic Modeling
- **Difficulty:** Medium
- **Target Files:**
  - `src/utils/fairRentCalculator.ts` (create this)
  - `src/data/cities.ts`
  - `src/components/ListingModal.tsx`
- **Objective:**
  Create a transparent, mathematical formula for the Anti-Gentrification Index:
  $$\text{AGI Score} = 100 \times \left(1 - \frac{\text{Asking Price}}{\text{Speculative Investor Median}}\right) \times \text{Tenant Protection Factor}$$
  Add a **"Working Hours to Pay Rent"** metric showing how many hours a minimum-wage or average young worker needs to work in that city to afford the unit compared to the market average.
- **Definition of Done:** Visual progress bar or badge on each listing card and modal showing exact labor hours saved.

---

### [TASK-06] Telegram & WhatsApp Instant Deal Alerts
- **Category:** Integrations / Bot
- **Difficulty:** Medium
- **Target Files:**
  - `src/services/notifications.ts` (create this)
  - `backend/telegram_notifier.py` (create this)
  - `src/components/Header.tsx`
- **Objective:**
  Build a notification hook so users can subscribe their Telegram handle or webhook to receive alerts when a new 95+ Deal Score sublease is detected in their preferred city.
- **Definition of Done:** A simulated or functional webhook dispatcher that formats an alert with direct link and Nemotron summary.

---

### [TASK-07] Dark Brutalist Mobile UI Polish & Keyboard Shortcuts
- **Category:** Design / Frontend
- **Difficulty:** Low - Medium
- **Target Files:**
  - `src/index.css`
  - `src/components/Header.tsx`
  - `src/components/FilterBar.tsx`
  - `src/components/ListingCard.tsx`
- **Objective:**
  Polish mobile responsiveness across iPhone and Android viewports. Add power-user keyboard shortcuts:
  - `Press /` -> Focus natural language search
  - `Press Esc` -> Close modals
  - `Press 1-8` -> Switch target cities instantly
  - Add brutalist scanline micro-animations or radar sweep effects on hover.
- **Definition of Done:** Flawless mobile viewport rendering and functioning keyboard navigation.

---

### [TASK-08] Multi-Language Localization (English First, Spanish & Japanese)
- **Category:** Internationalization / UX
- **Difficulty:** Medium
- **Target Files:**
  - `src/locales/en.json`, `src/locales/es.json`, `src/locales/ja.json`
  - `src/utils/i18n.ts`
  - `src/components/Header.tsx`
- **Objective:**
  Since the platform covers cities like Bogotá and Tokyo, allow instantaneous language switching between English (default), Spanish (for Latin America/Spain), and Japanese (for Tokyo/Osaka), while maintaining English as the primary default.
- **Definition of Done:** Language toggle in header updates all interface labels.

---

### [TASK-09] Devpost Submission Pitch, Demo Video Script & Slides
- **Category:** Product / Marketing / Video
- **Difficulty:** High Impact
- **Target Files:**
  - `docs/DEMO_SCRIPT.md` (create this)
  - `docs/DEVPOST_SUBMISSION.md` (create this)
  - `README.md`
- **Objective:**
  Write the compelling 3-minute video presentation script for Devpost:
  - **0:00 - 0:45:** The problem: Global youth priced out of major metropolises by speculative landlords and broker cartels.
  - **0:45 - 1:45:** The solution: RentScanner AI demo — showing live Tavily search for off-market sublets and instant NVIDIA Nemotron lease auditing on Nebius Token Factory.
  - **1:45 - 2:30:** Technical architecture deep-dive: Nemotron-3-Ultra + Nemotron-Mini-4B + Nebius Serverless Jobs.
  - **2:30 - 3:00:** The vision: An open-source civic weapon against gentrification.
- **Definition of Done:** Ready-to-record script with timing cues, slide templates, and screenshot storyboard.

---

### [TASK-10] Feedback Form Submission for Nebius & NVIDIA ($100 + Swag Prize)
- **Category:** Developer Experience / Devpost
- **Difficulty:** Low
- **Target Files:**
  - `docs/NEBIUS_NVIDIA_FEEDBACK.md` (create this)
  - `README.md`
- **Objective:**
  Write comprehensive, detailed, constructive developer feedback on:
  - Nebius Token Factory latency, pricing, and OpenAI compatibility.
  - NVIDIA Nemotron instruction following and reasoning on legal text.
  - Tavily Search API speed and filtering precision.
- **Definition of Done:** Meets all Devpost Feedback Award submission criteria to qualify our team for the $100 cash + NVIDIA swag pack award!

---

## 🏆 Let's Win This!
Questions? Reach out to the team leader (`Alortiztique`) or drop an issue in this repository!
