# SmartJobsBot V2 — Production Operational Runbook

This runbook establishes standard operating procedures, architectural specifications, monitoring protocols, and operational workflows for managing SmartJobsBot V2 in production.

---

## 1. System Architecture Overview

SmartJobsBot V2 is architected as an event-driven, fault-tolerant autonomous career intelligence platform:

- **Compute & Server Runtime:** Node.js 20+ with TypeScript running on Express HTTP server and GrammY Telegram bot engine.
- **Relational Data Layer:** PostgreSQL 16+ hosted on **Neon (Lakebase Postgres)** with dual-connection architecture:
  - `DATABASE_URL`: Connection pooler (PgBouncer) for high-concurrency dispatch transactions.
  - `DATABASE_URL_UNPOOLED`: Direct connection for schema migrations (DDL) and database maintenance.
- **Cache & Ephemeral Storage:** Upstash Redis with SSL encryption (`rediss://`) for deduplication windows, rate limit token buckets, and distributed watchdog state.
- **Job Ingestion Engine:** Decoupled multi-source collector pulling from 13 verified platforms (Arbeitnow, Remotive, WeWorkRemotely, Mostaql, Tanqeeb, Bayt, Wuzzuf, Forasna, Baeed, Naukrigulf, Adzuna, Jooble, LinkedIn).
- **Matching & Classification:** Two-tier deterministic taxonomy classification with an AI-powered 22-slot fallback pool (Gemini 2.5 Flash / 1.5 Pro).
- **Delivery Engine:** Slot-based chunked cursor dispatcher processing 25-subscriber batches with token-bucket rate limiting strictly bounded to $\le 25\text{ msgs/sec}$.

---

## 2. Health Monitoring & Observability

### 2.1 The Operational Health Endpoint (`GET /health`)
The application exposes a structured JSON telemetry endpoint on `http://localhost:${PORT}/health`.

#### Diagnostic Fields:
| JSON Path | Description | Expected Normal Range |
| :--- | :--- | :--- |
| `data.status` | Core application operational status | `"ok"` |
| `data.uptime` | Process uptime in seconds | $> 0$ |
| `data.database.status` | Database connectivity probe | `"connected"` |
| `data.database.pool.active` | Currently utilized pooled connections | $0 \le \text{active} \le 15$ |
| `data.database.pool.total` | Total pooled connections allocated | $\le 20$ (Configurable via `DATABASE_POOL_SIZE`) |
| `data.redis` | Redis ping response state | `"connected"` |
| `data.scheduler.isRunning` | Cron notification scheduler loop state | `true` |
| `data.sourcesSummary.active` | List of functional ingestion sources | 13 sources active |
| `data.sourcesSummary.failedLastRun` | Sources failing consecutive scrape cycles | `[]` (Empty) |

---

## 3. Standard Operational Procedures (SOPs)

### 3.1 Pre-Flight Deployment Check
Before triggering a production deployment or container restart, execute the diagnostic validator:
```bash
npm run deploy:check
```
*Validates database connectivity, relational table integrity, Redis ping latency, and environment completeness with formatted duration reporting.*

### 3.2 Scheduled Career Pipeline Execution
The pipeline runs autonomously at 09:00 and 18:00 (configured via `JOB_RUN_TIME_1` and `JOB_RUN_TIME_2`). To manually execute a pipeline cycle out-of-schedule:
```bash
npm run pipeline:run
```
*Guarded by PostgreSQL distributed advisory lock `JOB_PIPELINE_ADVISORY_LOCK_ID (824403)` to prevent concurrent execution conflicts.*

### 3.3 Historical Data Pruning & Retention
To prune expired jobs, sent job logs older than 90 days, and completed delivery slots:
```bash
npm run db:prune
```
*Executes chunked batch deletions in transactional blocks to maintain database query indexing performance without table locking.*

### 3.4 Live Subscriber Reconciliation
To audit parity between legacy Redis subscriber lists and PostgreSQL relational state:
```bash
npm run db:migrate:v1:reconcile
```
*Verifies 100% field-level preference hash matching across all registered users.*

---

## 4. Concurrency & Rate Limiting SLA

- **Delivery Batch Size:** 25 recipients per batch.
- **Telegram Dispatch Pacing:** Hard token-bucket rate limit bounded to $\le 25\text{ msgs/sec}$.
- **Historical Deduplication Window:** 4 hours (`ms('4h')`) suppressing repeated deliveries.
- **Explorer SLA:** `<300ms` direct PostgreSQL keyset pagination querying using composite index `(primarySpecialization, remoteScope, status)`.

