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

> **DeployMe** is an enterprise-grade career radar and automated matching platform. It continuously harvests, analyzes, deduplicates, and filters tech opportunities across **13 international and Arab job portals**, leverages **Google Gemini** for deep semantic evaluation, and delivers hyper-personalized job digests via **Telegram** — engineered to evolve into a full-scale **Web Career Intelligence Portal**.

**🤖 Try the Live Bot on Telegram:** [https://t.me/DeployMeRadarBot](https://t.me/DeployMeRadarBot)  
**🌐 Live Production API Health:** [career-platform-6p7y.onrender.com/health](https://career-platform-6p7y.onrender.com/health)

---

## 📑 Table of Contents

- [Live Demo & Experience](#-live-demo--interactive-experience)
- [Overview & Value Proposition](#-overview--value-proposition)
- [Future Vision: Expanding to a Full Web Platform](#-future-vision-expanding-to-a-full-web-platform)
- [Key Architectural & Engineering Highlights](#-key-architectural--engineering-highlights)
- [System Architecture](#-system-architecture)
- [Supported Job Sources (13 Platforms)](#-supported-job-sources-13-platforms)
- [Telegram Bot Experience & Commands](#-telegram-bot-experience)
- [Live Observability & Telemetry](#-live-observability--telemetry)
- [Tech Stack & Tooling](#-tech-stack--tooling)
- [Quality Assurance & Testing Standards](#-quality-assurance--testing-standards)
- [Author & Engineering Leadership](#-author--engineering-leadership)

---

## 🚀 Live Demo & Interactive Experience

DeployMe is continuously deployed and running live 24/7 in production. You can immediately experience the candidate onboarding, customize your technical Stack preferences, and explore real-time matched opportunities:

👉 **[Launch DeployMe on Telegram (@DeployMeRadarBot)](https://t.me/DeployMeRadarBot)**

*No local setup, database configuration, or API keys required to test — simply click the link above, send `/start`, and select your specialization.*

---

## 📌 Overview & Value Proposition

In today's fragmented hiring market, software engineers and tech professionals waste dozens of hours every week scouring disparate boards, dodging duplicate listings, and sifting through misaligned roles (such as "Junior" positions demanding 8 years of experience).

**DeployMe** solves this by engineering a resilient, automated data pipeline that:
1. **Aggregates from 13 sources simultaneously** (Global Remote + MENA/Arab hubs).
2. **Eliminates duplicates** using a two-tier composite and semantic fingerprinting algorithm.
3. **Applies strict hard-filtering** (e.g., Lead/Manager roles are rigorously isolated from Junior candidates).
4. **Performs deep semantic evaluation** using Gemini Flash with multi-key failover.
5. **Pushes a daily evening digest** at 21:00 (Asia/Gaza) directly to the user's pocket with zero noise and direct application links.

---

## 🔮 Future Vision: Expanding to a Full Web Platform

While DeployMe currently delivers value through Telegram for instant mobile accessibility, the system's modular architecture was purposefully built backend-first to power a comprehensive **Web-based SaaS Career Suite**:

```
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

### 🗺️ Product Roadmap:
* **Phase 1: Resilient Core Pipeline (Completed ✅)**
  * Multi-source aggregators (13 sources), PostgreSQL + Redis hybrid storage, strict seniority filters, multi-key Gemini rotation, and Telegram bot UI.
* **Phase 2: Modern Web Dashboard (Next Milestone 🚀)**
  * A full-stack web portal (**Next.js 15, TailwindCSS, Shadcn UI**) providing candidates with an interactive job radar, rich search/filtering, and customized email alerts.
* **Phase 3: Automated Resume Tailoring & Skills Gap Analysis**
  * Upload a PDF CV/Resume to extract skills, compare them against live market demands, and receive personalized keyword optimization advice.
* **Phase 4: Candidate Application Tracking System (ATS Kanban)**
  * A drag-and-drop Kanban board (`Wishlist` → `Applied` → `Interviewing` → `Offer`) synchronized with incoming alerts.

---

## 🛠️ Key Architectural & Engineering Highlights

### 1. Robust Distributed Concurrency (PostgreSQL Advisory Locks)
To guarantee idempotency and prevent race conditions when multiple scheduled triggers (external cron, GitHub Actions, internal scheduler) fire concurrently, DeployMe uses native PostgreSQL advisory locks (`pg_try_advisory_lock`). If a cycle is in-flight, subsequent executions gracefully exit without corrupting state.

### 2. High-Performance Hybrid Persistence
* **PostgreSQL (via Prisma ORM)**: Stores relational schemas, user accounts, preferences, job histories, and delivery slot telemetry with strong integrity and foreign key constraints.
* **Redis**: Acts as an ultra-fast caching layer for API rate limiting, Gemini response caching (7-day TTL), and real-time distributed locks.

### 3. Analyze-Once Architecture with Multi-Key Rotation
LLM calls are computationally heavy and subject to rate limits. DeployMe uses an **Analyze-Once** model:
* Every unique job across all users is evaluated **only once per cycle**.
* The structured analysis (`skills`, `seniority`, `workType`, `role`) is cached in Redis.
* User matching is computed in memory against this analysis in milliseconds.
* A multi-key token-bucket rate limiter with automated circuit-breakers cycles through backup keys if quotas are exhausted.

### 4. Strict Seniority & Experience Guardrails
A dedicated `SeniorityClassifier` and `HardFilterEngine` strictly enforce candidate boundaries. A Junior applicant will never receive "Lead", "Staff", or "Engineering Manager" roles, regardless of keyword overlaps.

### 5. Fair Source Diversity Balancing
To prevent high-volume aggregators (like Jooble or Adzuna) from monopolizing candidate digests, the pipeline enforces source diversity balancing, guaranteeing a representative blend of Arabic and global remote opportunities.

---

## 🏗️ System Architecture

```
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
│  [1. Job Aggregators] ─────► [2. Deduplication Engine] ─────► [3. Semantic Analysis Engine]    │
│   • 13 Parallel Sources       • Exact Fingerprint (SHA256)     • Google Gemini Flash           │
│   • Promise.allSettled         • Semantic Cross-board Dedupe    • Multi-key Fallback & Cache   │
│                                                                                                │
│  [4. Delivery Scheduler] ◄─── [5. Hard-Filter Gatekeeper] ◄─── [6. Score & Ranking Engine]      │
│   • Evening Digest (21:00)     • Seniority & Experience        • Stack Overlap (0-100)         │
│   • Direct Apply Links         • Regional Market Alignment     • Fair Source Balancing         │
└────────────────────────────────────────────────┬───────────────────────────────────────────────┘
                                                 │
                                                 ▼
                                 ┌───────────────────────────────┐
                                 │     Persistence Layer         │
                                 │  • PostgreSQL (Prisma ORM)    │
                                 │  • Redis (Cache & Locks)      │
                                 └───────────────────────────────┘
```

---

## 🌐 Supported Job Sources (13 Platforms)

| Source | Geographic Focus | Postings Type | Integration Mode |
|---|---|---|---|
| **LinkedIn** | Global / Worldwide | Full-time, Tech, Remote | RapidAPI / JSearch API |
| **We Work Remotely** | Worldwide | 100% Remote Tech | Live RSS Feed |
| **Remotive** | Worldwide | Remote Tech & Startup roles | REST API |
| **Arbeitnow** | Europe / Worldwide | Tech, Engineering, Remote | REST API |
| **Tanqeeb** | MENA / Gulf Region | Tech & Corporate | Scraper (Direct Links) |
| **Bayt** | Gulf / Arab World | Enterprise Tech & Engineering | Scraper |
| **Wuzzuf** | Egypt & Arab Region | Tech & Software Engineering | Scraper |
| **Forasna** | Egypt & MENA | Tech & General Jobs | Scraper |
| **Baeed (بعيد)** | Arab World | 100% Remote Arabic Tech | Scraper |
| **Mostaql (مستقل)**| Arab World | Freelance & Contract Projects | Scraper |
| **Naukrigulf** | UAE, Saudi, Gulf | Tech & Expat Opportunities | Scraper |
| **Adzuna** | Global / UK / US | Broad Tech Listings | Official API |
| **Jooble** | Worldwide | Aggregate Tech Index | Official API |

---

## 🤖 Telegram Bot Experience

The bot is designed with seamless UX, full Arabic and English localization, and zero clutter:

* `/start` — ⚡ Interactive step-by-step setup (Choose Stack, Target Market Scope).
* `/jobs` — Browse latest active roles matching your Stack and experience level on demand.
* `/settings` — Modify Stack, market scope, experience level (Junior/Mid/Senior), or switch language.
* `/pause` — Temporarily pause scheduled alerts without losing preferences.
* `/resume` — Immediately resume notifications.
* `/stop` — Unsubscribe and permanently purge all stored personal data.
* `/help` — Quick command guide and reference.

---

## 📊 Live Observability & Telemetry

DeployMe provides two non-intrusive ways to monitor production health:

1. **Production Health Endpoint (`GET /health`)**:
   Returns real-time connection status of PostgreSQL connection pool metrics, Redis cache, scheduler status, and scraper health.

2. **GitHub Actions Status Workflow (`Platform Status Summary`)**:
   A lightweight, read-only status report that runs in under 5 seconds and renders a markdown summary table directly in GitHub:
   * System Uptime & Status (`🟢 HEALTHY`)
   * Total Active & Paused Subscribers
   * Per-subscriber delivery status (`✅ Delivered` / `⏳ Pending`)
   * Health of all 13 external job boards

---

## 💻 Tech Stack & Tooling

* **Runtime:** Node.js 20 LTS (ES Modules)
* **Language:** TypeScript 5 (Strict Mode: `noImplicitReturns`, `noUnusedLocals`)
* **Framework:** Express.js 4
* **Bot Framework:** grammY (Modern Telegram Bot SDK)
* **Databases:** PostgreSQL 16, Redis 7
* **ORM:** Prisma ORM 5
* **Semantic Engine:** Google Gemini (`@google/genai`)
* **Testing:** Vitest (Unit & Integration test suites)
* **HTML Parsing:** Cheerio
* **Deployment & CI:** Render (Web Service), GitHub Actions

---

## 🧪 Quality Assurance & Testing Standards

DeployMe enforces high software engineering quality through comprehensive testing:
* **Unit Tests**: Mocked unit tests for every scraper, filter engine, scoring calculator, and validator.
* **Integration Tests**: End-to-end pipeline verification, database transactions, advisory locking, and Telegram bot handlers.
* **Fixture Tests**: HTML and JSON fixtures ensuring scrapers remain immune to layout shifts.
* **Automated CI**: GitHub Actions runs TypeScript typecheck, ESLint, and Vitest test suites on every pull request.

---

## 👨‍💻 Author & Engineering Leadership

Crafted with care by **Mohammed Abu Samra**  
Passionate Full-Stack & Systems Engineer dedicated to building scalable, high-impact distributed systems and modern web applications.

* **Telegram Bot:** [@DeployMeRadarBot](https://t.me/DeployMeRadarBot)
* **GitHub:** [@mohammedabusamra04](https://github.com/mohammedabusamra04)

---
*Distributed under the MIT License. Feel free to inspect, fork, or reach out for inquiries.*
