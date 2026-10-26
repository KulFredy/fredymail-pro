# FredyMail Next — tek imaj: API (arayüzü de sunar) + worker + CLI

# ---------- arayüz derlemesi ----------
FROM node:22.23.4-alpine AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
# Opsiyonel `ca` build secret'ı yalnızca TLS ara proxy'si olan ortamlar içindir; normal kurulumda etkisizdir.
RUN --mount=type=secret,id=ca,required=false \
    if [ -f /run/secrets/ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/ca; fi; \
    npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# ---------- uygulama ----------
FROM python:3.12.15-slim AS app
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    FM_STATIC_DIR=/app/static \
    FM_DEMO_MAIL_DIR=/data/demo-mail

RUN groupadd -g 10001 fredymail && useradd -u 10001 -g fredymail -d /app -s /usr/sbin/nologin fredymail

WORKDIR /app
COPY backend/requirements.lock /app/requirements.lock
RUN --mount=type=secret,id=ca,required=false \
    if [ -f /run/secrets/ca ]; then export PIP_CERT=/run/secrets/ca; fi; \
    pip install -r /app/requirements.lock
COPY backend/pyproject.toml /app/backend/pyproject.toml
COPY backend/fredymail /app/backend/fredymail
RUN pip install --no-deps /app/backend
COPY backend/alembic.ini /app/alembic.ini
COPY backend/migrations /app/migrations
COPY --from=web /web/dist /app/static

RUN mkdir -p /data/demo-mail /data/imports && chown -R fredymail:fredymail /data
USER fredymail
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8080/api/health', timeout=4).status==200 else 1)"

CMD ["uvicorn", "fredymail.api.main:create_app", "--factory", "--host", "0.0.0.0", "--port", "8080", \
     "--no-server-header", "--timeout-keep-alive", "15"]
