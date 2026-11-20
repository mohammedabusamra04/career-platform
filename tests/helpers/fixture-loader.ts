import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURES_DIR = path.resolve(__dirname, '../fixtures/sources');

/**
 * Reads a raw fixture file from tests/fixtures/sources/.
 */
export function loadSourceFixture(filename: string): string {
  const filePath = path.join(FIXTURES_DIR, filename);
  return fs.readFileSync(filePath, 'utf-8');
}

/**
 * Reads and parses a JSON fixture file from tests/fixtures/sources/.
 */
export function loadSourceJsonFixture<T = unknown>(filename: string): T {
  const content = loadSourceFixture(filename);
  return JSON.parse(content) as T;
}
