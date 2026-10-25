#!/usr/bin/env python3
"""
RentScanner AI // Interactive Telegram Bot Listener (TASK-06)
Nebius x NVIDIA Global AI Hackathon

Manages 1-on-1 conversations with renters in Telegram.
Guides renters through the Skyscanner-style filter wizard with inline buttons,
and saves personalized alert preferences to users_db.json.
"""

import os
import sys
import json
import time
import urllib.request
import urllib.error
from typing import Dict, Any, Optional

# Load Token
TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")
if not TELEGRAM_BOT_TOKEN:
    env_path = os.path.join(os.path.dirname(__file__), "..", ".env")
    if os.path.exists(env_path):
        with open(env_path, "r", encoding="utf-8") as f:
            for line in f:
                if line.startswith("TELEGRAM_BOT_TOKEN="):
                    TELEGRAM_BOT_TOKEN = line.split("=", 1)[1].strip().strip('"').strip("'")
                    break

USERS_DB_FILE = os.path.join(os.path.dirname(__file__), "users_db.json")

# In-memory session tracking for onboarding steps
USER_SESSIONS: Dict[int, Dict[str, Any]] = {}

CITIES_INFO = {
    "bogota": {"name": "Bogotá", "currency": "COP $", "presets": [800000, 1200000, 1800000, 2500000]},
    "nyc": {"name": "New York City", "currency": "$", "presets": [900, 1400, 2000, 3000]},
    "london": {"name": "London", "currency": "£", "presets": [650, 950, 1400, 2200]},
    "tokyo": {"name": "Tokyo", "currency": "¥", "presets": [60000, 90000, 130000, 180000]},
    "paris": {"name": "Paris", "currency": "€", "presets": [600, 900, 1300, 1800]},
    "berlin": {"name": "Berlin", "currency": "€", "presets": [500, 800, 1200, 1600]},
    "dubai": {"name": "Dubai", "currency": "AED ", "presets": [2500, 4500, 7000, 10000]},
    "sf": {"name": "San Francisco", "currency": "$", "presets": [1000, 1600, 2400, 3200]},
    "all": {"name": "All Metropolises (Global Radar)", "currency": "$", "presets": [500, 1000, 1500, 2500]},
}


