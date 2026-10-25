#!/usr/bin/env python3
"""
RentScanner AI // Batch Deal Alert Dispatcher (TASK-06)
Nebius x NVIDIA Global AI Hackathon

Reads a batch of freshly audited listings from Nemotron-70B,
filters for elite opportunities (Deal Score >= 90), enforces market scarcity,
dispatches real-time alerts to Telegram channels, and routes personalized DMs
to registered renters matching their custom radar criteria.
"""

import os
import sys
import json
import argparse
from typing import List, Dict, Any
from bot import send_telegram_alert, send_personal_alert, get_latest_chat_id, get_bot_info

DEFAULT_THRESHOLD = 90
DEFAULT_USERS_DB = os.path.join(os.path.dirname(__file__), "users_db.json")

# Official Telegram City Channels Map (Public Handles & Direct Numeric IDs)
CITY_CHANNELS = {
    "all": os.getenv("CHANNEL_GLOBAL", "-1003908427229"),           # RentScannerAI (General)
    "bogota": os.getenv("CHANNEL_BOGOTA", "@RentScannerAI_BOGOTA"), # Rent-Scanner-AI (BOGOTÁ)
    "nyc": os.getenv("CHANNEL_NYC", "@RentScannerAI_NEWYORKCITY"),  # Rent-Scanner-AI (NEW YORK CITY)
    "london": os.getenv("CHANNEL_LONDON", "@RentScannerAI_LONDON"), # Rent-Scanner-AI (LONDON)
    "tokyo": os.getenv("CHANNEL_TOKYO", "@RentScannerAI_TOKYO"),    # Rent-Scanner-AI (TOKYO)
    "paris": os.getenv("CHANNEL_PARIS", "-1003867417031"),          # Rent-Scanner-AI (PARIS)
    "berlin": os.getenv("CHANNEL_BERLIN", "-1004316639140"),        # Rent-Scanner-AI (BERLIN)
    "dubai": os.getenv("CHANNEL_DUBAI", "-1004415684025"),          # Rent-Scanner-AI (DUBAI)
    "sf": os.getenv("CHANNEL_SF", "-1003463263362"),                # Rent-Scanner-AI (SAN FRANCISCO)
}


def deal_matches_user(deal: Dict[str, Any], user: Dict[str, Any]) -> bool:
    """Evaluate whether a deal satisfies all personal radar filters of a user."""
    if not user.get("active", True):
        return False

    # 1. Scarcity & Deal Score threshold
    deal_score = deal.get("dealScore", deal.get("audit", {}).get("fairRentScore", 0))
    min_score = user.get("minDealScore", DEFAULT_THRESHOLD)
    if deal_score < min_score:
        return False

    # 2. City Matching
    user_city = (user.get("cityId") or "all").lower().strip()
    deal_city_id = (deal.get("cityId") or "").lower().strip()
    deal_city_name = (deal.get("cityName") or deal.get("city") or "").lower().strip()

    if user_city != "all":
        norm_deal_city = deal_city_name.replace("á", "a").replace("é", "e").replace("í", "i").replace("ó", "o").replace("ú", "u")
        norm_user_city = user_city.replace("á", "a").replace("é", "e").replace("í", "i").replace("ó", "o").replace("ú", "u")
        if norm_user_city not in deal_city_id and norm_user_city not in norm_deal_city:
            return False

    # 3. Maximum Budget Filter
    max_budget = user.get("maxBudget")
    if max_budget is not None and max_budget > 0:
        price = deal.get("priceLocal", deal.get("priceUsd", 0))
        if price > max_budget:
            return False

    # 4. Housing Typology Filter
    housing_type = (user.get("housingType") or "all").lower().strip()
    if housing_type != "all":
        title = (deal.get("title") or deal.get("raw_title") or "").lower()
        deal_type = (deal.get("housingType") or "").lower()
        if housing_type not in deal_type and housing_type not in title:
            return False

    # 5. 0% Broker Fee Filter
    if user.get("noBrokerFeeOnly", False):
        perks = " ".join(deal.get("nemotronAudit", {}).get("verifiedPerks", [])).lower()
        title = (deal.get("title") or "").lower()
        has_no_fee = (
            deal.get("noBrokerFee") is True
            or "no broker" in perks
            or "zero broker" in perks
            or "0% broker" in perks
            or "direct" in perks
            or "no broker" in title
            or "zero broker" in title
        )
        if not has_no_fee:
            return False

    # 6. Utilities Included Filter
    if user.get("utilitiesIncludedOnly", False):
        perks = " ".join(deal.get("nemotronAudit", {}).get("verifiedPerks", [])).lower()
        title = (deal.get("title") or "").lower()
        has_utilities = (
            deal.get("utilitiesIncluded") is True
            or "utilit" in perks
            or "bill" in perks
            or "wifi" in perks
            or "water" in perks
            or "gas" in perks
        )
        if not has_utilities:
            return False

    return True


