import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repositoryRoot = resolve(import.meta.dir, '../../..');
const read = (relativePath: string) => readFileSync(resolve(repositoryRoot, relativePath), 'utf8');

test('public desktop identity is Record Only while update compatibility stays on Meetily', () => {
  const tauriConfig = JSON.parse(read('frontend/src-tauri/tauri.conf.json'));
  const cargoManifest = read('frontend/src-tauri/Cargo.toml');
  const llamaManifest = read('llama-helper/Cargo.toml');

  expect(tauriConfig.productName).toBe('Meetily');
  expect(tauriConfig.app.windows[0].title).toBe('Record Only');
  expect(tauriConfig.bundle.macOS.bundleName).toBe('Record Only');
  expect(tauriConfig.identifier).toBe('cz.honzavoz.meetily.recordonly');
  expect(tauriConfig.plugins.updater.endpoints).toEqual([
    'https://github.com/honzavoz/meetily-recordonly/releases/latest/download/latest.json',
  ]);

  expect(cargoManifest).toContain('name = "meetily"');
  expect(cargoManifest).toContain('description = "Record Only desktop application"');
  expect(cargoManifest).toContain('repository = "https://github.com/honzavoz/meetily-recordonly"');
  expect(llamaManifest).toContain('license = "MIT"');
  expect(llamaManifest).toContain('repository = "https://github.com/honzavoz/meetily-recordonly"');
  expect(read('frontend/src-tauri/Info.plist')).toContain('<string>Record Only</string>');
});

test('About surface names the independent fork and opens bundled notices', () => {
  const about = read('frontend/src/components/About.tsx');
  const info = read('frontend/src/components/Info.tsx');
  const logo = read('frontend/src/components/Logo.tsx');
  const api = read('frontend/src-tauri/src/api/api.rs');

  expect(about).toContain('Record Only');
  expect(about).toContain('independent fork of Meetily Community Edition');
  expect(about).toContain('not endorsed by Zackriya Solutions');
  expect(about).toContain("invoke('open_legal_notices')");
  expect(about).not.toContain('AnalyticsConsentSwitch');
  expect(about).toContain(
    'https://github.com/honzavoz/meetily-recordonly/blob/main/PRIVACY_POLICY.md',
  );
  expect(api).toContain('pub async fn open_legal_notices');
  expect(api).toContain('licenses/THIRD_PARTY_NOTICES.md');
  expect(info).toContain('About Record Only');
  expect(logo).toContain('<span>Record Only</span>');
  expect(logo).toContain('About Record Only');
});

test('the fork cannot send analytics to the upstream telemetry project', () => {
  const provider = read('frontend/src/components/AnalyticsProvider.tsx');
  const commands = read('frontend/src-tauri/src/analytics/commands.rs');
  const legacy = read('frontend/src-tauri/src/lib_old_complex.rs');
  const privacy = read('PRIVACY_POLICY.md');

  expect(provider).toContain("RECORD_ONLY_ANALYTICS_DISABLED_KEY");
  expect(provider).toContain("await store.set('analyticsOptedIn', false)");
  expect(provider).not.toContain('await initAnalytics2()');
  expect(commands).not.toContain('phc_');
  expect(commands).toContain('Usage analytics is disabled in Record Only');
  expect(legacy).not.toContain('phc_');
  expect(privacy).toContain('# Record Only Privacy Policy');
  expect(privacy).toContain('Usage analytics is disabled');
});

test('fork attribution links to the current official upstream repository', () => {
  const upstream = 'https://github.com/Zackriya-Solutions/meetily';
  const attributedSurfaces = [
    'README.md',
    'THIRD_PARTY_NOTICES.md',
    'frontend/src/components/onboarding/steps/SetupOverviewStep.tsx',
  ];

  for (const relativePath of attributedSurfaces) {
    const source = read(relativePath);
    expect(source, relativePath).toContain(upstream);
    expect(source, relativePath).not.toContain('Zackriya-Solutions/meeting-minutes');
  }
});

