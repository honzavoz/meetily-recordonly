import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const frontendRoot = resolve(import.meta.dir, '../..');
const downloadSurfaces = [
  'src/contexts/OnboardingContext.tsx',
  'src/components/onboarding/steps/DownloadProgressStep.tsx',
  'src/components/BuiltInModelManager.tsx',
  'src/components/WhisperModelManager.tsx',
  'src/components/ParakeetModelManager.tsx',
];

test('every product download surface uses the shared model-license gate', () => {
  for (const relativePath of downloadSurfaces) {
    const source = readFileSync(resolve(frontendRoot, relativePath), 'utf8');
    expect(source, relativePath).toContain('useModelLicenseDownload');
  }
});

test('download surfaces do not bypass the shared gate with direct Tauri commands', () => {
  const directCommand = /invoke\(['"](?:builtin_ai_download_model|parakeet_download_model|parakeet_retry_download|whisper_download_model)['"]/;
  for (const relativePath of downloadSurfaces) {
    const source = readFileSync(resolve(frontendRoot, relativePath), 'utf8');
    expect(source, relativePath).not.toMatch(directCommand);
  }
});

test('backend exposes model license metadata and disables unaccepted Gemma downloads', () => {
  const summaryModels = readFileSync(
    resolve(frontendRoot, 'src-tauri/src/summary/summary_engine/models.rs'),
    'utf8',
  );
  const summaryManager = readFileSync(
    resolve(frontendRoot, 'src-tauri/src/summary/summary_engine/model_manager.rs'),
    'utf8',
  );
  const parakeet = readFileSync(
    resolve(frontendRoot, 'src-tauri/src/parakeet_engine/parakeet_engine.rs'),
    'utf8',
  );
  const whisper = readFileSync(
    resolve(frontendRoot, 'src-tauri/src/whisper_engine/whisper_engine.rs'),
    'utf8',
  );

  for (const source of [summaryModels, parakeet, whisper]) {
    expect(source).toContain('license_id');
    expect(source).toContain('license_url');
    expect(source).toContain('source_url');
    expect(source).toContain('attribution');
    expect(source).toContain('license_revision');
  }
  expect(summaryModels).toContain('download_available: false');
  expect(summaryManager).toContain('if !model_def.download_available');
  expect(parakeet).toContain('huggingface.co/istupakov/parakeet-tdt-0.6b-v3-onnx/resolve/main');
  expect(parakeet).not.toContain('meetily.towardsgeneralintelligence.com/models');
});
