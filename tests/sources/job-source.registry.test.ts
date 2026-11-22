import { describe, it, expect } from 'vitest';
import { JobSourceRegistry } from '../../src/modules/jobs/sources/job-source.registry.js';
import type { JobSource } from '../../src/modules/jobs/sources/job-source.interface.js';
import { JobSourceType } from '../../src/modules/jobs/job.types.js';

describe('JobSourceRegistry', () => {
  it('should format source badge in Arabic and English using registered metadata', () => {
    expect(JobSourceRegistry.formatSourceBadge('linkedin', 'ar')).toBe('المنصة: لينكدإن (LinkedIn)');
    expect(JobSourceRegistry.formatSourceBadge('linkedin', 'en')).toBe('Platform: LinkedIn');
    expect(JobSourceRegistry.formatSourceBadge('tanqeeb', 'ar')).toBe('المنصة: تنقيب (Tanqeeb)');
    expect(JobSourceRegistry.formatSourceBadge(null, 'ar')).toBe('المنصة: تقديم مباشر');
  });

  it('should dynamically format arbitrary new sources without crashing', () => {
    expect(JobSourceRegistry.formatSourceBadge('custom_job_board', 'ar')).toBe('المنصة: Custom job board');
  });
});
