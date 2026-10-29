# Telegram Alerts: Multi-City Channels & Personal Radar Notifier

The instant deal alert system monitors rental listings audited by **NVIDIA Nemotron-70B on Nebius Token Factory**. It enforces market scarcity by filtering exclusively for elite opportunities (Deal Score $\ge 90/100$) and dispatches real-time alerts through two distinct paths:
1. **Public City Broadcast Channels:** 9 dedicated Telegram channels (8 major metropolises + 1 global showcase).
2. **Personal Radar Matching Engine (1-on-1 Direct Messages):** Registered users configure personalized criteria via an interactive Telegram bot (`@Rent_Scanner_AI_BOT`). The batch engine compares newly audited listings against user criteria and delivers private DMs with exact match explanations.

## Web entry point

The header's **Deal Alerts** button opens a native dialog. **Continue in Telegram** opens
`https://t.me/Rent_Scanner_AI_BOT?start=web`; pressing Start there begins the existing onboarding
wizard. The bot must be deployed and running to respond. The web app does not verify its deployment
or mark a visitor as subscribed. City, budget and other live subscription filters are set in Telegram.

The same dialog previews messages using the bundled demo listings only, with a city, local-currency
budget, minimum sample deal score and channel. It never includes unpriced Scout hits. Changing the
city clears the budget so an amount in one currency is not reused in another. Preview settings can
be saved in this browser, but are not synced with the Telegram bot. The preview defaults to 95+;
the existing backend's default remains 90+ and is set independently.

WhatsApp has a labelled local message preview only. There is no WhatsApp delivery integration.
The browser does not request a bot token, phone number, chat ID or arbitrary webhook, and sends no
notification request. Live Telegram delivery remains in the Python backend.

Offline UI and service checks:

```bash
node --experimental-strip-types --test tests/notifications.test.ts
```

These checks do not send messages or establish that the bot or channels are running.

---

## How the pipeline flows

```
Batch Job (TASK-04) ──▶ Audited Listings ──▶ notifier.py ──┬──▶ Deal Score >= 90 ──▶ Public City Channels
(Nebius / Serverless)   (Nemotron-70B)                    │    (Enforce Scarcity)     (Bogotá, NYC, London, ...)
                                                          │
                                                          └──▶ User Radar Match  ──▶ 1-on-1 Private DMs
                                                               (City, Budget, Typo)   (@Rent_Scanner_AI_BOT)
                                                                       ▲
                                                                       │
Telegram Renter ──────▶ /start /config ──────▶ bot_listener.py ────────┘
(Interactive Bot)       (Inline Keyboard)      (State Machine -> users_db.json)
```

- **`backend/notifier.py`** is the batch dispatcher. It reads Nemotron-70B batches, silences cities where no deals reach $\ge 90$ to preserve perceived market scarcity, and evaluates registered renter profiles in `users_db.json` to dispatch 1-on-1 DMs.
- **`backend/bot.py`** provides Telegram Bot API bindings (`sendMessage`), brutalist cyberpunk markdown formatting, and personalized radar match headers.
- **`backend/bot_listener.py`** is a long-polling daemon implementing an interactive state machine for 1-on-1 Telegram chat onboarding.
- **`src/services/notifications.ts`** validates and saves local preview preferences, selects a matching demo listing, and formats a sample message. It does not deliver messages.

---

## 1. Official City Broadcast Channels

Channels receive automated posts when Nemotron audits identify off-market sublets with **Deal Score $\ge 90$**. If zero listings in a city surpass the threshold during a cycle, dispatch for that city is suppressed.

| Metropolis | Channel Name | Destination ID / Handle | Status |
|---|---|---|---|
| **Global Showcase** | RentScannerAI | `-1003908427229` | Active |
| **Bogotá** | Rent-Scanner-AI (BOGOTÁ) | `@RentScannerAI_BOGOTA` (`-1004409368707`) | Active |
| **New York City** | Rent-Scanner-AI (NEW YORK CITY) | `@RentScannerAI_NEWYORKCITY` | Active |
| **London** | Rent-Scanner-AI (LONDON) | `@RentScannerAI_LONDON` (`-1004453068839`) | Active |
| **Tokyo** | Rent-Scanner-AI (TOKYO) | `@RentScannerAI_TOKYO` (`-1004311958356`) | Active |
| **Paris** | Rent-Scanner-AI (PARIS) | `-1003867417031` | Active |
| **Berlin** | Rent-Scanner-AI (BERLIN) | `-1004316639140` | Active |
| **Dubai** | Rent-Scanner-AI (DUBAI) | `-1004415684025` | Active |
| **San Francisco** | Rent-Scanner-AI (SAN FRANCISCO) | `-1003463263362` | Active |

> **Note on Private Channel IDs:** Private channels require internal negative 64-bit integer IDs (e.g. `-1003867417031`), whereas public channels accept either `@handle` or internal ID. The bot must possess the **Post Messages** administrator permission in each channel.

---

## 2. Interactive 1-on-1 Onboarding Wizard (`bot_listener.py`)

Renters start an interactive onboarding session by sending `/start` or `/config` to `@Rent_Scanner_AI_BOT`. The bot presents inline keyboard menus across 5 steps:

