FROM python:3.12-slim-bookworm



WORKDIR /app



ARG INSTALL_TIMESFM=1

ARG INSTALL_MOIRAI=0



ENV PYTHONDONTWRITEBYTECODE=1 \

    PYTHONUNBUFFERED=1 \

    SERVER_HOST=0.0.0.0 \

    SERVER_PORT=8003 \

    PLAYWRIGHT_IN_DOCKER=1 \

    DISPLAY=:99 \

    TIMESFM_MODEL_PATH=/app/timesfm_model \

    MOIRAI_MODEL_PATH=/app/moirai_model \

    LSTM_MODEL_DIR=/app/models \

    PREDICTION_ENABLE_TIMESFM=1 \

    PREDICTION_ENABLE_LSTM=1 \

    PREDICTION_ENABLE_MOIRAI=0



RUN apt-get update && apt-get install -y --no-install-recommends \

    build-essential \

    libffi-dev \

    git \

    xvfb \

    && rm -rf /var/lib/apt/lists/*



# CPU-only PyTorch keeps the image small; GPU/CUDA not typical in app containers.

COPY requirements-docker.txt requirements-timesfm.txt requirements-moirai.txt ./

RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu

RUN pip install --no-cache-dir -r requirements-docker.txt



RUN if [ "$INSTALL_TIMESFM" = "1" ]; then \

      pip install --no-cache-dir -r requirements-timesfm.txt && \

      git clone --depth 1 https://github.com/google-research/timesfm.git /tmp/timesfm && \

      pip install --no-cache-dir "/tmp/timesfm[torch]" && \

      rm -rf /tmp/timesfm && \

      python -c "import timesfm; print('timesfm ok')"; \

    fi



RUN if [ "$INSTALL_MOIRAI" = "1" ]; then \

      pip install --no-cache-dir -r requirements-moirai.txt && \

      python -c "import uni2ts; print('uni2ts ok')"; \

    fi



# Playwright: OS deps + Chromium for Zerodha auto-auth in container (headed via Xvfb).

RUN python -m playwright install-deps chromium \

    && python -m playwright install chromium



COPY . .

RUN chmod +x /app/docker-entrypoint.sh



EXPOSE 8003



ENTRYPOINT ["/app/docker-entrypoint.sh"]

CMD ["gunicorn", "-c", "gunicorn_conf.py", "app:app"]

