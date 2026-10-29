"""Shared city identities and validation for the two existing batch formats."""
import math
import unicodedata
from urllib.parse import urlsplit, urlunsplit

DEFAULT_THRESHOLD = 95
CITIES_INFO = {
    "bogota": {"name": "Bogotá", "currency": "COP $", "code": "COP", "presets": [800000, 1200000, 1800000, 2500000]},
    "nyc": {"name": "New York City", "currency": "$", "code": "USD", "presets": [900, 1400, 2000, 3000]},
    "london": {"name": "London", "currency": "£", "code": "GBP", "presets": [650, 950, 1400, 2200]},
    "tokyo": {"name": "Tokyo", "currency": "¥", "code": "JPY", "presets": [60000, 90000, 130000, 180000]},
    "paris": {"name": "Paris", "currency": "€", "code": "EUR", "presets": [600, 900, 1300, 1800]},
    "berlin": {"name": "Berlin", "currency": "€", "code": "EUR", "presets": [500, 800, 1200, 1600]},
    "dubai": {"name": "Dubai", "currency": "AED ", "code": "AED", "presets": [2500, 4500, 7000, 10000]},
    "sf": {"name": "San Francisco", "currency": "$", "code": "USD", "presets": [1000, 1600, 2400, 3200]},
    "all": {"name": "All cities", "currency": "$", "code": "USD", "presets": [500, 1000, 1500, 2500]},
}
HOUSING_TYPES = {"room", "studio", "entire_apartment", "sublease", "all"}


def number(value, minimum=0, maximum=None):
    try:
        return (type(value) in (int, float) and math.isfinite(value)
                and value >= minimum and (maximum is None or value <= maximum))
    except OverflowError:
        return False


def _fold(value):
    if not isinstance(value, str):
        return ""
    return "".join(char for char in unicodedata.normalize("NFKD", value).casefold() if char.isalnum())


CITY_ALIASES = {_fold(alias): key for key, info in CITIES_INFO.items() for alias in (key, info["name"])}
CITY_ALIASES["newyork"] = "nyc"


def canonical_city(value):
    return CITY_ALIASES.get(_fold(value))


def normalize_deal(raw):
    """No invented prices, facts, or FX rates. Unknown information remains unavailable."""
    if not isinstance(raw, dict) or raw.get("kind") == "scout":
        return None
    city = canonical_city(raw.get("cityId") or raw.get("cityName") or raw.get("city"))
    if not city or city == "all":
        return None
    for field in ("cityId", "cityName", "city"):
        if raw.get(field) and canonical_city(raw[field]) != city:
            return None
    audit = raw.get("nemotronAudit", raw.get("audit", {}))
    if not isinstance(audit, dict):
        return None
    score = raw.get("dealScore", audit.get("fairRentScore"))
    url = raw.get("sourceUrl", raw.get("url"))
    if not number(score, maximum=100) or not isinstance(url, str) or len(url) > 2000 or any(c.isspace() for c in url):
        return None
    try:
        parts = urlsplit(url)
        if parts.scheme not in ("https", "http") or not parts.hostname or parts.username or parts.password:
            return None
        url = urlunsplit(parts._replace(fragment=""))
    except ValueError:
        return None
    info = CITIES_INFO[city]
    currency = raw.get("currency")
    if currency is None and raw.get("currencySymbol") == info["currency"]:
        currency = info["code"]
    price_usd = raw.get("priceUsd")
    price_local = raw.get("priceLocal")
    if not number(price_usd):
        price_usd = None
    if not number(price_local):
        price_local = None
    if currency == "USD" and price_usd is None:
        price_usd = price_local
    if info["code"] == "USD" and price_local is None and price_usd is not None:
        price_local, currency = price_usd, "USD"
    model = audit.get("modelUsed", audit.get("analyzedByModel", ""))
    model = model if isinstance(model, str) else ""
    demo = raw.get("demo") is True or raw.get("mode") == "demo" or any(word in model.lower() for word in ("simulated", "fallback", "sample"))
    summary = audit.get("summary", audit.get("leaseClauseSummary"))
    return {
        **raw, "cityId": city, "cityName": info["name"], "sourceUrl": url,
        "title": raw.get("title", raw.get("raw_title", "Untitled source")),
        "dealScore": score, "audit": audit, "summary": summary if isinstance(summary, str) else None,
        "model": model, "demo": demo, "priceLocal": price_local, "priceUsd": price_usd,
        "currency": currency, "type": raw.get("type", raw.get("housingType")),
    }


def matches_preferences(deal, user, min_score=DEFAULT_THRESHOLD):
    if not isinstance(user, dict) or user.get("active") is not True:
        return False
    threshold = user.get("minDealScore", DEFAULT_THRESHOLD)
    if not number(threshold, maximum=100) or deal["dealScore"] < max(DEFAULT_THRESHOLD, min_score, threshold):
        return False
    city = canonical_city(user.get("cityId"))
    if not city or (city != "all" and city != deal["cityId"]):
        return False
    budget = user.get("maxBudget")
    if budget is not None:
        if not number(budget):
            return False
        if city == "all":
            price = deal["priceUsd"]
        else:
            if deal["currency"] != CITIES_INFO[city]["code"]:
                return False
            price = deal["priceLocal"]
        if price is None or price > budget:
            return False
    housing_type = user.get("housingType", "all")
    if housing_type not in HOUSING_TYPES or (housing_type != "all" and housing_type != deal["type"]):
        return False
    for preference, fact in (("noBrokerFeeOnly", "noBrokerFee"), ("utilitiesIncludedOnly", "utilitiesIncluded")):
        if user.get(preference) is True and deal.get(fact) is not True:
            return False
    return True
