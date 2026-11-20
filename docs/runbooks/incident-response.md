# SmartJobsBot V2 — Incident Response & Triage Runbook

This guide outlines protocol levels, escalation procedures, and remediation playbooks for production incidents affecting SmartJobsBot V2.

---

## 1. Severity Levels & SLA Matrix

| Severity | Definition | Target Response | Target Resolution |
| :--- | :--- | :--- | :--- |
| **P0 (Critical)** | Complete service outage; database connection failure; bot unresponsive to all users. | $< 15\text{ minutes}$ | $< 1\text{ hour}$ |
| **P1 (High)** | Scheduled digest delivery degraded; Telegram HTTP 429 flood; $\ge 3$ job sources failing. | $< 30\text{ minutes}$ | $< 2\text{ hours}$ |
| **P2 (Medium)** | Single non-critical job source degraded; isolated user preference sync error; high query latency. | $< 2\text{ hours}$ | $< 8\text{ hours}$ |
| **P3 (Low)** | Minor cosmetic formatting glitch; non-blocking telemetry warning. | $< 24\text{ hours}$ | Next release |

---

## 2. Incident Playbooks

### Playbook 1: PostgreSQL Connection Pool Exhaustion or Database Outage (P0)

#### Symptoms:
- Health check returns `data.database.status: "disconnected"`.
- Log records: `PrismaClientKnownRequestError: Can't reach database server at ...` or `Timed out fetching a connection from the pool`.

#### Remediation Steps:
1. **Check Pool Sizing & Active Leaks:**
   Inspect live connections on Neon console or query `pg_stat_activity`:
   ```bash
   npm run deploy:check
   ```
2. **Increase Database Pool Size (if compute allows):**
   In `.env` or container environment, increase `DATABASE_POOL_SIZE`:
   ```env
   DATABASE_POOL_SIZE=30
   ```
3. **Verify Neon Compute Status:**
   If compute suspended due to inactivity or maintenance, trigger wake-up via:
   ```bash
   npx tsx -e "import { prisma } from './src/shared/database/prisma.service.js'; await prisma.$queryRawUnsafe('SELECT 1;'); console.log('DB awake!'); process.exit(0);"
   ```
4. **Emergency Pipeline Lock Release:**
   If a dead worker held advisory lock `824403`:
   ```bash
   npx tsx -e "import { prisma } from './src/shared/database/prisma.service.js'; await prisma.$queryRawUnsafe('SELECT pg_advisory_unlock_all();'); console.log('Locks released'); process.exit(0);"
   ```

---

### Playbook 2: Telegram 429 Rate Limit Flood (P1)

#### Symptoms:
- Bot logs output: `[ChunkedCursorDispatcher] Telegram 429 rate limit error for user ... Pausing loop for X s`.
- Delivery slot lag increases beyond normal execution windows.

#### Remediation Steps:
1. **Verify Automated Backoff:**
   `ChunkedCursorDispatcher` automatically extracts `retry_after` from Telegram's response and pauses the dispatch loop without dropping recipients or consuming retry quotas.
2. **Review Token Bucket Rate Configuration:**
   Ensure rate limiting in `ChunkedCursorDispatcher` is strictly $\le 25\text{ msgs/sec}$.
3. **Handle Blocked Users (`403 Forbidden`):**
   When users stop or block the bot, the platform flags `User.status = 'BLOCKED'` immediately, skipping them from future deliveries and preventing wasted API calls.
4. **Trigger Missed Slot Watchdog Recovery:**
   If a slot timed out during a severe rate limit block:
   The `MissedSlotWatchdogService` runs automatically every 15 minutes to resume pending deliveries from the last processed cursor.

---

### Playbook 3: Job Ingestion Source Outages & Circuit Breaker Tripping (P1/P2)

#### Symptoms:
- `GET /health` reports degraded sources in `data.sourcesSummary.failedLastRun`.
- Log entries: `[CircuitBreaker: <source>] Consecutive failures threshold reached. Tripping to OPEN state`.

#### Remediation Steps:
1. **Circuit Breaker Self-Healing:**
   The built-in `CircuitBreaker` pauses queries to failing sources (`OPEN` state) for a 15-minute cooldown (`ms('15m')`), then transitions to `HALF_OPEN` for trial probes. No manual intervention is needed.
2. **Isolate Specific Scraper Failure:**
   Run the dedicated source verification suite:
   ```bash
   npm run test:sources:live
   ```
3. **Inspect Upstream API Keys:**
   For authenticated sources (Adzuna, Jooble, RapidAPI, Firecrawl), verify API quotas and renew keys in `.env` if depleted.

---

### Playbook 4: AI Provider (Gemini) Outage or Key Quota Exhaustion (P2)

#### Symptoms:
- Log warning: `[GeminiProvider] Quota exceeded on slot ... Falling back to next available key`.

#### Remediation Steps:
1. **Automatic 22-Slot Fallback Rotation:**
   The platform automatically rotates across 11 configured Gemini keys and 2 model tiers (`gemini-2.5-flash` $\rightarrow$ `gemini-1.5-pro`).
2. **Graceful Deterministic Fallback:**
   If all 22 slots fail, `AmbiguityResolver` degrades gracefully to deterministic title-first matching with confidence score `0.5`, ensuring zero user requests are dropped or halted.
