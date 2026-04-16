FROM python:3.11-slim

WORKDIR /app

# System deps: git for cloning Kronos repo
RUN apt-get update && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/*

# Clone the Kronos model repo (provides /app/Kronos/model/*)
RUN git clone --depth 1 https://github.com/shiyu-coder/Kronos.git /app/Kronos

# Python dependencies first (layer-cached unless requirements.txt changes)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Service source code
COPY . /app/kronos_service/
WORKDIR /app/kronos_service

# Optional: pre-download model weights at build time to avoid cold-start delay.
# Comment out if your Railway plan has a short build timeout.
# Requires HF_TOKEN build-arg if models are gated.
# RUN python -c "from predictor import get_predictor; get_predictor('mini')"

EXPOSE 8000

# Railway injects $PORT automatically — fall back to 8000 for local dev
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]
