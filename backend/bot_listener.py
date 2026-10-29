"""Private-chat onboarding. Run one listener for each subscriber file."""
import json
import math
import os
from pathlib import Path
import re
import tempfile
import threading
import time

from alert_model import CITIES_INFO, DEFAULT_THRESHOLD, HOUSING_TYPES, number
from bot import SAMPLE_BOGOTA_DEAL, send_api_request, send_telegram_alert

USERS_DB_FILE = Path(__file__).with_name("users_db.json")
USER_SESSIONS = {}
# ponytail: one listener owns this JSON file; use SQLite profiles if multiple writer processes are needed.
PROFILE_LOCK = threading.Lock()
TYPE_LABELS = {"room": "Room", "studio": "Studio", "entire_apartment": "Entire apartment", "sublease": "Sublease", "all": "Any housing type"}


def load_users_db(path=None):
    path = Path(path or USERS_DB_FILE)
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {}
    if not isinstance(data, dict) or any(not isinstance(profile, dict) for profile in data.values()):
        raise ValueError("Invalid subscriber database; preserve it and repair it before saving")
    return data


def save_user_profile(chat_id, profile, path=None):
    """Serialize this listener's writes, then atomically replace the file for batch readers."""
    path = Path(path or USERS_DB_FILE)
    with PROFILE_LOCK:
        data = load_users_db(path)  # Unreadable data must never become an empty database.
        data[str(chat_id)] = profile
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent, prefix="users_db.", suffix=".tmp", delete=False) as file:
                temporary = Path(file.name)
                json.dump(data, file, ensure_ascii=False, indent=2, allow_nan=False)
                file.flush()
                os.fsync(file.fileno())
            temporary.replace(path)
        finally:
            if temporary is not None:
                temporary.unlink(missing_ok=True)


def parse_budget(text):
    if not isinstance(text, str) or not re.fullmatch(r"[0-9]+(?:\.[0-9]{1,2})?", text.strip()):
        return None
    value = float(text.strip())
    return value if math.isfinite(value) else None


def _message(chat_id, text, keyboard=None):
    payload = {"chat_id": chat_id, "text": text}
    if keyboard is not None:
        payload["reply_markup"] = {"inline_keyboard": [[{"text": label, "callback_data": value}] for label, value in keyboard]}
    result = send_api_request("sendMessage", payload)
    session = USER_SESSIONS.get(chat_id)
    if session is not None:
        session["messageId"] = result.get("result", {}).get("message_id")
    return result


def _ask(chat_id, step):
    session = USER_SESSIONS[chat_id]
    session["step"] = step
    if step == "CITY":
        text = "Step 1/5: Choose your city. All-cities budgets use USD."
        choices = [(info["name"], f"city:{key}") for key, info in CITIES_INFO.items()]
    elif step == "TYPE":
        text = "Step 2/5: Choose a housing type. Unknown listing types will not match a specific preference."
        choices = [(label, f"type:{key}") for key, label in TYPE_LABELS.items()]
    elif step == "BUDGET":
        info = CITIES_INFO[session["cityId"]]
        text = f"Step 3/5: Maximum monthly rent in {info['code']}. Choose a preset or type a number such as 1000.50, without separators."
        choices = [(f"{value:,} {info['code']}", f"budget:{value}") for value in info["presets"]] + [("No limit", "budget:any")]
    elif step == "BROKER":
        text = "Step 4/5: Require no broker fee? Listings with unknown fee status will not match this requirement."
        choices = [("No broker fee required", "broker:yes"), ("No preference", "broker:any")]
    else:
        text = "Step 5/5: Require utilities included? Listings with unknown utilities status will not match this requirement."
        choices = [("Utilities included required", "bills:yes"), ("No preference", "bills:any")]
    _message(chat_id, text, choices)


def finish_wizard(chat_id, user_info):
    session = USER_SESSIONS[chat_id]
    info = CITIES_INFO[session["cityId"]]
    profile = {
        "chatId": chat_id, "firstName": str(user_info.get("first_name", "Renter"))[:80],
        "cityId": session["cityId"], "cityName": info["name"], "currency": info["currency"], "currencyCode": info["code"],
        "housingType": session["type"], "maxBudget": session["maxBudget"],
        "noBrokerFeeOnly": session["noBrokerFee"], "utilitiesIncludedOnly": session["billsIncluded"],
        "minDealScore": DEFAULT_THRESHOLD, "active": True,
    }
    try:
        save_user_profile(chat_id, profile)
    except (OSError, ValueError):
        _message(chat_id, "Could not save your settings. Your previous subscription was preserved. Try /config later.")
    else:
        _message(chat_id, "Preferences saved for 95+ deals. Alerts are sent when the operator runs the batch dispatcher; no delivery schedule is guaranteed. Use /config to change settings or /stop to stop alerts.")
    USER_SESSIONS.pop(chat_id, None)


