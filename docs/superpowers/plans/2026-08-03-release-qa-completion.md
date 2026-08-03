# Release QA Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the confirmed Settings, lint, CI verification, and About branding gaps and ship an independently verified macOS build.

**Architecture:** Keep Settings content width independent from a dedicated tab-scroll viewport. Use the existing ESLint flat config through the ESLint CLI, add deterministic quality gates to the macOS workflow, and simplify About to Meetily-owned product copy.

**Tech Stack:** Next.js 14, React, TypeScript, Tailwind CSS, Radix Tabs, ESLint flat config, Bun tests, GitHub Actions, Rust/Cargo, Tauri

---

### Task 1: Add release contract tests

**Files:**
- Create: `frontend/tests/lib/release-qa-completion.test.ts`

- [ ] **Step 1: Write failing source-contract tests**

Read `src/app/settings/page.tsx`, `src/components/About.tsx`, `package.json`, and `.github/workflows/build-macos.yml`. Assert that Settings contains `settings-tabs-scroll`, `overflow-x-auto`, `min-w-max`, `min-w-0`, and responsive padding; About contains `Meetily` but no `Zackriya`; `package.json` uses `eslint .`; and the workflow contains `pnpm lint`, `pnpm exec bun test`, and `cargo test --workspace --locked`.

- [ ] **Step 2: Run the focused test**

Run: `pnpm exec bun test tests/lib/release-qa-completion.test.ts`

Expected: FAIL on the missing responsive, branding, lint, and CI contracts.

### Task 2: Isolate the Settings tab scroller

**Files:**
- Modify: `frontend/src/app/settings/page.tsx`
- Test: `frontend/tests/lib/release-qa-completion.test.ts`

- [ ] **Step 1: Add bounded responsive wrappers**

Use responsive `px-3 py-4 sm:px-6 sm:py-5 lg:px-8 lg:py-6`, add `min-w-0 w-full`, and wrap the tab list in `settings-tabs-scroll w-full min-w-0 overflow-x-auto overscroll-x-contain`.

- [ ] **Step 2: Keep the tab list content-sized**

Give `TabsList` `min-w-max` so only the dedicated viewport scrolls, then call `activeTabElement.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' })` when selection changes.

- [ ] **Step 3: Run the focused test**

Run: `pnpm exec bun test tests/lib/release-qa-completion.test.ts`

Expected: Settings assertions pass while later task assertions still fail.

### Task 3: Make lint deterministic

**Files:**
- Modify: `frontend/package.json`
- Modify: `frontend/eslint.config.mjs`
- Test: `frontend/tests/lib/release-qa-completion.test.ts`

- [ ] **Step 1: Replace the interactive script**

Set `scripts.lint` to `eslint .`.

- [ ] **Step 2: Ignore generated output**

Add flat-config ignores for `.next/**`, `out/**`, `dist/**`, `src-tauri/target/**`, and `src-tauri/binaries/**` before the Next compatibility configuration.

- [ ] **Step 3: Run lint and fix only blocking configuration or real lint errors**

Run: `pnpm lint`

Expected: exit 0 without an interactive prompt.

### Task 4: Complete Meetily About branding

**Files:**
- Modify: `frontend/src/components/About.tsx`
- Test: `frontend/tests/lib/release-qa-completion.test.ts`

- [ ] **Step 1: Remove the sales CTA and upstream attribution**

Delete the Zackriya contact section and its handler/imports if unused. Replace the footer with `Meetily — private meeting notes on your Mac.`

- [ ] **Step 2: Run the focused test**

Run: `pnpm exec bun test tests/lib/release-qa-completion.test.ts`

Expected: branding assertions pass.

### Task 5: Add macOS quality gates

**Files:**
- Modify: `.github/workflows/build-macos.yml`
- Test: `frontend/tests/lib/release-qa-completion.test.ts`

- [ ] **Step 1: Add frontend checks after dependency installation**

Run `pnpm lint` and `pnpm exec bun test` from `frontend` before packaging.

- [ ] **Step 2: Add Rust workspace tests after Rust setup**

Run `cargo test --workspace --locked` from the repository root before building the sidecar.

- [ ] **Step 3: Run the focused test**

Run: `pnpm exec bun test tests/lib/release-qa-completion.test.ts`

Expected: all release-contract tests pass.

### Task 6: Verify and deliver

**Files:**
- Modify: only files listed above

- [ ] **Step 1: Run complete local verification**

Run `pnpm exec bun test`, `pnpm lint`, `pnpm build`, and `git diff --check`.

- [ ] **Step 2: Commit and push**

Commit the implementation as `fix: complete release qa hardening` and push `main`.

- [ ] **Step 3: Build and install**

Trigger `.github/workflows/build-macos.yml`, require the complete workflow to pass, download its `meetily-macos-aarch64-unsigned-release-0.4.4` artifact, verify arm64 and bundle integrity, back up the installed app, and install the artifact.

- [ ] **Step 4: Perform desktop QA**

At a narrow window, verify the active Settings tab scrolls into view while the content stays left-aligned with no page-level horizontal scrollbar. At a wide window, verify the original single-row layout. Open About and confirm only Meetily branding is visible.
