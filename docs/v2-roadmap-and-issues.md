# SmartJobsBot V2 — Comprehensive Engineering Specifications & User Stories Backlog
## Architecture, 10,000+ User Scalability, Data Structures, Algorithms & Implementation Plan

- **Repository:** https://github.com/mohammedabusamra04/ai-career-platform
- **Target Branch:** `v2`
- **Baseline V1 Tag:** `v1-stable` (Commit `e926384`)
- **Scale Target:** $\ge 10,000$ active subscribers with sub-second browsing and crash-resilient digests.
- **Language Convention:** All commits, issues, code, and documentation are written strictly in English.

---

## 1. High Scalability Architecture (10,000+ Users)

```
                  ┌────────────────────────────────────────────────────────┐
                  │          Central Shared Job Collector ($O(1)$)          │
                  │  Collects independently of users into PostgreSQL Pool │
                  └──────────────────────────┬─────────────────────────────┘
                                             │
                                             ▼
                  ┌────────────────────────────────────────────────────────┐
                  │        PostgreSQL Shared Normalized Job Pool           │
                  │   B-Tree & Composite Indexes (status, spec, region)    │
                  └──────────────────────────┬─────────────────────────────┘
                                             │
                     ┌───────────────────────┴────────────────────────┐
                     ▼                                                ▼
     ┌───────────────────────────────┐               ┌─────────────────────────────────┐
     │  Telegram User /jobs Explorer │               │ Twice-Daily Digest Engine       │
     │  - Reads from DB only         │               │ - Equivalence Class Grouping    │
     │  - Keyset Pagination (5/page) │               │   $O(G \times J) \ll O(U \times J)$
     │  - Zero external scraping     │               │ - Chunked Cursor Queue (25/sec) │
     └───────────────────────────────┘               │ - Persistent Idempotency Slot   │
                                                     └─────────────────────────────────┘
```

### 1.1 Architectural Contrast (V1 vs V2)
- **Collection Scalability:**
  - *V1:* Collection was executed per-subscriber preference query ($U \times \text{sources}$). For 10,000 users, running $10,000 \times 11 = 110,000$ HTTP requests per cycle crashes external source APIs and causes IP blocks.
  - *V2:* Decoupled shared pool collection ($O(1)$ with respect to users). Sources are harvested on an independent background cron into a central normalized PostgreSQL table.
- **Matching & Scoring:**
  - *V1:* Gemini was invoked per job per subscriber, generating match scores with high token costs, latency, and rate-limit fragility.
  - *V2:* Deterministic scoring based on weighted signals (Primary specialization $+50$, Level $+15$, Region $+15$, Freshness $+10$, ATS $+5$). Gemini is strictly isolated as an `AmbiguityResolver` for unclassified job titles.
- **Equivalence Class Partitioning ($O(G \times J)$):**
  - Users select from 10 specializations (up to 3) and 3 regions. Active subscribers are grouped by `preferenceHash = SHA256(sortedSpecializations + ":" + region + ":" + level + ":" + workType)`. The distinct group space ($G$) is only 200–400 groups. Candidate jobs are scored once per group ($O(G \times J)$), and personal sent history is subtracted per user in $O(1)$ via hash sets.
- **Digest Delivery Resiliency:**
  - *V1:* Sent directly via an in-memory loop; if interrupted, delivery progress was lost.
  - *V2:* Chunked cursor worker processing batches of 25 users paced at $\le 25 \text{ msgs/second}$. Every user delivery state (`PENDING`, `SENT`, `FAILED`, `BLOCKED`) is committed transactionally per slot key (`digest:YYYY-MM-DD:0900`), enabling instantaneous crash recovery without duplicate messages.

---

## Milestone M1: PostgreSQL & Scalable Data Layer

### TASK-20: Configure PostgreSQL, Prisma & Connection Pool

#### TASK-20.1: Prisma Schema Definition & Relational Entities
- **User Story:**
  - *As the system architect,*
  - *I want a complete relational schema defined in Prisma that maps users, preferences, normalized jobs, sent history, and delivery slots with strict constraints and foreign keys,*
  - *So that product data survives server restarts and enforces referential integrity across the entire platform.*
- **Context & Problem:** V1 stored product data in Redis with arbitrary TTLs. Redis keys had no relational constraints, leading to orphaned preferences and no audit trail. V2 requires relational durability.
- **User Flow & Scenarios:**
  - When the application starts, Prisma connects to PostgreSQL via connection pooling.
  - When a user interacts with the bot, records are created or updated transactionally.
  - Foreign key cascades ensure that deleting a user safely anonymizes or deletes related preferences and delivery attempts.
- **Detailed Acceptance Criteria:**
  - Define native Postgres enums: `UserStatus` (`ACTIVE`, `PAUSED`, `BLOCKED`, `DELETED`), `Specialization` (10 items), `RegionPreference` (`ARAB`, `INTERNATIONAL`, `BOTH`), `RemoteScope` (`WORLDWIDE`, `REGION`, `COUNTRY`, `UNKNOWN`), `JobStatus` (`ACTIVE`, `EXPIRED`, `CLOSED`), `DeliveryStatus` (`PENDING`, `SENT`, `FAILED`, `BLOCKED`).
  - Model `User`: `id` (UUID), `telegramId` (BigInt, Unique), `firstName`, `username`, `status`, `createdAt`, `updatedAt`, `pausedUntil`.
  - Model `UserPreference`: `id`, `userId` (One-to-One with `User`), `specializations` (`Specialization[]`), `regionPreference`, `experienceLevel`, `workType`, `preferenceHash` (String, Indexed), `updatedAt`.
  - Model `Job`: `id`, `deduplicationKey` (String, Unique), `semanticKey` (String, Indexed), `title`, `company`, `source`, `url`, `applicationUrl`, `location`, `country`, `remoteScope`, `primarySpecialization`, `secondarySpecialization`, `experienceLevel`, `workType`, `description`, `skills` (Text[]), `salaryMin`, `salaryMax`, `currency`, `publishedAt`, `scrapedAt`, `lastSeenAt`, `status`.
  - Model `SentJob`: `id`, `userId`, `jobId`, `sentAt`, `feedback` (`LIKE`, `DISLIKE`, `NONE`), Unique constraint on `(userId, jobId)`.
  - Model `DeliverySlot`: `id`, `slotKey` (Unique), `scheduledTime`, `status`, `totalRecipients`, `sentCount`, `failedCount`, `startedAt`, `completedAt`.
  - Model `DigestDelivery`: `id`, `slotId`, `userId`, `status`, `attempts`, `lastError`, `deliveredAt`, Unique constraint on `(slotId, userId)`.
  - Prisma Client must only be imported inside `src/modules/*/repositories/`; domain services must never import `@prisma/client` directly.
- **Data Structures & Types:**
  ```prisma
  datasource db {
    provider = "postgresql"
    url      = env("DATABASE_URL")
  }
  generator client {
    provider = "prisma-client-js"
  }
  ```
- **Test Specifications:**
  - Run `prisma migrate dev` on a clean PostgreSQL instance and verify table creation.
  - Unit test verifying repository isolation: domain entities are mapped to/from Prisma models without leaking Prisma types.

#### TASK-20.2: Connection Pooling, Database Resiliency & Environment Config
- **User Story:**
  - *As a platform engineer,*
  - *I want robust database connection pooling with retry policies and environment variable validation,*
  - *So that 10,000 concurrent bot interactions do not exhaust PostgreSQL connection limits or drop queries.*
- **Context & Problem:** Serverless or containerized setups (e.g. Supabase, Render) default to connection limits (often 20–50 connections). Rapid burst queries during scheduled digests can exhaust connections, resulting in `FATAL: remaining connection slots are reserved for non-replication superuser connections`.
- **User Flow & Scenarios:**
  - The application reads `DATABASE_URL` and `DATABASE_POOL_SIZE` from `.env`.
  - Prisma client initializes a connection pool with size $N$ (default: 20).
  - During digest dispatch, workers share pooled connections cleanly without exceeding the limit.
- **Detailed Acceptance Criteria:**
  - Validate `DATABASE_URL` format using Zod in `src/config/env.ts`.
  - Support connection pool tuning parameters: `connection_limit=25&pool_timeout=10`.
  - Implement a `PrismaService` singleton class to prevent multi-instantiation during development reloads or test runs.
  - Graceful shutdown hook in `server.ts` disconnecting Prisma on `SIGTERM` and `SIGINT`.
- **Test Specifications:**
  - Concurrency test: execute 50 parallel database reads and verify zero connection leaks or timeout errors.
  - Environment test: verify startup throws an informative error if `DATABASE_URL` is missing or invalid.

