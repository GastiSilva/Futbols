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

# Desarrollo LOCAL contra emuladores (no toca producción)
npm run emu         # levanta Firestore+Auth+Functions+Storage, con datos persistentes
npm run emu:clean   # igual pero arrancando de cero (sin importar datos previos)
npm run seed        # carga usuarios/grupos/partidos de prueba (con el emulador ya corriendo)

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

**El número que se muestra NO es `registrations.position`**: el campo `position` se calcula en el alta con el contador `currentPlayers` y solo lo renumera `onRegistrationDeleted`. Si ese trigger no corre (falla, no está desplegado) o alguien borra una inscripción por fuera de `removeRegistration` (la consola de Firebase), el campo queda con huecos —la lista saltaba del 5 al 9— o con números repetidos. Por eso la UI numera por el **índice** de la lista ya ordenada (`orderedRegs` en `MatchDetailPage`, `ordenadasDe()` en `DashboardPage`, el índice del array en `shareList.js`) y recalcula `waitlisted` ahí mismo en vez de confiar en el `isOnWaitlist` guardado. Los tres tienen que numerar igual. Como red de contención, `onRegistrationDeleted` reescribe `currentPlayers = regsSnap.size` cuando detecta desfasaje, así el contador que asigna posiciones vuelve a la verdad en la primera baja.

**MVP per match**: chosen in `PostMatchPage` when loading the result. Stored as `matches/{id}.mvpUserId/mvpName` (via `saveMatchResult`) AND as the boolean `mvp` on each `playerStats` row — `onPlayerStatsWritten` delta-accumulates it into `stats.mvps`/`statsByGroup.{gid}.mvps` (idempotent, changing the MVP moves the count). Shown in `MatchDetailPage` and as a "MVPs" tab in `LeaderboardPage`.

**Partidos públicos + postulaciones (Fase 1)**: el organizador publica manualmente un partido al que le faltan jugadores (`matches.isPublic/publishedAt/spotsWanted`, toggle en `MatchDetailPage` — **no** es un campo de creación) y alguien de afuera del grupo se postula. Piezas:
- **`matches/{id}/applications/{applicantId}`** es una colección **deliberadamente separada** de `registrations`: una postulación NO ocupa cupo ni mueve `currentPlayers`. Eso es lo que permite no tocar en absoluto las reglas de `registrations` — el postulante nunca escribe ahí, ni al ser aceptado.
- **Solo puede postularse quien NO es miembro del grupo** (`!isMemberOfMatchGroup` en las reglas): si ya sos del grupo te anotás derecho en la lista. Sin esa condición habría dos caminos para lo mismo.
- **Al aceptar**, la CF `onApplicationResolved` crea la registration real con la MISMA transacción de cupos que `registerEntry` (leer `currentPlayers` → posición → escribir), y después `withdrawOverlappingApplications` retira las postulaciones pendientes de esa persona a partidos que se **solapen en horario** (±2hs, `OVERLAP_WINDOW_MS`) — solo las solapadas: matarle la del domingo por aceptar la del sábado sería un bug.
- **Sondeo consultivo** (`applications/{id}/votes/{voterId}`): los ya anotados dan pulgar arriba/abajo. **No es vinculante** — decide el organizador, esto solo le da contexto antes de meter a un desconocido.
- `allow get` de `matches` tiene una rama extra para `isPublic == true` (un no-miembro ve el partido), pero **`registrations` NO se abre**: el que se postula ve el partido, no la lista de quiénes van, hasta que lo acepten.
- **Chat 1-a-1** (`applications/{id}/messages`): conversación privada entre el postulante y quien gestiona el partido (`ApplicationChat.vue`, CF `onApplicationMessage`). Es 1-a-1 **a propósito, no un chat grupal del partido**: un chat de 14 personas manda 13 notificaciones irrelevantes por mensaje, y la conversación que hace falta es entre el que toca el timbre y el que abre la puerta. Además hereda el permiso naturalmente (quien ve la postulación ve su chat) y no necesita reglas nuevas complicadas.
- **Publicar vive en `PublicMatchesPage`, NO en `MatchDetailPage`**: la pantalla que trata de partidos abiertos es donde uno espera poder abrir el suyo, y el detalle del partido ya tiene demasiada info (clima, cupos, inscripción, lista, equipos, resultado) como para sumarle una card de gestión que quedaba sepultada. En el detalle solo queda un banner discreto con "Despublicar".
- Cliente: `useApplications.js` (postularse/retirarse/resolver/votar/chatear), `subscribeToPublicMatches` + `setMatchPublic` en `useMatch.js`, `PublicMatchesPage.vue` (ruta `partidos-abiertos`), `PublicMatchCard.vue` y `ApplicationChat.vue`. El filtro "excluir partidos de MIS grupos" es client-side (las reglas no pueden expresarlo).

