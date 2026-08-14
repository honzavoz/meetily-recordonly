# Google Meet reminder one-click installation plan

1. Add failing frontend tests for a retryable Web Store CTA and connected-state behavior.
2. Add failing Rust tests for the fixed Chrome Web Store URL and setup command behavior that no longer opens Finder or `chrome://extensions`.
3. Implement the settings UX and backend Web Store launch while preserving the existing extension ID and native host registration.
4. Add extension icons to the manifest/build output and create a deterministic Web Store ZIP builder and verifier.
5. Add Chrome Web Store listing, privacy disclosure, permission justifications, and reviewer instructions.
6. Run focused frontend, extension, Rust, package, and release-preflight verification.
7. Upload the initial draft, copy the dashboard-assigned item ID and public key into the manifest/native-host configuration, and verify their consistency.
8. Submit as an unlisted Chrome Web Store item, then release the app only after the listing URL is live.