#### TASK-20.3: Scalability B-Tree & Composite Indexes for 10k+ Queries
- **User Story:**
  - *As the database engine,*
  - *I want optimized composite and B-Tree indexes on all frequently filtered columns,*
  - *So that job exploration, duplicate checking, and candidate matching execute in $O(\log N)$ time.*
- **Context & Problem:** With 50,000+ collected jobs and 10,000 users, full table scans on `(status = 'ACTIVE')` or checking sent history take hundreds of milliseconds per query, crippling throughput.
- **Detailed Acceptance Criteria:**
  - Index `User(telegramId)` as `UNIQUE B-Tree`.
  - Index `Job(deduplicationKey)` as `UNIQUE B-Tree`.
  - Composite Index `Job(status, publishedAt DESC)` for active job browsing.
  - Composite Index `Job(primarySpecialization, remoteScope, status)` for fast candidate pre-filtering.
  - Unique Composite Index `SentJob(userId, jobId)` for instant $O(1)$ duplicate delivery prevention.
  - Composite Index `DigestDelivery(slotId, status)` for chunked pending recipient retrieval.
  - Index `UserPreference(preferenceHash)` for equivalence class aggregation.
- **Test Specifications:**
  - Execute `EXPLAIN ANALYZE` on active job query and sent-history query; verify plan uses `Index Scan` or `Bitmap Index Scan` with 0 sequential scans.

---

### TASK-21: Persist Users, State & Preferences

#### TASK-21.1: User Lifecycle State Machine (Active, Paused, Blocked, Deleted)
- **User Story:**
  - *As the system,*
  - *I want to manage subscriber lifecycles through an explicit state machine with active, paused, blocked, and deleted states,*
  - *So that notifications are dispatched strictly to eligible users and Telegram error feedback is persisted immediately.*
- **Context & Problem:** In V1, if a user blocked the bot on Telegram, the system repeatedly attempted delivery, wasting network quota and triggering Telegram rate-limiting.
- **User Flow & Scenarios:**
  - User sends `/start` $\to$ State transitions to `ACTIVE`.
  - User sends `/pause` $\to$ State transitions to `PAUSED` with timestamp `pausedUntil`.
  - Telegram returns HTTP 403 Forbidden $\to$ State transitions to `BLOCKED`.
  - User sends `/stop` and confirms $\to$ State transitions to `DELETED`.
- **Detailed Acceptance Criteria:**
  - Implement `UserRepository` with methods: `findByTelegramId`, `create`, `updateStatus`, `findActiveRecipients`.
  - When status is `BLOCKED`, exclude user from all scheduled and on-demand digest queries.
  - When status is `PAUSED`, exclude user until `currentTime >= pausedUntil`.
  - When status is `DELETED`, anonymize username/first name while maintaining historical foreign key integrity.
- **Data Structures & Types:**
  ```typescript
  export enum UserStatus {
    ACTIVE = 'ACTIVE',
    PAUSED = 'PAUSED',
    BLOCKED = 'BLOCKED',
    DELETED = 'DELETED',
  }
  ```
- **Test Specifications:**
  - Unit tests for all state transitions: Active $\to$ Paused $\to$ Active, Active $\to$ Blocked, Active $\to$ Deleted.
  - Query test: `findActiveRecipients()` must return only users with `status = 'ACTIVE'` or `(status = 'PAUSED' AND pausedUntil <= NOW())`.

#### TASK-21.2: Preference Validation & Specialization Taxonomy (Max 3 of 10)
- **User Story:**
  - *As a candidate,*
  - *I want my preferences validated against the 10 approved technical specializations, selecting between 1 and 3 areas,*
  - *So that my job recommendations are laser-focused on my actual career profile.*
- **Context & Problem:** V1 allowed free-text skill queries, resulting in inconsistent search terms and sparse job matches. V2 standardizes on a closed, curated taxonomy.
- **Detailed Acceptance Criteria:**
  - Approved specializations: `BACKEND`, `FRONTEND`, `FULLSTACK`, `MOBILE`, `DEVOPS`, `UIUX`, `DATA`, `QA`, `SECURITY`, `AI_ENGINEER`.
  - Enforce constraint: `1 <= specializations.length <= 3`.
  - Enforce region preference: `ARAB`, `INTERNATIONAL`, `BOTH` (default).
  - Optional filters: `experienceLevel` (`JUNIOR`, `MID`, `SENIOR`), `workType` (`FULL_TIME`, `PART_TIME`, `CONTRACT`, `INTERNSHIP`).
  - Validate payloads using Zod schema: `UserPreferenceSchema`.
- **Test Specifications:**
  - Test validation failure when specializations array is empty (`length = 0`).
  - Test validation failure when 4 specializations are provided (`length = 4`).
  - Test successful validation for 1, 2, and 3 valid specializations.

#### TASK-21.3: Equivalence Class Vector Hashing for 10k Scalability
- **User Story:**
  - *As the matching engine,*
  - *I want a deterministic hash generated from every user's normalized preference vector,*
  - *So that 10,000 subscribers are partitioned into a few hundred equivalence classes for batch matching.*
- **Context & Problem:** Scoring 10,000 individual users against 500 active jobs equals 5,000,000 score evaluations per digest run. By grouping users with identical preferences, scoring is performed only once per group.
- **Detailed Acceptance Criteria:**
  - Normalize preference attributes: Sort specializations alphabetically, uppercase region, uppercase level/workType (or 'ANY').
  - Hash formula: `preferenceHash = crypto.createHash('sha256').update(sortedSpecs.join(',') + '|' + region + '|' + (level ?? 'ANY') + '|' + (workType ?? 'ANY')).digest('hex')`.
  - Store `preferenceHash` inside `UserPreference` on create and update.
  - Implement `UserPreferenceRepository.findEquivalenceGroups()` returning `Map<string, UserPreferenceGroup>`.
- **Complexity:** $O(1)$ hash generation. Group matching achieves $O(G \times J) \ll O(U \times J)$ where $G \approx 300$, reducing scoring operations by 95%.
- **Test Specifications:**
  - Verify that `['BACKEND', 'FRONTEND']` and `['FRONTEND', 'BACKEND']` generate identical hash values.
  - Verify that differing region preferences produce distinct hashes.

---

### TASK-22: Persist Shared Job Pool

#### TASK-22.1: Central Normalized Job Storage & Atomic Upsert
- **User Story:**
  - *As the central collector,*
  - *I want normalized job postings persisted in a shared pool with atomic upsert operations based on deduplication keys,*
  - *So that jobs collected across all sources are centrally stored and updated without data duplication or loss.*
- **Context & Problem:** Sources frequently re-list existing openings across days. Without atomic upserts, repeated collection runs either duplicate rows or crash on primary key collisions.
- **Detailed Acceptance Criteria:**
  - Upsert on conflict using `deduplicationKey`:
    - If new: Insert row with `status = 'ACTIVE'`, `scrapedAt = NOW()`, `lastSeenAt = NOW()`.
    - If exists: Update `lastSeenAt = NOW()`, preserving existing non-null fields (do not overwrite detailed descriptions with nulls).
  - Maintain provenance in `sourcesSeen: string[]`.
  - Implement `JobRepository.upsertJob(jobData: NormalizedJob): Promise<Job>`.
- **Test Specifications:**
  - Ingest job A. Verify record created. Ingest job A again with updated description and URL. Verify row updated in place, `lastSeenAt` bumped, and row count unchanged.

#### TASK-22.2: Active Job Filtering & Status Lifecycle (Active vs Closed)
- **User Story:**
  - *As a job seeker,*
  - *I want stale and closed jobs excluded from my digest and browsing results,*
  - *So that I only spend time applying to genuinely active opportunities.*
- **Detailed Acceptance Criteria:**
  - Job status enum: `ACTIVE`, `EXPIRED`, `CLOSED`.
  - Mark jobs as `EXPIRED` if `lastSeenAt` is older than the source's retention policy (default: 21 days).
  - Mark jobs as `CLOSED` if a source adapter explicitly reports job closure.
  - Query `findActiveJobs(filter)` filters strictly by `status = 'ACTIVE'`.
- **Test Specifications:**
  - Insert 5 active jobs and 2 expired jobs. Verify `findActiveJobs()` returns only the 5 active jobs.

---

### TASK-23: Persist Sent-Job History & Feedback

#### TASK-23.1: High-Throughput Delivery History Storage ($O(1)$ Lookup)
- **User Story:**
  - *As the delivery engine,*
  - *I want every delivered job recorded in a durable sent history table with $O(1)$ lookup guarantees,*
  - *So that subscribers never receive the same job twice across consecutive digests.*
