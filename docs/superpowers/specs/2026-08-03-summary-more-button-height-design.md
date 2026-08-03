# Summary More Button Height

## Problem

In the compact summary toolbar, `Save` uses the standard small button height while `More` overrides it with a larger minimum height. The adjacent controls therefore look vertically mismatched.

## Design

Keep both controls on the existing shared `Button` component with `size="sm"`. Remove the `More`-specific minimum-height override so the component's 32 px small-size contract determines both heights. Preserve the overflow menu, label visibility, icon, spacing, and interaction behavior.

## Verification

Add a source-level regression test asserting that the overflow trigger uses `size="sm"` without `min-h-11`. Run the focused test, the full frontend test suite, and the production frontend build.
