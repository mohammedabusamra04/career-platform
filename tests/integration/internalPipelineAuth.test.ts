import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';
import app from '../../src/app.js';
import env from '../../src/config/env.js';
import { jobPipelineService } from '../../src/config/services.js';
import { EventEmitter } from 'node:events';

vi.mock('../../src/config/services.js', () => ({
  jobPipelineService: {
    run: vi.fn(),
    getLastStats: vi.fn().mockReturnValue(null),
  },
  jobCollectionService: {
    executeCollectionCycle: vi.fn(),
    getLastStats: vi.fn().mockReturnValue(null),
  },
  jobSourceManager: {
    getLastFailedSources: vi.fn().mockReturnValue([]),
  },
  jobNotificationScheduler: {
    getSchedulerStatus: vi.fn().mockReturnValue({
      isRunning: true,
      nextRun: null,
      lastRun: null,
      notificationTimes: ['09:00', '21:00'],
      timezone: 'UTC',
    }),
  },
  activeJobSources: [],
  prismaJobRepository: {},
  deduplicationService: {},
  fingerprintService: {},
}));

function createMockRequest(options: {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
}): Request {
  const req = new EventEmitter() as unknown as Request;
  req.method = options.method;
  req.url = options.url;
  req.headers = options.headers || {};
  req.body = options.body;
  req.ip = '127.0.0.1';
  (req as any).socket = { remoteAddress: '127.0.0.1' };
  return req;
}

function createMockResponse(): { res: Response; getStatus: () => number; getBody: () => any } {
  let statusCode = 200;
  let responseBody: any = null;

  const res = new EventEmitter() as unknown as Response;
  res.status = vi.fn((code: number) => {
    statusCode = code;
    return res;
  });
  res.json = vi.fn((data: any) => {
    responseBody = data;
    return res;
  });
  res.setHeader = vi.fn();
  res.getHeader = vi.fn();

  return {
    res,
    getStatus: () => statusCode,
    getBody: () => responseBody,
  };
}

describe('TASK-45.2: Pipeline Endpoint Authentication Integration (#129)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    env.pipelineApiKey = 'valid-ops-pipeline-secret-key-45';
  });

  it('rejects POST /internal/pipeline/run with invalid token returning HTTP 401 (Acceptance Criteria & Test Spec)', async () => {
    const req = createMockRequest({
      method: 'POST',
      url: '/internal/pipeline/run',
      headers: {
        authorization: 'Bearer wrong-attacker-secret',
      },
    });
    const { res, getStatus, getBody } = createMockResponse();

    await new Promise<void>((resolve) => {
      app.handle(req, res, () => {
        resolve();
      });
      setTimeout(resolve, 100);
    });

    expect(getStatus()).toBe(401);
    expect(getBody()).toMatchObject({
      status: false,
      code: 401,
      message: expect.stringContaining('Unauthorized'),
    });
  });

  it('rejects POST /internal/pipeline/run with missing token returning HTTP 401', async () => {
    const req = createMockRequest({
      method: 'POST',
      url: '/internal/pipeline/run',
      headers: {},
    });
    const { res, getStatus, getBody } = createMockResponse();

    await new Promise<void>((resolve) => {
      app.handle(req, res, () => {
        resolve();
      });
      setTimeout(resolve, 100);
    });

    expect(getStatus()).toBe(401);
    expect(getBody()).toMatchObject({
      status: false,
      code: 401,
      message: expect.stringContaining('Unauthorized'),
    });
  });

  it('rejects POST /jobs/pipeline/run with invalid token returning HTTP 401', async () => {
    const req = createMockRequest({
      method: 'POST',
      url: '/jobs/pipeline/run',
      headers: {
        authorization: 'Bearer invalid-token-xyz',
      },
    });
    const { res, getStatus, getBody } = createMockResponse();

    await new Promise<void>((resolve) => {
      app.handle(req, res, () => {
        resolve();
      });
      setTimeout(resolve, 100);
    });

    expect(getStatus()).toBe(401);
    expect(getBody()).toMatchObject({
      status: false,
      code: 401,
      message: expect.stringContaining('Unauthorized'),
    });
  });

  it('allows POST /internal/pipeline/run with valid Bearer token and returns HTTP 200', async () => {
    const mockResult = {
      subscribers: 10,
      processed: 10,
      notifiedWithJobs: 8,
      notifiedNoMatch: 2,
      skippedNoPreferences: 0,
      errors: 0,
      totalJobsCollected: 35,
    };
    vi.mocked(jobPipelineService.run).mockResolvedValueOnce(mockResult);

    const req = createMockRequest({
      method: 'POST',
      url: '/internal/pipeline/run',
      headers: {
        authorization: 'Bearer valid-ops-pipeline-secret-key-45',
      },
      body: {},
    });
    const { res, getStatus, getBody } = createMockResponse();

    await new Promise<void>((resolve) => {
      app.handle(req, res, () => {
        resolve();
      });
      setTimeout(resolve, 100);
    });

    expect(getStatus()).toBe(200);
    expect(getBody()).toMatchObject({
      status: true,
      code: 200,
      message: 'Job pipeline executed successfully',
      data: mockResult,
    });
    expect(jobPipelineService.run).toHaveBeenCalledTimes(1);
  });
});
