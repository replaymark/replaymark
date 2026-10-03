# Source brief (verbatim from the user, authoritative)

> Project name: **replaymark** (the brief below says "twitch-notify"; use `replaymark`
> for the repo, package names, container name and UI title instead).
> Additional user requirement: **the whole admin UI must be available in English and German**
> (language switch, default from browser language, persisted choice). Mails stay German
> unless the design decides otherwise.

---

# Auftrag: Twitch Game Notify (EventSub-Webhook → E-Mail, mit Admin-UI)

## Ziel

Ein selbst gehosteter Dienst, der mir eine E-Mail schickt, sobald einer von mir ausgewählten Twitch-Streamer **live ist und ein von mir ausgewähltes Spiel spielt**. Das gilt beim Live-Gehen genauso wie bei einem Spielwechsel mitten im Stream.

Der Dienst nutzt **Twitch EventSub mit Webhook-Transport** und richtet alles selbst ein: Token, Abos und Abgleich. Streamer, Spiele und Empfänger verwalte ich über ein **Web-Admin-UI**. Secrets und Infrastruktur kommen aus Umgebungsvariablen.

---

## Arbeitsweise für dich (Coding Agent)

- Baue das Projekt **vollständig** nach dieser Spec: Code, Tests, Docker-Setup und README.
- **Prüfe vor dem Pinnen die aktuellen Versionen** aller Pakete (`pnpm view <paket> version`) und pinne exakte Versionen. Die Versionen unten sind Mindestangaben (Stand Sept. 2026).
- Füge **keine weiteren Abhängigkeiten** hinzu, ohne sie im README kurz zu begründen. Leichtgewichtig und sauber hat Vorrang.
- **Nicht verwenden:** Next.js, TanStack Start, React Router Framework Mode, Express, tRPC, Redis/BullMQ, Better Auth, ESLint/Prettier.
- Arbeite in dieser Reihenfolge und halte nach jedem Schritt `pnpm typecheck`, `pnpm lint` und `pnpm test` grün:
  1. Monorepo-Gerüst, Tooling, DB-Schema + Migrationen
  2. Twitch-Client (Token, Helix, Ratelimits) + Webhook-Endpunkt mit Signaturprüfung
  3. Reconcile + Benachrichtigungslogik + Mail-Outbox
  4. Admin-API + Auth + SSE
  5. Frontend
  6. CLI, Docker, README
- Wenn diese Spec an einer Stelle unklar ist oder sich widerspricht, triff die naheliegendste Entscheidung und dokumentiere sie im README unter „Designentscheidungen“.

---

## Tech-Stack (verbindlich)

| Bereich | Wahl |
|---|---|
| Sprache | **TypeScript** (strict), durchgängig in Backend und Frontend |
| Laufzeit | **Node.js 24 LTS**. TypeScript wird per nativem Type-Stripping direkt ausgeführt (`node src/index.ts`), kein Build-Schritt fürs Backend |
| Paketmanager | **pnpm** mit Workspaces |
| Backend-Framework | **Hono** (≥ 4.13) + `@hono/node-server` |
| API-Typen | **Hono RPC** (`hc<AppType>`), keine Codegenerierung |
| Validierung | **Zod 4** (Server-Input, Env-Config, Formulare) |
| Datenbank | **SQLite** via **Drizzle ORM** + **better-sqlite3**, Migrationen mit `drizzle-kit` |
| E-Mail | **Nodemailer** |
| Frontend | **Vite 8** + **React 19** als SPA, **TanStack Router** (dateibasiert, typsicher), **TanStack Query**, **TanStack Form** |
| UI | **Tailwind CSS 4** + **shadcn/ui** (Base-UI-Variante), Icons: `lucide-react` |
| Live-Updates | **Server-Sent Events** (Hono `streamSSE`) |
| Lint/Format | **Biome** |
| Typecheck | `tsc --noEmit` (TypeScript 7) |
| Tests | **Vitest**; HTTP-Mocks für Twitch über injizierbares `fetch` oder `msw` |

### Wichtige Details zum Type-Stripping

- In `tsconfig`: `"erasableSyntaxOnly": true`, `"verbatimModuleSyntax": true`, `"allowImportingTsExtensions": true`, `"module": "nodenext"`. Keine `enum`s, keine Parameter-Properties, keine Namespaces.
- Relative Imports im Backend **mit `.ts`-Endung**.
- Node strippt **keine Typen in Dateien unter `node_modules`**. Das Backend darf daher zur Laufzeit **keinen TypeScript-Code aus anderen Workspace-Paketen importieren**. Gemeinsame Zod-Schemas und Typen liegen deshalb in `apps/server/src/shared/`. Das Frontend bindet sie über einen Vite-/TS-Pfadalias ein (`@shared/*`) und importiert `AppType` nur als `import type`.

