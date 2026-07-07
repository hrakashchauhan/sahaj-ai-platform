# Sahaj AI — Platform (core Sahaj module)

![CI](https://github.com/hrakashchauhan/sahaj-ai-platform/actions/workflows/ci.yml/badge.svg)

Multi-tenant AI enquiry-response platform for Indian SMBs. Inbound WhatsApp/Instagram
enquiries → grounded vernacular AI draft → owner approval (Telegram) → send, with
lead capture, hot-lead escalation, ROI data, and per-intent auto-send graduation.

## 🚀 Deploy a live instance (one click)

The whole stack (API + worker + Postgres + Redis) is defined in [`render.yaml`](./render.yaml):

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/hrakashchauhan/sahaj-ai-platform)

1. Click the button → sign in to Render → **Apply** the blueprint (free tier).
2. It provisions Postgres (pgvector) + Redis, runs migrations + RLS, and boots the API + worker.
3. Your live test URL is `https://<your-api>.onrender.com/health`. Runs in **mock mode**
   until you add real secrets (`GEMINI_API_KEY`, `WHATSAPP_*`, `TELEGRAM_BOT_TOKEN`) in the
   Render dashboard.
4. Point your Meta app webhook at `https://<your-api>.onrender.com/webhooks/whatsapp`
   (verify token = the generated `META_VERIFY_TOKEN`).

> Other hosts: a `Dockerfile` + `Procfile` are included (Railway/Fly/any container host).
> Any Postgres with the **pgvector** extension + a Redis work.

Full design: `../../.claude/plans/go-through-all-the-streamed-cray.md`.

## Architecture (two processes, one codebase)

- **API** (`src/main.ts`) — NestJS HTTP: Meta webhook ingress (fast-ack + enqueue), health.
- **Workers** (`src/worker.ts`) — BullMQ: `inbound → ai → outbound`, nightly graduation, Telegram approval bot.
- **Postgres + pgvector** — all state; **RLS** enforces tenant isolation (`src/db/rls.sql`).
- **Redis** — BullMQ queues + approval/edit context.
- **LLM** — Gemini Flash via `src/ai/llm.ts`; **falls back to a mock provider when `GEMINI_API_KEY` is empty**, so the whole loop runs offline.

```
WhatsApp ─► /webhooks ─► inbound q ─► ingestion ─► ai q ─► pipeline ─► decision
                                                                 ├─ auto ─► outbound q ─► WhatsApp
                                                                 └─ approval ─► Telegram ─► (tap) ─► outbound q
```

## Prerequisites

- Node 20+ (tested on 24), npm.
- Postgres 16 with the **pgvector** extension, and Redis. Easiest: `docker compose up -d`
  (starts `pgvector/pgvector:pg16` + `redis:7`). No Docker? Point `DATABASE_URL`/`REDIS_URL`
  at a hosted Postgres (must have pgvector) + Redis.

## Setup

```bash
cd platform
cp .env.example .env         # fill in as needed; all keys optional for the mock loop
npm install
docker compose up -d         # or use hosted Postgres+Redis

npm run db:generate          # generate SQL migration from src/db/schema.ts
npm run db:migrate           # create tables (+ pgvector) — uses DATABASE_ADMIN_URL
npm run db:rls               # create `app` role + RLS policies + tenant resolver
npm run db:seed              # demo dental tenant mapped to phone_number_id "TEST_NUMBER_1"
```

> RLS only bites for the non-superuser `app` role. Keep `DATABASE_URL` pointed at `app`
> and `DATABASE_ADMIN_URL` at the owner/superuser (used only for migrations + RLS DDL).

## Run

```bash
# terminal 1 — HTTP API (webhooks)
npm run start:dev
# terminal 2 — workers + Telegram bot
npm run worker:dev
```

## Try the full loop without WhatsApp/Gemini/Telegram

Simulate a Meta inbound webhook for the seeded tenant (mock LLM answers, mock WA/Telegram log to console):

```bash
curl -X POST localhost:3000/webhooks/whatsapp \
  -H 'content-type: application/json' \
  -d '{"entry":[{"changes":[{"value":{
        "metadata":{"phone_number_id":"TEST_NUMBER_1"},
        "contacts":[{"wa_id":"919812345678","profile":{"name":"Asha"}}],
        "messages":[{"from":"919812345678","id":"wamid.test1","type":"text",
                     "text":{"body":"Aapke clinic ka timing kya hai?"}}]
      }}]}]}'
```

Watch the **worker** terminal: it ingests the message, the mock LLM answers the `hours`
intent, guardrails run, and (in MANUAL mode) a mock Telegram approval is logged. Ask a
`pricing` question to see it held for approval; include "call me on 98…" to trigger a
hot-lead escalation.

### Going live (per the plan's Verification section)
Set real credentials in `.env`: `GEMINI_API_KEY`, `META_APP_SECRET` + `WHATSAPP_TOKEN` +
`WHATSAPP_PHONE_NUMBER_ID`, `TELEGRAM_BOT_TOKEN` (+ each owner's `telegram_chat_id` — DM the
bot `/start` to get it). Point the Meta app webhook at `${PUBLIC_URL}/webhooks/whatsapp`
with verify token `META_VERIFY_TOKEN`.

## Layout

```
src/
  config/      env (zod-validated)
  db/          schema, RLS, migrate/apply/seed, client
  tenancy/     withTenant() RLS boundary + tenant resolver
  webhooks/    Meta ingress (signature verify, fast-ack)
  ingestion/   parse payload → persist → enqueue AI
  ai/          types, prompt, KB context, LLM (+mock), validation, pipeline
  policy/      auto-send decision gate
  approvals/   intent-policy trust ladder, approval service, Telegram, graduation
  messaging/   WhatsApp client + outbound worker
  queue/       BullMQ queues
  lib/         redis cache, secret crypto
  main.ts      HTTP API   worker.ts   background workers
```

## Roadmap (next)

V1: Next.js dashboard (conversations, KB editor, ROI), Meta Embedded Signup, AI KB
bootstrap, Razorpay Subscriptions, delivery-status webhooks, DPDP export/delete.
V2: true pgvector RAG, Langfuse eval/cost dashboards, admin console, Jawaab/Hisaab modules.