def load_users_db() -> Dict[str, Any]:
    """Load user preferences from JSON database."""
    if os.path.exists(USERS_DB_FILE):
        try:
            with open(USERS_DB_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return {}
    return {}


def save_user_profile(chat_id: int, profile: Dict[str, Any]) -> None:
    """Save user radar profile to JSON database."""
    db = load_users_db()
    db[str(chat_id)] = profile
    with open(USERS_DB_FILE, "w", encoding="utf-8") as f:
        json.dump(db, f, indent=2, ensure_ascii=False)


def send_api_request(endpoint: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    """Send request to Telegram Bot API."""
    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/{endpoint}"
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except Exception as e:
        print(f"[Telegram API Error]: {e}")
        return {"ok": False, "error": str(e)}


def answer_callback(callback_query_id: str) -> None:
    """Acknowledge Telegram callback query to stop loading spinner."""
    send_api_request("answerCallbackQuery", {"callback_query_id": callback_query_id})


# --- WIZARD STEPS ---

def step_1_ask_city(chat_id: int, user_first_name: str) -> None:
    """Step 1: Ask target city."""
    USER_SESSIONS[chat_id] = {"step": "CITY"}
    
    keyboard = [
        [{"text": "🇨🇴 Bogotá", "callback_data": "city:bogota"}, {"text": "🇺🇸 New York City", "callback_data": "city:nyc"}],
        [{"text": "🇬🇧 London", "callback_data": "city:london"}, {"text": "🇯🇵 Tokyo", "callback_data": "city:tokyo"}],
        [{"text": "🇫🇷 Paris", "callback_data": "city:paris"}, {"text": "🇩🇪 Berlin", "callback_data": "city:berlin"}],
        [{"text": "🇦🇪 Dubai", "callback_data": "city:dubai"}, {"text": "🇺🇸 San Francisco", "callback_data": "city:sf"}],
        [{"text": "🌐 All Metropolises (Global Radar)", "callback_data": "city:all"}],
    ]
    
    text = (
        f"👋 *Welcome {user_first_name} to RentScanner AI!*\n"
        f"The open-source radar against runaway gentrification & predatory broker cartels.\n\n"
        f"🎯 *STEP 1 / 5: Target Metropolis*\n"
        f"Select the metropolis you want us to scan for off-market sublease deals:"
    )
    send_api_request("sendMessage", {"chat_id": chat_id, "text": text, "parse_mode": "Markdown", "reply_markup": {"inline_keyboard": keyboard}})


def step_2_ask_type(chat_id: int) -> None:
    """Step 2: Ask housing typology."""
    USER_SESSIONS[chat_id]["step"] = "TYPE"
    city_name = USER_SESSIONS[chat_id].get("cityName", "your city")

    keyboard = [
        [{"text": "🛏️ Room / Flatshare", "callback_data": "type:room"}],
        [{"text": "🏢 Studio / Efficiency", "callback_data": "type:studio"}],
        [{"text": "🏠 Entire Apartment", "callback_data": "type:entire_apartment"}],
        [{"text": "📜 Direct Sublease", "callback_data": "type:sublease"}],
        [{"text": "⚡ Any Typology (No Preference)", "callback_data": "type:all"}],
    ]

    text = (
        f"📍 Selected Metropolis: *{city_name}*\n\n"
        f"🏠 *STEP 2 / 5: Housing Typology*\n"
        f"What kind of living arrangement are you seeking?"
    )
    send_api_request("sendMessage", {"chat_id": chat_id, "text": text, "parse_mode": "Markdown", "reply_markup": {"inline_keyboard": keyboard}})


def step_3_ask_budget(chat_id: int) -> None:
    """Step 3: Ask max budget."""
    USER_SESSIONS[chat_id]["step"] = "BUDGET"
    city_id = USER_SESSIONS[chat_id].get("cityId", "bogota")
    city_info = CITIES_INFO.get(city_id, CITIES_INFO["all"])
    currency = city_info["currency"]
    presets = city_info["presets"]

    keyboard = [
        [
            {"text": f"{currency}{presets[0]:,}", "callback_data": f"budget:{presets[0]}"},
            {"text": f"{currency}{presets[1]:,}", "callback_data": f"budget:{presets[1]}"},
        ],
        [
            {"text": f"{currency}{presets[2]:,}", "callback_data": f"budget:{presets[2]}"},
            {"text": f"{currency}{presets[3]:,}", "callback_data": f"budget:{presets[3]}"},
        ],
        [{"text": "♾️ No Budget Limit (Any Price)", "callback_data": "budget:any"}],
    ]

    text = (
        f"💰 *STEP 3 / 5: Maximum Monthly Budget*\n"
        f"Select a quick preset or *type your exact number in chat* (e.g. `{presets[1]}`):"
    )
    send_api_request("sendMessage", {"chat_id": chat_id, "text": text, "parse_mode": "Markdown", "reply_markup": {"inline_keyboard": keyboard}})


def step_4_ask_broker_fee(chat_id: int) -> None:
    """Step 4: Ask broker fee preference."""
    USER_SESSIONS[chat_id]["step"] = "BROKER"

    keyboard = [
        [{"text": "🚫 Yes, 0% Broker Fee Mandatory", "callback_data": "broker:yes"}],
        [{"text": "⚡ No Preference (Allow broker listings)", "callback_data": "broker:any"}],
    ]

    text = (
        f"🛡️ *STEP 4 / 5: Zero Broker Fee Protection*\n"
        f"Require direct peer-to-peer sublet arrangements (bypassing 15% broker commissions)?"
    )
    send_api_request("sendMessage", {"chat_id": chat_id, "text": text, "parse_mode": "Markdown", "reply_markup": {"inline_keyboard": keyboard}})


def step_5_ask_bills(chat_id: int) -> None:
    """Step 5: Ask utilities included preference."""
    USER_SESSIONS[chat_id]["step"] = "BILLS"

    keyboard = [
        [{"text": "💡 Yes, Utilities Included Mandatory", "callback_data": "bills:yes"}],
        [{"text": "⚡ No Preference (Pay bills separately)", "callback_data": "bills:any"}],
    ]

    text = (
        f"💡 *STEP 5 / 5: Utilities & High-Speed WiFi*\n"
        f"Require utilities (electricity, water, gas, internet) bundled into the flat monthly rent?"
    )
    send_api_request("sendMessage", {"chat_id": chat_id, "text": text, "parse_mode": "Markdown", "reply_markup": {"inline_keyboard": keyboard}})


def finish_wizard(chat_id: int, user_info: Dict[str, Any]) -> None:
    """Step 6: Confirm and activate personal radar."""
    session = USER_SESSIONS.get(chat_id, {})
    
    city_id = session.get("cityId", "bogota")
    city_name = session.get("cityName", "Bogotá")
    housing_type = session.get("type", "all")
    max_budget = session.get("maxBudget")
    no_broker = session.get("noBrokerFee", False)
    bills_included = session.get("billsIncluded", False)
    currency = CITIES_INFO.get(city_id, {}).get("currency", "$")

    type_labels = {
        "room": "🛏️ Room / Flatshare",
        "studio": "🏢 Studio / Efficiency",
        "entire_apartment": "🏠 Entire Apartment",
        "sublease": "📜 Direct Sublease",
        "all": "⚡ Any Typology (No Preference)",
    }

    budget_str = f"{currency}{max_budget:,} / month" if max_budget else "♾️ No Limit"
    broker_str = "✅ Yes (0% Broker Fee)" if no_broker else "⚡ No Preference"
    bills_str = "✅ Yes (Utilities Included)" if bills_included else "⚡ No Preference"

    # Save to users_db.json
    profile = {
        "chatId": chat_id,
        "username": user_info.get("username", "Renter"),
        "firstName": user_info.get("first_name", "User"),
        "cityId": city_id,
        "cityName": city_name,
        "housingType": housing_type,
        "maxBudget": max_budget,
        "currency": currency,
        "noBrokerFeeOnly": no_broker,
        "utilitiesIncludedOnly": bills_included,
        "sortBy": "dealScore",
        "minDealScore": 90,
        "active": True,
        "configuredAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    save_user_profile(chat_id, profile)

    confirmation_text = (
        f"🎯 *PERSONAL RADAR ARMED & ACTIVATED!*\n"
        f"━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
        f"📍 *Metropolis:* {city_name}\n"
        f"🏠 *Housing:* {type_labels.get(housing_type, housing_type)}\n"
        f"💰 *Max Budget:* {budget_str}\n"
        f"🚫 *0% Broker Fee:* {broker_str}\n"
        f"💡 *Bills Included:* {bills_str}\n"
        f"⚡ *Ranking Order:* `NVIDIA Nemotron Deal Score` (>= 90/100)\n"
        f"━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n"
        f"🤖 *Radar Status:* `ACTIVE MONITORING`\n"
        f"Every 30 minutes, when NVIDIA Nemotron audits fresh listings in {city_name}, "
        f"if a verified deal exceeds Deal Score 90/100 and matches your radar, **you will receive an immediate private alert right here**.\n\n"
        f"💡 _Useful Commands:_\n"
        f"• `/radar` or `/status`: View your active configuration\n"
        f"• `/config`: Change your filters anytime\n"
        f"• `/test`: Receive an instant sample alert"
    )

    send_api_request("sendMessage", {"chat_id": chat_id, "text": confirmation_text, "parse_mode": "Markdown"})
    USER_SESSIONS.pop(chat_id, None)


# --- DISPATCHERS & HANDLERS ---

def handle_callback_query(cq: Dict[str, Any]) -> None:
    """Handle inline button clicks."""
    cq_id = cq["id"]
    from_user = cq["from"]
    chat_id = from_user["id"]
    data = cq.get("data", "")

    answer_callback(cq_id)

    if chat_id not in USER_SESSIONS:
        USER_SESSIONS[chat_id] = {}

    session = USER_SESSIONS[chat_id]

    if data.startswith("city:"):
        city_id = data.split(":", 1)[1]
        session["cityId"] = city_id
        session["cityName"] = CITIES_INFO.get(city_id, {}).get("name", "Global")
        step_2_ask_type(chat_id)

    elif data.startswith("type:"):
        housing_type = data.split(":", 1)[1]
        session["type"] = housing_type
        step_3_ask_budget(chat_id)

    elif data.startswith("budget:"):
        budget_val = data.split(":", 1)[1]
        session["maxBudget"] = int(budget_val) if budget_val != "any" else None
        step_4_ask_broker_fee(chat_id)

    elif data.startswith("broker:"):
        broker_val = data.split(":", 1)[1]
        session["noBrokerFee"] = (broker_val == "yes")
        step_5_ask_bills(chat_id)

    elif data.startswith("bills:"):
        bills_val = data.split(":", 1)[1]
        session["billsIncluded"] = (bills_val == "yes")
        finish_wizard(chat_id, from_user)


def handle_text_message(msg: Dict[str, Any]) -> None:
    """Handle text message from user."""
    chat_id = msg["chat"]["id"]
    from_user = msg.get("from", {})
    text = msg.get("text", "").strip()

    # Commands
    if text.startswith("/start") or text.startswith("/config"):
        step_1_ask_city(chat_id, from_user.get("first_name", "Friend"))
        return

    if text.startswith("/radar") or text.startswith("/status"):
        db = load_users_db()
        user_prof = db.get(str(chat_id))
        if user_prof:
            send_api_request("sendMessage", {
                "chat_id": chat_id,
                "text": (
                    f"📡 *YOUR ACTIVE RADAR:*\n"
                    f"• Metropolis: *{user_prof.get('cityName')}*\n"
                    f"• Type: *{user_prof.get('housingType')}*\n"
                    f"• Budget: *{user_prof.get('currency')}{user_prof.get('maxBudget', 'No limit')}*\n"
                    f"• 0% Broker Fee: *{user_prof.get('noBrokerFeeOnly')}*\n"
                    f"• Bills Included: *{user_prof.get('utilitiesIncludedOnly')}*\n"
                    f"• Min Deal Score: *{user_prof.get('minDealScore')}/100*\n\n"
                    f"Type `/config` if you want to modify your filters."
                ),
                "parse_mode": "Markdown",
            })
        else:
            send_api_request("sendMessage", {
                "chat_id": chat_id,
                "text": "You do not have an active radar yet. Type `/start` to configure it in 1 minute.",
            })
        return

    if text.startswith("/test"):
        from bot import send_telegram_alert, SAMPLE_BOGOTA_DEAL
        send_api_request("sendMessage", {
            "chat_id": chat_id,
            "text": "⚡ Dispatching instant sample alert to your chat...",
        })
        send_telegram_alert(SAMPLE_BOGOTA_DEAL, chat_id)
        return

    # If user is in the BUDGET step and typed a numeric amount
    session = USER_SESSIONS.get(chat_id)
    if session and session.get("step") == "BUDGET":
        digits = "".join([c for c in text if c.isdigit()])
        if digits:
            session["maxBudget"] = int(digits)
            step_4_ask_broker_fee(chat_id)
            return

    # Fallback default response
    send_api_request("sendMessage", {
        "chat_id": chat_id,
        "text": (
            "🤖 *RentScanner AI Assistant*\n"
            "Type `/start` to configure your personal sublease radar or `/radar` to inspect your active filters."
        ),
        "parse_mode": "Markdown",
    })


def run_polling():
    """Main long polling loop."""
    print("=" * 60)
    print("RentScanner AI // Telegram Interactive Bot Listener")
    print(f"Token: {TELEGRAM_BOT_TOKEN[:10]}...")
    print("Listening for user interactions in real time...")
    print("=" * 60)

    last_offset = 0

    while True:
        try:
            url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/getUpdates?offset={last_offset}&timeout=20"
            req = urllib.request.Request(url)
            with urllib.request.urlopen(req, timeout=25) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                updates = data.get("result", [])

                for update in updates:
                    last_offset = update["update_id"] + 1

                    if "callback_query" in update:
                        handle_callback_query(update["callback_query"])
                    elif "message" in update:
                        handle_text_message(update["message"])

        except urllib.error.URLError:
            time.sleep(3)
        except Exception as e:
            print(f"[Polling loop error]: {e}")
            time.sleep(2)


if __name__ == "__main__":
    run_polling()