**Insignias mensuales (vitrina)**: el primero de cada mes se premia al mejor del mes ANTERIOR, **por grupo**, y el premio queda **congelado para siempre** en `users/{uid}/badges`. Es un hecho histórico ("Fulano fue el goleador de agosto"), no un marcador que se recalcula: si se recalculara, mañana desaparecería y dejaría de ser un premio.
- **Sale de `playerStats`, no de `stats`**: `playerStats` ya tenía `savedAt` + `groupId`, así que cada gol sabe de qué mes y de qué grupo es — el sistema funciona **retroactivamente con todo el historial y sin agregar un solo campo**. Los acumuladores `stats`/`statsByGroup` son planos y **sin dimensión temporal**: de ahí es imposible sacar "el mes pasado". Requiere el índice collection-group de `playerStats` por `savedAt`.
- **Idempotencia por construcción**: `badgeId = {period}_{type}_{groupId}`, así un `set` repetido pisa el mismo doc en vez de duplicar el premio. Sumado al centinela `_badgeAwards/{period}`, nadie recibe la insignia ni el push dos veces aunque el scheduler dispare de más (la entrega es *at-least-once*).
- El centinela se escribe **antes** de notificar a propósito: si el envío de pushes falla a la mitad, el reintento de la hora siguiente no vuelve a otorgar ni a avisarle de nuevo a quien ya se enteró. Un premio perdido en el aire es mejor que uno duplicado.
- **`Presente` (`alwaysThere`) es la excepción a todas las reglas de arriba**: no compite (es una CONDICIÓN — jugó todos los partidos del grupo en el mes), la ganan **varios a la vez**, no aplica el empate ni `BADGE_MIN_MATCHES`, y su piso es del **grupo** (`PRESENT_MIN_GROUP_MATCHES` = 3: con uno o dos partidos, "no faltó" no significa constancia). No entra en el palmarés que se manda al grupo — ocho ganadores lo volverían un párrafo — pero sí manda push personal, con texto propio ("medalla de Presente", no "¡Ganaste el Presente!"). El denominador sale de contar `matchId` únicos en el mismo barrido, sin queries extra. Existe para que la vitrina no sea siempre del mismo delantero.
- **Piso de `BADGE_MIN_MATCHES` (2) partidos** en el mes para competir: sin eso, la insignia se la lleva el que apareció una vez, metió 2 goles y no volvió. **Empate = nadie gana**: repartir la misma insignia entre tres la devalúa, y desempatar por orden de aparición sería arbitrario.
- **Privacidad**: `badges` se **lee público** (esa es la gracia — el que se postula desde afuera muestra lo que ganó), pero `describeBadge({ showGroup })` **oculta el nombre del grupo** a quien no comparte grupo con el dueño del perfil. Mismo motivo por el que `ProfileViewPage` ya ocultaba `statsByGroup`: el listado de grupos es el mapa social de esa persona. Sin ese cuidado, la insignia filtraba por la ventana lo que la página cerraba por la puerta.
- **Nadie escribe insignias desde el cliente** — ni el dueño del perfil, ni un admin global: solo la CF por admin SDK. Si el cliente pudiera, cualquiera se autoproclama goleador del mes.
- **`Bombero` (el suplente que entra y salva el partido) NO es implementable hoy**: `registrations.isOnWaitlist` guarda el estado ACTUAL, y `onRegistrationDeleted` lo recalcula al promover — el suplente que entró queda indistinguible de un titular, o sea el dato se pisa en el momento en que ocurre. Haría falta que ese trigger grabe un flag `wasPromoted: true`, y aun así **no sería retroactivo**: empezaría a contar desde el deploy. El arte ya está hecho (`medalla-bombero.png`, flecha hacia arriba — un casco de bombero no se lee a 38px, la silueta es igual a la de una campana).
- Se decidió **no hacer insignias negativas** ("el que más se baja"). La baja no deja rastro (`onRegistrationDeleted` borra el doc), pero el problema de fondo es de diseño: avisar el lunes que no jugás el sábado y borrarte 40 minutos antes son el mismo evento en la base y cosas opuestas en la cancha. Contarlos igual empuja a la gente a **no anotarse temprano** para no manchar el perfil — justo lo contrario de lo que la app busca.
- **Arte de los premios**: `public/badges/*.png` (128px, transparencia). El goleador y el asistidor comparten el mismo botín — el asistidor virado a **rojo plateado**, porque hace lo mismo que el goleador pero para otro. **Rendimiento = trofeo; compromiso = medalla**: `Presente` es una medalla con cinta verde, no otra copa, para que se distinga de un vistazo (si todo fuera trofeo, la vitrina sería una repisa donde ninguno resalta). `medalla-bombero.png` ya está dibujada pero **sin usar** — ver abajo. Los originales que trajo el usuario venían a 512px y 1280px (461 KB entre los dos); recortados al contenido y escalados a 128px pesan 42 KB, y a los 38px que ocupan en la fila se ven idénticos. Un ícono monocromo de Material se lee como ítem de menú; un trofeo dibujado se lee como premio.
- Piezas: `runMonthlyBadges` + `BADGE_DEFS` (functions/index.js), `src/utils/badges.js` (catálogo visual: `art` = ruta del PNG, `color` = acento del disco — ⚠️ sus claves **tienen que coincidir** con las del backend), `useBadges.js` (solo lectura), `BadgeShelf.vue`, montado en `ProfilePage` y `ProfileViewPage`.

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

