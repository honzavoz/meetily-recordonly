# Project Colors and Meetily App Name Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add persistent, editable project colors throughout Meetily and restore the packaged application name to `Meetily` in version 0.4.4.

**Architecture:** Store a validated palette key on the canonical SQLite project record and include it in every Rust/frontend project DTO. Centralize palette rendering in a small frontend helper and edit colors through the existing project navigation. Preserve the bundle identifier while changing only the visible Tauri product/window name.

**Tech Stack:** Rust, SQLx/SQLite migrations, Tauri 2, TypeScript, React, Tailwind CSS, Bun tests, GitHub Actions macOS build.

---

### Task 1: Project color domain and migration

**Files:**
- Create: `frontend/src-tauri/migrations/20260803010000_add_project_colors.sql`
- Modify: `frontend/src-tauri/src/database/models.rs`
- Modify: `frontend/src-tauri/src/database/repositories/project.rs`
- Test: `frontend/src-tauri/src/database/repositories/project.rs`

- [ ] **Step 1: Write failing repository tests**

Add tests asserting that existing rows expose a deterministic default palette key, newly created projects rotate through valid palette keys, and `update_color` accepts palette keys but rejects arbitrary strings.

- [ ] **Step 2: Run the focused Rust test and verify failure**

Run: `cargo test database::repositories::project::tests --manifest-path frontend/src-tauri/Cargo.toml`

Expected: compilation or assertion failure because `color` and `update_color` do not exist.

- [ ] **Step 3: Add the additive migration and repository implementation**

The migration adds `color TEXT NOT NULL DEFAULT 'blue'`. Define the allowed keys `blue`, `violet`, `emerald`, `amber`, `rose`, `cyan`, `orange`, and `slate`. Include `color` in every project query/model, choose a deterministic key for creation, and implement `ProjectRepository::update_color(pool, project_id, color)` with validation.

- [ ] **Step 4: Run the focused repository tests**

Run: `cargo test database::repositories::project::tests --manifest-path frontend/src-tauri/Cargo.toml`

Expected: all project repository tests pass, or the known local native dependency blocker is documented and the equivalent GitHub Actions Rust build becomes the required gate.

- [ ] **Step 5: Commit the persistence layer**

```bash
git add frontend/src-tauri/migrations/20260803010000_add_project_colors.sql frontend/src-tauri/src/database/models.rs frontend/src-tauri/src/database/repositories/project.rs
git commit -m "feat: persist project colors"
```

### Task 2: Commands and pending-recording metadata

**Files:**
- Modify: `frontend/src-tauri/src/lib.rs`
- Modify: `frontend/src-tauri/src/audio/transcribe_later.rs`
- Modify: `frontend/src/services/projectService.ts`
- Modify: `frontend/src/types/projects.ts`
- Test: `frontend/src-tauri/src/audio/transcribe_later.rs`
- Test: `frontend/tests/services/transcribe-later-service.test.ts`

- [ ] **Step 1: Write failing command and serialization tests**

Assert that project color is serialized as `color`, pending metadata preserves it, older metadata without it uses `blue`, and transferred projects retain the canonical database color. Add a frontend service test for `update_project_color`.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `mise x bun@latest -- bun test frontend/tests/services/transcribe-later-service.test.ts`

Expected: failures for the missing color property/update call.

- [ ] **Step 3: Implement DTO propagation and the Tauri command**

Add `color: String`/`color: string` to project DTOs, register `update_project_color`, expose `ProjectService.updateColor`, and make recording metadata deserialize missing colors with the default `blue` key.

- [ ] **Step 4: Run focused tests**

Run: `mise x bun@latest -- bun test frontend/tests/services/transcribe-later-service.test.ts`

Expected: focused tests pass.

- [ ] **Step 5: Commit the API layer**

```bash
git add frontend/src-tauri/src/lib.rs frontend/src-tauri/src/audio/transcribe_later.rs frontend/src/services/projectService.ts frontend/src/types/projects.ts frontend/tests/services/transcribe-later-service.test.ts
git commit -m "feat: expose project color updates"
```

### Task 3: Palette UI and color editor

**Files:**
- Create: `frontend/src/lib/project-colors.ts`
- Create: `frontend/src/components/Projects/ProjectColorPicker.tsx`
- Modify: `frontend/src/components/Projects/ProjectPicker.tsx`
- Modify: `frontend/src/components/Sidebar/index.tsx`
- Modify: `frontend/src/app/meeting-details/page.tsx`
- Test: `frontend/tests/lib/project-colors.test.ts`

