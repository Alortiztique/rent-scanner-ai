# Deal alerts

Task 6 adds a web entry point, local sample previews and a Telegram bot and batch dispatcher.
WhatsApp delivery is not connected. No deployment, live inference or actual delivery was verified
by the offline tests.

## Web entry point

The header's **Deal Alerts** button opens a native dialog. **Continue in Telegram** opens
`https://t.me/Rent_Scanner_AI_BOT?start=web`. Pressing Start begins the bot's five-step setup.
The operator must run that bot for it to respond. Opening the link does not create a subscription.

The dialog previews bundled demo listings by city, local-currency budget, sample score of at least
95 and channel. Each preview includes the fixture's sample audit summary and source link. Unpriced
Scout hits cannot become sample deals. Changing city clears the budget. Browser storage holds
preview settings only; the bot's live preferences are configured separately in Telegram.

WhatsApp is a labelled local preview. The browser collects no phone number, bot token, chat ID or
webhook and has no notification delivery path.

## Backend responsibilities

- `alert_model.py` owns canonical city identities, supported input normalization, the 95+ floor
  and strict preference matching.
- `bot.py` owns the shared Telegram request function and plain-text message formatting. It uses
  provided facts and summaries, shows missing rent as unavailable, labels estimates and samples,
  and makes no independent verification claim. Plain text keeps source titles and renter names
  from breaking Telegram's Markdown parser.
- `bot_listener.py` handles private-chat setup for city, housing type, budget, broker fees and
  utilities. Callbacks must match the current step, allowed values and current menu message.
  Stale buttons cannot create or overwrite subscriptions.
- `notifier.py` reads a batch and previews eligible alerts by default. `--send` enables actual
  delivery of non-demo records. Successful deliveries are recorded per destination and source
  listing in a local SQLite ledger so normal reruns and concurrent dispatchers skip them.

The batch dispatcher runs when an operator invokes it. This branch adds no cron schedule or
automatic connection to the Task 4 job. After producing a feed, pass its path to the dispatcher.

## Accepted data and matching

The dispatcher accepts the existing job's `city`, `url`, `raw_title`, `audit` format, or complete
listing records with `cityId`, `sourceUrl`, `dealScore` and `nemotronAudit` or `audit`. Unknown
cities, conflicting city identities, unsafe source links and nonnumeric or invalid scores are
rejected. NYC and San Francisco names resolve to `nyc` and `sf` exactly, without substring matches.

Both channels and personal messages require scores of at least 95. A stricter `--score` applies
to both paths, and an individual profile can set a higher floor. Old 90+ profiles still receive
only 95+ deals. Demo records and simulated or fallback model output are excluded from live batches.

For a city-specific budget, the listing must have an observed local price in that city's currency.
An all-cities budget uses an observed `priceUsd`. An `audit.estimatedPriceUsd` is a labelled estimate
and cannot satisfy a budget. No exchange rate, free rent or property fact is invented for missing
data. Prices exactly equal to the budget qualify; zero is a valid budget.

A specific housing preference matches the canonical `type` or `housingType`. Mandatory no-broker-fee
and utilities-included filters require explicit true facts. Missing facts and phrases such as
"gas not included" cannot satisfy them. A source hit with no price can be previewed or sent when
there is no budget or other unmet filter, but its asking rent remains unavailable.

The audit summary comes from `audit.summary` or the fixture's `leaseClauseSummary`. Missing summaries
are identified as missing. Model assessments do not establish that a lease, perk or listing is verified.

## Subscriber data and delivery state

Run one listener process per subscriber file. The handler loop and a thread lock serialize profile
updates. Saves preserve existing profiles, write and flush a temporary file beside the destination,
then replace it atomically so batch readers see a complete file. Unreadable or invalid subscriber
files stop saving; they are not overwritten with an empty database. A failed save does not report
that preferences were saved.

`/stop` disables the private subscription, `/config` starts a new setup, and `/status` or `/radar`
shows stored settings. `/test` sends a clearly labelled sample only to the requesting private chat.
Budgets accept nonnegative numbers with up to two decimal places and no separators. `1000.50`
stays 1000.50; negative, incomplete or malformed input does not advance the setup.

Preserve `backend/alerts.db` on durable storage across batch runs and deployments. Deleting it
allows previous listings to be sent again. SQLite serializes delivery transactions to stop
concurrent dispatchers from sending the same destination twice. Only successful responses are
recorded, so failed sends can retry. A crash or network timeout after Telegram accepts a message
but before its success is recorded can still cause a duplicate on retry; this is not an exactly-once
guarantee across the network.

The subscriber JSON, its temporary files, delivery database and SQLite side files are ignored by
Git. `backend/users_db.example.json` is an anonymized example, not a file to use for live delivery.
Keep the token server-side in `TELEGRAM_BOT_TOKEN`, in the environment or local `.env`. Never use a
`VITE_` token variable. Request errors and logs do not print token-bearing URLs.

## Running and checking

No Telegram secret is needed for offline checks or the default preview:

```bash
node --experimental-strip-types --test tests/notifications.test.ts
python -m unittest discover -s tests -p test_telegram_alerts.py
python backend/notifier.py --batch backend/sample_batch.json --skip-users
python backend/bot.py
```

The committed sample batch is explicitly demo data. Its previews include destinations for the
configured channels but send nothing and create no delivery ledger. `--send` skips those samples.

For actual operation, set the server-side token, run the listener and supply a non-demo feed:

```bash
python backend/bot_listener.py
python backend/notifier.py --batch scored_listings_feed.json --send
```

These are separate processes. The bot must have permission to post to any configured channel.
`CHANNEL_BOGOTA`, `CHANNEL_NYC`, `CHANNEL_LONDON`, `CHANNEL_TOKYO`, `CHANNEL_PARIS`,
`CHANNEL_BERLIN`, `CHANNEL_DUBAI` and `CHANNEL_SF` override the defaults in `notifier.py`.
The configured destinations are not evidence that the channels are active. `--chat` overrides
the city-channel destination; `--skip-channels` and `--skip-users` disable either delivery path.
`--users-db` and `--state-db` select the local files.

To send a labelled sample to a destination you explicitly choose:

```bash
python backend/bot.py YOUR_CHAT_ID --send
```

The tests use temporary files and fake Telegram transports. They cover matching, sample labels,
onboarding, failed saves, repeated runs, concurrent dispatchers and failed delivery retry. UI checks
use static markup; browser layout, focus, Escape and live Telegram availability are not exercised.
