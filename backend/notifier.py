"""Preview or dispatch new 95+ deals. Delivery is opt-in; successful sends are deduplicated."""
import argparse
from contextlib import closing
import hashlib
import json
import os
from pathlib import Path
import sqlite3

from alert_model import DEFAULT_THRESHOLD, matches_preferences, normalize_deal, number
from bot import format_deal_alert, format_personal_alert, send_personal_alert, send_telegram_alert
from bot_listener import USERS_DB_FILE, load_users_db

DEFAULT_STATE_DB = Path(__file__).with_name("alerts.db")
CITY_CHANNELS = {
    "bogota": os.getenv("CHANNEL_BOGOTA", "@RentScannerAI_BOGOTA"),
    "nyc": os.getenv("CHANNEL_NYC", "@RentScannerAI_NEWYORKCITY"),
    "london": os.getenv("CHANNEL_LONDON", "@RentScannerAI_LONDON"),
    "tokyo": os.getenv("CHANNEL_TOKYO", "@RentScannerAI_TOKYO"),
    "paris": os.getenv("CHANNEL_PARIS", "-1003867417031"),
    "berlin": os.getenv("CHANNEL_BERLIN", "-1004316639140"),
    "dubai": os.getenv("CHANNEL_DUBAI", "-1004415684025"),
    "sf": os.getenv("CHANNEL_SF", "-1003463263362"),
}


def deal_matches_user(raw, user, min_score=DEFAULT_THRESHOLD):
    deal = normalize_deal(raw)
    return deal is not None and matches_preferences(deal, user, min_score)


def _deliver_once(connection, deal, destination, user):
    identity = hashlib.sha256(f"{deal['cityId']}:{deal['sourceUrl']}".encode()).hexdigest()
    # ponytail: serialize sends under SQLite's writer lock; use claimed rows if batch throughput matters.
    with connection:
        connection.execute("BEGIN IMMEDIATE")
        key = (str(destination), identity)
        if connection.execute("SELECT 1 FROM sent WHERE destination=? AND identity=?", key).fetchone():
            return "duplicate"
        result = send_personal_alert(deal, user) if user is not None else send_telegram_alert(deal, destination)
        if result.get("ok") is not True:
            return "failed"
        connection.execute("INSERT INTO sent(destination, identity) VALUES (?, ?)", key)
        return "sent"


def process_batch(batch_file, min_score=DEFAULT_THRESHOLD, target_chat=None,
                  notify_channels=True, notify_users=True, users_db_file=USERS_DB_FILE,
                  dry_run=True, state_db=DEFAULT_STATE_DB):
    if not number(min_score, minimum=DEFAULT_THRESHOLD, maximum=100):
        return {"ok": False, "error": "Minimum score must be between 95 and 100"}
    try:
        listings = json.loads(Path(batch_file).read_text(encoding="utf-8"))
        if not isinstance(listings, list):
            raise ValueError("Batch must be a list")
        users = load_users_db(users_db_file) if notify_users else {}
    except (OSError, ValueError):
        return {"ok": False, "error": "Batch or subscriber data is unreadable; no alerts sent"}
    deals = [deal for item in listings if (deal := normalize_deal(item)) is not None and deal["dealScore"] >= min_score]
    skipped_demo = sum(deal["demo"] for deal in deals) if not dry_run else 0
    if not dry_run:
        deals = [deal for deal in deals if not deal["demo"]]
    deliveries = []
    if notify_channels:
        deliveries.extend((deal, target_chat or CITY_CHANNELS[deal["cityId"]], None) for deal in deals)
    if notify_users:
        for user in users.values():
            chat_id = user.get("chatId")
            if type(chat_id) is not int or chat_id <= 0:
                continue
            deliveries.extend((deal, chat_id, user) for deal in deals if matches_preferences(deal, user, min_score))
    if dry_run:
        return {"ok": True, "dry_run": True, "previews": [
            {"destination": str(destination), "message": format_personal_alert(deal, user) if user is not None else format_deal_alert(deal)}
            for deal, destination, user in deliveries
        ]}
    counts = {"sent": 0, "duplicate": 0, "failed": 0}
    try:
        with closing(sqlite3.connect(state_db, timeout=30)) as connection:
            connection.execute("CREATE TABLE IF NOT EXISTS sent (destination TEXT NOT NULL, identity TEXT NOT NULL, PRIMARY KEY(destination, identity))")
            connection.commit()
            for deal, destination, user in deliveries:
                counts[_deliver_once(connection, deal, destination, user)] += 1
    except (OSError, sqlite3.Error):
        return {"ok": False, "error": "Delivery state unavailable; stop and preserve the state database", **counts}
    return {"ok": counts["failed"] == 0, "dry_run": False, "skipped_demo": skipped_demo, **counts}


def main():
    parser = argparse.ArgumentParser(description="Preview new 95+ rental alerts, or send with --send")
    parser.add_argument("--batch", default=str(Path(__file__).with_name("sample_batch.json")))
    parser.add_argument("--score", type=int, choices=range(95, 101), default=DEFAULT_THRESHOLD)
    parser.add_argument("--chat", help="Override the city-channel destination")
    parser.add_argument("--users-db", default=str(USERS_DB_FILE))
    parser.add_argument("--state-db", default=str(DEFAULT_STATE_DB))
    parser.add_argument("--skip-channels", action="store_true")
    parser.add_argument("--skip-users", action="store_true")
    parser.add_argument("--send", action="store_true", help="Send non-demo deals; default only prints previews")
    args = parser.parse_args()
    result = process_batch(args.batch, args.score, args.chat, not args.skip_channels, not args.skip_users,
                           args.users_db, dry_run=not args.send, state_db=args.state_db)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    if not result["ok"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
