# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Futbols** is a PWA for organizing amateur football matches. Players register for matches, track stats, and get FCM push notifications when lists open. There are three user roles: `player` (default), `og` (gets 30-min early registration access), and `admin` (Firebase custom claim `admin === true`).

## Commands

```bash
# Development
quasar dev          # or: npm run dev

# Build
npm run build       # SPA build
npm run build:pwa   # PWA build — this is what gets deployed to Firebase Hosting

# Lint / Format
npm run lint        # ESLint (auto-fix enabled via quasar.config.js)
npm run format      # Prettier

# Deploy (Firebase)
firebase deploy                    # full deploy
firebase deploy --only hosting     # frontend only
firebase deploy --only functions   # Cloud Functions only
firebase deploy --only firestore   # rules + indexes

# Functions local dev
cd functions && npm install
firebase emulators:start
```

## Architecture

### Frontend (src/)

**Boot sequence**: `src/boot/pinia.js` → `src/boot/firebase.js`

`firebase.js` boot initializes FCM in the background (`initFCMInBackground`): waits for the Service Worker, registers the foreground message handler, then on each `onAuthStateChanged` event requests notification permission and saves the FCM token to Firestore.

**Auth flow**: `useAuth.js` composable wraps Firebase Google OAuth. `initAuthListener()` must be called once (in `App.vue`) — it runs `onAuthStateChanged`, reads the Firestore user doc, checks the Firebase custom claim `admin`, and populates `useAuthStore`. The router guard in `src/router/index.js` blocks on `authStore.initialized` before evaluating `requiresAuth`/`requiresAdmin` meta.

**Role system** (`src/stores/auth.store.js`):
- `isAdmin` → Firebase custom claim `admin === true` (set via `setAdminClaim` Cloud Function)
- `role` → Firestore field `users/{uid}.role` (`'player' | 'og' | 'admin'`)
- Both must stay in sync: `setUserRole` Cloud Function sets the claim AND updates Firestore

**Composables pattern**: all business logic lives in `src/composables/`. Each composable holds its own `loading`/`error` refs. Exception: `useGroups.js` exposes a module-level `groups` ref (shared state across instances).

**`getEffectiveStatus(match)`** (`useMatch.js`): client-side match status inference — do not trust only `match.status` from Firestore for UI display. Call this function instead. The Cloud Scheduler sets status server-side, but there can be a lag.

**OG early access**: wherever `openAt` is used as a threshold, subtract 30 minutes if `authStore.user.role === 'og'`. This pattern repeats in `useRegistration.js` (both `joinMatch` and `canRegister`/`msUntilOpen`) and in `firestore.rules`.

### Firestore Data Model

See `src/services/firestore.schema.js` for full field-level documentation.

```
users/{uid}
  stats: { goals, assists, matchesPlayed }   ← accumulator, updated by writeBatch
  fcmToken: string                           ← current device token
  fcmTokens: string[]                        ← all known tokens (deduped)
  role: 'player' | 'og' | 'admin'

matches/{matchId}
  status: 'scheduled' | 'open' | 'closed' | 'finished'
  currentPlayers: number                     ← atomic counter, only via transaction
  openAt / notifyAt: Timestamp
  registrations/{userId}                     ← docId = userId → 1 registration per user
    position: number, isOnWaitlist: boolean
  playerStats/{userId}
    goals, assists, team: 'A' | 'B'

groups/{groupId}
  inviteCode: string (8 chars, uppercase, no O/0/I/1)
  nameLower: string  ← for prefix search queries
  members/{userId}   ← role: 'owner' | 'admin' | 'member'
  joinRequests/{userId}  ← status: 'pending' | 'accepted' | 'rejected'

_matchOpenQueue / _matchReminderQueue   ← internal scheduler queues (never read client-side)
```

**Critical**: Registration (`joinMatch`) uses `runTransaction` to prevent race conditions under concurrent signups. Reads must always come before writes in the transaction. `currentPlayers` is incremented manually inside the transaction (not with `FieldValue.increment()`) because the pre-write value is needed for the position calculation.

### Backend (functions/)

All functions deployed to `southamerica-east1`. Written with Firebase Functions v2.

| Export | Type | Purpose |
|---|---|---|
| `scheduleMatchOpenNotification` | Callable | Enqueues a match to `_matchOpenQueue` (admin-only) |
| `processMatchOpenQueue` | Scheduled (every 1 min) | Opens matches whose `openAt` has passed |
| `scheduleMatchReminderNotification` | Callable | Enqueues a reminder to `_matchReminderQueue` |
| `processMatchReminderQueue` | Scheduled (every 1 min) | Sends FCM reminders via `sendFCMToAllUsers` |
| `setAdminClaim` | Callable | Sets Firebase custom claim `admin` (admin-only) |
| `setUserRole` | Callable | Updates both Firestore role field and custom claim |
| `onMatchOpened` | Firestore trigger | Sends FCM broadcast when match status → `open` |

`sendFCMToAllUsers` reads all users' `fcmToken`/`fcmTokens`, sends in batches of 500 via `sendEachForMulticast`, and cleans up invalid tokens automatically.

### PWA / Service Worker (src-pwa/)

`custom-service-worker.js` uses Workbox `injectManifest` mode. Handles:
- Precaching + SPA fallback routing
- `push` event → `showNotification`
- `notificationclick` → opens `/partidos/{matchId}` or `/`

The SW calls `skipWaiting()` + `clientsClaim()` so updates take effect immediately.

### Firestore Security Rules

- `isAdmin()` checks the Firebase Auth custom claim (not the Firestore role field)
- `isOG()` reads the Firestore role field via `get()` — this counts as an extra read
- Users can update only their own `fcmToken`/`updatedAt`; stats are restricted to `isAdmin() || isOG()`
- `currentPlayers` on a match can be updated by any authenticated user (required for the transaction pattern)
- `joinRequests` can never be deleted (even by admins); they are soft-deleted via status field

## Environment Variables

Required in `.env.local` (not committed):
```
VITE_FIREBASE_API_KEY
VITE_FIREBASE_AUTH_DOMAIN
VITE_FIREBASE_PROJECT_ID
VITE_FIREBASE_STORAGE_BUCKET
VITE_FIREBASE_MESSAGING_SENDER_ID
VITE_FIREBASE_APP_ID
VITE_FIREBASE_MEASUREMENT_ID
VITE_FIREBASE_VAPID_KEY      ← required for FCM getToken()
```

## Known Issues

None currently tracked. (Previously: a duplicate dead-code `exports.onMatchOpened` in `functions/index.js`, a stale `firebase.json` project alias, and leftover debug `console.log`s in `src/boot/firebase.js`/`useGroups.js` — all fixed.)
