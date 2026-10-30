"""Telegram transport and plain-text messages. Credentials never reach the browser."""
import argparse
import json
import os
from pathlib import Path
import urllib.error
import urllib.request

from alert_model import normalize_deal, number


def _bot_token():
    token = os.getenv("TELEGRAM_BOT_TOKEN", "")
    if not token:
        path = Path(__file__).resolve().parent.parent / ".env"
        if path.exists():
            for line in path.read_text(encoding="utf-8").splitlines():
                if line.strip().startswith("TELEGRAM_BOT_TOKEN="):
                    token = line.strip().split("=", 1)[1].strip().strip('\"\'')
                    break
    return token


def send_api_request(endpoint, payload, timeout=15):
    if endpoint not in {"sendMessage", "getMe", "getUpdates", "answerCallbackQuery"}:
        raise ValueError("Unsupported Telegram method")
    try:
        token = _bot_token()
        if not token:
            return {"ok": False, "error": "TELEGRAM_BOT_TOKEN is not configured"}
        request = urllib.request.Request(
            f"https://api.telegram.org/bot{token}/{endpoint}",
            data=json.dumps(payload, allow_nan=False).encode("utf-8"),
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(request, timeout=timeout) as response:
            result = json.loads(response.read().decode("utf-8"))
        if not isinstance(result, dict) or result.get("ok") is not True:
            return {"ok": False, "error": "Telegram rejected the request"}
        return result
    except urllib.error.HTTPError as error:
        return {"ok": False, "error": f"Telegram returned HTTP {error.code}"}
    except (OSError, ValueError):
        # Exception strings can contain a URL with the bot token. Never log or return them.
        return {"ok": False, "error": "Telegram request failed"}


def format_deal_alert(raw):
    deal = normalize_deal(raw)
    if deal is None:
        raise ValueError("The alert needs a supported city, source link and numeric score")
    audit = deal["audit"]
    lines = ["RENTSCANNER // DEMO ALERT" if deal["demo"] else "RENTSCANNER // RENTAL ALERT"]
    if deal["demo"]:
        lines.append("Sample data. Not a live listing or a verified lease.")
    lines.extend([deal["cityName"], str(deal["title"])[:200]])
    if deal["priceLocal"] is not None and deal["currency"]:
        lines.append(f"Monthly asking rent: {deal['priceLocal']:,.2f} {deal['currency']}")
    elif deal["priceUsd"] is not None:
        lines.append(f"Monthly asking rent: {deal['priceUsd']:,.2f} USD")
    else:
        lines.append("Asking rent: unavailable")
        estimate = audit.get("estimatedPriceUsd")
        if number(estimate):
            lines.append(f"Model estimate: {estimate:,.2f} USD per month, not a confirmed asking rent")
    lines.append(f"Provided deal score: {deal['dealScore']}/100")
    risk = audit.get("scamRiskScore")
    if number(risk, maximum=10):
        lines.append(f"Model scam-risk assessment: {risk}/10, not verification")
    lines.append("Audit summary: " + (deal["summary"][:600] if deal["summary"] else "Not supplied"))
    if deal["model"]:
        lines.append("Reported model: " + deal["model"][:100])
    lines.extend(["Source: " + deal["sourceUrl"], "Confirm price, availability and lease terms with the source."])
    return "\n".join(lines)


def format_personal_alert(deal, user_profile):
    name = str(user_profile.get("firstName", "Renter"))[:80]
    return f"Personal radar for {name}\n{format_deal_alert(deal)}\nChange filters with /config or stop alerts with /stop."


def send_telegram_alert(deal, chat_id):
    return send_api_request("sendMessage", {"chat_id": chat_id, "text": format_deal_alert(deal)})


def send_personal_alert(deal, user_profile):
    chat_id = user_profile.get("chatId")
    if type(chat_id) is not int or chat_id <= 0:
        return {"ok": False, "error": "A private chat ID is required"}
    return send_api_request("sendMessage", {"chat_id": chat_id, "text": format_personal_alert(deal, user_profile)})


SAMPLE_BOGOTA_DEAL = {
    "demo": True, "cityId": "bogota", "cityName": "Bogotá", "type": "studio",
    "title": "Sample Chapinero studio sublease", "priceLocal": 850000, "priceUsd": 210,
    "currency": "COP", "dealScore": 96, "sourceUrl": "https://example.com/sample-bogota-sublease",
    "audit": {"summary": "Sample audit for a direct sublease. Verify the source before paying.", "modelUsed": "sample"},
}


def main():
    parser = argparse.ArgumentParser(description="Preview a sample Telegram alert")
    parser.add_argument("chat", nargs="?", help="Explicit destination for --send")
    parser.add_argument("--send", action="store_true", help="Send the labelled sample to that destination")
    args = parser.parse_args()
    if not args.send:
        print(format_deal_alert(SAMPLE_BOGOTA_DEAL))
        return
    if not args.chat:
        parser.error("--send requires an explicit destination")
    result = send_telegram_alert(SAMPLE_BOGOTA_DEAL, args.chat)
    if result.get("ok") is not True:
        raise SystemExit(result.get("error", "Delivery failed"))
    print("Sample sent.")


if __name__ == "__main__":
    main()
