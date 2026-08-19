/**
 * @norns/i18n-de — the platform-neutral German text spine.
 *
 * Lifted verbatim out of the mobile app so the desktop cashier and control
 * surface speak through the SAME describeError + the SAME exhaustive enum
 * registries. One place that turns the backend's developer vocabulary into
 * clean idiomatic German; no raw machine token ever reaches a human (doctrine a).
 *
 * Depends only on `@norns/api-client` — zero React, zero React-Native,
 * so it imports cleanly into both an Expo app and a Tauri/React app.
 */
export * from "./german-text"
export * from "./audit-vocab"
export * from "./address"
export * from "./finance-vocab"
export * from "./task-vocab"
