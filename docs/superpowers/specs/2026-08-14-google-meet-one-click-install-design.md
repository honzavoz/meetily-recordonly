# Google Meet reminder one-click installation

Date: 2026-08-14
Status: approved

## Goal

Replace the user-facing unpacked-extension instructions with a normal Chrome Web Store installation. A user should select **Install in Chrome**, confirm Chrome's standard extension dialog, and return to Meetily. Meetily should recognize the connection automatically.

## User flow

1. Meetily shows **Install in Chrome** while the reminder is not connected.
2. Selecting it registers Meetily's native-messaging host, enables the integration, and opens the extension's unlisted Chrome Web Store page.
3. Chrome owns the installation confirmation and future extension updates.
4. Meetily polls its existing integration status. The status becomes **Connected** after the extension's integration ping arrives.
5. The button remains available as **Open Chrome Web Store** until connected, so a dismissed or failed Chrome installation can be retried.
6. The bundled unpacked extension and its path remain available only as an advanced development/support fallback; the normal settings UI does not expose the folder or Developer mode instructions.

## Compatibility

The first dashboard upload establishes the Chrome Web Store item ID and public key. Before the app release, those assigned values replace the development manifest key and extension ID `fonilmfiddnidgjpcijiocffkbbeaddo`, and the native host's single allowed origin is updated to match. The store item ID, packaged manifest key, native-host origin, and settings URL must pass an automated consistency check. The extension protocol and privacy-sensitive permissions remain unchanged.

## Store deliverables

The repository produces a deterministic ZIP containing only the built extension, manifest, and required icons. It also contains copy-ready listing, privacy, permission-justification, and reviewer-instruction documents. Distribution is **unlisted**, giving users the normal store installation and automatic Chrome updates without making this private Meetily companion searchable.

## Release gate

Do not ship the app UI pointing to the store until the listing URL resolves. Google account verification, the developer agreement, developer registration payment, and final submission are account-holder actions. Everything else is prepared and verified in the repository.