def handle_callback_query(query):
    chat = query.get("message", {}).get("chat", {})
    user = query.get("from", {})
    chat_id = chat.get("id")
    if chat.get("type") != "private" or type(chat_id) is not int or chat_id != user.get("id"):
        return
    session = USER_SESSIONS.get(chat_id)
    prefix, separator, value = str(query.get("data", "")).partition(":")
    expected = {"city": "CITY", "type": "TYPE", "budget": "BUDGET", "broker": "BROKER", "bills": "BILLS"}
    valid = session and separator and session.get("step") == expected.get(prefix) and session.get("messageId") is not None and session["messageId"] == query["message"].get("message_id")
    if valid:
        if prefix == "city":
            valid = value in CITIES_INFO
        elif prefix == "type":
            valid = value in HOUSING_TYPES
        elif prefix == "budget":
            valid = value == "any" or parse_budget(value) is not None
        else:
            valid = value in {"yes", "any"}
    send_api_request("answerCallbackQuery", {"callback_query_id": query.get("id"), "text": "" if valid else "This menu expired. Use /config to start again."})
    if not valid:
        return
    if prefix == "city":
        session["cityId"] = value
        _ask(chat_id, "TYPE")
    elif prefix == "type":
        session["type"] = value
        _ask(chat_id, "BUDGET")
    elif prefix == "budget":
        session["maxBudget"] = None if value == "any" else parse_budget(value)
        _ask(chat_id, "BROKER")
    elif prefix == "broker":
        session["noBrokerFee"] = value == "yes"
        _ask(chat_id, "BILLS")
    else:
        session["billsIncluded"] = value == "yes"
        finish_wizard(chat_id, user)


def handle_text_message(message):
    chat = message.get("chat", {})
    chat_id = chat.get("id")
    if chat.get("type") != "private" or type(chat_id) is not int or chat_id <= 0:
        return
    text = message.get("text", "").strip()
    command = text.split(maxsplit=1)[0].split("@", 1)[0] if text else ""
    if command in {"/start", "/config"}:
        USER_SESSIONS[chat_id] = {}
        _ask(chat_id, "CITY")
    elif command in {"/status", "/radar", "/stop"}:
        try:
            profile = load_users_db().get(str(chat_id))
            if command == "/stop":
                USER_SESSIONS.pop(chat_id, None)
                if profile:
                    save_user_profile(chat_id, {**profile, "active": False})
                _message(chat_id, "Alerts stopped. Use /start to subscribe again.")
            elif profile:
                status = "active" if profile.get("active") is True else "stopped"
                budget = profile.get("maxBudget")
                threshold = profile.get("minDealScore", DEFAULT_THRESHOLD)
                threshold = max(DEFAULT_THRESHOLD, threshold) if number(threshold, maximum=100) else "unavailable"
                _message(chat_id, (
                    f"Radar {status}. City: {profile.get('cityName')}. Housing: {profile.get('housingType')}.\n"
                    f"Budget: {'No limit' if budget is None else budget} {profile.get('currencyCode', profile.get('currency', ''))}.\n"
                    f"No broker fee required: {profile.get('noBrokerFeeOnly') is True}. "
                    f"Utilities included required: {profile.get('utilitiesIncludedOnly') is True}.\n"
                    f"Minimum score: {threshold}. Change with /config or stop with /stop."
                ))
            else:
                _message(chat_id, "No subscription found. Use /start to set one up.")
        except (OSError, ValueError):
            _message(chat_id, "Subscriber settings are unavailable. No stored settings were changed. Please try later.")
    elif command == "/test":
        send_telegram_alert(SAMPLE_BOGOTA_DEAL, chat_id)
    elif USER_SESSIONS.get(chat_id, {}).get("step") == "BUDGET":
        value = parse_budget(text)
        if value is None:
            _message(chat_id, "Enter 0 or more with up to two decimal places, for example 1000.50. Do not use separators.")
        else:
            USER_SESSIONS[chat_id]["maxBudget"] = value
            _ask(chat_id, "BROKER")
    else:
        _message(chat_id, "Use /start to subscribe, /status to view settings or /stop to stop alerts.")


def run_polling():
    if send_api_request("getMe", {}).get("ok") is not True:
        raise SystemExit("Telegram bot is unavailable. Check the server-side token.")
    offset = 0
    while True:
        response = send_api_request("getUpdates", {"offset": offset, "timeout": 20}, timeout=25)
        if response.get("ok") is not True:
            time.sleep(3)
            continue
        for update in response.get("result", []):
            try:
                if "callback_query" in update:
                    handle_callback_query(update["callback_query"])
                elif "message" in update:
                    handle_text_message(update["message"])
            except (OSError, ValueError, KeyError, TypeError):
                print("Could not process a bot update; no credentials or message contents logged.")
            offset = update["update_id"] + 1


if __name__ == "__main__":
    run_polling()
