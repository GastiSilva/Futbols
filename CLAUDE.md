# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Cómo explicarle las cosas al usuario

**El usuario habla español. Respondé siempre en español.**

Cuando expliques un problema —sobre todo de **seguridad**, de datos o de arquitectura— usá SIEMPRE dos capas, en este orden:

1. **La técnica**: qué pasa, en qué archivo/línea, con el vocabulario preciso.
2. **La cotidiana**: la misma idea con una analogía simple, preferentemente **de fútbol** (el vestuario, el árbitro, la lista del partido, el DT, la cancha).

Ejemplo del formato esperado:

> **Técnico:** `isOwner(request.auth.uid)` compara el uid del que llama consigo mismo, así que siempre devuelve `true` y anula el `isMemberOfGroup` contiguo.
>
> **En criollo:** es como poner un tipo en la puerta del vestuario que, para dejarte pasar, te pide que muestres tu DNI y lo compara… con tu propio DNI. Obvio que coincide. Con eso entra cualquiera.

La analogía no reemplaza a la explicación técnica: van las dos, siempre. Sin la técnica no se puede arreglar; sin la cotidiana no se entiende qué está en juego.

## Project Overview

**Futbols** is a PWA for organizing amateur football matches. Players register for matches, track stats, and get FCM push notifications when lists open. Global roles: `player` (default) and `admin` (Firebase custom claim `admin === true`). Per-group, members can have **early access** (30-min early registration): OG flag (`members.og`) or group `owner`/`admin` role.

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

# Tests de las reglas de seguridad (requiere Java para el emulador)
npm run test:rules  # levanta el emulador de Firestore, corre los tests y lo baja

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
- **Early access is group-scoped**: a member has it if they are OG (`groups/{groupId}/members/{uid}.og === true`) **OR** their group role is `owner`/`admin`. On login, `useAuth.loadOgGroups()` collects those groups into `authStore.ogGroupIds`; check with `authStore.isOgInGroup(groupId)` (despite the name, it covers OG + owner/admin). A group owner/admin toggles the OG flag in `GroupDetailPage` via `useGroups.setMemberOG`.
- Both `isAdmin`/`role` must stay in sync: `setUserRole` Cloud Function sets the claim AND updates Firestore
- **Editable profile** (`users/{uid}.nickname/description/preferredFoot/preferredPositions`): edited only by the owner in `ProfilePage` (route `/perfil`, name `profile`, first item in the drawer) via `useAuth.updateUserProfile`. `preferredPositions` is a `string[]` of up to 5 position codes (`MAX_FAVORITE_POSITIONS` in `src/utils/positions.js`), picked with the interactive FIFA-style pitch component `src/components/PitchPositionPicker.vue` (SVG vertical pitch, clickable dots, `v-model` array). Intended to later feed an AI/algorithm that builds balanced teams (position + description + stats). Users only ever see their own profile (there is no public profile page). On mount the page re-reads the user doc and patches the store — the store copy is from login time and the stats accumulator (CF) updates Firestore behind its back.
- **Registrations use the nickname**: `joinMatch` registers with `user.nickname || user.displayName`; `addMemberToMatch` reads the target's `users/{uid}` doc to prefer their nickname; `addedByName` also prefers the nickname. The name is frozen into the registration doc (`displayName`).
- **Group data visibility** (`GroupDetailPage.canManageGroup`): ALL members see the invite link, the member list, and the group's matches. Management actions (accept/reject join requests, "Crear partido", member menus, group photo, regenerate code) are only for the group owner/admin or a global admin. Join requests are only fetched when allowed (rules deny the query to plain members — fetching them unconditionally used to break the page for regular members).

**Composables pattern**: all business logic lives in `src/composables/`. Each composable holds its own `loading`/`error` refs. Exception: `useGroups.js` exposes a module-level `groups` ref (shared state across instances).

**`getEffectiveStatus(match)`** (`useMatch.js`): client-side match status inference — do not trust only `match.status` from Firestore for UI display. Call this function instead. The Cloud Scheduler sets status server-side, but there can be a lag. It can return the UI-only status **`'full'`** (`currentPlayers >= maxPlayers`, never stored in Firestore): a full match still accepts registrations as **substitutes** (`isOnWaitlist: true`); `'closed'` means manually closed (no signups at all).