users/{uid}/badges/{badgeId}   ← docId = `{period}_{type}_{groupId}` (idempotente por construcción)
  type: 'topScorer'|'topAssists'|'topMvp', groupId, groupName, period: '2026-08', value, wonAt
  ← SOLO lo escribe runMonthlyBadges (admin SDK). Las reglas niegan toda escritura del cliente.

_badgeAwards/{period}          ← centinela: si existe, ese mes ya se premió (nunca se lee client-side)

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
| `runMonthlyBadges` | día 1 (03:00+ UTC) | Otorga las insignias del mes cerrado y notifica |

Una tarea se agenda de dos formas excluyentes (`taskIsDue`): `everyMinutes` (ritmo fijo, se respeta con `minuteOfEpoch % everyMinutes`) o `monthly: { day, hour }` (condición de **almanaque**, para lo que un intervalo no puede expresar — un mes no dura una cantidad fija de minutos). Las mensuales se evalúan al minuto 0 de cada hora a partir de `hour` del día indicado; la garantía de UNA sola ejecución no la da el reloj sino el **centinela** de la propia tarea. **Cada tarea corre dentro de su propio `try/catch`**: si una falla, se loguea y las demás siguen — antes cada job fallaba aislado por definición, y sin ese catch un error habría tumbado a todas. Para agregar una tarea periódica nueva, sumá una entrada a `SCHEDULED_TASKS`, **no** un `onSchedule` nuevo.

