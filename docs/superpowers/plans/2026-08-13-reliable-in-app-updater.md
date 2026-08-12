# Reliable In-App Updater Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Meetily reuse the updater resource from its successful check, expose real errors, prevent concurrent installs, and prove the repaired updater through a signed 0.4.11 → 0.4.12 in-app update.

**Architecture:** Add a small pure updater-flow module for resource resolution, error normalization, and single-flight execution. Inject Tauri dependencies into `UpdateService` so a successful check returns the exact prepared updater resource. Simplify `UpdateDialog` to consume that resource without a second check, then release 0.4.11, install it directly on the test Mac, and exercise the fixed code against 0.4.12.

**Tech Stack:** TypeScript, React 18, Bun test, Tauri 2 updater/process plugins, Next.js 14, GitHub Actions, minisign, macOS codesign.

---

## File map

- Create `frontend/src/lib/updater-flow.ts`: pure updater types, error normalization, prepared-resource resolution, and operation gate.
- Create `frontend/tests/lib/updater-flow.test.ts`: behavior tests for error values, fallback preparation, and single-flight execution.
- Create `frontend/tests/services/update-service.test.ts`: dependency-injected `UpdateService` tests proving resource retention and serialized checks.
- Create `frontend/tests/lib/updater-dialog-contract.test.ts`: source-level integration contract for the dialog because the repository has no DOM test runtime.
- Modify `frontend/src/services/updateService.ts`: retain the exact Tauri update resource and allow dependency injection.
- Modify `frontend/src/components/UpdateDialog.tsx`: remove the eager second check, use the prepared resource, add retry, and normalize errors.
- Modify `frontend/tests/lib/app-version.test.mjs`, `frontend/package.json`, `frontend/src-tauri/tauri.conf.json`, `frontend/src-tauri/Cargo.toml`, and `Cargo.lock`: release 0.4.11 and then 0.4.12 through separate red-green version cycles.

### Task 1: Pure updater flow primitives

**Files:**
- Create: `frontend/src/lib/updater-flow.ts`
- Create: `frontend/tests/lib/updater-flow.test.ts`

- [ ] **Step 1: Write failing tests for useful error messages**

Create `frontend/tests/lib/updater-flow.test.ts` with these first assertions:

```ts
import { describe, expect, test } from "bun:test";
import {
  normalizeUpdaterError,
  resolvePreparedUpdate,
  UpdateOperationGate,
  type PreparedUpdate,
} from "../../src/lib/updater-flow";

const preparedUpdate = (): PreparedUpdate => ({
  downloadAndInstall: async () => undefined,
});

describe("normalizeUpdaterError", () => {
  test("preserves string and Error messages", () => {
    expect(normalizeUpdaterError("network unavailable", "fallback")).toBe("network unavailable");
    expect(normalizeUpdaterError(new Error("signature mismatch"), "fallback")).toBe("signature mismatch");
  });

  test("reads object messages and falls back for unknown values", () => {
    expect(normalizeUpdaterError({ message: "resource closed" }, "fallback")).toBe("resource closed");
    expect(normalizeUpdaterError({ code: 500 }, "fallback")).toBe("fallback");
    expect(normalizeUpdaterError("   ", "fallback")).toBe("fallback");
  });
});
```

- [ ] **Step 2: Run the error tests and verify RED**

Run:

```bash
cd frontend
bun test tests/lib/updater-flow.test.ts
```

Expected: FAIL because `../../src/lib/updater-flow` does not exist.

- [ ] **Step 3: Add the minimal error normalizer and shared updater type**

Create `frontend/src/lib/updater-flow.ts`:

```ts
import type { DownloadEvent } from "@tauri-apps/plugin-updater";

export interface PreparedUpdate {
  downloadAndInstall(onEvent?: (event: DownloadEvent) => void): Promise<void>;
}

export function normalizeUpdaterError(error: unknown, fallback: string): string {
  if (typeof error === "string" && error.trim()) return error.trim();
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string" &&
    error.message.trim()
  ) {
    return error.message.trim();
  }
  return fallback;
}
```

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run `cd frontend && bun test tests/lib/updater-flow.test.ts`.

Expected: 2 pass, 0 fail.

- [ ] **Step 5: Extend the test with prepared-resource resolution**

Append inside the same test file:

```ts
describe("resolvePreparedUpdate", () => {
  test("returns the original prepared resource without refreshing", async () => {
    const original = preparedUpdate();
    let refreshCalls = 0;

    const result = await resolvePreparedUpdate(
      { available: true, preparedUpdate: original },
      async () => {
        refreshCalls += 1;
        return { available: true, preparedUpdate: preparedUpdate() };
      },
    );

    expect(result).toBe(original);
    expect(refreshCalls).toBe(0);
  });

  test("performs one fallback refresh when the resource is missing", async () => {
    const replacement = preparedUpdate();
    let refreshCalls = 0;

    const result = await resolvePreparedUpdate(
      { available: true },
      async () => {
        refreshCalls += 1;
        return { available: true, preparedUpdate: replacement };
      },
    );

    expect(result).toBe(replacement);
    expect(refreshCalls).toBe(1);
  });

  test("rejects a refresh that no longer has an update", async () => {
    expect(
      resolvePreparedUpdate({ available: true }, async () => ({ available: false })),
    ).rejects.toThrow("Update is no longer available");
  });
});
```

- [ ] **Step 6: Run the resolution tests and verify RED**

Run `cd frontend && bun test tests/lib/updater-flow.test.ts`.

Expected: FAIL because `resolvePreparedUpdate` is not exported.

- [ ] **Step 7: Implement prepared-resource resolution**

Add to `frontend/src/lib/updater-flow.ts`:

```ts
export interface PreparedUpdateInfo {
  available: boolean;
  preparedUpdate?: PreparedUpdate;
}

export async function resolvePreparedUpdate(
  info: PreparedUpdateInfo,
  refresh: () => Promise<PreparedUpdateInfo>,
): Promise<PreparedUpdate> {
  if (info.preparedUpdate) return info.preparedUpdate;

  const refreshed = await refresh();
  if (!refreshed.available || !refreshed.preparedUpdate) {
    throw new Error("Update is no longer available");
  }
  return refreshed.preparedUpdate;
}
```

- [ ] **Step 8: Add a failing single-flight test**

Append:

```ts
describe("UpdateOperationGate", () => {
  test("starts only one operation until the first one settles", async () => {
    const gate = new UpdateOperationGate();
    let release!: () => void;
    const blocker = new Promise<void>((resolve) => { release = resolve; });
    let calls = 0;

    const first = gate.run(async () => {
      calls += 1;
      await blocker;
    });
    const second = await gate.run(async () => { calls += 1; });

    expect(second).toBe(false);
    expect(calls).toBe(1);
    release();
    expect(await first).toBe(true);
    expect(await gate.run(async () => { calls += 1; })).toBe(true);
    expect(calls).toBe(2);
  });
});
```

- [ ] **Step 9: Run the gate test and verify RED**

Run `cd frontend && bun test tests/lib/updater-flow.test.ts`.

Expected: FAIL because `UpdateOperationGate` is not exported.

- [ ] **Step 10: Implement the operation gate**

Add:

```ts
export class UpdateOperationGate {
  private running = false;

  async run(operation: () => Promise<void>): Promise<boolean> {
    if (this.running) return false;
    this.running = true;
    try {
      await operation();
      return true;
    } finally {
      this.running = false;
    }
  }
}
```

- [ ] **Step 11: Verify and commit the pure flow**

Run:

```bash
cd frontend
bun test tests/lib/updater-flow.test.ts
```

Expected: 6 pass, 0 fail.

Commit:

```bash
git add frontend/src/lib/updater-flow.ts frontend/tests/lib/updater-flow.test.ts
git commit -m "test: define reliable updater flow"
```

### Task 2: Retain the exact Tauri update resource

**Files:**
- Modify: `frontend/src/services/updateService.ts`
- Create: `frontend/tests/services/update-service.test.ts`

- [ ] **Step 1: Write a failing service test with injected dependencies**

Create `frontend/tests/services/update-service.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { UpdateService } from "../../src/services/updateService";
import type { PreparedUpdate } from "../../src/lib/updater-flow";

describe("UpdateService", () => {
  test("returns the exact updater resource from the successful check", async () => {
    const prepared: PreparedUpdate = { downloadAndInstall: async () => undefined };
    let checks = 0;
    const service = new UpdateService(
      async () => {
        checks += 1;
        return Object.assign(prepared, {
          available: true,
          version: "0.4.11",
          date: "2026-08-13T00:00:00Z",
          body: "Updater fix",
        });
      },
      async () => "0.4.10",
    );

    const info = await service.checkForUpdates(true);

    expect(info.preparedUpdate).toBe(prepared);
    expect(info).toMatchObject({
      available: true,
      currentVersion: "0.4.10",
      version: "0.4.11",
    });
    expect(checks).toBe(1);
  });
});
```

