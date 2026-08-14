import { expect, test } from 'bun:test';

import {
  acceptModelLicense,
  getModelLicense,
  isModelLicenseAccepted,
  requestLicensedModelDownload,
  type ModelLicenseStorage,
} from '../../src/lib/model-license';

class MemoryStorage implements ModelLicenseStorage {
  private values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

test.each([
  ['qwen3.5:2b', 'Apache-2.0'],
  ['qwen3.5:4b', 'Apache-2.0'],
  ['parakeet-tdt-0.6b-v3-int8', 'CC-BY-4.0'],
  ['parakeet-tdt-0.6b-v2-int8', 'CC-BY-4.0'],
  ['large-v3-turbo', 'MIT'],
] as const)('%s exposes complete downloadable-model metadata', (modelName, licenseId) => {
  const metadata = getModelLicense(modelName);
  expect(metadata).not.toBeNull();
  expect(metadata?.licenseId).toBe(licenseId);
  expect(metadata?.licenseUrl).toMatch(/^https:\/\//);
  expect(metadata?.sourceUrl).toMatch(/^https:\/\//);
  expect(metadata?.attribution.length).toBeGreaterThan(20);
  expect(metadata?.revision.length).toBeGreaterThan(5);
  expect(metadata?.downloadAvailable).toBe(true);
});

test('Gemma remains usable when installed but is unavailable for a new download', () => {
  const gemma1b = getModelLicense('gemma3:1b');
  const gemma4b = getModelLicense('gemma3:4b');
  expect(gemma1b?.downloadAvailable).toBe(false);
  expect(gemma1b?.unavailableReason).toMatch(/terms/i);
  expect(gemma1b?.sourceUrl).toContain('gemma-3-1b-it-GGUF');
  expect(gemma4b?.sourceUrl).toContain('gemma-3-4b-it-GGUF');
});

test('acceptance is persisted for the exact model and license revision', () => {
  const storage = new MemoryStorage();
  expect(isModelLicenseAccepted('qwen3.5:2b', storage)).toBe(false);
  acceptModelLicense('qwen3.5:2b', storage);
  expect(isModelLicenseAccepted('qwen3.5:2b', storage)).toBe(true);
  expect(isModelLicenseAccepted('qwen3.5:4b', storage)).toBe(false);
});

test('download is invoked only after explicit acceptance', async () => {
  const storage = new MemoryStorage();
  const events: string[] = [];
  const result = await requestLicensedModelDownload({
    modelName: 'parakeet-tdt-0.6b-v3-int8',
    storage,
    requestAcceptance: async metadata => {
      events.push(`prompt:${metadata.modelName}`);
      return true;
    },
    download: async () => {
      events.push('download');
    },
  });

  expect(result).toBe('started');
  expect(events).toEqual(['prompt:parakeet-tdt-0.6b-v3-int8', 'download']);
  expect(isModelLicenseAccepted('parakeet-tdt-0.6b-v3-int8', storage)).toBe(true);
});

test('declined and unavailable models never invoke download', async () => {
  for (const modelName of ['qwen3.5:2b', 'gemma3:4b']) {
    const storage = new MemoryStorage();
    let downloadCalls = 0;
    const result = await requestLicensedModelDownload({
      modelName,
      storage,
      requestAcceptance: async () => false,
      download: async () => {
        downloadCalls += 1;
      },
    });
    expect(result).not.toBe('started');
    expect(downloadCalls).toBe(0);
  }
});
