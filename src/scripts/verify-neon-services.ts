import { prisma } from '../shared/database/prisma.service.js';
import redisClient, { connectRedis } from '../config/redis.js';
import app from '../app.js';
import env from '../config/env.js';
import type { Server } from 'http';

async function main() {
  console.log('[VERIFY] Starting Neon Services End-to-End Verification...');

  // 1. Test Neon PostgreSQL
  console.log('[VERIFY] 1. Connecting to Neon PostgreSQL...');
  await prisma.connect();
  const userCount = await prisma.user.count();
  const preferenceCount = await prisma.userPreference.count();
  const poolMetrics = await prisma.getPoolMetrics();

  console.log(`[VERIFY] ✅ Neon PostgreSQL Connected!`);
  console.log(`[VERIFY] Users in Database: ${userCount}`);
  console.log(`[VERIFY] Preferences in Database: ${preferenceCount}`);
  console.log(`[VERIFY] Pool Metrics: Total=${poolMetrics.total}, Active=${poolMetrics.active}, Idle=${poolMetrics.idle}`);

  // 2. Test Upstash Redis
  console.log('[VERIFY] 2. Connecting to Redis...');
  await connectRedis();
  const pingResult = await redisClient.ping();
  console.log(`[VERIFY] ✅ Redis Connected! Ping response: ${pingResult}`);

  // 3. Test Express App & Health Endpoint
  console.log('[VERIFY] 3. Starting Express app and verifying GET /health...');
  const testPort = Number(env.port) || 3152;
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(testPort, () => resolve(s));
  });

  try {
    const response = await fetch(`http://localhost:${testPort}/health`);
    const healthJson = await response.json();
    console.log(`[VERIFY] ✅ GET /health HTTP ${response.status}`);
    console.log(`[VERIFY] Health Telemetry Payload:\n${JSON.stringify(healthJson, null, 2)}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    console.log('[VERIFY] Express test server closed.');
  }

  // 4. Cleanup
  await prisma.disconnect();
  await redisClient.quit();
  console.log('[VERIFY] ✅ All services verified end-to-end successfully!');
}

main().catch((err: unknown) => {
  console.error('[VERIFY ERROR] Verification failed:', err);
  process.exit(1);
});

