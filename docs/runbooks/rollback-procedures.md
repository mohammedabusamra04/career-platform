# SmartJobsBot V2 — Rollback & Disaster Recovery Procedures

This runbook documents step-by-step procedures for safely rolling back SmartJobsBot V2 to a known stable state or executing disaster recovery without losing subscriber preferences or delivery history.

---

## 1. Rollback Decision Criteria

Initiate a rollback under the following conditions:
- **Catastrophic Database Corruption:** Relational table structures or user preferences become inconsistent and cannot be reconciled.
- **Unrecoverable Dispatch Loop Crash:** Persistent application fatal exceptions preventing the Express server and Telegram bot from booting.
- **Critical Security Breach or Key Compromise:** Immediate rollback to isolated maintenance state while credentials are rotated.

---

## 2. Emergency Pause Mode

If immediate traffic suspension is required to stop errant notifications:
```bash
npm run ops:emergency-pause
```
*Sets `global_delivery_pause` in Redis and temporarily flags active subscribers, preventing dispatch loops from initiating until lifted.*

---

## 3. Disaster Recovery & Snapshot Restoration

### 3.1 Redis Snapshot Verification & Restoration
All migration executions generate timestamped JSON snapshot backups in `backup/redis-migration-snapshot-<timestamp>.json`.

To inspect and verify an existing snapshot:
```bash
npm run ops:rollback:check
```

To restore user preferences from a verified snapshot:
```bash
npx tsx src/scripts/rollback-v2.ts --restore-snapshot backup/redis-migration-snapshot-<timestamp>.json
```

### 3.2 Neon Point-in-Time Branch Recovery
Because PostgreSQL is hosted on Neon (Lakebase Postgres), database state can be instantly rolled back using Neon's copy-on-write branching without downtime:

1. **Identify Stable History Point:**
   In Neon Console, navigate to the `production` branch timeline.
2. **Create Recovery Branch:**
   ```bash
   neon branch create recovery-branch --from production@<timestamp>
   ```
3. **Switch Environment Variable:**
   Update `DATABASE_URL` and `DATABASE_URL_UNPOOLED` in `.env` to point to the recovery branch:
   ```bash
   neon env pull --branch recovery-branch
   ```
4. **Run Pre-flight Verification:**
   ```bash
   npm run deploy:check
   ```
5. **Resume Normal Operations.**

---

## 4. Zero Data Loss Guarantee

When performing a rollback:
- **User Preference Hashes:** Checked and recomputed deterministically using `PreferenceHasher.hash()`.
- **Sent Jobs History:** The `SentJob` historical table remains intact across code rollbacks, preventing repeat recommendations or duplicate deliveries to users within the deduplication window (`HISTORICAL_SENT_WINDOW = ms('4h')`).