- **Context & Problem:** In V1, sent tracking relied on Redis keys with 30-day TTL. If Redis flushed or key expired, users received duplicate alerts. Relational history guarantees persistent deduplication.
- **Detailed Acceptance Criteria:**
  - Create table `SentJob` with `(userId, jobId)` compound primary/unique key.
  - Implement `SentJobRepository.recordBatchSent(deliveries: { userId: string, jobId: string }[]): Promise<void>`.
  - Implement `SentJobRepository.getSentJobIdsForUser(userId: string): Promise<Set<string>>`.
  - Exclude candidates in SQL using `WHERE id NOT IN (SELECT job_id FROM sent_jobs WHERE user_id = :userId)` or in-memory using `Set.has(jobId)`.
- **Test Specifications:**
  - Record job J1 as sent to user U1. Verify subsequent query excludes J1 for U1, but includes J1 for user U2.

#### TASK-23.2: User Relevance Feedback Storage (👍 / 👎)
- **User Story:**
  - *As a user,*
  - *I want to rate recommended jobs with thumbs up or thumbs down buttons,*
  - *So that my feedback is recorded and can be used to monitor match relevance.*
- **Detailed Acceptance Criteria:**
  - Support feedback states: `LIKE`, `DISLIKE`, `NONE`.
  - Update feedback on existing `SentJob` row when user clicks the inline button.
  - Idempotent: Clicking the same rating twice does not error.
  - Return brief Telegram callback answer toast: "تم تسجيل تقييمك بنجاح 👍".
- **Test Specifications:**
  - Update feedback from `NONE` to `LIKE`. Verify DB record. Update to `DISLIKE`. Verify DB updated.

---

### TASK-24: Delivery Attempts Tracking, Data Retention & Backups

#### TASK-24.1: Slot-Based Delivery Run State Tracking
- **User Story:**
  - *As an operations engineer,*
  - *I want every twice-daily digest dispatch tracked as a unique DeliverySlot with individual recipient status records,*
  - *So that mid-run process crashes can be resumed without sending duplicate digests to completed users.*
- **Context & Problem:** Delivering 10,000 messages takes 6–7 minutes due to Telegram rate limits. If the container restarts at minute 4, the entire run could fail or re-send to users 1–5,000.
- **Detailed Acceptance Criteria:**
  - Generate slot key: `slotKey = "digest:YYYY-MM-DD:0900"`.
  - On start, insert `DeliverySlot` (`status = 'RUNNING'`).
  - Pre-populate or streaming-insert `DigestDelivery` for all eligible users with status `PENDING`.
  - As each batch of 25 finishes, atomically update status to `SENT`, `FAILED`, or `BLOCKED`.
  - If a slot already exists in `RUNNING` or `PARTIAL_FAILED` state on startup, resume strictly from records where `status IN ('PENDING', 'FAILED')`.
- **Test Specifications:**
  - Simulate server crash after 30 deliveries out of 100. Restart delivery worker. Verify that the remaining 70 users receive digests, and the first 30 receive 0 duplicate messages.

#### TASK-24.2: Automated Data Pruning & Retention Lifecycle Policies
- **User Story:**
  - *As the system administrator,*
  - *I want automated background retention pruning for old jobs, sent logs, and slot metadata,*
  - *So that database storage stays bounded under 10k user volume.*
- **Detailed Acceptance Criteria:**
  - Prune `SentJob` records older than 60 days.
  - Archive/Delete `Job` records with `status = 'CLOSED'` older than 30 days.
  - Clean `DigestDelivery` and `DeliverySlot` records older than 30 days.
  - Provide a standalone script `npm run db:prune` executable via scheduled job.
- **Test Specifications:**
  - Insert test records older than 65 days and newer records. Run prune script. Verify only >60 day records deleted.

---

## Milestone M2: Central Collection & Shared Job Pool

### TASK-25: Standardize Job Source Contract & Adapter Hardening

#### TASK-25.1: Unified JobSource Contract & Error Isolation with Promise.allSettled
- **User Story:**
  - *As the collection engine,*
  - *I want all job sources implementing a standardized `JobSource` interface and executed via `Promise.allSettled`,*
  - *So that one failing job board never crashes or halts the collection of other boards.*
- **Detailed Acceptance Criteria:**
  - Define interface:
    ```typescript
    export interface JobSource {
      readonly type: JobSourceType;
      fetchJobs(): Promise<RawJobListing[]>;
    }
    ```
  - Note: `fetchJobs()` accepts zero subscriber parameters; collection is global.
  - Wrap every source invocation in a 10-second `AbortSignal` timeout.
  - Execute all active sources using `Promise.allSettled`.
  - Record failed sources into operational telemetry.
- **Test Specifications:**
  - Create 3 mock sources: Source 1 succeeds, Source 2 throws HTTP 500, Source 3 succeeds. Run manager. Verify output contains results from 1 and 3, and failure of 2 is captured safely.

#### TASK-25.2: Source Fixture Testing & Mock Harness
- **User Story:**
  - *As a developer,*
  - *I want comprehensive unit tests for every source adapter using static JSON and HTML fixtures,*
  - *So that source parsers are rigorously validated in CI without making live network requests.*
- **Detailed Acceptance Criteria:**
  - Store real-world response fixtures in `tests/fixtures/sources/` for: Remotive, WeWorkRemotely, Mostaql, Tanqeeb, Adzuna, Jooble, and LinkedIn.
  - Test parser extractions: Title, company, location, URL, description, publication date.
  - Test resilient fallback when optional fields (salary, location) are omitted.
- **Test Specifications:**
  - Run `npm test tests/sources/` in complete network-isolated mode; 100% tests must pass.

---

### TASK-26: Independent Scheduled Job Collector

#### TASK-26.1: Decoupled Collection Pipeline Engine
- **User Story:**
  - *As the platform,*
  - *I want job collection running on an independent, configurable schedule with zero dependency on user interaction,*
  - *So that user commands like `/jobs` or onboarding flows never trigger slow external scraping.*
- **Detailed Acceptance Criteria:**
  - Schedule collector via Cron (e.g. 05:00 and 17:00 UTC) or internal authenticated POST endpoint.
  - Collector pipeline sequence: `Harvest Sources` $\to$ `Normalize & Sanitize` $\to$ `Two-Tier Deduplicate` $\to$ `Deterministic Classify` $\to$ `Upsert to Shared Pool`.
  - Prevent concurrent collector runs using PostgreSQL advisory locks (`pg_try_advisory_lock`).
- **Test Specifications:**
  - Trigger collector endpoint twice concurrently. Verify lock prevents second run from executing simultaneously.

#### TASK-26.2: Collector Execution Metrics & Telemetry
- **User Story:**
  - *As an operations engineer,*
  - *I want rich structured logs and metrics for every collection run,*
  - *So that source anomalies, scraping blocks, and yield drops are immediately observable.*
- **Detailed Acceptance Criteria:**
  - Output structured JSON summary: `runId`, `durationMs`, `sourcesAttempted`, `sourcesFailed`, `totalFetched`, `newJobsInserted`, `existingJobsUpdated`, `duplicatesDropped`.
  - Update `lastCollectionStats` accessible via `GET /health`.
- **Test Specifications:**
  - Execute a mock collection run; verify `GET /health` returns matching counts.

---

### TASK-27: Job Normalization & Sanitization

#### TASK-27.1: Text Sanitization & Safe HTML Stripping
- **User Story:**
  - *As the ingestion pipeline,*
  - *I want all job titles, company names, and descriptions stripped of HTML, tracking params, and control characters,*
  - *So that job listings render safely in Telegram markdown and web interfaces.*
- **Detailed Acceptance Criteria:**
  - Strip HTML tags while preserving line breaks for paragraphs.
  - Decode HTML entities (`&nbsp;` $\to$ space, `&amp;` $\to$ `&`, `&quot;` $\to$ `"`).
  - Strip UTM tracking parameters from `url` and `applicationUrl`.
  - Validate URL format via Zod `z.string().url()`.
- **Test Specifications:**
  - Input: `<p>Senior Backend <b>Engineer</b> &amp; Team Lead</p>`. Output: `Senior Backend Engineer & Team Lead`.
  - Input: `https://company.com/job?utm_source=adzuna&utm_medium=api`. Output: `https://company.com/job`.

#### TASK-27.2: Location & Timestamp Standardization
- **User Story:**
  - *As the ingestion pipeline,*
  - *I want publication dates converted to ISO-8601 UTC and locations normalized into standard formats,*
  - *So that freshness sorting and regional matching operate on uniform data.*
- **Detailed Acceptance Criteria:**
  - Parse multiple date formats: Epoch timestamps, ISO strings, RSS RFC-2822 dates, and relative Arabic/English strings ("منذ ساعتين", "3 days ago").
  - Default missing publication dates to `scrapedAt` timestamp.
  - Parse and normalize locations into city, country, and remote indicators.