---

## Projektstruktur

```
twitch-notify/
├─ apps/
│  ├─ server/
│  │  ├─ src/
│  │  │  ├─ index.ts              # startet Listener, Scheduler, Worker; Graceful Shutdown
│  │  │  ├─ env.ts                # Env-Variablen, Zod-validiert
│  │  │  ├─ cli.ts                # CLI-Einstiegspunkt
│  │  │  ├─ shared/               # Zod-Schemas + Typen, auch vom Frontend genutzt
│  │  │  ├─ http/
│  │  │  │  ├─ public.ts          # nur POST /webhook
│  │  │  │  ├─ admin.ts           # /api/* (exportiert AppType), SPA-Auslieferung
│  │  │  │  ├─ internal.ts        # /healthz, /internal/* (nur 127.0.0.1)
│  │  │  │  ├─ sse.ts             # GET /api/events
│  │  │  │  └─ auth.ts            # Login, Sessions, Middleware
│  │  │  ├─ twitch/
│  │  │  │  ├─ token.ts           # Client-Credentials + Refresh
│  │  │  │  ├─ helix.ts           # Helix-Client mit Retry/Ratelimit
│  │  │  │  ├─ signature.ts       # HMAC-Prüfung
│  │  │  │  ├─ eventsub.ts        # Event-Verarbeitung
│  │  │  │  └─ reconcile.ts       # Abo-Abgleich
│  │  │  ├─ notify/               # Benachrichtigungslogik (Matching, Dedup)
│  │  │  ├─ mail/                 # Mailer + Templates (Text + HTML)
│  │  │  ├─ jobs/                 # Scheduler, Inbox-Worker, Mail-Outbox-Worker
│  │  │  ├─ events/bus.ts         # interner Event-Bus → SSE
│  │  │  └─ db/                   # schema.ts, client.ts
│  │  ├─ drizzle/                 # generierte Migrationen
│  │  └─ test/
│  └─ web/
│     ├─ src/
│     │  ├─ routes/               # TanStack-Router-Dateirouten
│     │  ├─ components/ui/        # shadcn/ui
│     │  ├─ lib/api.ts            # hc<AppType>-Client
│     │  └─ lib/sse.ts            # EventSource → Query-Cache
│     └─ vite.config.ts
├─ Dockerfile
├─ compose.yaml
├─ .env.example
├─ pnpm-workspace.yaml
├─ biome.json
├─ tsconfig.base.json
└─ README.md
```

Root-Skripte: `dev` (Server mit `node --watch` + Vite-Dev-Server mit Proxy auf `/api`), `build` (Frontend), `typecheck`, `lint`, `format`, `test`, `db:generate`.

---

## Netzwerk: drei Listener in einem Prozess

| Port | Bindung | Inhalt | Erreichbarkeit |
|---|---|---|---|
| `8080` | `0.0.0.0` | **nur** `POST /webhook`, alles andere `404` | öffentlich über den Reverse Proxy |
| `8081` | `0.0.0.0` | Admin-UI (statische SPA) + `/api/*` + SSE | **nur LAN/VPN**, nie öffentlich routen |
| `8082` | `127.0.0.1` | `GET /healthz`, `/internal/*` für die CLI | nur innerhalb des Containers |

- Der Container spricht nur HTTP. HTTPS übernimmt der vorhandene Reverse Proxy, z. B. `https://twitch.example.com/webhook` → `http://container:8080/webhook`.
- Die SPA wird mit Fallback auf `index.html` ausgeliefert (Client-Routing). Statische Assets mit langem Cache, `index.html` mit `no-cache`.

---

## Konfiguration

### Umgebungsvariablen (Zod-validiert beim Start, bei Fehlern klare Meldung und Abbruch)

```
TWITCH_CLIENT_ID=
TWITCH_CLIENT_SECRET=
TWITCH_WEBHOOK_SECRET=          # 10–100 Zeichen, zufällig
TWITCH_CALLBACK_URL=https://twitch.example.com/webhook

SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURITY=starttls          # starttls | ssl | none
SMTP_USERNAME=
SMTP_PASSWORD=
SMTP_FROM="Twitch Notify <notify@example.com>"

ADMIN_PASSWORD_HASH=            # erzeugt mit: node src/cli.ts hash-password
ADMIN_COOKIE_SECURE=true        # false, wenn das Admin-UI per http im LAN aufgerufen wird
PUBLIC_BASE_URL=                # optional, z. B. für Links in Mails aufs Admin-UI

DATA_DIR=/data
TZ=Europe/Berlin
LOG_LEVEL=info
```

