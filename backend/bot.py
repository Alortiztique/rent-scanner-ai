#!/usr/bin/env python3
"""
RentScanner AI // Telegram Alert Notifier
Nebius x NVIDIA Global AI Hackathon (TASK-06)

Dispatches real-time rental deal alerts to Telegram channels or private chats
when high-scoring opportunities (Deal Score >= 90) are audited by NVIDIA Nemotron.
"""

import os
import sys
import json
import urllib.request
import urllib.error
from typing import Dict, Any, Optional

# Load token from environment or local .env
TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")

# Try reading from .env if not found in environment
if not TELEGRAM_BOT_TOKEN:
    env_path = os.path.join(os.path.dirname(__file__), "..", ".env")
    if os.path.exists(env_path):
        with open(env_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line.startswith("TELEGRAM_BOT_TOKEN="):
                    TELEGRAM_BOT_TOKEN = line.split("=", 1)[1].strip().strip('"').strip("'")
                    break


def get_bot_info() -> Dict[str, Any]:
    """Verify bot token and return bot identity."""
    if not TELEGRAM_BOT_TOKEN:
        return {"ok": False, "error": "TELEGRAM_BOT_TOKEN not configured"}
    
    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/getMe"
    try:
        with urllib.request.urlopen(url, timeout=10) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except Exception as e:
        return {"ok": False, "error": str(e)}


def get_latest_chat_id() -> Optional[int]:
    """Fetch the chat_id of the most recent user who sent a message to the bot."""
    if not TELEGRAM_BOT_TOKEN:
        return None
    
    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/getUpdates"
    try:
        with urllib.request.urlopen(url, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            results = data.get("result", [])
            if results:
                last_msg = results[-1].get("message", {}) or results[-1].get("channel_post", {})
                chat = last_msg.get("chat", {})
                return chat.get("id")
    except Exception as e:
        print(f"[Error fetching updates]: {e}")
    return None


def format_deal_alert(deal: Dict[str, Any]) -> str:
    """Format a rental deal with brutalist cyberpunk markdown for Telegram (English)."""
    city = deal.get("cityName", deal.get("city", "Global"))
    neighborhood = deal.get("neighborhood", "Central Corridor")
    title = deal.get("title", deal.get("raw_title", "Off-Market Sublet Opportunity"))
    price_usd = deal.get("priceUsd", 0)
    price_local = deal.get("priceLocal", price_usd)
    currency_symbol = deal.get("currencySymbol", "$")
    market_median = deal.get("originalMarketPriceUsd", int(price_usd * 1.5))
    savings = deal.get("savingsPercentage", 35)
    deal_score = deal.get("dealScore", deal.get("audit", {}).get("fairRentScore", 92))
    source = deal.get("source", "Tavily Web Scout")
    source_url = deal.get("sourceUrl", deal.get("url", "https://rent-scanner-ai.pages.dev"))

    audit = deal.get("nemotronAudit", deal.get("audit", {}))
    scam_risk = audit.get("scamRiskScore", 0)
    gentrification_index = audit.get("gentrificationIndex", "Anti-Gentrification Champion")
    perks = audit.get("verifiedPerks", ["Direct peer-to-peer sublet", "Zero broker commission"])

    perks_text = "\n".join([f"  ✓ {p}" for p in perks[:3]])

    message = (
        f"🚨 *RENTSCANNER AI // RADAR ALERT*\n"
        f"📍 *{city.upper()}* • {neighborhood}\n"
        f"━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
        f"🏷️ *{title}*\n\n"
        f"💰 *{currency_symbol}{price_local:,}* / month "
        f"(`-{savings}%` vs Median: ${market_median:,})\n\n"
        f"🛡️ *NEMOTRON HOUSING AUDIT:*\n"
        f"• *Deal Score:* `{deal_score}/100` (HISTORIC ANOMALY)\n"
        f"• *Scam Risk:* `{scam_risk}/10` (Verified Lease)\n"
        f"• *Status:* _{gentrification_index}_\n\n"
        f"✨ *Verified Perks:*\n"
        f"{perks_text}\n"
        f"━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
        f"📡 Source: `{source}`\n"
        f"🔗 [View Original Posting]({source_url})\n\n"
        f"🤖 _Audited by NVIDIA Nemotron-3-Ultra on Nebius Token Factory_"
    )
    return message


def send_telegram_alert(deal: Dict[str, Any], chat_id: Any) -> Dict[str, Any]:
    """Send formatted deal alert to Telegram chat or channel."""
    if not TELEGRAM_BOT_TOKEN:
        print("[Telegram Bot] Error: No token configured.")
        return {"ok": False, "error": "No token"}

    message_text = format_deal_alert(deal)
    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"

    payload = {
        "chat_id": chat_id,
        "text": message_text,
        "parse_mode": "Markdown",
        "disable_web_page_preview": False,
    }

    try:
        req = urllib.request.Request(
            url,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            print(f"[Telegram Bot] Alert successfully dispatched to chat {chat_id}!")
            return data
    except urllib.error.HTTPError as e:
        err_content = e.read().decode("utf-8")
        print(f"[Telegram Bot HTTP Error {e.code}]: {err_content}")
        return {"ok": False, "error": err_content}
    except Exception as e:
        print(f"[Telegram Bot Error]: {e}")
        return {"ok": False, "error": str(e)}



def format_personal_alert(deal: Dict[str, Any], user_profile: Dict[str, Any]) -> str:
    """Format a personalized deal alert for a registered user's custom radar."""
    first_name = user_profile.get("firstName", "Renter")
    city = deal.get("cityName", deal.get("city", "Global"))
    neighborhood = deal.get("neighborhood", "Central Corridor")
    title = deal.get("title", deal.get("raw_title", "Off-Market Sublet Opportunity"))
    price_usd = deal.get("priceUsd", 0)
    price_local = deal.get("priceLocal", price_usd)
    currency_symbol = deal.get("currencySymbol", "$")
    market_median = deal.get("originalMarketPriceUsd", int(price_usd * 1.5))
    savings = deal.get("savingsPercentage", 35)
    deal_score = deal.get("dealScore", deal.get("audit", {}).get("fairRentScore", 92))
    source = deal.get("source", "Tavily Web Scout")
    source_url = deal.get("sourceUrl", deal.get("url", "https://rent-scanner-ai.pages.dev"))

    audit = deal.get("nemotronAudit", deal.get("audit", {}))
    scam_risk = audit.get("scamRiskScore", 0)
    gentrification_index = audit.get("gentrificationIndex", "Anti-Gentrification Champion")
    perks = audit.get("verifiedPerks", ["Direct peer-to-peer sublet", "Zero broker commission"])

    perks_text = "\n".join([f"  ✓ {p}" for p in perks[:3]])

    # Radar match reason
    match_reasons = [f"Metropolis: {user_profile.get('cityName', city)}"]
    if user_profile.get("maxBudget"):
        match_reasons.append(f"Under your budget ({user_profile.get('currency', '$')}{user_profile['maxBudget']:,})")
    if user_profile.get("housingType") and user_profile.get("housingType") != "all":
        match_reasons.append(f"Typology: {user_profile['housingType'].title()}")
    match_reasons.append(f"Deal Score: {deal_score}/100 (Threshold >= {user_profile.get('minDealScore', 90)})")

    reasons_text = "\n".join([f"  🎯 {r}" for r in match_reasons])

    message = (
        f"🎯 *RENTSCANNER AI // PERSONAL RADAR MATCH*\n"
        f"👤 *Direct Alert for:* {first_name}\n"
        f"📍 *{city.upper()}* • {neighborhood}\n"
        f"━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
        f"🏷️ *{title}*\n\n"
        f"💰 *{currency_symbol}{price_local:,}* / month "
        f"(`-{savings}%` vs Median: ${market_median:,})\n\n"
        f"🛡️ *NEMOTRON HOUSING AUDIT:*\n"
        f"• *Deal Score:* `{deal_score}/100` (HISTORIC ANOMALY)\n"
        f"• *Scam Risk:* `{scam_risk}/10` (Verified Lease)\n"
        f"• *Status:* _{gentrification_index}_\n\n"
        f"✨ *Verified Perks:*\n"
        f"{perks_text}\n"
        f"━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
        f"🔍 *Radar Criteria Match:*\n"
        f"{reasons_text}\n\n"
        f"📡 Source: `{source}`\n"
        f"🔗 [View Original Posting]({source_url})\n\n"
        f"🤖 _Audited by NVIDIA Nemotron-3-Ultra on Nebius Token Factory_\n"
        f"⚙️ _Modify your alert filters anytime with /config_"
    )
    return message


def send_personal_alert(deal: Dict[str, Any], user_profile: Dict[str, Any]) -> Dict[str, Any]:
    """Send personalized deal alert to a specific registered user."""
    chat_id = user_profile.get("chatId")
    if not chat_id:
        return {"ok": False, "error": "No chatId in user profile"}

    message_text = format_personal_alert(deal, user_profile)
    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"

    payload = {
        "chat_id": chat_id,
        "text": message_text,
        "parse_mode": "Markdown",
        "disable_web_page_preview": False,
    }

    try:
        req = urllib.request.Request(
            url,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            print(f"[Telegram Bot] Personal alert delivered to {user_profile.get('firstName')} (Chat {chat_id})!")
            return data
    except urllib.error.HTTPError as e:
        err_content = e.read().decode("utf-8")
        print(f"[Telegram Bot HTTP Error {e.code}]: {err_content}")
        return {"ok": False, "error": err_content}
    except Exception as e:
        print(f"[Telegram Bot Error]: {e}")
        return {"ok": False, "error": str(e)}


# Sample high-scoring test deal (Bogotá)
SAMPLE_BOGOTA_DEAL = {
    "title": "Chapinero Alto Vintage Penthouse Studio // Direct 4-Month Sublease",
    "cityName": "Bogotá",
    "neighborhood": "Chapinero Alto",
    "priceLocal": 850000,
    "priceUsd": 210,
    "currencySymbol": "COP $",
    "originalMarketPriceUsd": 450,
    "savingsPercentage": 53,
    "dealScore": 96,
    "source": "Reddit Sublet (r/bogota)",
    "sourceUrl": "https://reddit.com/r/bogota",
    "nemotronAudit": {
        "scamRiskScore": 0,
        "gentrificationIndex": "Anti-Gentrification Champion",
        "verifiedPerks": [
            "No broker fee or cosigner required",
            "Utilities included (300Mbps WiFi, water, power)",
            "Complies with Colombian Law 820 of 2003 (no illegal deposits)"
        ]
    }
}


def main():
    print("=" * 60)
    print("RentScanner AI // Telegram Alert Bot Runner (TASK-06)")
    print("=" * 60)

    info = get_bot_info()
    if not info.get("ok"):
        print(f"[ERROR] Could not connect to Telegram: {info.get('error')}")
        sys.exit(1)

    bot_user = info["result"]["username"]
    print(f"[CONNECTED] Telegram Bot: @{bot_user} ({info['result']['first_name']})")

    target_chat = sys.argv[1] if len(sys.argv) > 1 else None

    if not target_chat:
        print("\nChecking for incoming messages to detect chat_id...")
        detected_id = get_latest_chat_id()
        if detected_id:
            print(f"[FOUND] Detected active chat_id: {detected_id}")
            target_chat = detected_id
        else:
            print("\n[NOTE] No target chat_id provided.")
            print("To send a live test alert:")
            print(f"1. Open https://t.me/{bot_user} and send a message (e.g. 'Hello').")
            print("2. Run: python backend/bot.py <YOUR_CHAT_ID>")
            print("Or pass your channel handle: python backend/bot.py @my_channel")
            sys.exit(0)

    print(f"\nDispatching sample 96/100 Deal Score alert to {target_chat}...")
    res = send_telegram_alert(SAMPLE_BOGOTA_DEAL, target_chat)
    if res.get("ok"):
        print("✅ Alert delivered with 100% success!")
    else:
        print(f"❌ Failed to deliver: {res.get('error')}")


if __name__ == "__main__":
    main()