test('release and contributor guidance does not point at the retired upstream path', () => {
  const surfaces = [
    'CONTRIBUTING.md',
    'frontend/README.md',
    'scripts/generate-update-manifest-github.js',
    'scripts/test-update-locally.js',
    'backend/start_with_output.ps1',
  ];

  for (const relativePath of surfaces) {
    expect(read(relativePath), relativePath).not.toContain('Zackriya-Solutions/meeting-minutes');
  }
  expect(read('scripts/generate-update-manifest-github.js')).toContain(
    'honzavoz/meetily-recordonly',
  );
});

test('visible desktop surfaces do not present the upstream product name', () => {
  const visibleSurfaces = [
    'frontend/src/app/metadata.ts',
    'frontend/src/app/metadata.tsx',
    'frontend/src/app/google-meet-reminder/page.tsx',
    'frontend/src/components/Info.tsx',
    'frontend/src/components/Logo.tsx',
    'frontend/src/components/PermissionWarning.tsx',
    'frontend/src/components/PreferenceSettings.tsx',
    'frontend/src/components/TranscriptView.tsx',
    'frontend/src/components/VirtualizedTranscriptView.tsx',
    'frontend/src/components/onboarding/steps/WelcomeStep.tsx',
    'frontend/src-tauri/src/google_meet/window.rs',
    'frontend/src-tauri/src/notifications/types.rs',
    'frontend/src-tauri/src/tray.rs',
  ];

  for (const relativePath of visibleSurfaces) {
    const source = read(relativePath);
    expect(source, relativePath).toContain('Record Only');
    expect(source, relativePath).not.toMatch(/\bMeetily\b/);
  }
});

test('Chrome extension and store copy use the independent Record Only identity', () => {
  const manifest = JSON.parse(read('chrome-extension/manifest.json'));
  const listing = read('chrome-extension/store/LISTING.md');
  const privacy = read('chrome-extension/store/PRIVACY.md');
  const submission = read('chrome-extension/store/SUBMISSION.md');

  expect(manifest.name).toBe('Record Only - Meet Reminder');
  expect(manifest.action.default_title).toBe('Record Only - Meet Reminder');
  expect(manifest.description).toContain('Record Only');
  for (const copy of [listing, privacy, submission]) {
    expect(copy).toContain('Record Only');
  }
  expect(listing).toContain('independent fork of Meetily Community Edition');
  expect(listing).toContain('not endorsed by Zackriya Solutions');
});

test('brand artwork uses the Record Only recording symbol and copy', () => {
  const icon = read('assets/record-only-icon.svg');
  const storeArtwork = read('chrome-extension/store/images/screenshot-1280x800.svg');

  expect(icon).toContain('#FF5D6C');
  expect(icon).toContain('Record Only app icon');
  expect(icon).not.toContain('<text');
  expect(storeArtwork).toContain('Record Only');
  expect(storeArtwork).not.toContain('Meetily');
});

test('native messaging and local data compatibility identifiers do not change', () => {
  const registration = read('frontend/src-tauri/src/google_meet/registration.rs');
  const extensionProtocol = read('chrome-extension/src/protocol.js');
  const indexedDb = read('frontend/src/services/indexedDBService.ts');
  const summaryManager = read('frontend/src-tauri/src/summary/summary_engine/model_manager.rs');
  const parakeet = read('frontend/src-tauri/src/parakeet_engine/parakeet_engine.rs');
  const whisper = read('frontend/src-tauri/src/whisper_engine/whisper_engine.rs');

  for (const source of [registration, extensionProtocol]) {
    expect(source).toContain('cz.honzavoz.meetily.recordonly.google_meet');
  }
  expect(indexedDb).toContain("DB_NAME = 'MeetilyRecoveryDB'");
  for (const source of [summaryManager, parakeet, whisper]) {
    expect(source).toContain('.join("Meetily")');
  }
});