- SMTP-Security-Mapping in Nodemailer: `starttls` → `secure: false, requireTLS: true`; `ssl` → `secure: true`; `none` → `secure: false, ignoreTLS: true`.
- `.env.example` mit allen Variablen und Kommentaren mitliefern.

### Einstellungen in der Datenbank (über das Admin-UI änderbar)

- **Streamer** (Login-Name, aufgelöst zu User-ID, Anzeigename, Avatar) mit Spieleauswahl in einem von drei Modi:
  - `default`: nutzt die Standardspiele
  - `custom`: eigene Spieleliste
  - `any`: jedes Spiel und jede Kategorie (entspricht `*`)
- Pro Streamer ein Schalter **aktiv/pausiert**. Pausierte Streamer behalten ihre Einstellungen, bekommen aber keine Abos.
- **Standardspiele** (Liste von Kategorien)
- **E-Mail-Empfänger** (Liste von Adressen, mindestens eine)
- **Abgleichintervall** in Stunden (Standard: 6)

Spiele werden als Twitch-Kategorien mit `category_id`, Name und Box-Art-URL gespeichert, niemals nur als freier Text.

Jede Änderung an Streamern oder Spielen stößt einen **Abgleich** an. Mehrere Änderungen kurz hintereinander werden zusammengefasst (Debounce ca. 2 Sekunden).

---

## Datenmodell (SQLite)

Beim Öffnen setzen: `journal_mode=WAL`, `busy_timeout=5000`, `synchronous=NORMAL`, `foreign_keys=ON`. Migrationen laufen automatisch beim Start. Nur der Server-Prozess öffnet die DB. Die CLI spricht per HTTP mit dem laufenden Server.

Mindestens diese Tabellen (Namen und Spalten nach Bedarf verfeinern):

- `streamers`: `user_id` (PK), `login`, `display_name`, `avatar_url`, `game_mode` (`default|custom|any`), `enabled`, `created_at`
- `categories`: `category_id` (PK), `name`, `box_art_url`
- `streamer_games`: (`user_id`, `category_id`)
- `default_games`: `category_id`
- `settings`: Schlüssel/Wert (Empfänger, Intervall)
- `subscriptions`: `twitch_sub_id` (PK), `type`, `version`, `broadcaster_id`, `status`, `created_at`, `updated_at` (Spiegel des letzten Abgleichs)
- `live_state`: `broadcaster_id` (PK), `stream_id` (nullable), `category_id`, `category_name`, `title`, `started_at`, `updated_at`
- `eventsub_inbox`: `message_id` (PK), `type`, `payload`, `received_at`, `processed_at`, `error` (dient zugleich als Dedup der Message-IDs)
- `sent_notifications`: `stream_id`, `category_id`, `broadcaster_id`, `sent_at`, **UNIQUE(`stream_id`, `category_id`)**
- `mail_outbox`: `id`, `stream_id`, `category_id`, `payload` (Betreff/Text/HTML/Empfänger), `attempts`, `next_attempt_at`, `last_error`, `status` (`pending|sent|failed`), `created_at`
- `sessions`: `id` (zufällig, 32 Bytes), `created_at`, `expires_at`, `last_seen_at`
- `app_meta`: z. B. Zeitpunkt und Ergebnis des letzten Abgleichs

Aufräumen (täglich): Inbox-Einträge älter als 24 h, `sent_notifications` älter als 7 Tage, abgelaufene Sessions, versendete Outbox-Einträge älter als 30 Tage.

---

## Twitch-Anbindung

### Authentifizierung

- App-Access-Token per Client-Credentials-Flow: `POST https://id.twitch.tv/oauth2/token` mit `grant_type=client_credentials`.
- Token im Speicher halten und vor Ablauf (`expires_in`, mit Puffer) erneuern. Bei `401` einmal neu holen und die Anfrage wiederholen.
- Alle Helix-Anfragen senden `Client-Id` und `Authorization: Bearer <token>`.

### Helix-Client (zentral, alle Aufrufe laufen hierüber)