- **Test Specifications:**
  - Convert "2026-10-15T12:00:00Z", "Wed, 14 Oct 2026 10:00:00 GMT", and epoch 1792000000 to valid JS `Date` objects.

---

### TASK-28: Two-Tier Deduplication & Rich Data Merger

#### TASK-28.1: Level 1 SHA-256 Composite Fingerprint Engine
- **User Story:**
  - *As the deduplication engine,*
  - *I want exact duplicate postings identified via a SHA-256 composite fingerprint,*
  - *So that identical listings from the same source/URL are never duplicated in the shared pool.*
- **Detailed Acceptance Criteria:**
  - Formula: `SHA256(canonical(title) + "|" + canonical(company) + "|" + cleanUrl(url))`.
  - Canonicalize: Lowercase, remove special characters, collapse whitespace.
  - Set as `Job.deduplicationKey` in PostgreSQL.
- **Complexity:** Hashing in $O(m)$ where $m$ is text length. Index lookup in $O(1)$.
- **Test Specifications:**
  - Verify that varying whitespace or casing produces the identical fingerprint.

#### TASK-28.2: Level 2 Cross-Source Semantic Fingerprint Engine
- **User Story:**
  - *As the deduplication engine,*
  - *I want duplicate listings across different job boards detected via semantic title-company hashing,*
  - *So that a job posted on both Adzuna and Remotive is consolidated into a single entry.*
- **Detailed Acceptance Criteria:**
  - Formula: `SHA256(canonicalTitle(title) + "|" + canonicalCompany(company))`.
  - Canonicalize common title variants: "Back End" $\to$ "Backend", "Full-Stack" $\to$ "Full Stack", "Sr." $\to$ "Senior".
  - If a candidate shares the semantic key of an active job, trigger the merger policy instead of inserting a duplicate row.
- **Test Specifications:**
  - Ingest "Senior Backend Engineer" at "Acme Corp" from Source A. Ingest "Sr. Back End Engineer" at "Acme Corp" from Source B. Verify cross-source duplicate detected.

#### TASK-28.3: Intelligent Field Precedence & Rich Listing Merger
- **User Story:**
  - *As the deduplication engine,*
  - *I want duplicate listings merged by prioritizing direct ATS links, detailed descriptions, and salary info,*
  - *So that candidates receive the highest quality version of any job posting.*
- **Detailed Acceptance Criteria:**
  - Link Precedence: Company ATS/Direct (`lever.co`, `greenhouse.io`, `workday.com`, etc.) > Primary Job Board > General Aggregator.
  - Description: Keep the longer, richer description.
  - Salary: If one listing has salary and the other does not, retain the salary data.
  - Append source identifier to `sourcesSeen: string[]`.
- **Test Specifications:**
  - Merge Listing 1 (short description, direct ATS link) with Listing 2 (long description, aggregator link). Verify merged record has long description AND direct ATS link.

---

### TASK-29: Source Throttling & Health Monitor

#### TASK-29.1: Circuit Breaker & Exponential Backoff for Source Outages
- **User Story:**
  - *As the collector,*
  - *I want failing or rate-limiting sources protected by circuit breakers and backoff,*
  - *So that transient source errors do not flood remote servers or hang collection cycles.*
- **Detailed Acceptance Criteria:**
  - State machine: `CLOSED` (Normal), `OPEN` (Tripped), `HALF_OPEN` (Trial).
  - Trip breaker to `OPEN` on: 3 consecutive network timeouts, HTTP 429, or HTTP 5xx.
  - In `OPEN` state, immediately skip source for current run without making HTTP calls.
  - Cooldown: 15 minutes before transitioning to `HALF_OPEN`.
- **Test Specifications:**
  - Simulate 3 consecutive 503 errors on Source X. Verify 4th call is skipped immediately.

#### TASK-29.2: Consecutive Failure Detection & Source Health Telemetry
- **User Story:**
  - *As the platform maintainer,*
  - *I want automated health monitoring tracking failure streaks and zero-yield runs per source,*
  - *So that broken HTML scrapers or expired API keys are immediately surfaced.*
- **Detailed Acceptance Criteria:**
  - Record consecutive failure count and consecutive zero-yield count per source in database or memory.
  - If consecutive failures $\ge 2$, mark status as `UNHEALTHY`.
  - Expose status in `GET /health` with `sources: Record<string, SourceHealthStatus>`.
- **Test Specifications:**
  - Verify `/health` reports `DEGRADED` or `UNHEALTHY` after simulated source failures.

---

## Milestone M3: Deterministic Classification & Remote Scope

### TASK-30: Deterministic Specialization Classifier

#### TASK-30.1: Title-First Tokenized Rule Engine (Trie / Keyword Sets)
- **User Story:**
  - *As the classification engine,*
  - *I want job titles tokenized and matched against deterministic keyword sets for the 10 approved specializations,*
  - *So that over 90% of jobs are accurately classified instantly with zero AI cost.*
- **Detailed Acceptance Criteria:**
  - 10 Specializations: `BACKEND`, `FRONTEND`, `FULLSTACK`, `MOBILE`, `DEVOPS`, `UIUX`, `DATA`, `QA`, `SECURITY`, `AI_ENGINEER`.
  - Curated token dictionaries:
    - `BACKEND`: `node.js`, `express`, `nest.js`, `django`, `fastapi`, `spring boot`, `laravel`, `golang`, `backend`, `back-end`, `c#`, `.net`.
    - `FRONTEND`: `react`, `vue`, `angular`, `next.js`, `nuxt`, `frontend`, `front-end`, `tailwind`, `css3`.
    - `FULLSTACK`: `fullstack`, `full-stack`, `full stack`, `mern`, `mean`.
    - `MOBILE`: `flutter`, `react native`, `ios`, `swift`, `android`, `kotlin`, `mobile`.
    - `DEVOPS`: `devops`, `sre`, `kubernetes`, `docker`, `terraform`, `aws`, `cloud engineer`, `ci/cd`.
    - `UIUX`: `ui/ux`, `ux/ui`, `product designer`, `figma`, `ui designer`, `ux designer`.
    - `DATA`: `data engineer`, `data analyst`, `data scientist`, `bi engineer`, `sql developer`, `etl`.
    - `QA`: `qa`, `quality assurance`, `test automation`, `tester`, `selenium`, `cypress`, `playwright`.
    - `SECURITY`: `cybersecurity`, `infosec`, `penetration tester`, `soc analyst`, `security engineer`.
    - `AI_ENGINEER`: `ai engineer`, `machine learning`, `nlp`, `llm`, `deep learning`, `computer vision`.
  - Assign `classificationMethod = 'RULE_TITLE'` and `confidence = 0.95`.
- **Complexity:** $O(k)$ where $k$ is token count of title. Execution takes $<0.1\text{ms}$ per job.
- **Test Specifications:**
  - Test suite of 100 benchmark job titles; verify $\ge 90\%$ classified correctly without AI.

#### TASK-30.2: Explicit Exclusion Negative Matcher
- **User Story:**
  - *As the classification engine,*
  - *I want explicit negative exclusion patterns evaluated prior to positive classification,*
  - *So that non-technical and managerial postings are rejected from technical candidate digests.*
- **Detailed Acceptance Criteria:**
  - Exclusions: `recruiter`, `talent acquisition`, `sales manager`, `account manager`, `marketing specialist`, `executive assistant`, `content writer`, `customer support`.
  - If a negative pattern matches (e.g. "Technical Recruiter" or "DevOps Sales Manager"), mark as `NON_TECHNICAL` or reject from pool.
- **Test Specifications:**
  - Input: "QA Recruitment Consultant". Output: Rejected / `NON_TECHNICAL`.
  - Input: "Software Sales Account Executive". Output: Rejected / `NON_TECHNICAL`.

#### TASK-30.3: Primary and Secondary Specialization Assignment
- **User Story:**
  - *As the classification engine,*
  - *I want to assign a required primary specialization and an optional secondary specialization,*
  - *So that multi-disciplinary roles (e.g., Fullstack with heavy DevOps) are matched appropriately.*
- **Detailed Acceptance Criteria:**
  - If title matches multiple domains (e.g. "Full Stack Engineer (React/Node) with AWS/DevOps"), assign:
    - `primarySpecialization = FULLSTACK`
    - `secondarySpecialization = DEVOPS`
  - Secondary match is optional (`null` if single domain).
- **Test Specifications:**
  - Classify "Data Scientist / Machine Learning Engineer" $\to$ Primary: `DATA`, Secondary: `AI_ENGINEER`.

---

### TASK-31: Scoped AI Ambiguity Resolver