```
[Step 1: City] ──▶ [Step 2: Typology] ──▶ [Step 3: Budget] ──▶ [Step 4: Broker Fee] ──▶ [Step 5: Utilities] ──▶ Confirmation
(8 cities + All)   (Studio, Room, ...)    (Presets / Custom)   (0% Fee / Any)          (Included / Any)         (Sorted by Nemotron)
```

### Supported Commands
- `/start` — Launch the 5-step interactive radar setup.
- `/config` — Reconfigure existing filters at any time.
- `/radar` or `/status` — View current active filters and threshold settings.
- `/test` — Trigger an instant sample alert to verify delivery.

### User Radar Schema (`users_db.json`)
```json
{
  "chatId": 8170853843,
  "username": "Renter",
  "firstName": "Alex",
  "cityId": "bogota",
  "cityName": "Bogotá",
  "housingType": "studio",
  "maxBudget": 1500000,
  "currency": "COP $",
  "noBrokerFeeOnly": true,
  "utilitiesIncludedOnly": false,
  "sortBy": "dealScore",
  "minDealScore": 90,
  "active": true,
  "configuredAt": "2026-10-25T00:00:00Z"
}
```

---

## 3. Personal Matching Engine (`notifier.py`)

When a batch of audited listings is processed, `deal_matches_user(deal, user)` validates:
1. **Active Status:** `user.active == true`.
2. **Deal Score Threshold:** Listing `dealScore >= user.minDealScore` (default: 90/100).
3. **Metropolis Matching:** Listing `cityId` matches user target or user selected `all`.
4. **Budget Cap:** Listing `priceLocal <= user.maxBudget` (when configured).
5. **Typology:** Substring match against `housingType`, title, or listing description.
6. **Zero Broker Fee:** When requested, verifies `0% broker fee` via perks or title.
7. **Utilities Included:** When requested, verifies water/power/wifi inclusion.

When a match occurs, a personalized DM is dispatched to the renter's private Telegram chat:
```markdown
🎯 *RENTSCANNER AI // PERSONAL RADAR MATCH*
👤 *Direct Alert for:* Alex
📍 *BOGOTÁ* • Chapinero Alto
━━━━━━━━━━━━━━━━━━━━━━━━━━
🏷️ *Chapinero Alto Terrace Studio // 4-Month Direct Sublease*

💰 *COP $850,000* / month (`-53%` vs Median: $450)

🛡️ *NEMOTRON HOUSING AUDIT:*
• *Deal Score:* `96/100` (HISTORIC ANOMALY)
• *Scam Risk:* `0/10` (Verified Lease)
• *Status:* _Anti-Gentrification Champion_

✨ *Verified Perks:*
  ✓ Zero broker commissions or extortionate fees
  ✓ Utilities included (Water, gas, 300Mbps fiber WiFi)
━━━━━━━━━━━━━━━━━━━━━━━━━━
🔍 *Radar Criteria Match:*
  🎯 Metropolis: Bogotá
  🎯 Under your budget (COP $1,500,000)
  🎯 Typology: Studio
  🎯 Deal Score: 96/100 (Threshold >= 90)

📡 Source: `Reddit Sublet (r/bogota)`
🔗 [View Original Posting](https://reddit.com/r/bogota/comments/chapinero_sublet)

🤖 _Audited by NVIDIA Nemotron-3-Ultra on Nebius Token Factory_
⚙️ _Modify your alert filters anytime with /config_
```

---

## 4. Testing & Local Execution

### Prerequisites
Set credentials in `.env` (or pass via environment):
```bash
TELEGRAM_BOT_TOKEN="8973053324:AAG..."
```

### Run Batch Dispatcher
```bash
# Full cycle: broadcast to qualifying channels AND notify registered users
python3 backend/notifier.py --batch backend/sample_batch.json

# Test user matching only (suppress channel broadcast)
python3 backend/notifier.py --batch backend/sample_batch.json --skip-channels

# Test channel broadcast only (suppress user DMs)
python3 backend/notifier.py --batch backend/sample_batch.json --skip-users
```

### Run Interactive Bot Listener (Daemon)
```bash
python3 backend/bot_listener.py
```

### Run Standalone Telegram Connectivity Test
```bash
python3 backend/bot.py <YOUR_CHAT_ID_OR_CHANNEL>
```

---

## 5. Security & Privacy Boundaries

- **Token Isolation:** `TELEGRAM_BOT_TOKEN` is used server-side only in Python dispatchers. It is never embedded into client-side Vite bundles.
- **Renter Privacy Protection:** `backend/users_db.json` and `backend/*.db` are strictly ignored by `.gitignore`. Renter Telegram `chatId` numbers and personal filters remain local and are never committed to the public GitHub repository. An anonymized template is provided at [`backend/users_db.example.json`](../backend/users_db.example.json).
- **Browser boundary:** The client has no notification delivery path or token setting. Sample previews are always labelled as demo data. Saving preview settings does not create a subscription. Actual sign-up happens in Telegram and delivery uses the server-side `TELEGRAM_BOT_TOKEN`.