- Bei `429` bis zum Zeitpunkt aus dem Header `Ratelimit-Reset` (Unix-Sekunden) warten und wiederholen.
- Bei `5xx` und Netzwerkfehlern exponentieller Backoff mit Jitter (max. 5 Versuche).
- `fetch` ist injizierbar, damit Tests die Twitch-API mocken können.

### Genutzte Endpunkte

- `GET /helix/users?login=...`: Login → User-ID, Anzeigename, `profile_image_url` (bis 100 pro Anfrage)
- `GET /helix/search/categories?query=...`: Spielsuche für die Autovervollständigung im UI
- `GET /helix/games?id=...`: Kategorie-Details nachladen
- `GET /helix/streams?user_id=...`: Live-Status (bis 100 IDs pro Anfrage)
- `GET /helix/channels?broadcaster_id=...`: aktuelle Kategorie + Titel
- `GET|POST|DELETE /helix/eventsub/subscriptions`

Box-Art-URLs enthalten Platzhalter `{width}x{height}`. Im Frontend passend ersetzen.

### Abos (EventSub)

Pro aktivem Streamer drei Abos, alle mit `condition: { broadcaster_user_id }` und `transport: { method: "webhook", callback, secret }`:

| Typ | Version | Zweck |
|---|---|---|
| `stream.online` | 1 | Streamer geht live |
| `stream.offline` | 1 | Streamer geht offline |
| `channel.update` | 2 | Kategorie oder Titel geändert |

### Abgleich (Reconcile)

Läuft beim Start, nach Änderungen im UI (Debounce), im konfigurierten Intervall, nach einer `revocation` und auf Knopfdruck (UI und CLI). Es läuft nie mehr als ein Abgleich gleichzeitig; weitere Anstöße während eines Laufs führen zu genau einem weiteren Lauf danach.

1. Alle bestehenden Abos laden: `GET /helix/eventsub/subscriptions`, **paginiert** über `after`. Nur Abos mit unserer Callback-URL berücksichtigen.
2. Soll-Menge = {(Typ, broadcaster_user_id)} für alle **aktiven** Streamer.
3. Abos löschen, die nicht gewollt sind **oder** einen Fehlerstatus haben (alles außer `enabled` und `webhook_callback_verification_pending`). Dazu gehören auch Duplikate: pro Soll-Eintrag bleibt höchstens ein Abo.
4. Fehlende Abos anlegen.
5. Tabelle `subscriptions` aktualisieren, Ergebnis loggen („12 aktiv, 3 angelegt, 1 gelöscht“), in `app_meta` speichern und per SSE melden.
6. Danach den Live-Status aller aktiven Streamer abgleichen (siehe Benachrichtigungslogik).

Schlägt das Anlegen einzelner Abos fehl, laufen die übrigen weiter. Der Fehler wird geloggt und im UI angezeigt.

### Webhook-Endpunkt `POST /webhook` (Port 8080)

Relevante Header: `Twitch-Eventsub-Message-Id`, `-Message-Timestamp`, `-Message-Signature`, `-Message-Type`, `-Subscription-Type`.

Reihenfolge strikt einhalten:

1. **Roh-Body lesen** (`c.req.arrayBuffer()`), noch **nicht** parsen.
2. **Signatur prüfen:** `HMAC-SHA256(webhook_secret, message_id + timestamp + raw_body)` und mit dem Header-Wert `sha256=<hex>` vergleichen. Vergleich mit `crypto.timingSafeEqual`, vorher Längen prüfen. Fehlende Header oder falsche Signatur → `403`.
3. **Zeitstempel prüfen:** älter als 10 Minuten (oder mehr als 10 Minuten in der Zukunft) → verwerfen mit `403`.
4. **Dedup:** Die Message-ID in `eventsub_inbox` eintragen (`INSERT … ON CONFLICT DO NOTHING`). War sie schon da → sofort `204`, keine erneute Verarbeitung.
5. Erst jetzt JSON parsen und nach `Message-Type` verzweigen:
   - `webhook_callback_verification`: `200`, `Content-Type: text/plain`, Body exakt der Wert von `challenge`.
   - `notification`: Das Event ist durch Schritt 4 bereits **persistent gespeichert**. Sofort `204` antworten, den Inbox-Worker anstoßen.
   - `revocation`: Grund (`subscription.status`) loggen, Abo-Status in der DB aktualisieren, Abgleich anstoßen, `204`.

Wichtig: Kein „fire and forget“ ohne Persistenz. Wenn der Container zwischen Antwort und Verarbeitung neu startet, verarbeitet der Inbox-Worker beim Start alle Einträge ohne `processed_at`.

