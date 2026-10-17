# RentScanner AI // Backend & Nebius Serverless Jobs

This directory contains the background processing pipelines and batch inference scripts designed to deploy on **Nebius AI Cloud** as **Nebius Serverless Jobs** or **Nebius Serverless Endpoints**.

## Overview
1. **`nebius_serverless_job.py`**:
   - Queries the **Tavily Search API** for real-time sublet postings across major global hubs (NYC, London, Tokyo, Bogotá, Dubai, Paris, Berlin, San Francisco).
   - Invokes **NVIDIA Nemotron** (`nvidia/llama-3.1-nemotron-70b-instruct` or `nvidia/nemotron-4-340b-instruct`) hosted on **Nebius Token Factory** to score each listing for:
     - Anti-Gentrification Index (AGI)
     - Fair-Rent Score (0 to 100)
     - Scam & Deposit Risk (0 to 10)
   - Outputs normalized JSON feeds ready to ingest into the frontend radar or Cloudflare D1 database.

## Running Locally

```bash
# Set up virtual environment
uv venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate

# Install dependencies
uv pip install -r requirements.txt

# Set environment variables
export NEBIUS_API_KEY="your_nebius_api_key"
export TAVILY_API_KEY="your_tavily_api_key"

# Run the job
python nebius_serverless_job.py
```

## Deploying as a Nebius Serverless Job
You can package this directory into a lightweight OCI container image and trigger it on Nebius AI Cloud using the Nebius CLI:

```bash
nebius serverless job create \
  --name rentscanner-audit-worker \
  --image cr.nebius.ai/rentscanner/worker:latest \
  --env NEBIUS_API_KEY=secret:nebius-token-key \
  --env TAVILY_API_KEY=secret:tavily-api-key
```