def dispatch_to_users(listings: List[Dict[str, Any]], users_db_file: str = DEFAULT_USERS_DB) -> Dict[str, Any]:
    """Scan registered users and dispatch direct 1-on-1 alert messages for matches."""
    if not os.path.exists(users_db_file):
        print(f"[USER MATCHER] Warning: No user database found at {users_db_file}")
        return {"users_evaluated": 0, "users_notified": 0, "total_matches": 0}

    try:
        with open(users_db_file, "r", encoding="utf-8") as f:
            users_db: Dict[str, Any] = json.load(f)
    except Exception as e:
        print(f"[USER MATCHER] Error reading {users_db_file}: {e}")
        return {"users_evaluated": 0, "users_notified": 0, "total_matches": 0}

    active_users = [u for u in users_db.values() if u.get("active", True)]
    print(f"\n--- 👥 Scanning {len(active_users)} Active Registered Renter(s) for Radar Matches ---")

    users_notified = 0
    total_matches = 0

    for user in active_users:
        name = user.get("firstName", "Renter")
        chat_id = user.get("chatId")
        user_city = user.get("cityName", user.get("cityId", "Global"))

        matches = [deal for deal in listings if deal_matches_user(deal, user)]

        if not matches:
            print(f"  💤 {name} (Chat {chat_id} • {user_city}): No new matching deals in this cycle.")
            continue

        print(f"  🎯 {name} (Chat {chat_id} • {user_city}): Found {len(matches)} matching deal(s)!")
        user_sent = 0
        for deal in matches:
            title = deal.get("title", deal.get("raw_title", "Sublease Opportunity"))
            score = deal.get("dealScore", deal.get("audit", {}).get("fairRentScore", 0))
            print(f"     -> Sending Personal DM: \"{title}\" (Score {score}/100)")
            res = send_personal_alert(deal, user)
            if res.get("ok"):
                user_sent += 1
                total_matches += 1
            else:
                print(f"        ❌ Failed to deliver DM to {chat_id}: {res.get('error')}")

        if user_sent > 0:
            users_notified += 1

    return {
        "users_evaluated": len(active_users),
        "users_notified": users_notified,
        "total_matches": total_matches,
    }