---

## Benachrichtigungslogik

### Inbox-Worker

- Verarbeitet Inbox-Einträge der Reihe nach (nach `received_at`), markiert sie mit `processed_at` bzw. `error`.
- Ein Fehler bei einem Event wird geloggt und darf weder den Worker noch den Dienst beenden.

### Events

- **`stream.online`:** In `live_state` `stream_id` = `event.id` und `started_at` setzen. Aktuelle Kategorie und Titel über `GET /helix/channels?broadcaster_id=...` holen (liefert `game_id`/`game_name`/`title` zuverlässig). Dann prüfen.
- **`channel.update`:** Kategorie aus `event.category_id`/`category_name` und Titel aus `event.title` übernehmen. **Nur prüfen, wenn der Streamer live ist** (`stream_id` gesetzt). Das Event kommt auch offline.
- **`stream.offline`:** `stream_id` leeren.
- Jede Änderung am Live-Status wird per SSE ans UI gemeldet.

### Live-Status-Abgleich

Beim Start und nach jedem Abgleich den Live-Status aller aktiven Streamer über `GET /helix/streams?user_id=...` (bis 100 IDs pro Anfrage) initialisieren bzw. korrigieren. Wer dabei live ein passendes Spiel spielt, wird ebenfalls geprüft (die Dedup-Regel verhindert Doppelmails).

### Prüfen

- Gilt nur für **aktive** Streamer.
- Die Kategorie passt, wenn:
  - Modus `any`, oder
  - Modus `custom` und die `category_id` steht in der Liste des Streamers, oder
  - Modus `default` und die `category_id` steht in den Standardspielen.
- Passt sie: In **einer Transaktion** `sent_notifications` (`stream_id`, `category_id`) eintragen **und** einen `mail_outbox`-Eintrag anlegen. Schlägt der Insert wegen der Unique-Constraint fehl, wurde schon benachrichtigt → nichts tun.
- Folge: Wechselt ein Streamer innerhalb desselben Streams weg und wieder zurück, kommt keine zweite Mail.

### Mail-Outbox-Worker

- Versendet fällige Einträge (`status = pending`, `next_attempt_at <= jetzt`).
- Bei Fehler: `attempts` erhöhen, `last_error` speichern, `next_attempt_at` mit exponentiellem Backoff setzen (z. B. 1 min, 5 min, 30 min). Nach 3 Fehlversuchen `status = failed`. Im UI ist ein manueller „Erneut senden“-Button vorhanden.
- Überlebt Neustarts, da alles in SQLite liegt.

### E-Mail

- Betreff: `🔴 {Anzeigename} spielt jetzt {Spiel}`
- Text + HTML (schlichtes, dunkel/hell-taugliches Layout, Box-Art optional als Bild-URL): Anzeigename, Spiel, Stream-Titel, Link `https://twitch.tv/{login}`, Uhrzeit (Zeitzone aus `TZ`, Format `dd.MM.yyyy HH:mm`).
- Titel bei `stream.online` aus `/helix/channels`, bei `channel.update` aus dem Event.
- Empfänger aus den Einstellungen in der DB.

---

## Admin-API (Port 8081, alle Routen außer Login erfordern eine Session)

Alle Eingaben werden mit Zod validiert. Alle Routen sind in einem Hono-Router definiert, dessen Typ als `AppType` exportiert wird.

| Methode | Pfad | Zweck |
|---|---|---|
| `POST` | `/api/auth/login` | Passwort prüfen, Session-Cookie setzen |
| `POST` | `/api/auth/logout` | Session löschen |
| `GET` | `/api/auth/me` | Session gültig? |
| `GET` | `/api/overview` | Zusammenfassung: Streamer, Live-Status, Abo-Zählung, letzter Abgleich, fehlgeschlagene Mails |
| `GET` | `/api/streamers` | Liste inkl. Live-Status, aktuellem Spiel, Abo-Status pro Typ |
| `POST` | `/api/streamers` | Streamer per Login hinzufügen (löst über Helix auf; unbekannter Login → `404` mit klarer Meldung) |
| `PATCH` | `/api/streamers/:id` | Modus, Spieleliste, aktiv/pausiert ändern |
| `DELETE` | `/api/streamers/:id` | Streamer entfernen |
| `GET` | `/api/categories/search?q=` | Spielsuche über `/helix/search/categories` (Ergebnisse kurz cachen, Mindestlänge 2 Zeichen) |
| `GET`/`PUT` | `/api/settings` | Standardspiele, Empfänger, Intervall |
| `GET` | `/api/subscriptions` | Abo-Liste aus der DB |
| `POST` | `/api/sync` | Abgleich anstoßen |
| `GET` | `/api/notifications` | Verlauf (gesendete + fehlgeschlagene Mails, paginiert) |
| `POST` | `/api/notifications/:id/retry` | Fehlgeschlagene Mail erneut einplanen |
| `POST` | `/api/test-mail` | Testmail an alle Empfänger |
| `GET` | `/api/events` | SSE-Stream |

