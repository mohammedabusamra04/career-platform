# ⚡ DeployMe — Automated Career Intelligence Platform

[![Node.js](https://img.shields.io/badge/Node.js-20.x-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Prisma ORM](https://img.shields.io/badge/Prisma-ORM-2D3748?logo=prisma&logoColor=white)](https://www.prisma.io/)
[![Redis](https://img.shields.io/badge/Redis-Cache-DC382D?logo=redis&logoColor=white)](https://redis.io/)
[![Google Gemini](https://img.shields.io/badge/Google_Gemini-Flash-8E75B2?logo=google&logoColor=white)](https://ai.google.dev/)
[![Telegram Bot](https://img.shields.io/badge/Telegram-@DeployMeRadarBot-26A5E4?logo=telegram&logoColor=white)](https://t.me/DeployMeRadarBot)
[![Tests](https://img.shields.io/badge/Tests-Vitest_100%25_Passing-6E9F18?logo=vitest&logoColor=white)](https://vitest.dev/)
[![Production Status](https://img.shields.io/badge/Status-Live_on_Render-2ea44f)](https://career-platform-6p7y.onrender.com/health)

**DeployMe** is a backend-driven job aggregation, classification, and matching platform built in **TypeScript**. It collects tech and remote opportunities across **13 international and Arab job sources**, deduplicates and classifies them across 10 engineering specializations, filters out expired or blocked listings, and delivers personalized daily digests and on-demand search via **Telegram**.

- **Live Telegram Bot:** [t.me/DeployMeRadarBot](https://t.me/DeployMeRadarBot)
- **Production Health Check:** [career-platform-6p7y.onrender.com/health](https://career-platform-6p7y.onrender.com/health)

---

## Table of Contents

- [Live Demo](#live-demo)
- [Problem & Solution](#problem--solution)
- [Architecture Overview](#architecture-overview)
- [Key Engineering Highlights](#key-engineering-highlights)
- [Supported Job Sources](#supported-job-sources)
- [Bot Commands](#bot-commands)
- [Observability & Health](#observability--health)
- [Tech Stack](#tech-stack)
- [Testing & CI](#testing--ci)
- [Roadmap](#roadmap)
- [Author](#author)

---

## Live Demo

DeployMe runs 24/7 in production on Render. No local setup is required to test the onboarding, filtering, or `/jobs` explorer:

1. Open [@DeployMeRadarBot](https://t.me/DeployMeRadarBot) on Telegram.
2. Send `/start`, pick up to 3 specializations, your target market (`Arab`, `International`, or `Both`), and your experience level.
3. Receive an immediate 5-job onboarding digest and use `/jobs` anytime to browse and sort active matches.

---

## Problem & Solution

Job seekers spend hours each week checking fragmented boards, running into duplicate postings, expired links, and roles whose titles don't match their actual requirements.

DeployMe automates this workflow through a deterministic-first pipeline:
1. **Collects** listings from 13 global and regional sources (plus a free Gmail Job Alerts ingestion webhook for LinkedIn).
2. **Enriches & Verifies** short listings via a bounded 40KB streaming JSON-LD (`JobPosting`) reader and rejects dead links (`404`/`410`, soft-404s, WAF blocks, and postings older than 21 days).
3. **Deduplicates** cross-board listings via SHA-256 fingerprinting and semantic keys.
4. **Classifies** roles across 10 specializations, seniority levels, and remote scopes before matching and delivering an evening digest at `21:00` (`Asia/Gaza`).

---

## Architecture Overview

```text
                                 ┌───────────────────────────────┐
                                 │     Client Interfaces         │
                                 │  • Telegram Bot (grammY)      │
                                 │  • REST API / Health Probe    │
                                 └───────────────┬───────────────┘
                                                 │
                                                 ▼
┌────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                   DeployMe Core Services                                       │
│                                                                                                │
│  [1. Job Aggregators] ─────► [2. Enricher & Link Verifier] ──► [3. Deduplication & Classifier] │
│   • 13 Sources + Gmail        • 40KB JSON-LD Streaming          • SHA-256 & Semantic Keys      │
│   • Promise.allSettled        • 404/410 & Soft-404 Filter       • 4-Stage + Gemini Fallback    │
│                                                                                                │
│  [4. Delivery Scheduler] ◄─── [5. Hard-Filter Gatekeeper] ◄─── [6. Equivalence Scoring Engine] │
│   • Evening Digest (21:00)     • Seniority & Experience         • Shared Group Scoring (0-100) │
│   • Direct Apply Links         • Regional Market Alignment      • Fair Source Balancing        │
└────────────────────────────────────────────────┬───────────────────────────────────────────────┘
                                                 │
                                                 ▼
                                 ┌───────────────────────────────┐
                                 │     Persistence Layer         │
                                 │  • PostgreSQL (Source of Truth│
                                 │  • Redis (Optional Cache)     │
                                 └───────────────────────────────┘
```

---

## Key Engineering Highlights

### 1. PostgreSQL as Source of Truth + Graceful Redis Cache
- **PostgreSQL (Prisma ORM)** stores users, preferences, active jobs, delivery slots, and `SentJob` history, and enforces distributed mutual exclusion via native advisory locks (`pg_try_advisory_lock`).
- **Redis** acts strictly as an optional performance cache (Gemini analysis results, link-liveness checks, rate-limiting keys). If Redis is unavailable, `RedisAdapter` degrades gracefully to cache-free mode with warning logs without crashing the server or pipeline.

### 2. 4-Stage Classification Pipeline & Title Conflict Arbitration
Job classification is structured as a decoupled `Chain of Responsibility` pipeline over pure TypeScript domain types (isolated from Prisma):
1. **Negative Exclusion:** Filters out non-engineering roles (recruiting, sales, marketing, IT service/help desk).
2. **Title Role Lock & Conflict Arbitration:** Locks clear titles (`Laravel`, `Frontend`) immediately, and arbitrates compound titles (e.g., `Data Platform Engineer` vs `AI Platform Engineer`) against description/skill evidence instead of relying on hardcoded title lists.
3. **Contextual Description Scoring:** Evaluates full descriptions and exclusive tools when titles are ambiguous, preventing generic keywords (`testing`, `Docker`, `Python`) from misclassifying roles.
4. **Gemini Fallback:** Invoked only for unresolved roles, using multi-key rotation, token-bucket rate limiting, and circuit breakers.

### 3. Fast Streaming Enrichment & Dead-Link Filtering
- For sources that return only titles or short snippets, `JobDetailEnricher` streams the first ~40KB of HTML with bounded concurrency to extract Schema.org `JobPosting` JSON-LD metadata.
- `LinkLivenessVerifier` filters out `404`/`410` responses, WAF blocks, and expired soft-404 pages before jobs reach subscribers.

### 4. Analyze-Once & Equivalence Matching
Each unique job is analyzed once per cycle, and subscribers sharing identical preference hashes (`EquivalenceMatching`) are evaluated as a group rather than running redundant per-user scoring loops.

---

## Supported Job Sources

| Source | Region | Type | Integration |
|---|---|---|---|
| **LinkedIn** | Global | Full-time & Remote Tech | Free Gmail Alerts Ingestion + JSearch/Firecrawl fallback |
| **We Work Remotely** | Worldwide | Remote Tech | RSS Feed |
| **Remotive** | Worldwide | Remote Tech | REST API |
| **Arbeitnow** | Europe / Worldwide | Tech & Engineering | REST API |
| **Adzuna** | Global / UK / US | Broad Tech Listings | Official API |
| **Jooble** | Worldwide | Aggregate Tech Index | Official API |
| **Bayt** | MENA / Gulf | Enterprise Tech | HTML Scraper |
| **Wuzzuf** | Egypt / MENA | Software & Tech | HTML Scraper |
| **Forasna** | Egypt / MENA | Tech & General | HTML Scraper |
| **Tanqeeb** | MENA / Gulf | Tech & Corporate | HTML Scraper |
| **Naukrigulf** | Gulf Region | Tech & Engineering | HTML Scraper |
| **Baeed** | Arab World | Remote Arabic Tech | HTML Scraper |
| **Mostaql** | Arab World | Freelance Projects | HTML Scraper |

---

## Bot Commands

- `/start` — Guided onboarding (Specialization, Market Scope, Experience Level).
- `/jobs` — On-demand paginated explorer with `Best Match` and `Latest` sorting.
- `/settings` — Update specializations, target region, experience level, or language (`AR`/`EN`).
- `/pause` / `/resume` — Pause or resume scheduled notifications.
- `/stop` — Unsubscribe and permanently delete stored user data.
- `/help` — Command reference.

---

## Observability & Health

- **`GET /health`**: Reports live PostgreSQL pool metrics, Redis cache state, scheduler status, subscriber delivery stats, and per-source health (`HEALTHY`, `DEGRADED`, or `UNHEALTHY`).
- **Platform Status Summary Workflow**: Read-only GitHub Actions check that queries `/health` and renders a markdown status report.

---

## Tech Stack

- **Runtime & Language:** Node.js 20 LTS, TypeScript 5 (Strict Mode, ESM)
- **API & Bot:** Express 5, grammY (Telegram Bot API), Zod
- **Database & Cache:** PostgreSQL 16, Prisma ORM 6, Redis (optional cache)
- **AI & Parsing:** Google Gemini (`@google/genai`), Cheerio
- **Testing & CI:** Vitest, ESLint, Prettier, GitHub Actions, Render

---

## Testing & CI

- **113 test files / 1,078 passing tests** covering unit, integration, fixture-based scraper tests, load simulations, and chaos recovery.
- **GitHub Actions CI (`ci.yml`)** runs `npm ci`, `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build` on every push and pull request.

---

## Roadmap

```text
                       ┌──────────────────────────────────────────┐
                       │          DeployMe Cloud Ecosystem        │
                       └────────────────────┬─────────────────────┘
                                            │
                    ┌───────────────────────┴───────────────────────┐
                    ▼                                               ▼
         [ Live Telegram Bot ]                            [ Future Web Portal ]
      ⚡ Instant Notifications & Alerts             📊 Full-featured Candidate SaaS
      📱 On-the-go Status Management               💻 Dashboard & Kanban Tracker
      🎯 Interactive Settings & /jobs              📄 Resume Matcher & Studio
```

- **Phase 1 (Completed):** 13-source aggregation pipeline, PostgreSQL + optional Redis architecture, 4-stage classifier, Telegram bot, and CI/CD.
- **Phase 2 (Planned):** Web dashboard (Next.js) with saved-job tracking, CV skill matching, and Kanban application board.

---

## Author

**Mohammed Abu Samra** — Backend & Systems Developer

- GitHub: [@mohammedabusamra04](https://github.com/mohammedabusamra04)
- Telegram Bot: [@DeployMeRadarBot](https://t.me/DeployMeRadarBot)under the MIT License. Feel free to inspect, fork, or reach out for inquiries.*