#### TASK-31.1: Ambiguity Detection Trigger & Isolation
- **User Story:**
  - *As the classification engine,*
  - *I want Gemini AI called ONLY when deterministic rules yield genuine ambiguity or zero matches,*
  - *So that AI token costs are minimized and AI service downtime never halts collection.*
- **Detailed Acceptance Criteria:**
  - Trigger conditions:
    1. Deterministic rules return `UNRESOLVED`.
    2. Deterministic rules detect severe title vs description conflict.
  - Prohibit AI invocation for jobs with high-confidence title matches.
  - Prohibit AI invocation for calculating user-specific match scores.
- **Test Specifications:**
  - Process 50 jobs with unambiguous titles. Verify mock AI provider was called 0 times.

#### TASK-31.2: Gemini Provider Integration with Zod Schema Validation
- **User Story:**
  - *As the system,*
  - *I want Gemini prompts tightly structured and responses strictly validated using Zod,*
  - *So that malformed LLM outputs never corrupt the database.*
- **Detailed Acceptance Criteria:**
  - System Prompt: "You are a job specialization classifier. Categorize the role into exactly one of the 10 allowed specializations."
  - Input: Clean title + first 500 characters of description.
  - Zod Response Schema:
    ```typescript
    export const AIAmbiguityResolutionSchema = z.object({
      specialization: z.nativeEnum(Specialization),
      confidence: z.number().min(0).max(1),
      reasoning: z.string().max(200),
    });
    ```
  - On validation error, log and set job as `UNRESOLVED` without throwing.
- **Test Specifications:**
  - Mock Gemini returning valid JSON $\to$ Verify parsed specialization stored.
  - Mock Gemini returning invalid JSON or unknown enum $\to$ Verify handled safely as `UNRESOLVED`.

#### TASK-31.3: Graceful Degradation on AI Outage
- **User Story:**
  - *As the platform,*
  - *I want collection, matching, and digests to continue functioning with 100% availability if Gemini fails,*
  - *So that third-party AI outages never cause user-facing downtime.*
- **Detailed Acceptance Criteria:**
  - Wrap Gemini provider calls in timeout (5s) and circuit breaker.
  - If all Gemini keys fail or quota is exhausted, leave ambiguous jobs as `UNRESOLVED`.
  - All deterministically classified jobs proceed through the pipeline normally.
- **Test Specifications:**
  - Set invalid Gemini API key. Run collection pipeline. Verify pipeline completes successfully with 0 unhandled exceptions.

---

### TASK-32: Experience Level & Work Type Heuristic Classifier

#### TASK-32.1: Seniority Heuristic Engine (Junior, Mid, Senior, Unknown)
- **User Story:**
  - *As a candidate,*
  - *I want jobs labeled accurately with seniority levels (Junior, Mid, Senior),*
  - *So that I can evaluate suitability without reading through paragraphs of text.*
- **Detailed Acceptance Criteria:**
  - `JUNIOR`: Tokens `junior`, `entry level`, `fresh graduate`, `associate`, `intern`, `0-2 years`.
  - `MID`: Tokens `mid-level`, `intermediate`, `2-5 years` (default if no seniority specified).
  - `SENIOR`: Tokens `senior`, `sr.`, `lead`, `staff`, `principal`, `architect`, `head of`, `5+ years`.
  - Store as `UNKNOWN` if evidence is contradictory or absent.
- **Test Specifications:**
  - Test "Lead Software Architect" $\to$ `SENIOR`.
  - Test "Entry Level Python Developer" $\to$ `JUNIOR`.

#### TASK-32.2: Contract & Employment Type Heuristic Engine
- **User Story:**
  - *As a candidate,*
  - *I want employment types classified cleanly (Full-time, Part-time, Contract, Internship),*
  - *So that I only apply to roles fitting my work availability.*
- **Detailed Acceptance Criteria:**
  - Support: `FULL_TIME`, `PART_TIME`, `CONTRACT`, `INTERNSHIP`, `UNKNOWN`.
  - Check source structured fields first; fallback to description keyword heuristics.
- **Test Specifications:**
  - Test "Freelance React Developer - 3 months contract" $\to$ `CONTRACT`.

---

### TASK-33: Remote Eligibility & Regional Scope Classifier

#### TASK-33.1: 4-Tier Scope Categorization (WORLDWIDE, REGION, COUNTRY, UNKNOWN)
- **User Story:**
  - *As a global candidate,*
  - *I want genuine worldwide remote opportunities strictly distinguished from geographically restricted roles,*
  - *So that I don't waste time applying to positions requiring US/EU residency or work permits.*
- **Detailed Acceptance Criteria:**
  - `WORLDWIDE`: Open globally without location constraints.
  - `REGION`: Restricted to a macro region (e.g., `MENA`, `EMEA`, `LATAM`, `Europe`).
  - `COUNTRY`: Restricted to a specific country (e.g., "Remote - USA only", "عن بعد - السعودية فقط").
  - `UNKNOWN`: Insufficient data.
  - **Golden Rule:** Never classify as `WORLDWIDE` unless explicit affirmative evidence exists (e.g. "anywhere in the world", "work from anywhere", "worldwide remote").
- **Test Specifications:**
  - "Remote Frontend Engineer (Must reside in Germany)" $\to$ Scope: `COUNTRY`, Country: `DE`.
  - "Remote Node.js Developer (Worldwide / Work from anywhere)" $\to$ Scope: `WORLDWIDE`.

#### TASK-33.2: Evidence-Based Confidence Scoring & Contradiction Detection
- **User Story:**
  - *As the system,*
  - *I want evidence sources logged and contradictions resolved in favor of geographic restrictions,*
  - *So that candidates are protected from misleading remote job claims.*
- **Detailed Acceptance Criteria:**
  - Record `remoteScopeEvidence`: Source API flag, Title token, or Description clause.
  - Contradiction resolution: If title says "Remote", but description says "Must hold US Citizenship and be based in US", resolve to `COUNTRY` (US).
- **Test Specifications:**
  - Verify contradictory posting resolves to restricted country rather than worldwide.

---

## Milestone M4: Arabic-First Telegram Onboarding & Preferences

### TASK-34: Multi-Select Specialization Keyboards

#### TASK-34.1: Welcome & State Initialization on `/start`
- **User Story:**
  - *As a new user,*
  - *I want a welcoming, concise Arabic introduction on `/start` explaining the bot and initiating setup,*
  - *So that I understand the bot's value and can configure my preferences in under 30 seconds.*
- **Detailed Acceptance Criteria:**
  - Send welcome greeting in clear Arabic.
  - Query database: If user exists, load existing preferences; if new, insert `User` (`status = 'ACTIVE'`).
  - Display inline keyboard for Step 1: Specialization Selection.
  - Idempotent: Repeated `/start` commands reset preference draft safely without error.
- **Test Specifications:**
  - Test `/start` handler with mocked grammY context; verify welcome message and keyboard payload sent.

#### TASK-34.2: Inline Button Multi-Selection (1 to 3 Specializations) with Toggle State
- **User Story:**
  - *As a candidate,*
  - *I want to select between 1 and 3 specializations using interactive inline buttons with checkmarks (✅),*
  - *So that I can tailor my job alerts without typing free-form text.*
- **Detailed Acceptance Criteria:**
  - Display 10 approved specializations as 2-column inline buttons.
  - Clicking a specialization toggles state: Adds or removes ✅ icon.
  - Enforce maximum 3 selections: If user clicks a 4th, do not select; display Telegram toast via `answerCallbackQuery`: "الحد الأقصى هو 3 تخصصات فقط ⚠️".
  - Include navigation button: "التالي ⬅️".
  - If user clicks "التالي" with 0 selections, show toast: "يرجى اختيار تخصص واحد على الأقل للمتابعة 📌".
- **Test Specifications:**
  - Simulate selecting 3 items then clicking a 4th; verify callback query answered with alert and state unchanged.

---

### TASK-35: Target Region & Preference Confirmation Flow

#### TASK-35.1: Region Preference Selection (Arab, International, Both)
- **User Story:**
  - *As a candidate,*
  - *I want to select my target job market: Arab region, International, or Both,*
  - *So that I receive opportunities tailored to my geographic relocation or remote preferences.*
- **Detailed Acceptance Criteria:**
  - Present 3 interactive buttons:
    - 🌍 **السوق العربي والدولي معاً** (`BOTH` - Default & Recommended).
    - 🏢 **السوق العربي وفرص الشرق الأوسط** (`ARAB`).
    - 🌐 **السوق الدولي والعمل عن بعد عالمياً** (`INTERNATIONAL`).
  - Explain clearly that this preference guides which jobs are sent, independent of job remote scope.
- **Test Specifications:**
  - Click `ARAB` button; verify draft preference updated and user navigated to confirmation review.