### SSE (`/api/events`)

- Ereignisse: `live-state` (Streamer live/offline/Spielwechsel), `subscriptions` (nach Abgleich), `notification` (Mail versendet/fehlgeschlagen), `sync` (Start/Ende).
- Alle 20 Sekunden ein Heartbeat-Kommentar. Header: `Cache-Control: no-cache`, `X-Accel-Buffering: no`.
- Das Frontend aktualisiert bei Ereignissen gezielt den TanStack-Query-Cache (`invalidateQueries` bzw. `setQueryData`) und verbindet sich bei Abbruch automatisch neu.

### Auth

- Ein einziger Admin. Passwort-Hash (scrypt aus `node:crypto`, Format mit Salt und Parametern) in `ADMIN_PASSWORD_HASH`. Fehlt die Variable, startet das Admin-UI nicht und loggt einen klaren Hinweis (Webhook läuft trotzdem).
- Session-Cookie: `HttpOnly`, `SameSite=Strict`, `Path=/`, `Secure` gemäß `ADMIN_COOKIE_SECURE`, Laufzeit 30 Tage (gleitend).
- Login-Rate-Limit: max. 5 Fehlversuche pro 15 Minuten pro IP, danach `429`.
- Bei allen mutierenden Requests (`POST`/`PUT`/`PATCH`/`DELETE`) den `Origin`-Header gegen den `Host` prüfen (CSRF-Schutz zusätzlich zu SameSite).
- Security-Header für die SPA: `Content-Security-Policy` (nur `self`, Bilder zusätzlich von `static-cdn.jtvnw.net`), `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`.

---

## Frontend (Admin-UI)

Deutsch, schlicht, aufgeräumt, responsiv (auch am Handy bedienbar), Hell- und Dunkelmodus (System-Einstellung, umschaltbar).
(User addition: UI fully bilingual English + German.)

### Seiten

1. **Login:** Passwortfeld, Fehlermeldung, sonst nichts.
2. **Übersicht** (Startseite):
   - Kacheln: Streamer gesamt / live, aktive Abos, letzter Abgleich (mit Ergebnis), fehlgeschlagene Mails.
   - Streamer-Liste als Karten oder Tabelle: Avatar, Anzeigename, Live-Badge (rot, pulsierend), aktuelles Spiel mit Box-Art, Titel, „passt“-Markierung, Abo-Status-Indikator (grün = alle drei `enabled`, gelb = pending, rot = Fehler/fehlt).
   - Live-Änderungen erscheinen ohne Neuladen (SSE).
3. **Streamer hinzufügen / bearbeiten** (Dialog oder eigene Seite):
   - Login-Name eingeben → Vorschau mit Avatar und Anzeigename vor dem Speichern.
   - Spiele-Modus: „Standardspiele“ / „Eigene Auswahl“ / „Jedes Spiel“.
   - Bei „Eigene Auswahl“: Combobox mit Live-Suche (debounced), Treffer mit Box-Art, gewählte Spiele als entfernbare Chips.
   - Schalter aktiv/pausiert, Löschen mit Bestätigung.
4. **Abos:** Tabelle (Streamer, Typ, Status, erstellt), Button „Jetzt abgleichen“ mit Ladezustand, Ergebnis des letzten Abgleichs.
5. **Verlauf:** Liste der Benachrichtigungen (Zeit, Streamer, Spiel, Status, Fehlermeldung), Filter nach Status, „Erneut senden“ bei fehlgeschlagenen.
6. **Einstellungen:** Standardspiele (gleiche Combobox), Empfänger (Liste mit Hinzufügen/Entfernen, E-Mail-Validierung), Abgleichintervall, Button „Testmail senden“. Anzeige der Callback-URL (nur lesend) als Kontrolle.

### Umsetzung