**Preferencias de notificación (`users/{uid}.notificationPrefs`)**: cada push pertenece a UNA categoría — `myGroups`, `applications`, `chat`, `publicNearby`, `badges`. El usuario las prende/apaga desde `ProfilePage` (toggles que se guardan solos, vía `useAuth.updateNotificationPref`). El filtro se aplica en **`collectTokensFromUserDocs(userDocs, category)`**, que es el único punto por el que pasan los cuatro helpers de envío — así ninguna ruta se lo saltea por olvido. Defaults: todo `true` salvo `publicNearby`, que nace **apagada** (es la única que avisa sobre partidos de gente que el usuario no conoce, así que es opt-in explícito). ⚠️ Las listas `NOTIFICATION_CATEGORIES`/`NOTIFICATION_DEFAULTS` están duplicadas en `functions/index.js` y `src/utils/notifications.js` y **tienen que coincidir**: si divergen, el usuario apaga un interruptor que el backend no consulta. ⚠️ Los `.select()` de los helpers incluyen `notificationPrefs` — sin ese campo el filtro compila pero no filtra nada.

`sendFCMToAllUsers(title, body, data, excludeUserIds = [], category)` reads all users' `fcmToken`/`fcmTokens`, sends in batches of 500 via `sendEachForMulticast`, and cleans up invalid tokens automatically. **`excludeUserIds` skips users already registered to the match** — the `match_reminder`, `match_open` (via `onMatchOpened`), and open-queue notifications all pass `getRegisteredUserIds(matchId)` so people already signed up don't get pinged (guests have `userId: null` and are naturally excluded). `sendFCMToUser(userId, ...)` targets a single user.

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
  - ⚠️ **El `allow list` de `matches` NO puede filtrar por grupo — es un límite de Firestore, no un olvido.** `request.query` expone únicamente `limit`, `offset` y `orderBy`: las cláusulas `where` **no** son inspeccionables desde las reglas, y como el motor evalúa las queries sin leer documentos, tampoco hay `resource` que consultar. La membresía vive en `groups/{gid}/members/{uid}`, así que "solo los partidos de mis grupos" es **inexpresable** en un `allow list`. Lo que sí se exige es un `limit <= 200` (constante `MATCH_QUERY_LIMIT` en `useMatch.js`): **toda query nueva a `matches` tiene que llevar `limit` explícito o Firestore la rechaza**. El aislamiento real lo dan `allow get` (que sí lee el doc y verifica membresía) y que la query del cliente pida solo lo suyo: `subscribeToUpcoming` ahora abre **una suscripción por fuente** (los globales con `groupId == null`, más una por cada tanda de ≤30 grupos del usuario, porque `in` topea en 30) en vez de traer la colección entera y filtrarla en JavaScript — antes el dispositivo se descargaba los partidos de todos los grupos y solo dibujaba los propios, o sea el filtro era cosmético y el dato ya había cruzado.