#### TASK-35.2: Interactive Summary Review & Transactional Preference Save
- **User Story:**
  - *As a candidate,*
  - *I want to review a summary of my selections and confirm them before saving,*
  - *So that I can verify my preferences and receive an instant initial digest.*
- **Detailed Acceptance Criteria:**
  - Display review card summarizing chosen specializations and region preference.
  - Provide two buttons: "تأكيد وحفظ ✅" and "تعديل الاختيارات ✏️".
  - Clicking "تأكيد وحفظ":
    - Transactionally write `UserPreference` to PostgreSQL.
    - Compute and store `preferenceHash`.
    - Trigger immediate first digest flow (`TASK-40`).
- **Test Specifications:**
  - Verify DB record contains exact selected enums and computed hash upon confirmation.

---

### TASK-36: Settings, Pause/Resume, Account Deletion & Help

#### TASK-36.1: `/settings` Interactive Preference Editor
- **User Story:**
  - *As a registered subscriber,*
  - *I want to view and edit my saved preferences via `/settings` at any time,*
  - *So that I can update my career interests as my skills evolve.*
- **Detailed Acceptance Criteria:**
  - Query user preferences from PostgreSQL.
  - Render current settings with buttons to "تعديل التخصصات 🛠️" or "تعديل المنطقة 🌍".
  - Apply changes immediately to all future digests and `/jobs` queries without deleting historical delivery logs.
- **Test Specifications:**
  - Update preferences via `/settings`; verify new preferences reflected immediately in subsequent queries.

#### TASK-36.2: `/pause` (1 Day, 1 Week, Indefinite) & `/resume` Commands
- **User Story:**
  - *As a subscriber,*
  - *I want to pause notifications temporarily or resume them with simple commands,*
  - *So that I can stop notifications during vacations or interviews without losing my settings.*
- **Detailed Acceptance Criteria:**
  - `/pause` displays options: "لمدة يوم", "لمدة أسبوع", "حتى أقوم بالاستئناف يدوياً".
  - Set `status = 'PAUSED'` and update `pausedUntil` timestamp.
  - Paused users are strictly excluded from scheduled 09:00 and 21:00 digest dispatches.
  - `/resume` sets `status = 'ACTIVE'` and sends confirmation: "تم استئناف إشعارات الوظائف بنجاح 🚀".
- **Test Specifications:**
  - Execute `/pause` for 1 day; verify `pausedUntil` is set to $NOW + 24\text{ hours}$. Verify delivery query excludes user.

#### TASK-36.3: `/stop` Two-Step Confirmation & Data Anonymization
- **User Story:**
  - *As a user,*
  - *I want to unsubscribe and delete my profile with a confirmation prompt,*
  - *So that I can exercise my data privacy rights without accidental unsubscriptions.*
- **Detailed Acceptance Criteria:**
  - `/stop` displays warning: "هل أنت متأكد من رغبتك في إلغاء الاشتراك وحذف بياناتك؟" with buttons: "نعم، حذف البيانات ❌" and "تراجع ↩️".
  - Upon confirmation: Update `status = 'DELETED'`, delete `UserPreference`, and anonymize personal names.
  - Zero subsequent digests are sent to deleted users.
- **Test Specifications:**
  - Test confirmation sets status to `DELETED`. Verify subsequent digest run completely skips this user.

#### TASK-36.4: `/help` Arabic Command Directory & Usage Guide
- **User Story:**
  - *As a user,*
  - *I want a clear Arabic directory of all bot commands via `/help`,*
  - *So that I can independently navigate all platform capabilities.*
- **Detailed Acceptance Criteria:**
  - Explain: `/jobs` (explore matching jobs), `/settings` (edit preferences), `/pause` (pause alerts), `/resume` (resume alerts), `/stop` (unsubscribe), and `/help`.
  - Format with clean Markdown and emoji bullet points.
- **Test Specifications:**
  - Verify `/help` handler returns complete command list.

---

## Milestone M5: High-Performance Deterministic Matching Engine

### TASK-37: Hard Filter Exclusion Engine

#### TASK-37.1: Specialization & Region Incompatibility Exclusion
- **User Story:**
  - *As the matching engine,*
  - *I want clearly incompatible jobs filtered out before scoring,*
  - *So that zero compute time is wasted scoring jobs the candidate cannot accept.*
- **Detailed Acceptance Criteria:**
  - Specialization Filter: Job `primarySpecialization` OR `secondarySpecialization` MUST intersect with user's selected specializations (`1..3`).
  - Region Filter:
    - If user prefers `ARAB`: Exclude non-worldwide jobs restricted to non-Arab countries.
    - If user prefers `INTERNATIONAL`: Exclude on-site local roles restricted to Arab countries.
    - If user prefers `BOTH`: Allow all matching specializations.
- **Complexity:** $O(1)$ set checks.
- **Test Specifications:**
  - Candidate with `[BACKEND]` preference rejects a `FRONTEND` job with 100% certainty.

#### TASK-37.2: Historical Delivery Exclusion ($O(1)$ Hash Set)
- **User Story:**
  - *As the matching engine,*
  - *I want previously delivered jobs excluded in $O(1)$ lookup time,*
  - *So that candidate digests contain only fresh, unseen opportunities.*
- **Detailed Acceptance Criteria:**
  - Load user's delivered job IDs into in-memory `Set<string>`.
  - Filter candidate array: `candidates.filter(job => !sentSet.has(job.id))`.
- **Test Specifications:**
  - Input: 10 candidate jobs, 4 already present in `sentSet`. Output: 6 candidates.

---

### TASK-38: Explainable Bounded Scoring Calculator

#### TASK-38.1: Additive Multi-Signal Weighting Algorithm
- **User Story:**
  - *As a candidate,*
  - *I want jobs ranked by a transparent, bounded, deterministic score,*
  - *So that the most relevant opportunities appear first with consistent ranking.*
- **Detailed Acceptance Criteria:**
  - Signal Weights:
    - Primary Specialization Match: $+50$ points.
    - Secondary Specialization Match: $+30$ points (mutually exclusive with primary).
    - Experience Level Match: $+15$ points (if user configured level, or $+10$ for `ANY`).
    - Region & Remote Scope Fit: $+15$ points (`WORLDWIDE` or direct market fit).
    - Freshness Score: Up to $+10$ points (Linear decay: $\max(0, 10 - \text{daysSincePublished})$).
    - Direct Company ATS Source: $+5$ points (`lever`, `greenhouse`, direct company career page).
  - Bounded Range: Score is strictly clamped between $0$ and $100$.
  - Minimum Acceptance Threshold: $55$ points. Roles below 55 are excluded from digests.
- **Test Specifications:**
  - Exact match fresh role: $50 + 15 + 15 + 10 + 5 = 95$ points.
  - Secondary match 5-day old role: $30 + 10 + 15 + 5 + 0 = 60$ points.

#### TASK-38.2: Transparent Arabic Explanation Builder
- **User Story:**
  - *As a candidate,*
  - *I want a short Arabic explanation accompanying each job recommendation,*
  - *So that I understand why this specific job was selected for me.*
- **Detailed Acceptance Criteria:**
  - Build explanation string dynamically from score signals:
    - "تطابق ممتاز: تخصص أساسي مطابق + فرصة عن بعد عالمية + نشرت حديثاً".
  - Attach explanation to matching result.
- **Test Specifications:**
  - Verify explanation text matches computed score components.

---

### TASK-39: Equivalence Group Matching Optimizer (10k+ Users Scaling)

#### TASK-39.1: Equivalence Vector Hashing & User Grouping ($O(G \times J)$)
- **User Story:**
  - *As the matching engine,*
  - *I want users grouped by preference hash so candidate jobs are evaluated once per group instead of once per user,*
  - *So that matching scales easily to 10,000+ users without CPU spikes or execution timeouts.*
- **Detailed Acceptance Criteria:**
  - Query active users grouped by `preferenceHash`.
  - For each distinct group $g \in G$:
    - Run hard filters and scoring against all active jobs.
    - Sort candidate jobs by score descending.
    - Cache top $M$ candidates in memory for the duration of the run.
- **Complexity:** $O(G \times J)$ where $G \approx 200..400$ distinct groups. Eliminates 95% of compute operations compared to naive $O(U \times J)$.
- **Test Specifications:**
  - Benchmark test: 1,000 users distributed across 10 equivalence groups. Verify score function executed exactly 10 times, not 1,000 times.

#### TASK-39.2: Personalized Sent-Log Application per Group Member
- **User Story:**
  - *As the matching engine,*
  - *I want group rankings personalized per user by subtracting each user's unique sent history,*
  - *So that group members receive fresh jobs without cross-user interference.*
- **Detailed Acceptance Criteria:**
  - Iterate through users in group $g$.
  - For each user: Read `sentSet`, filter cached group ranking, pick top 20 remaining jobs.
