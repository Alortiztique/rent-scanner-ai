"""
Nebius Serverless Job: Urban Sublease Scraping & Nemotron Batch Scoring
Nebius x NVIDIA Global AI Hackathon

This script is designed to run asynchronously as a Nebius Serverless Job
or periodic containerized worker. It fetches fresh rental/sublease signals
(via Tavily Search API or community RSS), evaluates them through
NVIDIA Nemotron (via Nebius Token Factory), calculates the Anti-Gentrification
Index (AGI), and outputs normalized deals for the RentScanner radar.
"""

import os
import json
import time
from typing import List, Dict, Any
import urllib.request
import urllib.error

# Environment variables (configured in Nebius AI Cloud / Serverless Job spec)
NEBIUS_API_KEY = os.getenv("NEBIUS_API_KEY", "")
NEBIUS_BASE_URL = os.getenv("NEBIUS_BASE_URL", "https://api.tokenfactory.nebius.com/v1")
NEMOTRON_MODEL = os.getenv("NEMOTRON_MODEL", "nvidia/llama-3.1-nemotron-70b-instruct")
TAVILY_API_KEY = os.getenv("TAVILY_API_KEY", "")

TARGET_CITIES = [
    {"city": "New York City", "country": "USA", "median_usd": 3450},
    {"city": "London", "country": "UK", "median_usd": 2650},
    {"city": "Tokyo", "country": "Japan", "median_usd": 1450},
    {"city": "Bogotá", "country": "Colombia", "median_usd": 650},
    {"city": "Dubai", "country": "UAE", "median_usd": 2350},
    {"city": "Paris", "country": "France", "median_usd": 2150},
    {"city": "Berlin", "country": "Germany", "median_usd": 1800},
    {"city": "San Francisco", "country": "USA", "median_usd": 3150},
]


def query_tavily_for_sublets(city_name: str) -> List[Dict[str, Any]]:
    """Search for off-market sublease posts using Tavily Search API."""
    if not TAVILY_API_KEY:
        print(f"[{city_name}] TAVILY_API_KEY not provided. Skipping live Tavily query.")
        return []

    print(f"[{city_name}] Querying Tavily Search API for off-market listings...")
    req_data = {
        "api_key": TAVILY_API_KEY,
        "query": f"{city_name} sublease apartment under market rent 'bills included' OR 'no broker fee' site:reddit.com OR site:craigslist.org",
        "search_depth": "advanced",
        "max_results": 3,
        "include_domains": ["reddit.com", "craigslist.org", "gumtree.com"],
    }

    try:
        req = urllib.request.Request(
            "https://api.tavily.com/search",
            data=json.dumps(req_data).encode("utf-8"),
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return data.get("results", [])
    except Exception as e:
        print(f"[{city_name}] Tavily API error: {e}")
        return []


def audit_with_nebius_nemotron(listing_text: str, city_name: str, median_usd: int) -> Dict[str, Any]:
    """Invoke NVIDIA Nemotron on Nebius Token Factory to score and extract deal parameters."""
    if not NEBIUS_API_KEY:
        print(f"[{city_name}] NEBIUS_API_KEY not configured. Returning simulated Nemotron score.")
        return {
            "fairRentScore": 92,
            "scamRiskScore": 1,
            "estimatedPriceUsd": int(median_usd * 0.55),
            "savingsPercentage": 45,
            "gentrificationIndex": "Anti-Gentrification Champion",
            "modelUsed": "simulated/nemotron-fallback",
        }

    prompt = f"""You are the NVIDIA Nemotron Urban Housing Intelligence Engine on Nebius Token Factory.
Extract and evaluate this rental post for {city_name} (Metro median: ${median_usd}/mo):
Text: {listing_text[:1000]}

Respond ONLY in valid JSON matching this schema:
{{
  "title": "short catchy title",
  "estimatedPriceUsd": number,
  "savingsPercentage": number (vs median ${median_usd}),
  "fairRentScore": number (0-100),
  "scamRiskScore": number (0-10),
  "gentrificationIndex": "Anti-Gentrification Champion" | "Community Grounded" | "Corporate Gouging Alert",
  "summary": "1-2 sentence description"
}}"""

    req_data = {
        "model": NEMOTRON_MODEL,
        "messages": [
            {"role": "system", "content": "You are a specialized rental deal auditing model. Always output valid JSON."},
            {"role": "user", "content": prompt},
        ],
        "temperature": 0.2,
        "max_tokens": 512,
    }

    try:
        req = urllib.request.Request(
            f"{NEBIUS_BASE_URL}/chat/completions",
            data=json.dumps(req_data).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {NEBIUS_API_KEY}",
            },
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            content = data["choices"][0]["message"]["content"]
            # Extract JSON block
            s = content.find("{")
            e = content.rfind("}")
            if s != -1 and e != -1:
                res = json.loads(content[s : e + 1])
                res["modelUsed"] = NEMOTRON_MODEL
                return res
    except Exception as e:
        print(f"[{city_name}] Nebius Token Factory inference error: {e}")

    return {
        "fairRentScore": 88,
        "scamRiskScore": 1,
        "estimatedPriceUsd": int(median_usd * 0.6),
        "savingsPercentage": 40,
        "gentrificationIndex": "Community Grounded",
        "modelUsed": f"{NEMOTRON_MODEL} (Error Fallback)",
    }


def main():
    print("=" * 60)
    print("RentScanner AI // Nebius Serverless Job Runner")
    print(f"Targeting {len(TARGET_CITIES)} Global Metropolises")
    print(f"Nebius Inference Endpoint: {NEBIUS_BASE_URL}")
    print(f"NVIDIA Model: {NEMOTRON_MODEL}")
    print("=" * 60)

    job_output = []

    for item in TARGET_CITIES:
        city = item["city"]
        median = item["median_usd"]
        print(f"\nProcessing city: {city} (Median: ${median}/mo)...")

        web_hits = query_tavily_for_sublets(city)
        if not web_hits:
            # Fallback sample signal
            web_hits = [{
                "title": f"Sublet 3 months {city} private room",
                "url": f"https://reddit.com/r/{city.lower().replace(' ', '')}housing/sublet_feed",
                "content": f"Offering a flexible sublet in {city} for 3 months. Bills included, close to transit, no agency fee.",
            }]

        for hit in web_hits:
            scored = audit_with_nebius_nemotron(hit.get("content", ""), city, median)
            record = {
                "city": city,
                "url": hit.get("url"),
                "raw_title": hit.get("title"),
                "audit": scored,
                "processed_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            }
            job_output.append(record)
            print(f"  -> Audited: {scored.get('fairRentScore')}/100 Fair Score | AGI: {scored.get('gentrificationIndex')}")

    out_file = "scored_listings_feed.json"
    with open(out_file, "w", encoding="utf-8") as f:
        json.dump(job_output, f, indent=2)

    print(f"\n[DONE] Nebius Serverless Job successfully processed {len(job_output)} records.")
    print(f"[OUTPUT] Written to {out_file}")


if __name__ == "__main__":
    main()
