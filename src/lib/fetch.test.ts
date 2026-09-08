import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('fetch: writes auditable cache metadata without request contents', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'job-tracker-fetch-'));
  const originalDataDir = process.env.JT_DATA_DIR;
  const originalFetch = globalThis.fetch;
  process.env.JT_DATA_DIR = dataDir;
  globalThis.fetch = async () => new Response('{"jobs":[]}', {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

  try {
    const { fetchText } = await import('./fetch.js');
    await fetchText('https://cache-key.example/jobs?query=mechanical', {
      realUrl: 'https://api.example/jobs',
      method: 'POST',
      body: 'sensitive-request-body',
      retries: 0,
    });

    const cacheDir = join(dataDir, 'cache');
    const metadataFile = readdirSync(cacheDir).find((file) => file.endsWith('.meta.json'));
    assert.ok(metadataFile);
    const rawMetadata = readFileSync(join(cacheDir, metadataFile), 'utf8');
    const metadata = JSON.parse(rawMetadata) as Record<string, unknown>;
    assert.equal(metadata.cacheKey, 'https://cache-key.example/jobs?query=mechanical');
    assert.equal(metadata.target, 'https://api.example/jobs');
    assert.equal(metadata.method, 'POST');
    assert.equal(metadata.status, 200);
    assert.equal(metadata.contentType, 'application/json');
    assert.equal(typeof metadata.fetchedAt, 'string');
    assert.equal(rawMetadata.includes('sensitive-request-body'), false);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalDataDir === undefined) delete process.env.JT_DATA_DIR;
    else process.env.JT_DATA_DIR = originalDataDir;
    rmSync(dataDir, { recursive: true, force: true });
  }
});