- [ ] **Step 2: Run the service test and verify RED**

Run `cd frontend && bun test tests/services/update-service.test.ts`.

Expected: FAIL because `UpdateService` does not accept dependencies and `UpdateInfo` has no `preparedUpdate`.

- [ ] **Step 3: Inject dependencies and retain the resource**

In `frontend/src/services/updateService.ts`:

```ts
import { check } from "@tauri-apps/plugin-updater";
import type { PreparedUpdate } from "@/lib/updater-flow";

interface CheckedUpdate extends PreparedUpdate {
  version: string;
  date?: string;
  body?: string;
}

type CheckUpdate = () => Promise<CheckedUpdate | null>;
type ReadVersion = () => Promise<string>;

export interface UpdateInfo {
  available: boolean;
  currentVersion: string;
  version?: string;
  date?: string;
  body?: string;
  downloadUrl?: string;
  preparedUpdate?: PreparedUpdate;
}
```

Change the class constructor and internal calls:

```ts
export class UpdateService {
  constructor(
    private readonly checkUpdate: CheckUpdate = check,
    private readonly readVersion: ReadVersion = getVersion,
  ) {}

  // Existing fields remain unchanged.
}
```

Replace both `await getVersion()` calls with `await this.readVersion()`, replace `await check()` with `await this.checkUpdate()`, and include the resource in the available result:

```ts
return {
  available: true,
  currentVersion,
  version: update.version,
  date: update.date,
  body: update.body,
  preparedUpdate: update,
};
```

- [ ] **Step 4: Add a failing concurrent-check test**

Append:

```ts
test("rejects a concurrent check without starting another Tauri request", async () => {
  let release!: () => void;
  const blocker = new Promise<void>((resolve) => { release = resolve; });
  let checks = 0;
  const service = new UpdateService(
    async () => {
      checks += 1;
      await blocker;
      return null;
    },
    async () => "0.4.10",
  );

  const first = service.checkForUpdates(true);
  await Promise.resolve();
  await expect(service.checkForUpdates(true)).rejects.toThrow("Update check already in progress");
  expect(checks).toBe(1);
  release();
  await first;
});
```

- [ ] **Step 5: Verify service behavior and commit**

Run:

```bash
cd frontend
bun test tests/services/update-service.test.ts
```

Expected: 2 pass, 0 fail.

Commit:

```bash
git add frontend/src/services/updateService.ts frontend/tests/services/update-service.test.ts
git commit -m "fix: retain prepared updater resource"
```

### Task 3: Remove the dialog’s second check and add retry

**Files:**
- Modify: `frontend/src/components/UpdateDialog.tsx`
- Create: `frontend/tests/lib/updater-dialog-contract.test.ts`

- [ ] **Step 1: Write the failing dialog contract test**

Create `frontend/tests/lib/updater-dialog-contract.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(
  resolve(import.meta.dir, "../../src/components/UpdateDialog.tsx"),
  "utf8",
);

describe("UpdateDialog updater ownership", () => {
  test("uses the prepared resource without importing the raw Tauri check", () => {
    expect(source).not.toMatch(/import\s*\{[^}]*\bcheck\b[^}]*\}\s*from\s*["']@tauri-apps\/plugin-updater["']/s);
    expect(source).toContain("updateInfo.preparedUpdate");
    expect(source).toContain("resolvePreparedUpdate");
  });

  test("normalizes errors and guards repeated update operations", () => {
    expect(source).toContain("normalizeUpdaterError");
    expect(source).toContain("new UpdateOperationGate()");
    expect(source).toContain("Try Again");
  });
});
```

- [ ] **Step 2: Run the dialog contract and verify RED**

Run `cd frontend && bun test tests/lib/updater-dialog-contract.test.ts`.

Expected: FAIL because the dialog imports raw `check()` and does not use the new flow primitives.

- [ ] **Step 3: Replace the eager check with the prepared resource**

In `UpdateDialog.tsx`, remove `check` and `Update` from the Tauri updater import. Add:

```ts
import { useRef } from "react";
import {
  normalizeUpdaterError,
  resolvePreparedUpdate,
  UpdateOperationGate,
  type PreparedUpdate,
} from "@/lib/updater-flow";
```

Replace the local updater state and add the immediate gate:

```ts
const [update, setUpdate] = useState<PreparedUpdate | null>(null);
const [isPreparing, setIsPreparing] = useState(false);
const operationGateRef = useRef(new UpdateOperationGate());
```