def process_batch(
    batch_file: str,
    min_score: int = DEFAULT_THRESHOLD,
    target_chat: Any = None,
    notify_channels: bool = True,
    notify_users: bool = True,
    users_db_file: str = DEFAULT_USERS_DB,
) -> Dict[str, Any]:
    """Process a batch of listings, filter by score, and dispatch qualifying alerts to channels and users."""
    if not os.path.exists(batch_file):
        print(f"[ERROR] Batch file not found: {batch_file}")
        return {"ok": False, "error": "File not found"}

    with open(batch_file, "r", encoding="utf-8") as f:
        listings: List[Dict[str, Any]] = json.load(f)

    print("=" * 65)
    print("RentScanner AI // Nemotron Batch Notifier (TASK-06)")
    print(f"Batch File: {batch_file}")
    print(f"Total Listings Received from Nemotron-70B: {len(listings)}")
    print(f"Scarcity Deal Score Threshold: >= {min_score}/100")
    print(f"Channel Dispatch: {'ENABLED' if notify_channels else 'DISABLED'}")
    print(f"Personal User Radar Match: {'ENABLED' if notify_users else 'DISABLED'}")
    print("=" * 65)

    dispatched_channels_count = 0
    discarded_channels_count = 0
    summary_report = []

    # 1. Channel Broadcast
    if notify_channels:
        # Group listings by city
        cities_map: Dict[str, List[Dict[str, Any]]] = {}
        for item in listings:
            city = item.get("cityName", item.get("city", "Global"))
            cities_map.setdefault(city, []).append(item)

        for city, city_listings in cities_map.items():
            print(f"\n--- Analyzing Metropolis: {city.upper()} ({len(city_listings)} deals in batch) ---")

            # Filter listings >= min_score
            qualifying = [item for item in city_listings if item.get("dealScore", item.get("audit", {}).get("fairRentScore", 0)) >= min_score]

            if not qualifying:
                print(f"  🔒 [SCARCITY FILTER]: 0 deals reached threshold >= {min_score} in {city}.")
                print(f"     -> Suppressing channel dispatch for {city} (Market scarcity preserved).")
                discarded_channels_count += len(city_listings)
                summary_report.append({"city": city, "qualified": 0, "status": "SILENCED (SCARCITY)"})
                continue

            print(f"  🚨 [STEALTH DEAL LOCATED]: {len(qualifying)} deal(s) surpassed threshold >= {min_score}!")

            # Determine specific city channel
            norm_city = city.lower().replace(" ", "").replace("á", "a").replace("é", "e").replace("í", "i").replace("ó", "o").replace("ú", "u")
            destination_channel = target_chat
            if not destination_channel:
                if "bogota" in norm_city:
                    destination_channel = CITY_CHANNELS["bogota"]
                elif "york" in norm_city or "nyc" in norm_city:
                    destination_channel = CITY_CHANNELS["nyc"]
                elif "london" in norm_city:
                    destination_channel = CITY_CHANNELS["london"]
                elif "tokyo" in norm_city:
                    destination_channel = CITY_CHANNELS["tokyo"]
                elif "paris" in norm_city:
                    destination_channel = CITY_CHANNELS["paris"]
                elif "berlin" in norm_city:
                    destination_channel = CITY_CHANNELS["berlin"]
                elif "dubai" in norm_city:
                    destination_channel = CITY_CHANNELS["dubai"]
                elif "francisco" in norm_city or "sf" in norm_city:
                    destination_channel = CITY_CHANNELS["sf"]
                else:
                    destination_channel = CITY_CHANNELS["all"]

            print(f"  📢 [DESTINATION]: {destination_channel}")

            for deal in qualifying:
                score = deal.get("dealScore", deal.get("audit", {}).get("fairRentScore", 0))
                title = deal.get("title", deal.get("raw_title", "Sublease Opportunity"))
                print(f"  -> Publishing: \"{title}\" (Deal Score: {score}/100)")

                res = send_telegram_alert(deal, destination_channel)
                if res.get("ok"):
                    dispatched_channels_count += 1
                else:
                    print(f"     ❌ Delivery error to {destination_channel}: {res.get('error')}")

            discarded_channels_count += (len(city_listings) - len(qualifying))
            summary_report.append({"city": city, "qualified": len(qualifying), "status": "DISPATCHED"})

    # 2. Personal User Radar Direct Messages
    user_stats = {"users_evaluated": 0, "users_notified": 0, "total_matches": 0}
    if notify_users:
        user_stats = dispatch_to_users(listings, users_db_file)

    print("\n" + "=" * 65)
    print("BATCH NOTIFICATION CYCLE SUMMARY:")
    print(f"• Total Analyzed: {len(listings)}")
    print(f"• Channel Alerts Dispatched: {dispatched_channels_count}")
    print(f"• Channel Deals Silenced (Score < {min_score}): {discarded_channels_count}")
    print(f"• Active Renters Evaluated: {user_stats['users_evaluated']}")
    print(f"• Renters Notified via DM: {user_stats['users_notified']}")
    print(f"• Total Personal DMs Delivered: {user_stats['total_matches']}")
    print("=" * 65)

    return {
        "ok": True,
        "total": len(listings),
        "channel_dispatched": dispatched_channels_count,
        "channel_discarded": discarded_channels_count,
        "cities": summary_report,
        "user_matches": user_stats,
    }


def main():
    parser = argparse.ArgumentParser(description="RentScanner AI Nemotron Batch Notifier")
    parser.add_argument("--batch", default="backend/sample_batch.json", help="Path to JSON batch file")
    parser.add_argument("--score", type=int, default=DEFAULT_THRESHOLD, help="Minimum Deal Score threshold")
    parser.add_argument("--chat", default=None, help="Target Telegram chat_id or channel handle")
    parser.add_argument("--users-db", default=DEFAULT_USERS_DB, help="Path to users database JSON file")
    parser.add_argument("--skip-channels", action="store_true", help="Skip public channel broadcast")
    parser.add_argument("--skip-users", action="store_true", help="Skip personalized direct messages to users")
    args = parser.parse_args()

    process_batch(
        args.batch,
        min_score=args.score,
        target_chat=args.chat,
        notify_channels=not args.skip_channels,
        notify_users=not args.skip_users,
        users_db_file=args.users_db,
    )


if __name__ == "__main__":
    main()