- API-Zugriff ausschließlich über den typisierten `hc<AppType>`-Client in TanStack-Query-Hooks.
- Formulare mit TanStack Form + den Zod-Schemas aus `@shared`.
- Optimistische Updates bei Schaltern (aktiv/pausiert) mit Rollback bei Fehler.
- Toasts für Erfolg/Fehler (shadcn `sonner`).
- Leere Zustände mit Hinweis („Noch keine Streamer, füge den ersten hinzu“).
- `401` von der API → Weiterleitung zum Login.

---

## CLI

Aufruf im Container: `docker compose exec notify node src/cli.ts <befehl>`. Die CLI spricht per HTTP mit `127.0.0.1:8082/internal/*` (kein Auth nötig, da nur im Container erreichbar). Ausnahme: `hash-password` läuft ohne Server.

- `status`: Streamer mit ID, aktiv/pausiert, Live-Status, aktuellem Spiel und Abo-Status (übersichtliche Tabelle).
- `sync`: Abgleich ausführen und Ergebnis ausgeben.
- `test-mail`: Testmail an die konfigurierten Empfänger.
- `hash-password`: Passwort interaktiv abfragen (ohne Echo), Hash für `ADMIN_PASSWORD_HASH` ausgeben.
- `import <datei.yaml>`: Einmaliger Import von Streamern und Standardspielen im alten Format (siehe unten). Unbekannte Logins/Spiele deutlich melden, Rest trotzdem importieren. Danach Abgleich.

Altes YAML-Format für `import`:

```yaml
default_games: ["Elden Ring"]
streamers:
  papaplatte:
    games: ["Minecraft", "Elden Ring"]
  gronkh: {}              # nutzt Standardspiele
  somestreamer:
    games: ["*"]          # jedes Spiel
```

Spielnamen werden dabei über `GET /helix/games?name=...` aufgelöst (Groß-/Kleinschreibung egal).

---

## Robustheit & Betrieb

- Ein Fehler bei einem einzelnen Event, einer Mail oder einem Abgleich darf den Dienst nicht beenden. `unhandledRejection` wird geloggt, nicht ignoriert.
- **Graceful Shutdown** bei `SIGTERM`/`SIGINT`: keine neuen Requests annehmen, laufende Jobs beenden lassen (max. 10 s), SSE-Verbindungen schließen, DB schließen.
- **Logging:** strukturiert (JSON in Produktion, lesbar im Dev), Level über `LOG_LEVEL`. **Keine Secrets loggen** (Token, Client-Secret, Webhook-Secret, SMTP-Passwort, Passwort-Hash, Session-IDs). Eine kleine Redaction-Funktion zentral einsetzen.
- **`GET /healthz`** (Port 8082): `200` mit JSON `{ status, subscriptionsEnabled, lastSyncAt, lastSyncOk }`. `503`, wenn die DB nicht erreichbar ist.
- Beim Start klar loggen: Callback-URL, Anzahl Streamer, Ergebnis des ersten Abgleichs.

---

## Docker

### Dockerfile (Multi-Stage)

- Stage `build` auf `node:24-slim`: pnpm per Corepack, Abhängigkeiten installieren, Frontend bauen, Produktions-Abhängigkeiten für den Server installieren (better-sqlite3 benötigt ggf. Build-Tools; nur in dieser Stage installieren).
- Stage `runtime` auf `node:24-slim`: nur `apps/server/src`, `apps/server/drizzle`, `apps/server/node_modules`, das gebaute Frontend und nötige Root-Dateien kopieren.
- Nicht-root-User, `WORKDIR /app/apps/server`, `ENV NODE_ENV=production`, `VOLUME /data`, `EXPOSE 8080 8081`, `STOPSIGNAL SIGTERM`.
- `HEALTHCHECK` ohne curl, z. B. `node -e "fetch('http://127.0.0.1:8082/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"`.
- `.dockerignore` mitliefern.

### compose.yaml

```yaml
services:
  notify:
    build: .
    container_name: twitch-notify
    restart: unless-stopped
    env_file: .env
    ports:
      - "8080:8080"                 # Webhook, Ziel des Reverse Proxy
      - "192.168.1.10:8081:8081"    # Admin-UI nur im LAN (IP anpassen)
    volumes:
      - ./data:/data
```

Im README erklären, wie man die Admin-Port-Bindung an LAN-IP, `127.0.0.1` oder ein Tailscale-Interface anpasst.

---

## Tests (Vitest)

