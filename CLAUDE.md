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
- `role` → Firestore field `users/{uid}.role` (`'player' | 'admin'`) — global role
- **OG is now group-scoped**, not a global role: it's the boolean flag `groups/{groupId}/members/{uid}.og`. On login, `useAuth.loadOgGroups()` collects the groups where the user is OG into `authStore.ogGroupIds`; check membership with `authStore.isOgInGroup(groupId)`. A group owner/admin toggles it in `GroupDetailPage` via `useGroups.setMemberOG`.
- Both `isAdmin`/`role` must stay in sync: `setUserRole` Cloud Function sets the claim AND updates Firestore

**Composables pattern**: all business logic lives in `src/composables/`. Each composable holds its own `loading`/`error` refs. Exception: `useGroups.js` exposes a module-level `groups` ref (shared state across instances).

**`getEffectiveStatus(match)`** (`useMatch.js`): client-side match status inference — do not trust only `match.status` from Firestore for UI display. Call this function instead. The Cloud Scheduler sets status server-side, but there can be a lag.

**OG early access**: wherever `openAt` is used as a threshold, subtract 30 minutes if `authStore.isOgInGroup(match.groupId)` (i.e. the user is OG in the match's group). This pattern repeats in `useRegistration.js` (`registerEntry`/`canRegister`/`msUntilOpen`) and in `firestore.rules` (`isOgInMatchGroup(matchId)`). OGs also get a push notification 30 min before `openAt`, scheduled at match-creation time into `_matchOgNotifyQueue` and sent by `processMatchOgNotifyQueue` → `sendFCMToGroupOGs`. Matches with no `groupId` have no OG early access.

**Registering others**: `useRegistration.registerEntry` is the shared transactional core. `joinMatch` (self), `addGuestToMatch` (guest with no account → auto-id docId, `userId: null`, `isGuest: true`, `guestName`), and `addMemberToMatch` (another existing member → docId = their uid) all go through it. Every registration records `addedBy`/`addedByName`. `removeRegistration(matchId, registrationId)` cancels any entry (self via `leaveMatch`, or whoever set `addedBy`, or admin). UI lives in `DashboardPage` (the "Anotar a otra persona" dialog).

### Firestore Data Model

See `src/services/firestore.schema.js` for full field-level documentation.

```
users/{uid}
  stats: { goals, assists, matchesPlayed }   ← accumulator, written ONLY by the
                                                onPlayerStatsWritten Cloud Function (delta-based)
  statsByGroup: { [groupId]: { goals, assists, matchesPlayed } }
  fcmToken: string                           ← current device token
  fcmTokens: string[]                        ← all known tokens (deduped)
  role: 'player' | 'admin'                   ← OG is per-group (members.og), not here

matches/{matchId}
  status: 'scheduled' | 'open' | 'closed' | 'finished'
  currentPlayers: number                     ← atomic counter, only via transaction
  openAt / notifyAt: Timestamp
  registrations/{regId}                      ← docId = userId (self/member) OR auto-id (guest)
    userId: string|null, position, isOnWaitlist
    isGuest: bool, guestName: string|null      ← guest = person without an account
    addedBy: string, addedByName: string       ← who registered this entry
  playerStats/{userId}                       ← docId = uid (guests excluded, they have no profile)
    goals, assists, team: 'A'|'B'|null, groupId   ← a write here triggers the accumulator CF

groups/{groupId}
  inviteCode: string (8 chars, uppercase, no O/0/I/1)
  nameLower: string  ← for prefix search queries
  members/{userId}   ← role: 'owner' | 'admin' | 'member';  og: bool (early access)
  joinRequests/{userId}  ← status: 'pending' | 'accepted' | 'rejected'

_matchOpenQueue / _matchReminderQueue / _matchOgNotifyQueue   ← internal scheduler queues (never read client-side)
```

**Critical**: Registration (`joinMatch`) uses `runTransaction` to prevent race conditions under concurrent signups. Reads must always come before writes in the transaction. `currentPlayers` is incremented manually inside the transaction (not with `FieldValue.increment()`) because the pre-write value is needed for the position calculation.

### Backend (functions/)

All functions deployed to `southamerica-east1`. Written with Firebase Functions v2.

| Export | Type | Purpose |
|---|---|---|
| `scheduleMatchOpenNotification` | Callable | Enqueues a match to `_matchOpenQueue`, and (if it has a group) the OG early-notify to `_matchOgNotifyQueue`. Callable by a global admin OR the owner/admin of the match's group (`assertCanManageMatchNotifications`) |
| `processMatchOpenQueue` | Scheduled (every 1 min) | Opens matches whose `openAt` has passed |
| `scheduleMatchReminderNotification` | Callable | Enqueues a reminder to `_matchReminderQueue` (same permission as above) |
| `onPlayerStatsWritten` | Firestore trigger | On any write to `matches/{id}/playerStats/{uid}`, delta-updates the user's `stats`/`statsByGroup` accumulator — idempotent, so clients never write another user's doc and re-saving a result doesn't double-count |
| `processMatchReminderQueue` | Scheduled (every 1 min) | Sends FCM reminders via `sendFCMToAllUsers` |
| `processMatchOgNotifyQueue` | Scheduled (every 1 min) | Sends the 30-min-early push to a group's OGs via `sendFCMToGroupOGs` |
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
- Group-scoped helpers (each does 1-2 `get()`s): `isOgInMatchGroup(matchId)` (early registration), `isMemberOfMatchGroup(matchId)` (load results), `isGroupAdmin(groupId)` (owner/admin)
- Users can update only their own `fcmToken`/`updatedAt`; `stats`/`statsByGroup` are writable from the client ONLY by a global admin (normally written by the `onPlayerStatsWritten` CF via admin SDK, which bypasses rules)
- **Create a match**: global admin, OR the owner/admin of the group set in `groupId` (`createdBy` must be self). **Load a result** (`scoreA`/`scoreB`/`status` + `playerStats`): any member of the match's group, or admin
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