Replace the async `check()` effect with state initialization only:

```ts
useEffect(() => {
  if (open && updateInfo?.available) {
    setIsDownloading(false);
    setIsPreparing(false);
    setProgress(null);
    setError(null);
    setUpdate(updateInfo.preparedUpdate ?? null);
  } else {
    setIsDownloading(false);
    setIsPreparing(false);
    setProgress(null);
    setError(null);
    setUpdate(null);
  }
}, [open, updateInfo]);
```

- [ ] **Step 4: Route preparation and installation through one gate**

Rewrite `handleDownloadAndInstall` around this skeleton, retaining the existing progress-event switch and relaunch calls inside the operation:

```ts
const handleDownloadAndInstall = async () => {
  await operationGateRef.current.run(async () => {
    let stage: "prepare" | "install" = "prepare";
    setError(null);
    setIsPreparing(!update);

    try {
      const updateToUse = await resolvePreparedUpdate(
        { available: Boolean(updateInfo?.available), preparedUpdate: update ?? updateInfo?.preparedUpdate },
        () => updateService.checkForUpdates(true),
      );
      setUpdate(updateToUse);
      setIsPreparing(false);
      setIsDownloading(true);
      setProgress({ downloaded: 0, total: 0, percentage: 0 });
      stage = "install";

      let downloaded = 0;
      let contentLength = 0;
      await updateToUse.downloadAndInstall((event) => {
        switch (event.event) {
          case "Started":
            contentLength = event.data.contentLength ?? 0;
            setProgress({ downloaded: 0, total: contentLength, percentage: 0 });
            break;
          case "Progress": {
            downloaded += event.data.chunkLength;
            const percentage = contentLength > 0
              ? Math.round((downloaded / contentLength) * 100)
              : 0;
            setProgress({ downloaded, total: contentLength, percentage });
            break;
          }
          case "Finished":
            setProgress({
              downloaded: contentLength,
              total: contentLength,
              percentage: 100,
            });
            break;
        }
      });

      toast.success("Update installed successfully. The app will restart...");
      setIsDownloading(false);
      onOpenChange(false);
      await relaunch();
    } catch (cause: unknown) {
      console.error(`[UpdateDialog] ${stage} failed`, cause);
      const fallback = stage === "prepare"
        ? "Unable to prepare the update"
        : "Unable to download or install the update";
      const message = normalizeUpdaterError(cause, fallback);
      setError(`${stage === "prepare" ? "Failed to prepare update" : "Update failed"}: ${message}`);
      setIsPreparing(false);
      setIsDownloading(false);
      toast.error(message);
    }
  });
};
```

Do not leave the old fallback `check()` block or any raw `err.message` access.

- [ ] **Step 5: Add preparing and retry UI states**

Treat `isPreparing || isDownloading` as busy in close/escape/outside-click guards. Show `Preparing Update` with the spinner while preparing. Replace the error-only footer with:

```tsx
{error && (
  <>
    <Button variant="outline" onClick={() => handleOpenChange(false)}>
      Close
    </Button>
    <Button onClick={handleDownloadAndInstall} disabled={isPreparing || isDownloading}>
      {isPreparing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
      Try Again
    </Button>
  </>
)}
```

- [ ] **Step 6: Run focused updater tests and verify GREEN**

Run:

```bash
cd frontend
bun test tests/lib/updater-flow.test.ts tests/services/update-service.test.ts tests/lib/updater-dialog-contract.test.ts
```

Expected: 10 pass, 0 fail.

- [ ] **Step 7: Run static checks and commit**

Run:

```bash
cd frontend
./node_modules/.bin/eslint src/components/UpdateDialog.tsx src/services/updateService.ts src/lib/updater-flow.ts tests/lib/updater-flow.test.ts tests/services/update-service.test.ts tests/lib/updater-dialog-contract.test.ts --quiet
bunx tsc --noEmit
```

Expected: both commands exit 0.

Commit:

```bash
git add frontend/src/components/UpdateDialog.tsx frontend/tests/lib/updater-dialog-contract.test.ts
git commit -m "fix: reuse prepared in-app update"
```

### Task 4: Full local regression verification

**Files:** No production changes expected.

- [ ] **Step 1: Run all frontend tests**

Run `cd frontend && bun test`.

Expected: all tests pass with 0 failures.

- [ ] **Step 2: Run lint and production build**

Run:

```bash
cd frontend
./node_modules/.bin/eslint . --quiet
bun run build
```

Expected: ESLint exits 0 and Next builds all pages successfully.

- [ ] **Step 3: Run release and repository gates**

Run from repository root:

```bash
./scripts/check-version-consistency.sh
node scripts/tests/updater-release-assets.test.js
node scripts/tests/decode-updater-signature.test.js
./scripts/tests/release-preflight.test.sh
git diff --check
git status --short --branch
```

Expected: version 0.4.10 is consistent before the bump, updater fixture tests pass, release preflight passes, diff check is clean, and only planned commits are ahead of `origin/main`.

### Task 5: Release the updater fix as 0.4.11

**Files:**
- Modify: `frontend/tests/lib/app-version.test.mjs`
- Modify: `frontend/package.json`
- Modify: `frontend/src-tauri/tauri.conf.json`
- Modify: `frontend/src-tauri/Cargo.toml`
- Modify: `Cargo.lock`

- [ ] **Step 1: Change only the version test to 0.4.11**

In `app-version.test.mjs`, change the test title and three expected declarations from `0.4.10` to `0.4.11`.

- [ ] **Step 2: Run the version test and verify RED**

Run `cd frontend && bun test tests/lib/app-version.test.mjs`.

Expected: FAIL because package/config/Cargo declarations still report 0.4.10.

- [ ] **Step 3: Bump all application declarations to 0.4.11**

Set exactly:

```text
frontend/package.json                    "version": "0.4.11"
frontend/src-tauri/tauri.conf.json       "version": "0.4.11"
frontend/src-tauri/Cargo.toml            version = "0.4.11"
Cargo.lock (Meetily package only)         version = "0.4.11"
```

- [ ] **Step 4: Verify GREEN and commit**

Run:

```bash
cd frontend
bun test tests/lib/app-version.test.mjs
cd ..
./scripts/check-version-consistency.sh
./scripts/tests/release-preflight.test.sh
git diff --check
```

Expected: version test passes, consistency reports 0.4.11, and all 13 release-preflight scenarios pass.

Commit:

```bash
git add frontend/tests/lib/app-version.test.mjs frontend/package.json frontend/src-tauri/tauri.conf.json frontend/src-tauri/Cargo.toml Cargo.lock
git commit -m "chore: release 0.4.11"
```

- [ ] **Step 5: Push main and run the signed release workflow**

Run:

```bash
git push origin main
gh workflow run release.yml --ref main
gh run list --workflow release.yml --branch main --limit 1
```

Watch the returned run with `gh run watch <run-id> --exit-status`.

Expected: create-release, Apple Silicon build, minisign verification, and verify-and-publish all succeed.

- [ ] **Step 6: Verify the public 0.4.11 release**

Run:

```bash
gh release view v0.4.11 --json tagName,isDraft,isPrerelease,publishedAt,url,targetCommitish,assets
curl -fsSL -o /private/tmp/meetily-0.4.11-latest.json https://github.com/honzavoz/meetily-recordonly/releases/latest/download/latest.json
node -e 'const m=require("/private/tmp/meetily-0.4.11-latest.json"); if(m.version!=="0.4.11"||!m.platforms?.["darwin-aarch64"]?.signature) process.exit(1); console.log(m.version)'
```

Expected: public non-draft v0.4.11, canonical updater assets, and manifest version 0.4.11.

### Task 6: Install signed 0.4.11 directly without touching user data

**Files:** Operational change to `/Applications/Meetily.app`; user data remains in place.

- [ ] **Step 1: Record pre-install data evidence**

Record, without exposing contents:

```bash
sqlite3 "$HOME/Library/Application Support/cz.honzavoz.meetily.recordonly/meeting_minutes.sqlite" 'PRAGMA integrity_check; SELECT COUNT(*) FROM meetings;'
find "$HOME/Movies/meetily-recordings" -mindepth 1 -maxdepth 1 -type d | wc -l
/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' /Applications/Meetily.app/Contents/Info.plist
codesign --verify --deep --strict --verbose=2 /Applications/Meetily.app
```

Expected: integrity `ok`, a recorded meeting count, a recorded recording-folder count, installed version 0.4.8 or 0.4.10, and valid signature.

- [ ] **Step 2: Download and verify the direct 0.4.11 bundle**

Download the `.app.tar.gz` and signature assets from v0.4.11, decode the updater signature with `scripts/decode-updater-signature.js`, extract the configured public key with `scripts/extract-updater-public-key.js`, and run:

```bash
minisign -Vm /private/tmp/Meetily_0.4.11_aarch64.app.tar.gz \
  -x /private/tmp/Meetily_0.4.11_aarch64.app.tar.gz.minisig \
  -p /private/tmp/meetily-updater.pub
```

Expected: signature and trusted-comment signature verification pass.

- [ ] **Step 3: Stop Meetily and preserve the old bundle reversibly**

Create an explicit temporary backup directory with `mktemp -d /private/tmp/meetily-app-backup.XXXXXX`. Quit Meetily cleanly, confirm no Meetily process remains, then move only `/Applications/Meetily.app` into that exact backup directory. Do not alter the SQLite database or recordings directory.

- [ ] **Step 4: Install and verify 0.4.11**

Extract the verified archive into `/Applications`, then run:

```bash
/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' /Applications/Meetily.app/Contents/Info.plist
codesign --verify --deep --strict --verbose=2 /Applications/Meetily.app
```

Expected: 0.4.11 and a valid strict signature. Keep the temporary backup until the 0.4.12 in-app update is complete.

- [ ] **Step 5: Launch and recheck data evidence**

Launch `/Applications/Meetily.app`, confirm the main window appears, then repeat the SQLite integrity/count and recordings-directory count. Expected values match Step 1.

### Task 7: Publish a version-only 0.4.12 verification release

**Files:**
- Modify: `frontend/tests/lib/app-version.test.mjs`
- Modify: `frontend/package.json`
- Modify: `frontend/src-tauri/tauri.conf.json`
- Modify: `frontend/src-tauri/Cargo.toml`
- Modify: `Cargo.lock`

- [ ] **Step 1: Change only the version test to 0.4.12 and verify RED**

Run `cd frontend && bun test tests/lib/app-version.test.mjs`.

Expected: FAIL against 0.4.11 declarations.

- [ ] **Step 2: Set all five version declarations to 0.4.12**

Use the same files and exact declaration locations from Task 5, with value 0.4.12. Do not change updater behavior in this commit.

- [ ] **Step 3: Verify and commit 0.4.12**

Run the version test, full `bun test`, version consistency, release preflight, ESLint `--quiet`, production build, and `git diff --check`.

Expected: all gates pass.

Commit:

```bash
git add frontend/tests/lib/app-version.test.mjs frontend/package.json frontend/src-tauri/tauri.conf.json frontend/src-tauri/Cargo.toml Cargo.lock
git commit -m "chore: release 0.4.12"
```

- [ ] **Step 4: Push and publish 0.4.12**

Push `main`, dispatch `release.yml`, watch it to success, verify v0.4.12 is public, and verify the production `latest.json` reports 0.4.12 with a signed `darwin-aarch64` entry.

### Task 8: Prove the repaired in-app updater end to end

**Files:** No repository changes expected unless the test exposes a defect.

- [ ] **Step 1: Confirm the starting application is 0.4.11**

Read `/Applications/Meetily.app/Contents/Info.plist` and verify strict code signing before opening the updater UI.

- [ ] **Step 2: Exercise the real UI**

In the installed application use About → `Check for Updates`. Verify it displays 0.4.11 → 0.4.12. Open the update dialog and confirm it reaches the ready state without `Failed to prepare update`.

- [ ] **Step 3: Download, install, and relaunch**

Select `Download & Install` once. Confirm progress advances, the application relaunches, and no second operation begins from repeated input while busy.

- [ ] **Step 4: Verify the resulting installation and data**

Run:

```bash
/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' /Applications/Meetily.app/Contents/Info.plist
codesign --verify --deep --strict --verbose=2 /Applications/Meetily.app
sqlite3 "$HOME/Library/Application Support/cz.honzavoz.meetily.recordonly/meeting_minutes.sqlite" 'PRAGMA integrity_check; SELECT COUNT(*) FROM meetings;'
find "$HOME/Movies/meetily-recordings" -mindepth 1 -maxdepth 1 -type d | wc -l
```

Expected: version 0.4.12, valid strict signature, integrity `ok`, and unchanged meeting and recording-folder counts.

- [ ] **Step 5: Verify the repaired dialog error path**

Run the focused updater-flow and dialog contract tests once more. The string-error fixture must display its underlying message, and the single-flight fixture must show the second operation did not start.

- [ ] **Step 6: Remove only the temporary application backup after acceptance**

After all acceptance evidence is recorded, report the exact temporary backup path and ask before permanently removing it. User data directories are never cleanup targets.