- **Signatur & Webhook:** gültige Signatur, ungültige Signatur (`403`), fehlende Header (`403`), zu alter Zeitstempel, doppelte Message-ID (zweimal `204`, einmal verarbeitet), Challenge-Antwort (Body exakt, `text/plain`), Revocation stößt Abgleich an.
- **Benachrichtigungslogik:**
  - online + passendes Spiel → genau eine Mail
  - online mit „Just Chatting“, dann `channel.update` auf passendes Spiel → genau eine Mail beim Wechsel
  - `channel.update` offline → keine Mail
  - Wechsel weg und zurück im selben Stream → keine zweite Mail
  - neuer Stream (neue `stream_id`) mit gleichem Spiel → neue Mail
  - Modus `any` → Mail bei jeder Kategorie
  - Modus `default` → nutzt Standardspiele
  - pausierter Streamer → keine Mail
  - Inbox-Einträge ohne `processed_at` werden nach „Neustart“ verarbeitet, ohne Doppelmail
- **Mail-Outbox:** Fehlversuch → Backoff und erneuter Versuch; nach 3 Fehlschlägen `failed`; manueller Retry.
- **Abgleich** (gemockte Twitch-API): fehlende anlegen, überflüssige löschen, Fehlerstatus ersetzen, Duplikate entfernen, Paginierung über mehrere Seiten, fremde Callback-URLs ignorieren, 429 mit `Ratelimit-Reset`.
- **Admin-API:** ohne Session `401`, Login mit falschem Passwort, Rate-Limit, Origin-Check, Streamer hinzufügen mit unbekanntem Login.
- Tests nutzen eine In-Memory- oder temporäre SQLite-DB und eine gemockte Mail-Transport-Schicht.

---

## README.md (Deutsch)

1. Kurzbeschreibung + Screenshot-Platzhalter
2. **Twitch-App anlegen** unter dev.twitch.tv/console (Kategorie beliebig, Client-Typ „Confidential“, Redirect-URL `http://localhost` genügt, Zwei-Faktor-Authentifizierung am Twitch-Account nötig)
3. **Webhook-Secret erzeugen** (`openssl rand -hex 32`)
4. **Admin-Passwort-Hash erzeugen** (`docker compose run --rm notify node src/cli.ts hash-password`)
5. **Reverse-Proxy-Route** für `/webhook` → Port 8080, mit Beispielen für nginx und Caddy. Hinweis: Request-Body muss **unverändert** durchgereicht werden (keine Umkodierung, kein Buffering-Filter, der den Body verändert). Das Admin-UI (8081) **nicht** öffentlich routen.
6. Optional: Admin-UI über Reverse Proxy im LAN/VPN mit SSE-Hinweisen (`proxy_buffering off`, langer `proxy_read_timeout`).
7. `.env` ausfüllen, `docker compose up -d`, Admin-UI öffnen, Streamer anlegen, `status` und Testmail prüfen
8. Migration aus dem alten YAML-Format mit `import`
9. **Lokales Testen mit der Twitch CLI** (`twitch event trigger stream.online -F http://localhost:8080/webhook -s <secret>`, `twitch event verify-subscription …`)
10. Entwicklung: `pnpm install`, `pnpm dev`, Tests, Lint, DB-Migrationen erzeugen
11. Designentscheidungen (inkl. aller Stellen, an denen du von dieser Spec abgewichen bist)

---

## Abnahmekriterien

1. Nach `docker compose up -d` legt der Dienst selbstständig alle Abos an. Das UI und `status` zeigen sie als `enabled`.
2. Ein Streamer geht mit einem passenden Spiel live → genau eine Mail.
3. Ein Streamer startet mit „Just Chatting“ und wechselt später zum passenden Spiel → genau eine Mail beim Wechsel.
4. Ein Streamer ändert offline die Kategorie → keine Mail.
5. Ein Streamer wird im UI entfernt oder pausiert → seine Abos werden ohne Neustart gelöscht.
6. Ein Neustart des Containers führt weder zu doppelten Mails noch zu doppelten Abos; unverarbeitete Events werden nachgeholt.
7. Anfragen mit falscher Signatur werden mit `403` abgelehnt.
8. Auf Port 8080 ist ausschließlich `POST /webhook` erreichbar.
9. Das Admin-UI ist ohne Login nicht nutzbar; Live-Status-Änderungen erscheinen ohne Neuladen.
10. Spiele können im UI per Suche ausgewählt werden; ungültige Spielnamen sind nicht möglich.
11. `pnpm typecheck`, `pnpm lint` und `pnpm test` laufen fehlerfrei durch.