**Early access (30 min before `openAt`)**: wherever `openAt` is used as a threshold, subtract 30 minutes if `authStore.isOgInGroup(match.groupId)` (OG or group owner/admin). This pattern repeats in `useRegistration.js` (`registerEntry`/`canRegister`/`msUntilOpen`, constant `EARLY_ACCESS_MS`) and in `firestore.rules` (`hasEarlyAccessInMatchGroup(matchId)` / `memberHasEarlyAccess(groupId, uid)`). Rules of the early window:
- The **match creator can register HIMSELF from moment zero** (no time restriction at all) — client (`creatorSelf` in `registerEntry`, `canRegister`, `msUntilOpen`) and rules (`isMatchCreator(matchId)`, branch (0) of registrations create).
- During the early window, **only members who ALSO have early access can be registered** (by themselves or by someone with early access / the creator). Guests and regular members must wait for `openAt`. Enforced in `registerEntry` (reads the target's member doc inside the transaction) and in rules branch (2).
- Early-access members (OG + owner + admins) get the push 30 min before `openAt` via `_matchOgNotifyQueue` → `processMatchOgNotifyQueue` → `sendFCMToGroupOGs` (queries both `og == true` and `role in ['owner','admin']`). Matches with no `groupId` have no early access.

**Instant-open lists (`instantOpen`)**: the "Abrir la lista ahora" toggle in `CreateMatchPage` sets `openAt = now` and `matches/{id}.instantOpen = true`. That flag **cancels the 30-min early-access window entirely** — everyone in the group registers from the same instant and the FCM goes out to the whole group at once (no OG head start). Enforced in three places that must agree: `earlyAccessMsFor(match)` in `useRegistration.js` (returns 0 instead of `EARLY_ACCESS_MS`, used by `registerEntry`/`canRegister`/`msUntilOpen`/`isInEarlyWindow`), branch (2) of the registrations `create` rule (`instantOpen == false`), and `scheduleMatchOpenNotification` (skips `enqueueOgEarlyNotify`). Since `openAt` is already past, the callable flips the match to `open` immediately, which fires `onMatchOpened` → `sendFCMToGroupMembers`.

**Shared match links / guest mode**: "Compartir lista" appends `/invitacion/{matchId}` (`buildMatchInviteLink`). That public route (`MatchInvitePage`) branches three ways: already logged in → straight to the match; **guest** → Firebase **anonymous auth** (`loginAsGuest`), which registers them as `isGuest: true` (auto-id doc, `userId: null`, so no stats/MVP — exactly what the UI promises); or log in / sign up → full circuit (login → match → auto-join the group via `useMatchInvite.joinMatchGroup`, triggered by `?invitado=1`).
- **`isAuthenticated()` in the rules now EXCLUDES anonymous users** (`sign_in_provider != 'anonymous'`) — it gates nearly every write in the app. Guests get narrow explicit branches instead (`isAnonGuest()`): read matches/registrations, branch (0b) of registrations create (only `isGuest` docs, only from `openAt`), and `currentPlayers` for their transaction.
- Guests are confined to `allowGuest` routes (`player-dashboard`, `match-detail`) by the router guard; anything else bounces them back to their match with `?registrate=1`, which opens the "create an account" dialog. `authStore.isGuest` / `guestMatchId` (persisted in sessionStorage, since the anonymous session survives a refresh) gate the UI; `guestMatchId` is also the only match they may join.
- The pending-invite intent survives the `/login` round trip via sessionStorage (`useMatchInvite.setPendingInvite`/`consumePendingInvite`), same pattern as group invites. The FCM boot skips anonymous users (no `users/` doc to write a token to).

**Registering others**: `useRegistration.registerEntry` is the shared transactional core. `joinMatch` (self), `addGuestToMatch` (guest with no account → auto-id docId, `userId: null`, `isGuest: true`, `guestName`), and `addMemberToMatch` (another existing member → docId = their uid) all go through it. Every registration records `addedBy`/`addedByName`. `removeRegistration(matchId, registrationId)` cancels any entry (self via `leaveMatch`, or whoever set `addedBy`, or admin). UI lives in `DashboardPage` (the "Anotar a otra persona" dialog, which hides the guest option and filters members during the early window).

**Waitlist / substitutes**: when the quota is full, new registrations get `isOnWaitlist: true` (position > maxPlayers). When any registration is deleted, the CF `onRegistrationDeleted` renumbers positions (1..N, no gaps) and recomputes `isOnWaitlist`, then notifies: (1) any substitute **promoted** to starter gets a personal FCM (`sendFCMToUser`); (2) if **no** substitute filled the gap and the list is still `open` with a free slot, it **broadcasts to everyone** (`sendFCMToAllUsers` excluding already-registered) that a spot opened up; (3) otherwise (spot auto-filled, or list not open) it just tells the match **creator** someone left.

**MVP per match**: chosen in `PostMatchPage` when loading the result. Stored as `matches/{id}.mvpUserId/mvpName` (via `saveMatchResult`) AND as the boolean `mvp` on each `playerStats` row — `onPlayerStatsWritten` delta-accumulates it into `stats.mvps`/`statsByGroup.{gid}.mvps` (idempotent, changing the MVP moves the count). Shown in `MatchDetailPage` and as a "MVPs" tab in `LeaderboardPage`.

**Venues (sedes)**: top-level `venues` collection (`useVenues.js`, module-level shared `venues` ref; `VenuesPage` at `/sedes`). Fields: `name`, `address`, `mapsUrl` (Google Maps share link), `notes`. Any authenticated user creates; creator or global admin edits/deletes. Matches reference them via `venueId` and denormalize `location` (name — address) and `venueMapsUrl`, so match display never needs an extra read and survives venue deletion. In Create/EditMatchPage a `manualLocation` toggle disables the venue select and lets the user type `location` freely (`venueId` is cleared); otherwise `location` is readonly and auto-filled from the selected venue.

**Finished match display** (`MatchDetailPage`): below the final score it shows the MVP chip and the goal scorers grouped by team A/B (from `playerStats`, `goals > 0`, fetched when `status === 'finished'`).

### Firestore Data Model

See `src/services/firestore.schema.js` for full field-level documentation.

```
users/{uid}
  stats: { goals, assists, matchesPlayed, mvps, wins, draws, losses }   ← accumulator, written
                                                ONLY by the onPlayerStatsWritten CF (delta-based)
  statsByGroup: { [groupId]: { goals, assists, matchesPlayed, mvps, wins, draws, losses } }
  nickname: string|null, description: string, preferredFoot: 'derecho'|'izquierdo'|'ambidiestro'|null
  preferredPositions: string[]               ← up to 3 pitch position codes (src/utils/positions.js)
  fcmToken: string                           ← current device token
  fcmTokens: string[]                        ← all known tokens (deduped)
  role: 'player' | 'admin'                   ← OG is per-group (members.og), not here

matches/{matchId}
  status: 'scheduled' | 'open' | 'closed' | 'finished'   ← 'full' is UI-only (getEffectiveStatus)
  currentPlayers: number                     ← atomic counter, only via transaction
  openAt / notifyAt: Timestamp
  venueId: string|null, venueMapsUrl: string|null   ← denormalized from venues/{venueId}
  mvpUserId / mvpName: string|null           ← MVP of the match (set with the result)
  createdBy: string                          ← creator can self-register anytime
  registrations/{regId}                      ← docId = userId (self/member) OR auto-id (guest)
    userId: string|null, position, isOnWaitlist
    isGuest: bool, guestName: string|null      ← guest = person without an account
    addedBy: string, addedByName: string       ← who registered this entry
  playerStats/{userId}                       ← docId = uid (guests excluded, they have no profile)
    goals, assists, mvp: bool, team: 'A'|'B'|null, groupId   ← a write here triggers the accumulator CF
    result: 'W'|'E'|'L'|null                 ← derived from team + match score in savePlayerStats;
                                               the CF delta-counts it into stats.wins/draws/losses
                                               (self-contained so editing the score stays correct)

groups/{groupId}
  inviteCode: string (8 chars, uppercase, no O/0/I/1)
  nameLower: string  ← for prefix search queries
  members/{userId}   ← role: 'owner' | 'admin' | 'member';  og: bool
                       (early access = og OR role owner/admin)
  joinRequests/{userId}  ← status: 'pending' | 'accepted' | 'rejected'

venues/{venueId}
  name, nameLower, address, mapsUrl: string|null, notes, createdBy

_matchOpenQueue / _matchReminderQueue / _matchOgNotifyQueue   ← internal scheduler queues (never read client-side)
```

**Critical**: Registration (`joinMatch`) uses `runTransaction` to prevent race conditions under concurrent signups. Reads must always come before writes in the transaction. `currentPlayers` is incremented manually inside the transaction (not with `FieldValue.increment()`) because the pre-write value is needed for the position calculation.

### Backend (functions/)

All functions deployed to `southamerica-east1`. Written with Firebase Functions v2.

| Export | Type | Purpose |
|---|---|---|
| `scheduleMatchOpenNotification` | Callable | Enqueues a match to `_matchOpenQueue`, and (if it has a group) the OG early-notify to `_matchOgNotifyQueue`. Callable by a global admin OR the owner/admin of the match's group (`assertCanManageMatchNotifications`) |
| `scheduleMatchReminderNotification` | Callable | Enqueues a reminder to `_matchReminderQueue` (same permission as above) |
| `onPlayerStatsWritten` | Firestore trigger | On any write to `matches/{id}/playerStats/{uid}`, delta-updates the user's `stats`/`statsByGroup` accumulator — idempotent, so clients never write another user's doc and re-saving a result doesn't double-count |
| **`processScheduledTasks`** | **Scheduled (every 1 min) — ÚNICO job** | Despachador de TODO el trabajo periódico (ver abajo) |
| `setAdminClaim` | Callable | Sets Firebase custom claim `admin` (admin-only) |
| `setUserRole` | Callable | Updates both Firestore role field and custom claim |
| `onMatchOpened` | Firestore trigger | Sends FCM broadcast when match status → `open` |
| `onRegistrationDeleted` | Firestore trigger | On registration delete: renumbers positions, recomputes `isOnWaitlist`, notifies promoted substitutes (`sendFCMToUser`); if no substitute filled the gap and the list is open, **broadcasts a free-spot alert to everyone** (`sendFCMToAllUsers`, minus those already registered); otherwise notifies the match creator |
| `recalcAllStats` | Callable (admin-only) | Full rebuild of every user's `stats`/`statsByGroup` from all `playerStats` docs (collectionGroup scan). Needed because the delta accumulator can't recover results saved while `onPlayerStatsWritten` was undeployed. Triggered from the "Recalcular estadísticas" card in `AdminDashboardPage` |

**Schedulers unificados**: Cloud Scheduler regala **3 jobs por proyecto**; el proyecto tenía **5** (los 2 extra se facturaban). Ahora hay **un solo job**, `processScheduledTasks`, que corre cada minuto y despacha las tareas de `SCHEDULED_TASKS` según su `everyMinutes`:

| Tarea (función interna) | Cada | Qué hace |
|---|---|---|
| `runMatchOpenQueue` | 1 min | Abre los partidos cuyo `openAt` ya pasó |
| `runMatchOgNotifyQueue` | 1 min | Push anticipado (30 min antes) a los OG del grupo |
| `runMatchReminderQueue` | 1 min | Recordatorios de que la lista abre pronto |
| `runMatchLowSignupAlert` | 10 min | Avisa si faltan jugadores 6-8hs antes |
| `runAutoCloseMatches` | 60 min | Bloquea resultado/votación a las 36hs de terminado |

El intervalo se respeta con `minuteOfEpoch % everyMinutes`. **Cada tarea corre dentro de su propio `try/catch`**: si una falla, se loguea y las demás siguen — antes cada job fallaba aislado por definición, y sin ese catch un error habría tumbado a todas. Para agregar una tarea periódica nueva, sumá una entrada a `SCHEDULED_TASKS`, **no** un `onSchedule` nuevo.

`sendFCMToAllUsers(title, body, data, excludeUserIds = [])` reads all users' `fcmToken`/`fcmTokens`, sends in batches of 500 via `sendEachForMulticast`, and cleans up invalid tokens automatically. **`excludeUserIds` skips users already registered to the match** — the `match_reminder`, `match_open` (via `onMatchOpened`), and open-queue notifications all pass `getRegisteredUserIds(matchId)` so people already signed up don't get pinged (guests have `userId: null` and are naturally excluded). `sendFCMToUser(userId, ...)` targets a single user.

### PWA / Service Worker (src-pwa/)

`custom-service-worker.js` uses Workbox `injectManifest` mode. Handles:
- Precaching + SPA fallback routing
- `push` event → `showNotification`
- `notificationclick` → opens `/partidos/{matchId}` or `/`

The SW calls `clientsClaim()` unconditionally, but deliberately does **not** call `skipWaiting()` at install time — it only does so on receiving a `{ type: 'SKIP_WAITING' }` `message` event. A new SW sits in the "waiting" state until the user clicks "Actualizar ahora" (`App.vue`, which posts that message and reloads on `controllerchange`). Calling `skipWaiting()` unconditionally was a bug: it made every detected SW change force an immediate, unprompted reload, which showed up as the app "asking to update" on almost every load.

### Firestore Security Rules

- `isAdmin()` checks the Firebase Auth custom claim (not the Firestore role field)
- Group-scoped helpers (each does 1-2 `get()`s): `memberHasEarlyAccess(groupId, uid)` / `hasEarlyAccessInMatchGroup(matchId)` (early registration: OG or owner/admin), `isMatchCreator(matchId)`, `isMemberOfMatchGroup(matchId)` (load results), `isGroupAdmin(groupId)` (owner/admin)
- **Registration create** has 3 branches: (0) match creator registering himself — anytime; (1) `request.time >= openAt` — self/guest/member; (2) early window (`openAt - 30m`) — caller must have early access (or be creator) and the target member must ALSO have early access; guests never allowed early
- Users can update their own profile fields but never `stats`/`statsByGroup`/`role`; those are writable from the client ONLY by a global admin (normally written by the `onPlayerStatsWritten` CF via admin SDK, which bypasses rules)
- **Create a match**: global admin, OR the owner/admin of the group set in `groupId` (`createdBy` must be self). **Load a result** (`scoreA`/`scoreB`/`status`/`mvpUserId`/`mvpName` + `playerStats`): any member of the match's group, or admin
- **Aislamiento entre grupos** (corregido): leer un partido y su lista de inscriptos exige ser **miembro del grupo** del partido (o admin, o partido sin grupo). Antes era `isAuthenticated()` a secas, o sea cualquier usuario logueado veía los partidos y las listas de TODOS los grupos. `allow get` / `allow list` están separados para que un invitado anónimo pueda leer su partido puntual pero nunca enumerar la colección.
- **Invitado anónimo confinado a su partido**: su inscripción usa **`docId = su uid`** (antes era auto-id). Eso permite que las reglas verifiquen, vía `guestHasEntryInMatch(matchId)`, que el `currentPlayers` que mueve es el del partido donde está anotado — antes bastaba con ser anónimo para tocar el contador de cualquier partido. También le impide anotarse dos veces al mismo partido. Los invitados **sin cuenta** (anotados por otro jugador) siguen usando auto-id, porque una persona puede anotar a varios.
  - ⚠️ `guestHasEntryInMatch` sirve **solo en escrituras**, nunca en `read`. Condicionar la LECTURA de `registrations` a "ya tenés una inscripción" genera una **dependencia circular** que rompe el alta: `registerEntry` abre la transacción leyendo su propio doc de inscripción (que todavía no existe) para detectar dobles altas → `PERMISSION_DENIED` en `:batchGet` al apretar "Anotarme". `existsAfter` tampoco lo salva: en la fase de lectura de la transacción no hay estado futuro. Además, una condición que dependa de un doc puntual es incompatible con `list` (Firestore evalúa las queries sin leer documentos), así que el `onSnapshot` de la lista se rechazaba entero. Por eso `registrations` tiene `get` y `list` **separados** y el invitado anónimo puede leer cualquier lista: para llegar necesita el matchId exacto, que es el link que le compartieron, y lo que de verdad lo confina (mover cupos, crear/borrar su inscripción) sigue verificado.
- **`memberCount`**: solo miembros del grupo (o quien se está uniendo en esa misma transacción, verificado con `existsAfter`). La versión anterior usaba `isOwner(request.auth.uid)`, que compara el uid consigo mismo y **siempre da true** — cualquiera podía pisar el contador de cualquier grupo.
- **Cargar un resultado solo puede dejar `status: 'finished'`**. Antes aceptaba cualquiera de los cuatro estados, así que un miembro común podía mandar `'closed'` por esa rama y cerrarle la lista al grupo en pleno horario de inscripción.
- `currentPlayers` on a match can be updated by any authenticated user (required for the transaction pattern)
- `joinRequests` can never be deleted (even by admins); they are soft-deleted via status field
- `venues`: read by any authenticated user; create requires `createdBy == request.auth.uid`; **update by any authenticated user** (the "only OGs can edit" intent is UI-only via `canEditVenue` — OG is per-group and venues are global, so rules can't verify cross-group OG status; venues are low-risk and denormalized into matches); **delete** only by creator or global admin (`canDeleteVenue`)

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

## Tests

`tests/firestore.rules.test.js` — 26 tests de las reglas de seguridad contra el emulador (`npm run test:rules`, necesita Java). Cubren: aislamiento entre grupos (leer partidos y listas), quién puede borrar un partido, la rama de resultado que no debe poder cerrar listas, `memberCount`, el confinamiento del invitado anónimo a su partido, campos de perfil no escribibles (`stats`/`role`) y la auto-promoción a admin/OG de un grupo.

Detalle de implementación: todos los datos de prueba se escriben en el `beforeEach` **global** con `withSecurityRulesDisabled`, y los contextos de auth se cachean en `ctxCache`. Abrir `withSecurityRulesDisabled` dentro de un `describe` anidado, después de que un contexto ya se usó, rompe con `Firestore has already been started`.

Al agregar o cambiar una regla en `firestore.rules`, sumá el test correspondiente acá.

## Known Issues

None currently tracked. (Previously: a duplicate dead-code `exports.onMatchOpened` in `functions/index.js`, a stale `firebase.json` project alias, and leftover debug `console.log`s in `src/boot/firebase.js`/`useGroups.js` — all fixed.)