- **Test Specifications:**
  - User A and User B in same group. User A has seen Job 1; User B has not. Verify User A receives Jobs 2–21, User B receives Jobs 1–20.

---

## Milestone M6: Resilient Twice-Daily Digest Delivery (10k Users Delivery)

### TASK-40: Instant First Digest on Onboarding

#### TASK-40.1: Post-Onboarding Database Query & Immediate Send
- **User Story:**
  - *As a newly subscribed candidate,*
  - *I want my first digest delivered immediately upon completing onboarding,*
  - *So that I experience the bot's core value right away without waiting for the next scheduled slot.*
- **Detailed Acceptance Criteria:**
  - Send searching message: "جاري البحث عن أنسب الفرص المتاحة لك الآن... 🔍".
  - Query active jobs from PostgreSQL using user's new preferences.
  - Score and select top 5 jobs for Page 1 (max 20 total across pages).
  - Edit initial message with formatted digest cards.
  - Record delivered jobs in `SentJob`.
- **Test Specifications:**
  - Complete preference confirmation; verify digest message delivered in $<1.5$ seconds.

#### TASK-40.2: Zero-Match Empty State Guidance
- **User Story:**
  - *As a candidate,*
  - *I want helpful guidance if no jobs currently match my criteria,*
  - *So that I understand my settings are saved and future jobs will be sent as soon as they are collected.*
- **Detailed Acceptance Criteria:**
  - Render polite empty state: "لا توجد وظائف مطابقة تماماً لتخصصك حالياً 🔎. سيقوم البوت بإشعارك تلقائياً في الجولة القادمة (09:00 أو 21:00) فور جمع فرص جديدة تناسبك ✨".
  - Provide button to edit settings or expand region preference.
- **Test Specifications:**
  - Query with zero matching jobs; verify clean empty state rendered without throwing exceptions.

---

### TASK-41: Slot-Based Batch Delivery Engine

#### TASK-41.1: Timezone-Aware Scheduled Cron Trigger (09:00 & 21:00 Asia/Gaza)
- **User Story:**
  - *As a subscriber,*
  - *I want digests delivered reliably twice a day at 09:00 and 21:00 Asia/Gaza,*
  - *So that I receive timely updates aligned with morning and evening job browsing habits.*
- **Detailed Acceptance Criteria:**
  - Schedule jobs using Luxon or cron-parser configured for `Asia/Gaza`.
  - Create `DeliverySlot` record with unique slot key `digest:YYYY-MM-DD:HHmm`.
  - Prevent concurrent slot runs via PostgreSQL advisory locks and unique constraints.
- **Test Specifications:**
  - Verify scheduler triggers at 09:00 and 21:00 Gaza time across daylight saving changes.

#### TASK-41.2: Chunked Cursor Dispatcher (Batches of 25 with 25 msgs/sec pacing)
- **User Story:**
  - *As the delivery engine,*
  - *I want 10,000 digest messages dispatched in sequential batches of 25 users paced at 25 msgs/sec,*
  - *So that delivery completes reliably in 6–7 minutes without violating Telegram broadcast rate limits.*
- **Detailed Acceptance Criteria:**
  - Query eligible recipients in cursor batches of 25.
  - Send messages with rate-limiter token bucket enforcing $\le 25 \text{ msgs/second}$.
  - Transactionally update `DigestDelivery` status to `SENT` or `FAILED` per user.
- **Complexity:** $O(U)$ linear time execution. Memory footprint bounded under $50\text{MB}$.
- **Test Specifications:**
  - Simulate 250 deliveries. Monitor throughput; verify rate never exceeds 25 messages per second.

#### TASK-41.3: Idempotent State Machine & Crash Recovery
- **User Story:**
  - *As an operations engineer,*
  - *I want an interrupted delivery run to resume seamlessly upon container restart,*
  - *So that zero subscribers are missed and zero subscribers receive duplicate digests.*
- **Detailed Acceptance Criteria:**
  - On restart, query active slot for `status IN ('PENDING', 'FAILED')`.
  - Skip all users marked `SENT`.
  - Continue processing remaining batches until slot completes.
- **Test Specifications:**
  - Abort dispatch worker after 50 out of 100 users. Restart worker. Verify 50 remaining users receive digests, first 50 receive 0 duplicate messages.

---

### TASK-42: Rate Limit Resiliency, User Blocking & Missed Slot Watchdog

#### TASK-42.1: Telegram 429 Retry-After Handling & Blocked User Flagging
- **User Story:**
  - *As the delivery engine,*
  - *I want Telegram rate limit errors handled with dynamic backoff and blocked users flagged immediately,*
  - *So that individual client errors never break the overall dispatch loop.*
- **Detailed Acceptance Criteria:**
  - Catch HTTP 429: Read `parameters.retry_after`, pause dispatch loop for that duration, and retry.
  - Catch HTTP 403 (bot was blocked by user): Update `User.status = 'BLOCKED'` and `DigestDelivery.status = 'BLOCKED'`.
  - Catch other errors: Increment retry counter; mark as `FAILED` if retries exceed 3.
- **Test Specifications:**
  - Mock Telegram 403 response; verify user marked `BLOCKED` in PostgreSQL and loop continues.

#### TASK-42.2: Missed Slot Detection & Watchdog Recovery
- **User Story:**
  - *As an operations engineer,*
  - *I want missed delivery slots detected and recovered within a 2-hour grace period,*
  - *So that temporary server downtime does not result in completely skipped digests.*
- **Detailed Acceptance Criteria:**
  - Periodic watchdog runs every 15 minutes.
  - If current time is within 2 hours of a scheduled slot that was never initialized, trigger recovery run.
  - If slot is $>2$ hours late, mark as `SKIPPED_EXPIRED` to avoid disturbing users at night.
- **Test Specifications:**
  - Simulate server reboot 30 minutes after scheduled 09:00 slot. Watchdog triggers slot recovery automatically.

---

## Milestone M7: Digest UX & Job Explorer (/jobs)

### TASK-43: Digest Pagination & Feedback

#### TASK-43.1: Arabic Digest Card Formatting (Max 5 Jobs/Page, Max 20 Total)
- **User Story:**
  - *As a candidate,*
  - *I want clean, readable Arabic job cards with 5 jobs per page (max 20 total) and direct application links,*
  - *So that I can quickly review high-match roles on my mobile screen.*
- **Detailed Acceptance Criteria:**
  - Each job card includes:
    - 💼 **[Job Title]** (Hyperlink to direct application).
    - 🏢 **Company Name** | 📍 Location / Country.
    - 🌐 **Remote Scope** (عن بعد عالمياً / إقليمي / محلي).
    - 📊 **Seniority Level** & Match Score.
  - Set `disable_web_page_preview: true`.
  - Max 5 jobs per message, max 4 pages (20 jobs total). Remaining matching jobs stay accessible in `/jobs`.
- **Test Specifications:**
  - Verify card format renders correctly in Telegram test bot without broken HTML/Markdown entities.

#### TASK-43.2: Inline Pagination Message Editing
- **User Story:**
  - *As a candidate,*
  - *I want clicking page buttons to edit the existing message in-place,*
  - *So that my chat remains clean without cluttering my screen with new messages for every page.*
- **Detailed Acceptance Criteria:**
  - Use `editMessageText` with inline keyboard: `[Prev ➡️]`, `[Page 1/4]`, `[Next ⬅️]`.
  - Encode state in callback data: `digest:page:2`.
  - Answer callback query promptly with `await ctx.answerCallbackQuery()`.
- **Test Specifications:**
  - Click next page; verify `editMessageText` called with Page 2 content and updated button layout.

#### TASK-43.3: Inline Feedback Handler (👍 / 👎)
- **User Story:**
  - *As a candidate,*
  - *I want to rate recommended jobs with thumbs up or thumbs down buttons,*
  - *So that my relevance feedback is recorded instantly.*
- **Detailed Acceptance Criteria:**
  - Provide 👍 and 👎 buttons.
  - Persist feedback state (`LIKE`, `DISLIKE`) in `SentJob`.
  - Display confirmation toast: "شكراً لك! تم تسجيل رأيك لتحسين الترشيحات القادمة ✨".
- **Test Specifications:**
  - Click thumbs up; verify feedback written to database and callback acknowledged.

---

### TASK-44: `/jobs` Database Explorer Engine

#### TASK-44.1: Direct PostgreSQL Keyset Pagination Query
- **User Story:**
  - *As a job seeker,*
  - *I want `/jobs` to query all currently active matching jobs directly from PostgreSQL,*
  - *So that I can browse all available opportunities on-demand with sub-300ms response times.*