- **Calificar la descripción** (`users/{uid}/descriptionRatings`): solo entre quienes **comparten un grupo**. El voto lleva `sharedGroupId` y la regla verifica que calificador y calificado sean ambos miembros de ese grupo (helper `sharesGroupWith`) — mentir no sirve. Antes alcanzaba con estar autenticado; con perfiles visibles para desconocidos eso pasaba a ser un vector de sabotaje contra quien se postula desde afuera. `ProfileViewPage` resuelve el grupo compartido con `useProfile.findSharedGroupId` y, si no hay ninguno, muestra el perfil en **modo público**: lo deportivo (apodo, foto, descripción, posiciones, pie, equipo, stats globales) sin el bloque de calificación ni el desglose `statsByGroup`, que expondría el mapa social de esa persona.
- **`reports`** (denuncias de usuarios): crea cualquiera con cuenta, solo en su nombre (`reporterId == uid`) y nunca a sí mismo; se crea siempre en `status: 'pending'`. **Lee solo un admin global** — ni el denunciante ni el denunciado. **Nunca se borran** (ni un admin): se resuelven cambiando `status`. No hay panel: se revisan a mano desde la consola de Firebase. UI: `ReportUserDialog.vue`, enganchado en `ProfileViewPage`.
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
VITE_USE_EMULATORS=true      ← OPCIONAL: conecta la app a los emuladores locales
```

## Desarrollo local contra emuladores

Sin esto, `quasar dev` escribe en la base de **producción real** — con partidos públicos eso significa que un partido de prueba aparece en "Partidos abiertos" de todos los usuarios y las notificaciones push salen de verdad.

Para trabajar aislado, en **tres terminales**:

```bash
npm run emu    # 1. emuladores (Firestore, Auth, Functions, Storage) + panel en :4000
npm run seed   # 2. datos de prueba (4 usuarios, 2 grupos, 1 partido publicado)
npm run dev    # 3. la app — requiere VITE_USE_EMULATORS=true en .env.local
```

Usuarios que crea el seed (contraseña `test1234` para todos): `gaston@test.com` (organizador), `enzo@test.com` (el de afuera que se postula), `marcos@test.com` y `lucia@test.com` (anotados, votan el sondeo). **Probar con varias cuentas a la vez**: una ventana normal + una de incógnito + perfiles de Chrome distintos (dos ventanas de incógnito comparten sesión entre sí).

⚠️ **Si el seed falla con `ECONNREFUSED 127.0.0.1:9099` aunque el emulador esté corriendo**: falta `GCLOUD_PROJECT`. El SDK de Admin la necesita para hablar con el emulador de **Auth** (Firestore anda sin ella), y sin esa variable el error que tira parece de red — como si el emulador no estuviera levantado. Ya está seteada dentro de `scripts/seed-emulator.mjs`; no hace falta ningún `serviceAccount.json`.

Detalles: el flag `VITE_USE_EMULATORS` es **opt-in explícito**, nunca se activa solo por estar en modo dev — así `quasar dev` sin el emulador prendido no falla misteriosamente. `initMessaging()` devuelve `null` con emuladores (FCM no está emulado, pedir token da error). `npm run emu` importa/exporta a `.emulator-data/` (gitignoreado), así los datos sobreviven entre corridas; `npm run emu:clean` arranca vacío. El seed **aborta** si las variables de entorno no apuntan a localhost.

## Tests

`tests/firestore.rules.test.js` — 111 tests de las reglas de seguridad contra el emulador (`npm run test:rules`, necesita Java). Cubren: aislamiento entre grupos (leer partidos y listas), el `limit` obligatorio al listar `matches`, quién puede borrar un partido, la rama de resultado que no debe poder cerrar listas, `memberCount`, el confinamiento del invitado anónimo a su partido, campos de perfil no escribibles (`stats`/`role`), `notificationPrefs`, calificar la descripción solo entre compañeros de grupo, los `reports`, los partidos públicos y sus postulaciones (quién publica, quién se postula, quién resuelve, el sondeo), las insignias (lectura pública, escritura negada a todos incluido el admin) la auto-promoción a admin/OG de un grupo, la votación de Muralla (voto propio, no al suplente, independiente de la de MVP, cerrada = no se vota más), el feed de `events` (lectura solo del propio grupo, `limit` obligatorio, escritura negada a todos incluido el admin) y el historial cara a cara `chemistry`/`rivalry` (lectura abierta, escritura solo del backend).

Detalle de implementación: todos los datos de prueba se escriben en el `beforeEach` **global** con `withSecurityRulesDisabled`, y los contextos de auth se cachean en `ctxCache`. Abrir `withSecurityRulesDisabled` dentro de un `describe` anidado, después de que un contexto ya se usó, rompe con `Firestore has already been started`.

Al agregar o cambiar una regla en `firestore.rules`, sumá el test correspondiente acá.

## Known Issues

None currently tracked. (Previously: a duplicate dead-code `exports.onMatchOpened` in `functions/index.js`, a stale `firebase.json` project alias, and leftover debug `console.log`s in `src/boot/firebase.js`/`useGroups.js` — all fixed.)