- [ ] **Step 1: Write failing palette helper tests**

Test that all eight keys resolve to chip, dot, and border classes and that an unknown/missing key resolves to `blue`.

- [ ] **Step 2: Run the test and verify failure**

Run: `mise x bun@latest -- bun test frontend/tests/lib/project-colors.test.ts`

Expected: module-not-found failure for `project-colors`.

- [ ] **Step 3: Implement the palette and reusable picker**

Create a typed palette mapping with accessible light backgrounds and dark foregrounds. Build a compact popover containing eight labeled swatches with keyboard focus states and an `aria-label` for each color.

- [ ] **Step 4: Apply project colors consistently**

Use the palette for project navigation dots, meeting chips, pending-recording chips, project picker rows, and meeting-detail chips. Add optimistic color updates in the sidebar with rollback and toast on failure.

- [ ] **Step 5: Run palette tests and production type/build checks**

Run: `mise x bun@latest -- bun test frontend/tests/lib/project-colors.test.ts && pnpm --dir frontend build`

Expected: tests pass and Next.js production build completes.

- [ ] **Step 6: Commit the UI**

```bash
git add frontend/src/lib/project-colors.ts frontend/src/components/Projects/ProjectColorPicker.tsx frontend/src/components/Projects/ProjectPicker.tsx frontend/src/components/Sidebar/index.tsx frontend/src/app/meeting-details/page.tsx frontend/tests/lib/project-colors.test.ts
git commit -m "feat: add editable project colors"
```

### Task 4: Restore Meetily identity and release 0.4.4

**Files:**
- Modify: `frontend/src-tauri/tauri.conf.json`
- Modify: `frontend/src-tauri/Cargo.toml`
- Modify: `frontend/package.json`
- Modify: `Cargo.lock`
- Test: `frontend/tests/lib/app-version.test.mjs`

- [ ] **Step 1: Extend the version/config test**

Assert that all version sources equal `0.4.4`, `productName` equals `Meetily`, the main window title equals `Meetily`, and the bundle identifier remains `cz.honzavoz.meetily.recordonly`.

- [ ] **Step 2: Run the test and verify failure**

Run: `mise x bun@latest -- bun test frontend/tests/lib/app-version.test.mjs`

Expected: failure because the current visible name and version are old.

- [ ] **Step 3: Update identity and synchronized versions**

Set the Tauri product/window name to `Meetily`, keep the identifier unchanged, and update the four synchronized version declarations to `0.4.4`.

- [ ] **Step 4: Run the version test**

Run: `mise x bun@latest -- bun test frontend/tests/lib/app-version.test.mjs`

Expected: all identity/version assertions pass.

- [ ] **Step 5: Commit the release identity**

```bash
git add frontend/src-tauri/tauri.conf.json frontend/src-tauri/Cargo.toml frontend/package.json Cargo.lock frontend/tests/lib/app-version.test.mjs
git commit -m "chore: restore Meetily name for 0.4.4"
```

### Task 5: Full verification, main push, and macOS artifact

**Files:**
- Verify only; no expected source changes.

- [ ] **Step 1: Run frontend tests and build**

Run: `cd frontend && mise x bun@latest -- bun test && pnpm build`

Expected: zero failed tests and successful Next.js production build.

- [ ] **Step 2: Run Rust checks**

Run: `cargo test --manifest-path frontend/src-tauri/Cargo.toml`

Expected: all tests pass, or local native-toolchain blocking is explicitly documented and GitHub Actions must pass.

- [ ] **Step 3: Verify repository state**

Run: `git diff --check && git status --short --branch`

Expected: no tracked changes and only the pre-existing untracked `.pnpm-store/` remains.

- [ ] **Step 4: Push main and trigger unsigned macOS release build**

Push `main`, dispatch `Build and Test - macOS` with artifact upload enabled, and wait for successful completion.

- [ ] **Step 5: Download and inspect the artifact**

Download the `0.4.4` artifact to `/Users/janvozenilek/Downloads/Meetily-0.4.4`, unpack it, and read `Info.plist`. Expected: bundle/display name `Meetily`, version `0.4.4`, existing bundle identifier unchanged.

- [ ] **Step 6: Launch and manually verify**

Open the exact downloaded `Meetily.app`, change one project color, confirm all visible chips update, restart the app, and confirm the color persists.
