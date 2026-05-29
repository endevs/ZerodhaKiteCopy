FROM python:3.12-slim-bookworm

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    SERVER_HOST=0.0.0.0 \
    SERVER_PORT=8003 \
    PLAYWRIGHT_IN_DOCKER=1 \
    DISPLAY=:99

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libffi-dev \
    xvfb \
    && rm -rf /var/lib/apt/lists/*

# CPU-only PyTorch keeps the image small; GPU/CUDA not typical in app containers.
COPY requirements-docker.txt .
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu
RUN pip install --no-cache-dir -r requirements-docker.txt
# Playwright: OS deps + Chromium for Zerodha auto-auth in container (headed via Xvfb).
RUN python -m playwright install-deps chromium \
    && python -m playwright install chromium

COPY . .
RUN chmod +x /app/docker-entrypoint.sh

EXPOSE 8003

ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["gunicorn", "-c", "gunicorn_conf.py", "app:app"]
