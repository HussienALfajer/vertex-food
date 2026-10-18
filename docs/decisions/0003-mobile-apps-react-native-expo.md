# 0003 — Customer and driver apps: React Native with Expo

Status: Accepted (store publishing path open: Q3) · Date: 2026-10-18

## Context
The customer app ships on Android and iOS, with a web version through `apps/web`; the driver app is Android-first because drivers use cheap Android phones. Vertex Shifa chose Expo and Spike B there confirmed Expo push over FCM and APNs to devices in Syria (Vertex Shifa ADR 0022). Google Play does not list Syria among the countries where a developer account can be registered (checked 2026-10-18); the App Store status for Syrian developers is unconfirmed.

## Decision
- **React Native with Expo** for `apps/customer` and `apps/driver` (managed workflow, prebuild when a native module needs it). EAS Build; EAS Update for JavaScript fixes between releases.
- **Shared:** contracts, error codes, API client, i18n catalogs, money formatting, design tokens, `packages/ui-native`.
- **Arabic RTL** forced at start; Latin digits.
- **Push:** Expo notifications, registering both the Expo token and the native token, as in Vertex Shifa ADR 0022.
- **Driver app specifics:** background location only while on duty (Spike C); status changes queued on the phone and sent when the network returns (ADR 0009).
- **Customer app:** not offline-first; a read cache of recent orders and addresses; ordering needs a connection.
- **Publishing:** through store accounts held by an entity in a supported country, or a signed APK from our domain for Android, as decided in Q3. The app never depends on the store for payment (no in-app purchases).
- **Store requirements:** privacy policy, in-app account deletion, location-use disclosure for the driver app.

## Consequences
- Customer and driver apps share most of their foundations.
- Q3 must be answered before Phase 5 publishing; development builds do not need it.