- **Detailed Acceptance Criteria:**
  - Query PostgreSQL shared pool filtered by user's active preferences.
  - Display total active match count: "وجدنا 47 وظيفة نشطة تناسب تخصصاتك 🎯".
  - 5 jobs per page with inline navigation.
  - **Zero external scraping:** Never trigger source adapters on `/jobs`.
  - Execution time $<300\text{ms}$ using composite index `(status, primarySpecialization, remoteScope)`.
- **Test Specifications:**
  - Benchmark 100 concurrent `/jobs` requests; verify all return in $<500\text{ms}$ with zero network calls to external job boards.

#### TASK-44.2: Sorting Toggle (Best Match vs Latest)
- **User Story:**
  - *As a candidate,*
  - *I want to toggle sorting between "Best Match" (default) and "Latest",*
  - *So that I can browse either by relevance score or chronological recency.*
- **Detailed Acceptance Criteria:**
  - Default sort: `Best Match` (deterministic score descending).
  - Alternative sort: `Latest` (`publishedAt DESC`).
  - Toggle sorting via inline button without restarting conversation flow.
- **Test Specifications:**
  - Toggle sort to Latest; verify SQL query orders by `published_at DESC`.

#### TASK-44.3: Direct Application URL Link Validation
- **User Story:**
  - *As a candidate,*
  - *I want job titles linking directly to official listings,*
  - *So that I can apply directly without confusing redirects or dead links.*
- **Detailed Acceptance Criteria:**
  - Validate all URLs with HTTPS format.
  - Provide transparent link: Bot does not apply on candidate's behalf.
- **Test Specifications:**
  - Verify every rendered link has valid HTTPS protocol.

---

## Milestone M8: Security, Observability & Staging

### TASK-45: Boundary Validation & Endpoint Security

#### TASK-45.1: Comprehensive Zod Inbound/Outbound Payloads Validation
- **User Story:**
  - *As a security engineer,*
  - *I want all environment variables, HTTP payloads, and Telegram callback data validated with Zod,*
  - *So that malformed inputs, malicious injections, or corrupted payloads are rejected at the boundary.*
- **Detailed Acceptance Criteria:**
  - Validate `env` at boot; throw descriptive error and halt if missing or malformed.
  - Validate all Telegram callback strings with regex schemas.
  - Validate incoming webhooks or pipeline trigger payloads.
- **Test Specifications:**
  - Pass invalid callback payload; verify rejected safely without uncaught exception.

#### TASK-45.2: Secure Pipeline Endpoint Authentication
- **User Story:**
  - *As an operations engineer,*
  - *I want internal pipeline and administrative endpoints protected by secret token authentication,*
  - *So that unauthorized third parties cannot trigger resource-intensive scraping or delivery runs.*
- **Detailed Acceptance Criteria:**
  - Require header `Authorization: Bearer <PIPELINE_API_SECRET>`.
  - Reject missing or incorrect tokens with HTTP 401 Unauthorized.
  - Never log secret tokens in stdout or logger.
- **Test Specifications:**
  - Request `POST /internal/pipeline/run` with invalid token; verify 401 returned.

---

### TASK-46: Concurrency Control & Operational Telemetry

#### TASK-46.1: Structured JSON Logging & Detailed Health Endpoint
- **User Story:**
  - *As an operations engineer,*
  - *I want structured JSON logs and a comprehensive `GET /health` endpoint,*
  - *So that production metrics, database health, and pipeline run status are readily observable.*
- **Detailed Acceptance Criteria:**
  - `GET /health` checks: PostgreSQL connection, connection pool active/idle count, last collection timestamp/metrics, last digest slot status.
  - Log events in structured JSON format with severity, timestamp, module, and traceId.
- **Test Specifications:**
  - Call `GET /health`; verify 200 OK with complete JSON telemetry object.

#### TASK-46.2: Distributed Advisory Locking for Collector & Sender
- **User Story:**
  - *As the system,*
  - *I want PostgreSQL advisory locks guarding collection and delivery runs,*
  - *So that overlapping cron triggers or dual GitHub Actions runs never execute simultaneously.*
- **Detailed Acceptance Criteria:**
  - Use `SELECT pg_try_advisory_lock(:lockId)` at pipeline start.
  - If lock acquired: Execute pipeline and release lock in `finally` block.
  - If lock not acquired: Exit cleanly with log "Pipeline already running in another process".
- **Test Specifications:**
  - Run two worker instances concurrently; verify exactly one executes while the other exits cleanly.

---

### TASK-47: Full Staging E2E Suite & 10k Users Load Test

#### TASK-47.1: Simulated Load Testing for 10,000 Subscribers
- **User Story:**
  - *As a QA engineer,*
  - *I want an automated load test simulating 10,000 subscribers and 1,000 jobs against a mock Telegram server,*
  - *So that memory consumption, throughput pacing, and delivery correctness are verified before production.*
- **Detailed Acceptance Criteria:**
  - Seed database with 10,000 mock users and preferences.
  - Execute full digest dispatch to a mock Telegram server.
  - Verify total delivery duration: 6–7 minutes at 25 msgs/sec.
  - Verify memory usage remains stable ($\Delta \le 50\text{MB}$).
  - Verify 100% of eligible recipients receive exactly one digest.
- **Test Specifications:**
  - Review load test execution report: 10,000 sent, 0 duplicates, 0 uncaught exceptions.

#### TASK-47.2: Fault Injection & Chaos Recovery Scenarios
- **User Story:**
  - *As a QA engineer,*
  - *I want chaos scenarios (database drop, Telegram 429 flood) injected during active delivery,*
  - *So that system self-healing and zero-duplicate guarantees are proven under failure conditions.*
- **Detailed Acceptance Criteria:**
  - Kill database connection for 10 seconds mid-run. Verify reconnect and resumed execution without lost batches.
  - Inject 50 consecutive Telegram 429s. Verify backoff pauses and recovers cleanly.
- **Test Specifications:**
  - Document zero lost records and zero duplicates under simulated chaos conditions.

---

## Milestone M9: Production Migration & Launch

### TASK-48: V1 Redis Data Migration Script

#### TASK-48.1: Redis Preference Extraction & Taxonomy Mapping
- **User Story:**
  - *As a maintainer,*
  - *I want existing V1 Redis subscriber preferences extracted and mapped into the V2 PostgreSQL schema,*
  - *So that existing users do not lose their alerts during the V2 upgrade.*
- **Detailed Acceptance Criteria:**
  - Dump Redis snapshot before migration.
  - Read `preferences:<userId>` and map free-text roles to the closest approved V2 specialization.
  - If mapping is ambiguous, flag for user re-confirmation on next interaction.
  - Insert mapped records into `User` and `UserPreference`.
- **Test Specifications:**
  - Run migration on sample dataset of 50 users; verify 100% accurate conversion.

#### TASK-48.2: Migration Dry-Run & Reconciliation Tooling
- **User Story:**
  - *As a maintainer,*
  - *I want a dry-run migration mode reporting conversion statistics and discrepancy counts,*
  - *So that data migration is verified before committing changes to production.*
- **Detailed Acceptance Criteria:**
  - Dry-run script outputs: Total Redis subscribers, successful mappings, unmapped roles, and errors.
  - Reconcile subscriber counts pre- and post-migration.
- **Test Specifications:**
  - Execute dry run against staging Redis; verify zero unhandled exceptions in summary report.

---

### TASK-49: Production Cutover & Operational Runbook

#### TASK-49.1: Production Deployment & Zero-Downtime Cutover
- **User Story:**
  - *As a release engineer,*
  - *I want zero-downtime cutover to V2 with health verification,*
  - *So that subscribers experience uninterrupted service during deployment.*
- **Detailed Acceptance Criteria:**
  - Run Prisma migrations against production PostgreSQL.
  - Seed initial shared job pool via collection run.
  - Deploy V2 container and verify `GET /health` returns 200 OK.
  - Switch Telegram webhook / polling to V2.
- **Test Specifications:**
  - Perform live smoke test interacting with production bot; verify interactive keyboard responses.

#### TASK-49.2: Operational Runbook, Incident Response & Rollback Procedures
- **User Story:**
  - *As a support engineer,*
  - *I want comprehensive operational runbooks and rehearsed rollback procedures to `v1-stable`,*
  - *So that production incidents can be diagnosed and remediated in under 5 minutes.*
- **Detailed Acceptance Criteria:**
  - Document rollback procedure: Re-deploy tag `v1-stable` from `main` with Redis connection.
  - Document incident response for database connection spikes, source scraping blocks, and Telegram rate limits.
  - Update repository `README.md` to reflect V2 architecture, commands, and operational setup.
- **Test Specifications:**
  - Execute a rehearsed rollback test in staging; verify V1 bot restores within 5 minutes.
