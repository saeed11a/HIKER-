# AGENTS.md

## Project Context

This is a Base44 app repository. Treat it as user-owned application code, keep changes focused on the user's request, and preserve existing project conventions.

Start with `README.md` for local setup, environment variables, and publish workflow.

## Base44 References

- CLI overview: https://docs.base44.com/developers/references/cli/get-started/overview.md
- Agent skills: https://docs.base44.com/developers/backend/overview/skills.md

If your agent supports Agent Skills, install or update Base44 skills before Base44-specific work:

```bash
npx skills add base44/skills
```

## Key Files

- `src/`: frontend application source.
- `src/api/base44Client.js`: frontend Base44 SDK client.
- `vite.config.js`: Vite config and Base44 Vite plugin setup.
- `.env.local`: local-only environment values; never commit secrets.

## Working Notes

- Use `base44 dev` as the default local development command when you need the local Base44 backend. It can run the backend and frontend together.
- When docs or code mention the frontend being started automatically, that usually means the Base44 project config includes `site.serveCommand`, for example `"serveCommand": "npm run dev"` in `base44/config.jsonc`.
- Use `npm run dev` only for frontend-only work against the hosted Base44 backend.
- Prefer the existing Base44 CLI workflow over adding new npm scripts for Base44-specific tasks.
- Reuse the existing SDK client and Vite plugin patterns before adding new Base44 integration paths.
- Run the relevant checks from `package.json` before finishing code changes.

## Base44 sandbox run notes

- Run the app with `docker compose -f docker-compose.base44.yml up -d` (dev server from the bind-mounted source on host port 3000). Details in `docker-compose.base44.yml`.
- **The `web` command execs `./node_modules/.bin/vite` directly, not `npx vite`.** The npx/npm wrapper is the parent process, so every container stop — including an ordinary restart — makes it print `npm error signal SIGTERM` and `npm error command sh -c vite --host 0.0.0.0 --port 3000 --strictPort`. That is npm reporting its own child being killed, not an app failure: the log block is followed by a fresh `VITE v… ready` and the server keeps serving. Execing the binary keeps the same dev server (same flags, same live reload) and leaves the log clean, so a real startup error is not buried under restart noise.
- A **package-lock.json is committed** (lockfileVersion 3). The export originally shipped without one, so the sandbox used `npm install --no-package-lock` and created nothing; that flag has been dropped. The container still runs `npm install` on every start — with the lockfile present it resolves from those pinned versions — because `npm ci` would wipe `node_modules` in the volume on each restart. The workflows still use `npm install`; switching them to `npm ci` is optional and would make APK/EXE builds reproducible.
- There is **no local `.env`** and the repo carries no `VITE_BASE44_APP_ID` / `VITE_BASE44_APP_BASE_URL`. Without a linked Base44 app there is no backend in the sandbox: the UI renders, `getPublicSettings()` and every entity/auth call fail, and the router falls back to the login screen. That is the expected state, not a regression — the Supabase migration is what removes this dependency. A fresh load shows the login screen with **no** failed requests or console errors.
- **Settings read/write follow the backend switch.** `src/lib/settingsApi.js` sends them to Base44 while `VITE_AUTH_BACKEND=base44` (the shipped builds) and to Supabase's `public.settings` — same columns, created by `0001` — when it is `supabase`. Before that split, every screen showing the company name, currency or packing defaults logged `Base44Error: 404` in the sandbox (`useSettings` had no backend branch). One row is created on the first save. **The other modules have not been cut over**: the dashboard stats, raw stock, articles, invoices, forms, reports and the recycle bin still call `base44.entities.*` directly, so they 404 — visibly on the dashboard as failed requests plus a console error — once you are past the PIN gate. That is the remaining module-by-module cutover, not a regression from the settings change.
- **A blank preview means the Supabase publishable key is missing.** `.env.base44-defaults` sets
  `VITE_AUTH_BACKEND=supabase`, so `src/api/supabaseClient.js` exports `null` while `VITE_SUPABASE_PUBLISHABLE_KEY`
  is empty and `AuthContext` throws `Cannot read properties of null (reading 'auth')` on mount — a white page
  instead of the login screen, with those two errors in the console. Supply the key as an app secret; compose lists
  `/run/base44/app.env` after the defaults so the real value wins, and the platform recreates the `web` service when
  it lands. Verified in this sandbox (empty key → white page, `#root` never mounts).
- Checks run through the container: `docker compose -f docker-compose.base44.yml exec -T web npm run lint` (also `npm run typecheck`, `npm run build`).
- **`windows-exe.yml` has its desktop shell now** — it used to fail at step 7 for want of `electron/` and `electron-builder.yml`,
  which both exist: `electron/main.cjs` is the main process (CommonJS, Electron + Node built-ins only, no npm dependency) and
  `electron-builder.yml` is the packaging config, with `package.json` `main` pointing at the entry. `files` excludes
  `node_modules` on purpose — the renderer is a finished Vite bundle and nothing is required from npm at runtime.
- **The shell serves `dist/` over a registered `hiker://` scheme, never `file://`.** `BrowserRouter` needs a real origin: a
  file:// document has no history API, so `history.pushState` throws and every route after the login screen would break. Do not
  "simplify" `main.cjs` back to a file:// load. The window starts at `hiker://app/` (not `/index.html`, which the router would
  treat as a route and answer with the 404 page).
- **Validating the desktop build in the sandbox** (the Windows installer itself is only built on the `windows-latest` runner):
  `docker compose -f docker-compose.base44.yml exec -T web sh -c 'npm run build -- --base=./ && npm install --no-save electron@35.1.5 electron-builder@26.0.12 && npx electron-builder --config electron-builder.yml --linux dir --publish never'`
  (the `--linux dir` run validates the config and the bundle; `release/` is gitignored). Running it headlessly needs `xvfb` plus
  Electron's desktop libraries (`libnss3 libgtk-3-0 libgbm1 libasound2 …`): `xvfb-run -a ./release/linux-unpacked/base44-app
  --no-sandbox --disable-gpu --disable-dev-shm-usage --remote-debugging-port=9222`, then read the DOM over the DevTools
  protocol. Verified that way: the packaged app boots to `hiker://app/login` and renders the login screen, every asset answers
  200 with the right MIME type, the built CSS is applied, and `pushState` works. Electron links (password reset, Google sign-in)
  need `hiker://app/reset-password` in the Supabase project's allowed redirect URLs; email + password and the PIN flow do not.
- **The Windows NSIS installer builds in the sandbox too**, once wine is complete — the failure that looks like a config error is an
  environment one. One-off recipe in the `web` container:
  `dpkg --add-architecture i386 && apt-get update && apt-get install -y --no-install-recommends wine wine64 wine32:i386 xvfb`, then
  `docker compose -f docker-compose.base44.yml exec -T web sh -c 'cd /app && xvfb-run -a npx electron-builder --config electron-builder.yml --win nsis --x64 --publish never'`.
  Without `wine32:i386` NSIS aborts with `File: …__uninstaller-nsis-….exe -> no files found` (the 32-bit uninstaller stub cannot run),
  and without a display wine fails with `could not load kernel32.dll` / `nodrv_CreateWindow` — neither is a repo defect. Verified this
  way: `release/HIKER-Factory-ERP-0.0.0-setup.exe` (86 MB) builds with no electron-builder warnings. `release/` stays gitignored and
  the wine/apt packages live only in the disposable container.
- **`windows-exe.yml` takes its build config from repository variables _or_ secrets** (`${{ vars.X || secrets.X }}`; a variable wins). Which backend the installer is built for is chosen by `VITE_AUTH_BACKEND`: set it to `supabase` (as a repository variable or secret) for the Supabase build, leave it unset for the shipped Base44 build — nothing switches by accident. Step 3 requires only the selected backend's values: Base44 → `VITE_BASE44_APP_ID` + `VITE_BASE44_APP_BASE_URL`; Supabase → `VITE_SUPABASE_URL` + `VITE_SUPABASE_PUBLISHABLE_KEY`. `android-apk.yml` still reads `vars.*` only.
- Full audit, blockers and phase plan: `docs/AUDIT.md`; per-phase status in `docs/PROGRESS.md`.
- **Database work goes through compose**, not `docker run`: the platform's managed secrets file quotes values that contain special characters, and `docker run --env-file` does **not** strip those quotes, so a connection string arrives as `"postgresql://…"` and psql silently falls back to a local socket. Compose parses it correctly. Use the `dbadmin` service (profile `tools`) — see `supabase/migrations/README.md`.
- The Supabase project `heqxvqgztkaixtgezbcw` already has the `0001_core_schema.sql` applied (16 tables, RLS on all, 61 policies, anonymous access revoked). It mirrors the Base44 entity/column names on purpose.
- `npx supabase` and the Base44 CLI are **not** installed in this sandbox. Neither is a Java/Android toolchain, but
  unlike those two it can be installed into the disposable `web` container on demand — see the APK recipe a few
  bullets down — so the APK can be built here as well as on the GitHub runner.
- **The Android APK builds in the sandbox**, the way the NSIS installer does; the toolchain lives only in the `web`
  container. In order: `apt-get install -y --no-install-recommends openjdk-17-jdk-headless unzip`, then **Temurin
  21** (`https://api.adoptium.net/v3/binary/latest/21/ga/linux/x64/jdk/hotspot/normal/eclipse?project=jdk`, untarred
  to `/opt/jdk21`) — Capacitor 7's Android module asks for `sourceCompatibility 21`, so JDK 17 alone fails with
  `error: invalid source release: 21`; then the SDK: `commandlinetools-linux-*_latest.zip` unzipped to
  `/opt/android-sdk/cmdline-tools/latest`, `yes | sdkmanager --licenses`, and
  `sdkmanager --sdk_root=/opt/android-sdk "platform-tools" "platforms;android-35" "build-tools;35.0.0"`.
- **Build outside the repo** — `npx cap add android` writes a whole native project and `android/` is not gitignored,
  so the scaffold goes to `/tmp/apk`: `npm run build -- --base=./` in `/app`, copy `dist` to `/tmp/apk/www`, a minimal
  `package.json` plus `capacitor.config.json` (`appId com.hiker.factoryerp`, `appName "HIKER Factory ERP"`,
  `webDir www`), `npm install @capacitor/core@7 @capacitor/cli@7 @capacitor/android@7 @capacitor/assets`,
  `npx cap add android`, copy the repo's `resources/` next to the project and
  `npx @capacitor/assets generate --android --assetPath=resources …` (the path resolves against **the project**, not
  the repo — otherwise the step only logs "Asset directory not found" and continues), `npx cap sync android`,
  `sdk.dir=/opt/android-sdk` in `android/local.properties`, `./gradlew assembleDebug --no-daemon` (48 s warm; the
  first run also downloads Gradle and AGP), then copy `app/build/outputs/apk/debug/app-debug.apk` out.
- **The sandbox APK is the Supabase build** — `VITE_AUTH_BACKEND=supabase` is the container's own default and the
  publishable key is in its environment, so it is the same backend the preview runs. `android-apk.yml` now takes its
  values as `vars.* || secrets.*` (the rule `windows-exe.yml` already followed), so one repository variable picks
  which backend the runner's APK is built for, and only that backend's values are required.
- Verified: `release/HIKER-Factory-ERP-0.0.0-android-debug.apk`, 9.1 MB, debug-signed, built with no warnings — the
  archive carries `assets/public/login-art/{biometric,cyan-dragon,dragon-lake,dragon-moon,red-circuit}.jpg`, the real
  `hiker-logo.png` and the generated launcher icons (`@capacitor/assets` reported 148 files, 5.76 MB). `release/`
  stays gitignored, as it does for the installer.
- **The built installers are downloadable from the sandbox.** The `downloads` service (`nginx:alpine`, config
  `docker/apk-server.conf`, host port **8000**) serves the gitignored `release/` folder read-only, so the APK/EXE
  can be handed out without copying a binary into the app bundle — anything under `public/` ends up in `dist/`, and
  therefore inside the next APK/EXE. Reach it at
  `https://8000-${BASE44_PUBLIC_HOST_SUFFIX}/<file in release/>`; nginx answers with the real MIME type and
  `Content-Disposition: attachment`, and `/healthz` is its healthcheck. Verified: a byte-identical download of
  `release/HIKER-Factory-ERP-0.0.0-android-debug.apk` (9,080,373 bytes, md5 matches) through the public proxy, with
  no credentials. This is the sandbox's own link — it dies with the sandbox. For a durable download the installers are
  published as a GitHub **Release** by `.github/workflows/release.yml` (`/releases/latest/download/<name>`), with the
  APK and the EXE also attached to the Actions run for 14 days; the sandbox itself has no GitHub credentials and the
  connected integration may only **read** this repository, so it cannot create the Release or push the tag that
  triggers one — details in the section at the end of this file.
- **The APK goes stale silently, so rebuild it before handing the link out (last: 2026-10-22 20:25 UTC)** — `release/` is
  gitignored and nothing rebuilds the file when `src/` moves on, so compare `stat -c %y release/HIKER-Factory-ERP-android-debug.apk`
  with `git log -1 --date=iso -- src public resources`. Last rebuild: **2026-10-22 20:25 UTC, at commit `33f352c`** —
  11,410,809 bytes, md5 `b29471f03dcf171c3a5fa885e0b700fc` (the earlier `HIKER-Factory-ERP-0.0.0-android-debug.apk` is
  gone; the file name no longer carries the version). It carries the money magnitude suffixes (H/L/C) and the touch
  tap-highlight fix, plus this commit's kata ledger row-action column (`35rem` / `31rem` are in the bundle). Quickest staleness proof: unzip `assets/public/assets/index-*.js` out of the APK and compare its
  md5 with the one `npm run build` just wrote under `dist/assets/` — matching hashes mean the archive holds exactly
  this build (and `grep -c -F sb_publishable_` / the PIN check on that same file catches the white-screen trap). It needed only the reused `/tmp/apk` project — copy the fresh `dist` over `www`, re-copy
  `resources/` from the repo, `@capacitor/assets generate` + `cap sync android`, then
  `JAVA_HOME=/opt/jdk21 ./gradlew assembleDebug --no-daemon` (~11 s warm); no scaffold rebuild. The recipe above still works end to end, with two things this rebuild
  taught: the toolchain lives **only in the container layer**, so any `up -d --build` or platform-driven recreate wipes
  `/opt/jdk21`, `/opt/android-sdk`, `/root/.gradle` and `/tmp/apk` — reinstall before building; and
  `npx @capacitor/assets generate` needs `@capacitor/filesystem`/`@capacitor/share` in the build project's own
  `node_modules`, since `capacitor.settings.gradle` resolves them from there. Checked after the build: the bundle carries
  the publishable key (two `sb_publishable_…` literals, zero unsubstituted `VITE_SUPABASE_PUBLISHABLE_KEY` references —
  the white-screen trap), that day's `exclude_id` duplicate-payment code is in `assets/index-*.js`, the 24
  `assets/public/` entries include all five `login-art/*.jpg` images, and the public download is byte-identical
  (md5 matches) through `https://8000-${BASE44_PUBLIC_HOST_SUFFIX}/HIKER-Factory-ERP-android-debug.apk`.

## Auth backend and the PIN unlock

- Supabase is the app's **only** backend — the five-digit PIN flow, `src/lib/authApi.js` and `AuthContext` talk to it directly. The `VITE_AUTH_BACKEND` switch and the Base44 branch were removed (see "The Base44 code is gone" at the end of this file).
- Signing in is a client-side transition (`AuthContext` subscribes to `supabase.auth.onAuthStateChange`), not a full page reload.
- The PIN screens are `/unlock` (enter the PIN), `/setup-pin` (first time: choose five digits, then confirm them) and
  `/change-pin` (the current PIN is required). They share `src/components/PinKeypad.jsx`.
- `ProtectedRoute` sends a signed-in account with no PIN to `/setup-pin` (administrator) or `/pin-not-issued` (anyone
  else), and to `/unlock` only once a PIN exists — a PIN-less account never reaches the app, and `/unlock` itself
  bounces to `/setup-pin` when there is no PIN to check. "No PIN" is therefore never a silent bypass.
- Server-side entry points: `setup_pin()` (own account, first time only, administrators only — returns `already_set`
  once a PIN exists), `change_pin()` (own account, checks the current PIN; a wrong one counts towards the same
  five-attempt / 15-minute lockout as `verify_pin()`), `set_pin()` (an administrator issuing *someone else's*). The
  browser may call those plus `pin_status()`/`verify_pin()`; all are revoked from `anon`, and no role can select
  `pin_hash`.
- **`search_path` trap, worth remembering:** pgcrypto's `crypt()`/`gen_salt()` live in the `extensions` schema on
  Supabase, so every PIN function must be declared `set search_path = public, extensions`. Without it, setting a PIN
  fails at run time with `function gen_salt(unknown, integer) does not exist` — and `verify_pin()` hides the fault,
  because it short-circuits before hashing when `pin_hash` is null. `0005` repaired the functions that had this.
- The administrator has set their own five-digit PIN, so a fresh load lands on `/unlock` (the `/setup-pin` bounce only
  happens while no PIN exists). Never set, reset or read a PIN for them (no SQL, no `setup_pin` call, no default
  value): they enter it themselves. Because a PIN is unknown to the agent, code behind `/unlock` is only verifiable
  when the preview pane is unlocked — the platform replays the pane's session storage, which includes the
  `hiker_pin_unlocked` flag, so an unlocked pane can be driven straight into the app (verified: `/settings` renders).
- `/unlock` needs a real session, so it cannot be checked by simply opening the route. The preview browser replays the
  preview pane's storage on **every fresh load**, which discards a session created in a previous call — drive sign-in
  and the keypad inside one `preview_execute_code` script. Also do not drive `logout` from the preview: it revokes the
  shared Supabase refresh token and signs the user out of their own pane.
- `0002` is applied and the administrator profile (`hikerplusshoes@gmail.com`) exists. Do not re-run the bootstrap
  expecting changes: it returns `already_bootstrapped`.

## Staff & access (roles, departments, permissions)

- The permissions interface is the "Staff & access" section at the bottom of `/settings` (`src/components/staff/`). It
  renders only for `role = 'admin'` **and** `VITE_AUTH_BACKEND=supabase`, because `profiles` / `user_permissions` only
  exist in Supabase — with the Base44 backend the section is hidden rather than throwing RLS errors.
- `department` (0003: fixed factory list) and `role` are written straight to `profiles` through the existing
  `profiles_admin_update` policy. Access levels become `<module>:<action>` rows in `user_permissions`, the same grants
  `has_permission()` and the RLS policies already enforce — so the screen is enforcing, not just hiding menu items.
  An administrator cannot change their own role from the screen (deliberate: it would lock them out of it).
- The module list, the three access presets (No access / View only / Full access) and the per-department defaults live
  in `src/lib/permissions.js`. Editing a preset there changes what that preset writes; nothing is hard-coded in the
  database.
- Staff *accounts* are still created in Supabase Auth (dashboard "Add user"/invite): there is no in-app invite flow, and
  the section shows an empty-state note when no other profiles exist.

## Labour, payments and the accounting rules (0006, applied)

- `supabase/migrations/0006_labour_and_accounting.sql` is **applied**. It is purely additive: the Labour module
  (`labour_categories` seeded with Upper / Last Process, Machine / Sole, Finishing, plus `labours`,
  `labour_category_links`, `labour_rates`, `labour_production`, `labour_earnings`, `labour_stage_moves`), manual
  categories (`manual_categories`), and the posting functions. Rollback: `0006_labour_and_accounting.rollback.sql`.
- **One authoritative money path.** `public.post_payment(jsonb)` writes the `payments` row and its *single*
  `roznamcha` entry in one transaction, decides the direction itself (customer = in, supplier/labour = out, manual =
  the category's direction), refuses an account that does not exist in the table its type names, flags an
  over-payment as an advance, and returns the existing rows when the same `idempotency_key` is posted again.
  `public.reverse_payment(uuid, text)` posts a linked opposite entry and marks the original reversed — nothing is
  deleted (a partial unique index on `reversal_of` makes a double reversal impossible). `labour_earned()`,
  `labour_paid()`, `labour_rate_on()` and `labour_balances()` are the read side.
- **Kharcha is the expense side of the same cash book (0012, applied).** The Kharcha screen, the dashboard
  "Kharcha" card and the Kharcha report all read `roznamcha` rows with `source = 'kharcha'`. `post_payment()` now
  tags a manual posting by the direction of its category — an expense (out) is written as `source = 'kharcha'`, a
  manual receipt (in) as `'other_income'` — so an expense recorded from the Payments menu ("Other / Manual" →
  the seeded `Kharcha` category, or any expense category an administrator adds in Settings) leaves the cash book
  and appears in Kharcha in the same transaction. Existing rows keep the source they were posted with, and the
  roznamcha policies still accept all of (`kharcha`, `other_income`, `opening`, `manual`) for staff's own manual
  entries. Rollback: `0012_kharcha_ledger_link.rollback.sql`.
- **Labour quantities are server-side too.** `record_labour_production` rejects negative pairs and an identical
  entry (unique index on labour + stage + article + date + reference), `complete_labour_production` earns
  completed pairs × the rate effective on the completion date and snapshots that rate (so a later rate change never
  rewrites history, and a retry earns nothing twice — `labour_earnings.completion_key` is unique), and
  `transfer_labour_stage` moves *pending* pairs to the next stage without earning anything again. `pairs_pending`
  is a generated column, so it can never go negative.
- **RLS tightened on the financial tables.** Direct inserts/updates/deletes on `payments` are now administrator-only;
  staff must post through `post_payment`/`reverse_payment`, which check the module permission themselves. On
  `roznamcha`, staff may still keep their own manual entries (`kharcha`, `other_income`, `opening`, `manual`) but
  cannot edit or delete an entry a module produced — those are corrected with a reversal. A "view only" account
  therefore cannot post money even if it calls the API directly (verified: `42501`).
- Frontend: `src/lib/accounting.js` (postings + reads + manual categories) and `src/lib/labour.js`. The unified
  payment screen is `src/components/forms/PaymentForm.jsx` (Customer / Supplier / Labour / Other); `src/pages/Payments.jsx`
  and `src/pages/Roznamcha.jsx` now read and write Supabase. Manual categories are managed in Settings
  (`src/components/settings/ManualCategories.jsx`, administrators only). The Labour screen is `src/pages/Labour.jsx`
  with its dialogs in `src/components/labour/LabourDialogs.jsx` (`/labour`, module `labour`).
- **Menu/route gating:** `src/lib/usePermissions.js` + `src/components/RequirePermission.jsx`; the sidebar filters by
  module. This only mirrors what the database already enforces (RLS + the functions) — it is not the security
  boundary. The hook returns everything allowed when Supabase is not the backend, so the Base44 builds keep their
  previous behaviour.
- **Testing the backend without leaving data behind:** run the statements inside a transaction that is rolled back,
  acting as a real account: `select set_config('request.jwt.claims', json_build_object('sub', :'admin_id', 'role',
  'authenticated')::text, true); set local role authenticated;` then wrap statements in a `pg_temp.attempt(sql)`
  helper to see whether RLS admits them. Demote the admin to `user` with a view-only grant inside a *savepoint* to
  test the denials, then `rollback to savepoint`.
- **Data layer:** every screen reads and writes through `src/lib/entities.js`, which keeps the Base44 entity call
  shapes (`filter` / `create` / `update` / `delete` / `aggregate`) and sends them to Base44 while
  `VITE_AUTH_BACKEND=base44`, or to the matching Supabase table while it is `supabase`. The earlier note that the
  dashboard, stock, articles, invoices, customers, suppliers and reports "still call `base44.entities.*` directly"
  no longer describes the code. Not every one of those modules has been re-verified on Supabase since the cutover —
  check the screen you touch rather than trusting the routing alone.

## Top bar, account menu, avatars and printing (0008)

- **The top bar** (`src/components/layout/TopBar.jsx`) carries the HIKER+ wordmark, `LiveClock`, `ConnectionStatus`,
  `ThemeToggle` and `ProfileMenu`. It is `no-print`. At the 360px phone width the bar is width-tight: the HIKER+
  badge is hidden below `sm`, the clock's icon below `sm` and its date below `lg` — the label LIVE is kept at every
  width. Measure `header` children before adding anything else to it.
- **`LiveClock`** formats in `Asia/Karachi` (`src/lib/datetime.js`) whatever the device timezone is, and ticks once
  a second.
- **`useBackendStatus`** (`src/lib/useBackendStatus.js`) is the only thing that may call the connection LIVE: it
  makes a real request to the configured backend (Supabase: `profiles.select('id').limit(1)` — the one read every
  signed-in account is allowed by RLS; Base44: `app.getPublicSettings()`), at most once a minute and again when the
  tab becomes visible. Green LIVE = a recent success, amber SYNCING = a check or React Query request in flight, red
  OFFLINE = nothing verified recently. `navigator.onLine` is never used as evidence of a connection.
- **The account menu** (`src/components/layout/ProfileMenu.jsx`) shows name, email, role and department and offers
  Change PIN (→ `/change-pin`, or `/setup-pin` when the account has no PIN), Change profile picture, Switch user and
  Sign out. "Switch user" and "Sign out" both call `logout()` — this app has one identity mode, so both end the
  session and return to the login screen; neither swaps a displayed name. Every action is self-service only: the
  PIN functions are bound to `auth.uid()` and `set_own_avatar()` writes only the caller's row. Issuing or resetting
  *someone else's* PIN stays an administrator action in Staff & access.
- **Avatars (0008, applied).** `profiles.avatar_url`; `public.set_own_avatar(text)` (SECURITY DEFINER, self-only —
  a self-update RLS policy could not be used because RLS cannot restrict columns, and a policy wide enough for a
  picture would also allow a self-service role/status/PIN change); and the public-read `avatars` Storage bucket
  whose policies confine writes to `<user id>/…`. `src/lib/profileApi.js` uploads to `avatars/<user id>/avatar.<ext>`
  and saves the public URL with a `?v=` stamp. `AuthContext` carries `department` and `avatar_url` and exposes
  `refreshProfile()` so a new picture shows without a reload.
- **Printing.** `src/components/invoice/InvoicePrintView.jsx` holds the printable invoice (the invoice number,
  customer, lines, totals, payments and balance all come from the stored invoice, line rows and settings — nothing
  is templated). `InvoiceDetailDialog` adds `printing-invoice` to `<html>` while it is open, and the print rules in
  `src/index.css` hide `#root` so the printed page is the invoice alone. Default paper is **Letter** (8.5in × 11in, 10mm margin — `@page { size: letter portrait }` in
  `src/index.css`), and the bill's own Print / PDF hands `printElement()` `fillPage: true`, which gives the
  sheet the page's own height (258.6mm of the 259.4mm printable box) so its ruled lines take the slack and
  the paper prints as one whole Letter bill — not a band across the top. Add `.print-receipt`
  to the print view's root to switch to the named `receipt` page (80mm). The `print:` utilities on the dialog
  unclip it (`max-h-[92vh] overflow-y-auto` would otherwise cut the printout at one screen). The layout is still
  the original one, re-cut for paper — a visual redesign is pending a reference image.
- **Testing note:** a picture upload leaves a real object in the `avatars` bucket. Direct SQL deletion from
  `storage.objects` is blocked (`storage.protect_delete()`); remove the object through the Storage API, then clear
  `profiles.avatar_url`. `delete from storage.objects …` will always fail.

## Live sync, Database Center, Users and the admin console (0010, 0011)

- **`0010_admin_console_security.sql` and `0011_sync_probe.sql` are applied.** 0010 hardens `has_permission()` so it
  also requires `profiles.status = 'active'` (deactivating an account now revokes its data access everywhere RLS is
  consulted), adds the audited `log_admin_event()`, `admin_users()` (reports `has_pin` — never the hash),
  `admin_update_user()` (self-lockout protected), triggers that audit role/status/department/permission changes, the
  `backups` history table, and `restore_table_rows()`. 0011 adds `sync_probe(since)`, which is deliberately SECURITY
  **INVOKER** so every per-table change count is filtered by the caller's own RLS.
- **A restore can only INSERT.** `restore_table_rows()` runs
  `insert … select * from jsonb_populate_recordset(…) on conflict (id) do nothing` against an allow-list of business
  tables. It can never update or delete a production row. Auth users, Storage files and project config are outside a
  data backup by design.
- **Offline outbox.** `src/lib/syncQueue.js` keeps failed *plain entity* writes in `localStorage` and replays them in
  order. `src/lib/entities.js` mints the row `id` with `crypto.randomUUID()` before the first attempt, so a replayed
  create hits the primary key (23505) and is treated as already applied instead of duplicating. **The multi-row RPC
  paths (`post_payment`, `create_invoice`, `record_production`, `save_raw_stock`, `save_ready_stock`,
  `record_purchase`) are deliberately NOT queued** — they are not keyed idempotently and a blind replay could post a
  second transaction. Those forms still require a connection and show the error inline.
- **`SyncProvider` / `useSync()`** (`src/lib/SyncContext.jsx`) is the single source of truth for the top-bar
  indicator and the panel. Green needs BOTH a verified backend and an empty outbox with no failures — internet alone
  never turns it green. It does one reconciliation pass on load, probes every 45 s, syncs on `online`/focus, and
  retries failures with exponential backoff. `ConnectionStatus` is a button; `SyncPanel` is the dialog.
- **Database Center** (`/database-center`, module `database_center`) has a live explorer, Excel/CSV/PDF export, and
  an administrator-only Backup & Restore tab (module `backup`). Reads go straight to the tables through PostgREST,
  so RLS is the boundary; no SQL is accepted from the browser; `profiles`, `user_permissions` and `audit_logs` are
  not in `EXPLORER_TABLES`, and a `HIDDEN_COLUMNS` list drops `pin_hash`/`idempotency_key` even if a table has them.
  `src/lib/xlsx.js` writes a real .xlsx by hand (ZIP + CRC-32, stored entries) — no spreadsheet dependency was added.
- **Users** (`/users`, module `users`) lists accounts via `admin_users()`, edits through `admin_update_user()`,
  issues PINs through `set_pin()`, and **deletes an account from the card itself** (the Delete button beside
  Deactivate → `src/components/users/DeleteStaffDialog.jsx` → `deleteStaffAccount()`, the `admin-users` Edge
  Function's `delete` action, which refuses the caller's own account). Deleting is permanent: the Auth user goes
  with its profile, its permissions and its PIN hash (the FKs cascade). Trap: `user_permissions.granted_by` and
  `backups.created_by` reference `profiles(id)` with **no** `on delete` rule, so an account that granted access to
  someone else cannot be deleted until those rows are cleared. **Verified this branch:** the button → confirmation → the
  service call dispatched in the preview (no console errors), and the delete itself was completed with a live session —
  `200 {"ok":true}`, the profile and the Auth user gone, a `user_deleted` audit row. In the *preview* the call answers
  401 because the replayed pane session is stale (its refresh token answers `400`, and GoTrue refuses the access token
  with `session_not_found`, so the function's `admin.auth.getUser()` fails) — a live pane session deletes normally. That
  401 is now legible: `callAdminFunction` reads a non-2xx reply's body, so the dialog shows the function's own message
  instead of supabase-js's "Edge Function returned a non-2xx status code". Creating an account needs the service_role key, so it is the only action that goes
  to the **`admin-users` Edge Function** (`supabase/functions/admin-users/index.ts`), which re-checks the caller is an
  active administrator. It is deployed — the Management API path that works is
  `POST /v1/projects/<ref>/functions/deploy?slug=admin-users` with a `metadata` part and a `file` part (plain
  `POST /functions` answers "Cannot read properties of undefined (reading 'toString')"). Redeploy after editing it;
  the access token lives in `/run/base44/app.env` as `SUPABASE_ACCESS_TOKEN` and must never be printed.
- **Trap: `Intl.DateTimeFormat.format()` throws on an ISO string** (`RangeError: Invalid time value`). PostgREST
  returns timestamps as strings, so `formatAppDate/formatAppTime/formatAppStamp` in `src/lib/datetime.js` now coerce
  through a `toDate()` guard that returns `null` for anything unreadable. Before that fix, rendering a `last_login_at`
  or `created_date` string blanked the whole app (the Users screen) with no console error. Never call
  `dateFormat.format(value)` directly again.
- **Verification status (this branch):** the sync indicator + panel, the Database Center explorer (Articles and
  Invoices), the backup panel, and route/sidebar gating were exercised in the preview. The Users screen rendered
  blank; it was traced to the date-formatter bug above and fixed, but that fix was **not re-verified in the preview**
  (the turn's preview-call budget ran out). The create→recycle→purge flow through `entities.js` was **not** driven
  either — the outbox change is additive (only a network-failed write is queued), but it is unverified here.

## Repository, branch and secrets

- Remote: `https://github.com/saeed11a/HIKER-`. Work happens on the platform's working branch
  `base44/setup-0ed2dbd6`; `main` is never committed to, force-pushed or reset by this work. The platform's own
  authenticated sync commits and pushes the working branch at the end of each turn — **do not run `git commit`,
  `git push` or `git checkout` yourself**, and do not try to switch branches.
- **Provenance of this tree.** The `HIKER-` app was imported empty (its root `README.md` is still the original
  one-line stub — the upstream project README was deliberately not copied over it). The HIKER+ Shoes Factory ERP
  source was copied here verbatim from `saeed11a/Personal-App`, which is the same project's own repository, so the
  two trees are identical today and will now diverge. No application source was modified for the sandbox.
- **The sandbox has no GitHub credentials.** `git push` (even `--dry-run`) fails with
  `could not read Username for 'https://github.com'`. A direct push is therefore impossible here, not merely
  disallowed: getting work into `main` goes through a pull request.
- **Nothing secret may be committed.** The repo carries no real credentials: `.env.base44-defaults` holds public
  Vite defaults with an empty key placeholder, and `.env.example` documents names only. `.gitignore` ignores
  `.env` / `.env.*` (un-ignoring just those two templates) plus `*.jks`, `*.keystore`, `*.p12`, `*.pem`, `*.key`
  and `service-account*.json`. The real values live in the managed env file `/run/base44/app.env` — never print
  one, never copy one into the repo. A tree audit (`grep` for JWT-shaped strings and `postgresql://…@…` URLs)
  must stay empty before any sync.
- `node_modules/`, `dist/` and `.vite/` are gitignored build output; `base44/.app.jsonc` is the per-user app-id
  pointer and stays ignored too.
- Checks, all through the container: `npm run build` ✓ and `npm run lint` ✓. `npm run typecheck` is **not** a
  passing gate here — it reports ~1100 pre-existing JSX prop-type errors across the untyped `.jsx` components.
  There is no automated test runner in this repo.

## The kata ledger entry row and the uppers position (this branch)

- **A kata row posts money from the ledger itself.** `src/components/PartyDetailView.jsx` renders the
  customer/supplier kata (inside the detail page now, not a popup) as DESCRIPTION · JAMMA · BANAM · BALANCE
  plus one inline entry row (description + amount + Jamma/Banam → Post). The row does not pick a side: it goes through `postPayment()` (`src/lib/accounting.js`), so
  `post_payment()` still decides the direction and writes the single roznamcha entry — a customer entry is
  always a receipt (banam), a supplier entry always a payment (jamma). The typed description is stored in the
  payment's `notes`, and `analytics.partyLedger()` now shows it as the ledger row's text (falling back to
  "Payment received · Cash"). **A posted payment cannot be deleted through the app** (reversals only), so a
  test posting has to be removed through the REST API by exact id — see below.
- **The Uppers page carries a per-article position.** For slug `uppers`, `src/pages/RawCategoryPage.jsx`
  renders `src/components/stock/UppersByArticle.jsx` from `analytics.uppersArticlePosition()`: bags in,
  bags consumed by production (`production_entries.input_bags`), remaining bags/pairs and stock value. The
  remaining figures are green above `settings.low_stock_threshold` and red at or below it — the same rule the
  Articles and Ready Shoes screens use. Verified live: the card renders (HK: 12 bags in, 8 used, 400 prs / 4
  bags remaining, green, alert level 50) after a real posting on the kata row (Rs 1 → balance 108,000 →
  107,999) and its removal. The **red** state was NOT exercised: no article is at or below the alert level and
  the level cannot be raised, for the reason below.
- **The Settings screen can save again — `0009_invoice_payment_details.sql` is applied (this branch).** The form
  posts `bank_account_no` / `bank_account_name` / `bank_branch` / `terms`, which the live project did not have, so
  PostgREST answered `column settings.bank_account_name does not exist` and no settings row could be created or
  updated — which also pinned the low stock alert level to the built-in default (50). 0009 adds those four columns
  to `public.settings` (nothing else in the repo needs them); `notify pgrst, 'reload schema'` was issued so the API
  sees them without waiting. Verified against the live project: as the signed-in administrator, inside a
  transaction that was rolled back, the exact payload Settings sends inserted **and** updated cleanly
  (`low_stock_threshold` 37 → 41), and a PostgREST POST of the same columns answered `201` with the new column
  echoed (that row deleted again; `public.settings` is back to 0 rows, so the app's defaults are untouched until
  someone saves). **The on-screen Save was not driven** — `/settings` is behind the PIN gate and the pane was
  locked — so the user exercises that once. With the level now writable, the red (at-or-below-level) stock state on
  Articles / Uppers / Ready Shoes becomes exercisable as well.
## The animated delete → Recycle Bin (0013, this branch)

- **Every module's delete flies the record into the Recycle Bin, and the record is attributed to whoever
  deleted it.** `src/lib/deleteFlight.js` is the channel between the two halves: a delete is triggered from a
  table row deep inside a module, while the bin belongs to the layout.
- `recordAnchor(id)` reads the record's own row/card through `[data-record-id="<id>"]` — added to **both** of
  DataTable's layouts (the stacked-card one and the table). **A record is in the DOM twice and the hidden copy
  measures 0×0, so the first *visible* match wins**; before that, the flight silently never played. A module
  that renders its own list just needs the same attribute.
- **The bin control itself was removed from the screen at the user's request** (the circular trash button pinned to
  the lower-right corner, which sat over the mobile content). `src/components/recycle/RecycleFlightLayer.jsx`
  (mounted by `Layout`) is now the portal overlay alone: the record lifts off the row, shrinks and leaves towards
  that same corner in 620 ms — where the Recycle Bin lives, in the sidebar — and a restore rises back out of it.
  `data-flight-card` is what the preview drives; there is no `data-bin` / `data-lid` any more, and the toast
  viewport's `sm:pb-24` went with the bin. It honours `prefers-reduced-motion` (the record still moves to the bin,
  it just does not fly) and the dim layer is `pointer-events-none`, so it never swallows a click.
- **Order is the safety rule: `softDelete()` writes to the backend first and only then plays the flight**, so a
  refused or failed delete never shows a record dropping in — and the caller's toast, which awaits the same
  promise, cannot appear before the drop. Never reorder those two.
- **`0013_soft_delete_audit.sql` is applied**: `deleted_by` (uuid) and `deleted_by_name` on the 14
  soft-deletable tables, so the bin can say who deleted a record and when. `AuthProvider` mirrors the signed-in
  profile into `src/lib/activeIdentity.js` — plain module code cannot read React context — and `softDelete`
  stamps both columns **only when Supabase is the backend**, so the shipped Base44 builds never send fields
  their entities do not have. `deleted_date` is now a full ISO timestamp, which is what the bin's "Deleted"
  column renders (`formatAppStamp`). Restoring clears all three, so a later delete stamps fresh.
- **Fixed here: restoring from the bin used to blank the entire app.** `<Toaster />` was rendered *outside*
  `<Router>`, and the bin's restore toast carries a `<Link>Open module</Link>` action — React threw
  `Cannot destructure property 'basename' of useContext(...)` and `#root` emptied. The Toaster now sits inside
  the Router, next to `<AuthenticatedApp />`. Verified: the restore toast renders and the app stays up. Do not
  move it back out.
- The bin's table gained a **"Deleted by"** column and its search now matches the record id too.
- **Verification status (this branch).** Driven in the preview against a throwaway article (created for the
  test, then removed — nothing is left in `public.articles`):
  verified = the row's Delete + confirmation, the record leaving the list, the bin listing it with
  **Deleted by hikerplusshoes@gmail.com** and its time, restore putting it back exactly once, and the app
  surviving the restore toast after the Toaster fix. **Not verified: the flight itself** — in those runs the
  card never rendered, which is how the hidden-copy anchor bug above was found; the fix is in, but the turn's
  preview budget ran out before it could be re-checked, so the animation, its timing, the mobile card layout
  and the permanent-delete gate still need one look in the pane. The mobile delete gesture and the purge were
  exercised only up to the point the earlier runs failed.

## Party balances: one rule, read twice (this branch)

- **A card and the kata it opens must read the same two sides.** `analytics.customerBalanceMap()` /
  `supplierBalanceMap()` now return the kata's own sides per party name — `{ jamma, banam, invoices | purchases }` —
  and `kata.partySides()` only adds the opening balance (Banam for a customer's due, Jamma for a supplier's payable).
  The card (`PartyGrid`), the `Customers`/`Suppliers` KPIs, the detail dialog's big figure and `partyLedger()` are
  therefore all the same arithmetic.
- **`invoices.received` must never be added to the payments rows.** `create_invoice()` takes the money received with
  an invoice *and* writes the matching `payments` row (reference = the invoice number). The old
  `customerBalanceMap()` summed `sum(invoices.received)` **and** every payment, counting each receipt twice: the
  Walk customer's card read `−Rs 220,000` while his kata closed at `−Rs 230,000` (invoice 240,000, receipt 10,000).
  Receipts come from the payments rows alone — the same rule `post_payment()`/0014's `v_outstanding` use.
- **A payment's side is its `direction`** (`in` = Jamma, `out` = Banam; 0014 keeps the stored `transaction_type` in
  step), so the maps split payments by direction instead of assuming an account's usual side — money paid *out* to a
  customer now debits him. The supplier card had the inverse bug (it read `paid − purchased`, so a supplier the
  factory owed showed as an advance); it now matches his kata, "Payable — factory owes" included.
- **Verified in the preview** (Supabase, mobile viewport): Walk's card `−Rs 230,000` = his kata's
  `Closing −Rs 230,000`, dialog `Net balance −Rs 230,000` / "Receivable — customer owes", Receivable KPI 326,000;
  and with a throwaway supplier (purchase 1,000 + payment 400, both removed afterwards) the card read `+Rs 600` with
  the kata closing `+Rs 600` and Payable 600, no console errors.
- **Two customers may share a name** and are deliberately keyed by it (the kata is per name too): "Saeed" ×2 shows
  the same jamma/banam sides and differs only by each row's own opening balance.

- **Test-data cleanup without the app's help:** `public.payments` and `public.roznamcha` can be removed from the
  `web` container with the platform secrets already in its environment — the service-role key needs no printing:
  `docker compose -f docker-compose.base44.yml exec -T web sh -s` then
  `curl -s -G "$VITE_SUPABASE_URL/rest/v1/payments" -H "apikey: $VITE_SUPABASE_PUBLISHABLE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"`, and a `DELETE …/payments?id=eq.<id>`. The `dbadmin` SQL path
  works from here too, but **only through the connection pooler** — `SUPABASE_DB_URL` names the project's direct
  host, which resolves to IPv6 only and the sandbox has no IPv6 route (`Network is unreachable`). Connect with
  `-h aws-0-ap-northeast-1.pooler.supabase.com -U postgres.heqxvqgztkaixtgezbcw` and the password lifted out of the
  managed URL by `sed`, exactly as in `supabase/migrations/README.md`; the region comes from
  `GET https://api.supabase.com/v1/projects/<ref>` (`region`).

## Kata buttons open their own pages (this branch)

- **A customer/supplier card is a way in, not a popup.** `src/components/PartyGrid.jsx` renders the
  credit-card-style tile — name with the JAMMA/BANAM AHEAD badge, the remaining, the phone, the document
  count and the eye/pencil/bin row — and navigates to `/customers/:id` or `/suppliers/:id` when the card
  itself or its eye is used (`basePath` prop). The row's pencil/bin keep `RowActions`'
  `event.stopPropagation()`, so editing or deleting from the list never navigates away.
- **The pages:** `src/pages/PartyDetailPage.jsx` (one component, `type="customer" | "supplier"`, mounted on
  both routes, gated by the same `RequirePermission` modules as the lists) and `src/pages/LabourDetail.jsx`
  (`/labour/:id`, opened by the labour table's view control). Each loads its one record plus the same
  balance map the list used, so the page's figure is the figure the card showed, and the page is where
  edit / delete / receive-payment / pay-labour now live.
- `src/components/PartyDetailView.jsx` is the old `PartyDetailDialog` body with the dialog chrome taken off:
  hero card, account details, last transaction, the Jamma/Banam table and the "New entry" posting row. The
  posting path is untouched — it still goes through `postPayment()` → `post_payment()`. `PartyDetailDialog.jsx`
  and `PartyLedger.jsx` were **deleted** with it: no list selects a party inline any more, so both were dead.
- Labour's statement moved the same way: `src/components/labour/LabourStatementView.jsx` (presentational,
  takes the loaded statement) replaced the `StatementDialog` export in `LabourDialogs.jsx`, and the reversal
  confirm dialog now lives on `LabourDetail.jsx`. `reversePayment()` and `labourStatement()` are unchanged.
- Verified in the preview (Supabase backend, phone width, pane unlocked): 4 cards → `/customers/<id>` (name
  heading, kata table, new-entry row, Receive payment, **no** dialog), 1 card → `/suppliers/<id>`, the labour
  view control → `/labour/<id>` (statement renders) with Back returning to `/labour`, the card's pencil
  opening the edit form in place without navigating — no console errors, no failed requests.

## The kata buttons, cut like cards (this branch)

- **One tile for all three party lists.** `src/components/KataCard.jsx` is the bank-card panel, laid out
  the way a card is printed: the HIKER+ mark top-left, the party's name where the cardholder's sits, his
  remaining in the top-right corner, the silver chip with its kata word across the middle and the
  account's number line under it, then a footer of "last transaction" (amount · date) beside the
  document count and the row's actions. `PartyGrid` (customers, suppliers) and
  `src/components/labour/LabourCards.jsx` (labour) both render it, so the three lists cannot drift
  apart. The whole tile opens the party's page and keeps `data-record-id` for the delete flight; the
  card's own eye/pencil/bin call the same handlers they did in the table.
- **The number line is the party's phone** read back in card groups (`03123456789` → `0311 9044 902`);
  with no phone it prints the record id's own last four, the way a card prints its tail. A phone is no
  longer repeated as the card's subtitle — the subtitle is what is left once it moved (customer
  product details, labour stages).
- **Labour's accounts list is cards now, not the accounts `DataTable`** — its `accountColumns` went
  with it. Everything the table showed is on the tile or its page: remaining + which side is ahead,
  stage/phone, pending pairs, active/inactive badge and the Record-payment control. The *production*
  table on the same screen is untouched.
- **The face is the CSS class `.kata-card` / `.kata-chip`** (`src/index.css`): a deep purple face lit
  from its middle, an Islamic geometric lattice masked into the top-right corner (`::before`) and a
  sheen across the upper left (`::after`). Like a real card the face is **fixed** — the same dark
  purple in both themes, no brand token — so everything printed on it is a white tint, and
  `brand-foreground` must not be used there (in the dark theme it is near-black). The chip is brushed
  silver. The remaining keeps the Jamma-green / Banam-red rule from `kata.js` in its light tints
  (`remainingOnCard`, the same `SIDE_TEXT_ON_BRAND` the detail hero uses); `RowActions`'
  `tone="onCard"` skin and labour's Record-payment button are white-tinted to match. `RowActions`'
  default skin is unchanged for every table.
- **"Last transaction" is real data.** `analytics.customerBalanceMap()` / `supplierBalanceMap()` return
  `last` (the date of the newest of the party's documents and payments) and `lastAmount` (that same
  row's own money — `total` on an invoice, `amount` on a purchase or payment), read from the 500 most
  recent rows of each source (`withLastActivity`), never a second full scan; a source the reader may not
  see leaves the line blank rather than failing the card. The labour side is
  `labour.lastLabourActivity()`, which now returns `{ date, amount }` per labour id from his newest
  payment / earning / work entry (a work entry carries no money of its own, so only its date shows).
  `labour_balances()` has no date, so it is not the source.
- **Fixed here:** the customer card's document cell read "Purchases" whenever the customer had no
  invoice yet (the old `entry.invoices ? … : …` falsiness test); the label now follows the module —
  customers show Invoices, suppliers Purchases.
- **Verified in the preview** (Supabase, pane unlocked, desktop + 375px): 4 customer, 1 supplier and 1
  labour card render the face — background `rgb(26,11,46)` with white ink at 16px radius, HIKER+ mark,
  name, silver chip (`linear-gradient(135deg, rgb(251,252,253) …)`), contactless mark, number line
  (`0311 9044 902`), LAST TRANSACTION / TOTAL INVOICES `Rs 15,000 · 2026-10-12` / `0`, and on labour
  `Rs 1,000 · 2026-10-11` / PENDING PAIRS `0 prs` with its ACTIVE pill; the lattice pseudo-element
  paints (`repeating-linear-gradient` 45°, opacity 0.18, radial mask) as does the sheen; Jamma figures
  compute `rgb(167,243,208)`, Banam `rgb(254,205,211)`, settled white — green/red kept; tapping a card
  still opens `/customers/<id>`; no sideways scroll at 375px, no console errors, no failed requests.
  The card's pencil opening the edit form without navigating was verified when the tile was built, not
  re-driven after this face change (the handlers are untouched).
- **If a list page goes blank after editing `src/lib/labour.js`**, and the console says the module
  "does not provide an export named …", that is Vite's transform cache holding a module read mid-write —
  `docker compose -f docker-compose.base44.yml restart web`, not a code fault (the file parses and
  `npm run lint` is clean).
- **The app's name is "HIKER Shoes Factory" — the "ERP" suffix was dropped** from every user-visible name
  (sidebar and auth-layout taglines read "Shoes Factory", the page footer, `index.html`'s title/description,
  `public/manifest.json`, and the report / PDF / backup footers). The **HIKER+ mark itself is unchanged**
  (top bar, sidebar logo alt, card face), and so is `electron-builder.yml`'s `productName` /
  `artifactName` ("HIKER Factory ERP"): renaming those would change the installer the Windows workflow
  produces and Electron's userData directory, resetting the desktop build's local session. `settings.company_name`
  (default "HIKER Shoes Factory") still overrides the name on printed documents.
- **The party's name is the largest line on a kata card** (`text-lg`, uppercase) — it grew from `text-base`
  in the rename change.

## The Jamma / Banam default and the kata PDF (this branch)

- **The picker opens on the account type's usual side.** `kata.defaultSideFor()` — customer → Jamma (money
  received), supplier/labour → Banam (money paid), manual → none — is the starting value of the kata's New entry
  row (`PartyDetailView`) and of the New payment dialog (`components/forms/PaymentForm.jsx`), where it also follows
  a change of account type. It is only the starting value: the side is still the user's to change before posting,
  the posting path is untouched and `post_payment()` still decides the money direction.
- **Fixed:** `PartyDetailPage` handed `PaymentForm` `party_type` / `party_id` / `party_name`, but the form reads
  `account_type` / `account_id` / `account_name` — so "Receive payment" on a *supplier's* page opened a Customer
  form with no account selected. The keys match now (the labour screens always used the right ones).
- **The kata prints as a PDF.** `src/lib/kataPdf.js` writes a real file with jsPDF, in the same drawing style as the
  Database Center export: teal letterhead, the account summary, then the ledger — `exportPartyKataPdf()` for a
  customer/supplier kata, `exportLabourStatementPdf()` for a worker's statement. The "Print / PDF" button sits in the
  kata page's footer (`PartyDetailView`) and in the labour page's header (`LabourDetail`). Rows print oldest first
  (a statement reads downwards) and every value is folded to WinAnsi by `plain()`, because the built-in PDF fonts
  cannot print a typographic minus or dash — do not pass `netBalance().text` straight into the document.
- Verified in the preview (Supabase, phone width, pane unlocked): a customer's New entry opens on Jamma and a
  supplier's on Banam; "Receive payment" opens on Customer + that customer + Jamma, switching the type to Supplier
  moves the side to Banam, and "Pay supplier" opens on Supplier + Banam. Both PDFs were generated from the module in
  Node and their text read back — the party kata (Jamma +Rs 10,000, Banam −Rs 240,000, net −Rs 230,000, both ledger
  rows) and the labour statement (earned 500, paid 200, net 300). The button's click dispatched with **no** console
  error, but the browser download itself is not observable from the preview.

## The new brand mark and the icons cut from it (this branch)

- **The reference logo (a black-framed square holding an off-white sticker: the "H" arch with its hiker and the
  "+", over the HIKER+ / SHOES / tagline lockup) was cut down to the H^ mark alone** and written over every icon
  file the app already loads: `public/hiker-logo.png` (512×512 — the in-app mark and the favicon),
  `public/icon-512.png`, `public/icon-192.png`, `public/apple-touch-icon.png` (180), `build/icon.png` (512 —
  electron-builder's Windows .ico source) and `resources/icon.png` / `resources/icon-only.png` (1024, what
  `@capacitor/assets` turns into the APK's launcher icon), plus `resources/icon-foreground.png` (the mark on
  transparency, sized into the adaptive-icon safe zone), `resources/splash.png` (mark on `#F4F4F4`) and
  `resources/splash-dark.png` (**a white cut of the mark** on `#16191f` — the art is black and would otherwise
  vanish on the dark plate). `resources/icon-background.png` is unchanged (solid plate). No frontend file needed
  editing: every in-app mark already loads `/hiker-logo.png`. `public/manifest.json` declares that file at its
  real 512×512 now.
- Cutting it was a pixel job, not a guess: the sticker's interior is found by dropping the black frame
  (floodfill from a corner with `-fuzz 20%`), masking the dark ink against that alpha, then taking the tallest
  row band outside the picture frame as the mark and its column extent inside that band (the final geometry:
  bbox 218×226 at 150,84 → a 276×276 crop at 120,57, whose corners stay inside the sticker). A later logo change
  means redoing that measurement, not just resizing.
- The APK/EXE icons themselves are still built only on the GitHub runners (`android-apk.yml` /
  `windows-exe.yml`); only their source files changed here.

## The kata's posting row on the purchase screen (this branch)

- **`src/components/PurchaseKataEntry.jsx`** is the party kata's New entry row carried onto `/purchases`:
  supplier picker, description, amount, the Jamma / Banam picker (a supplier opens on Banam — money paid) and
  Post, with the same inline validation messages as `PartyDetailView`. It calls
  `postPayment({ account_type: 'supplier', … })`, so `post_payment()` still decides the direction and writes the
  single roznamcha entry: **it writes no purchase and moves no stock**, and the New purchase form is untouched.
- Verified in the preview (Supabase, mobile, pane unlocked): the row renders with both comboboxes; posting with
  nothing chosen raises "Choose the supplier this entry belongs to"; the side picker moves the hint both ways
  ("He paid you back — credited…" / "You paid him — debited…"); posting Rs 1 Banam against Hasan answered the
  toast, cleared the row, and the entry showed in his kata (balance −Rs 1, "Advance paid ahead").
- **Cleaning a test posting:** a posted payment cannot be deleted through the app (reversals only), so remove it
  through the REST API by exact id — the `payments` row, the `roznamcha` row it wrote (`payments.roznamcha_id`)
  **and** the `payment_posted` row in `audit_logs` (`entity_id` = the payment id). Done that way here; the
  supplier has no payments again. Note `payments` has no `description`/`account_name` column (use `notes` /
  `party_id`).

## The party pages wear the kata button's face (this branch)

- `PartyDetailView` (customer/supplier kata page) and `LabourDetail`'s hero used the orange
  `bg-gradient-to-br from-brand …` panel; both now use the same `.kata-card` face as `KataCard`, with
  `relative z-[1]` on their content — the face's lattice (`::before`) and sheen (`::after`) are absolutely
  positioned pseudo-elements that would otherwise paint over the text. The labour card's status pill was
  re-tinted for the dark face (`emerald-200/15` on active, `white/10` otherwise) because `StatusPill`'s light
  tones are not legible on it.
- **"Received" now leads the card.** The detail card's first figure is what has already moved on the account
  (Received / Paid), the billed figure (Invoiced / Purchased) follows, Documents stays third.
- Verified in the preview (mobile): customer hero `rgb(26,11,46)` with white ink, classes `kata-card p-5`, cells
  `["Received","Invoiced","Documents"]`; the labour hero the same face with its ACTIVE pill; the new mark loads
  in the sidebar (naturalWidth 512) and on the list cards; no console errors and no failed requests.

## The daily Roznamcha close and its history (0015, this branch)

- **A day is closed in the database, not on the screen.** `0015_roznamcha_day_history.sql` (applied) adds
  `public.roznamcha_days` (one row per closed day: `close_date` UNIQUE, `opening_balance`, `total_in` = Jamma,
  `total_out` = Banam, `remaining`, `entry_count`, a `details` jsonb snapshot of the day's entries, who closed it)
  and `public.roznamcha.day_id` (the closed day an entry was archived into; NULL = still open). The only writer is
  `public.close_roznamcha_day(p_payload jsonb)` — SECURITY DEFINER, requires `roznamcha:edit`, reads the balance the
  previous close carried out (or `settings.opening_cash` on the first day), totals the open entries, writes the day
  row, stamps those entries, and logs `roznamcha_day_closed`. The browser never computes a balance that gets stored.
- **Nothing is deleted and nothing is archived twice.** The close only stamps rows with `day_id IS NULL`, refuses a
  `close_date` that already exists (the unique index is the real guard, and the SQL test confirmed a second call
  answers `already_closed`), and refuses when nothing is open. It sweeps `entry_date <= close_date`, so a backdated
  entry is carried into the next close instead of being stranded on the live screen forever.
- **The carry-forward is the whole point.** The live screen's opening is the *last* close's `remaining`
  (`latestRoznamchaDay()`), falling back to `settings.opening_cash` before the first close — so after a close the
  Roznamcha shows the remaining alone and keeps working from it (`Opening Rs 87,000 + IN Rs 0 − OUT Rs 0`).
- **Reads are split on purpose.** The live screen calls `listRoznamcha({ unarchived: true })` (`unarchived` adds
  `.is('day_id', null)`); `cashTotals()`, Kharcha and every report keep reading **all** rows, so an expense or a
  receipt does not vanish from them once its day is closed. Do not make `unarchived` the default.
- **Files.** `src/lib/roznamchaDays.js` (days, a day's entries, the close call), `src/components/roznamcha/`
  (`roznamchaColumns.jsx` — the entry columns and the manual-source rule, now shared by both screens so a closed day
  reads like the day did; `CloseDayButton.jsx` — button + confirmation + toast, used by both screens;
  `DayHistoryDialog.jsx` — one day's figures and its entries), `src/pages/RoznamchaHistory.jsx` at
  `/roznamcha/history` (module `roznamcha`), reached from the **History** button beside Record payment / New entry.
  `Roznamcha.jsx` lost its local `SOURCE_LABELS`/`MANUAL_SOURCES` to the shared module — keep them there.
- **Two traps.** `DayHistoryDialog` loads the day's entries *after* it opens, so a check taken right after the click
  reads `0 in · 0 out` and "Loading records…"; poll for the entry rows before asserting. And on mobile every
  DataTable row is in the DOM twice (a hidden desktop copy), so count rows with `offsetParent !== null`.
- **Verification status (2026-10-12).** The close itself was exercised in SQL as the signed-in administrator inside a
  transaction that was **rolled back** — 11 live entries (in 90,000 / out 3,000, settings opening NULL → 0) produced
  `remaining 87000`, stamped exactly those 11 rows, snapshotted 11 details, and the second call answered
  `already_closed`; after `rollback` the table was empty and all 11 entries were live again. In the preview the
  loaded day was then **closed for real from the user's own pane** (not by the agent), and the screens read it back:
  history shows the day (`Rs 90,000` Jamma / `Rs 3,000` Banam / `Rs 87,000` remaining / 11 entries, CARRIED FORWARD
  `Rs 87,000`), its dialog lists all 11 entries with their descriptions and Jamma/Banam amounts, and the live cash
  book shows IN 0 / OUT 0 / `Opening Rs 87,000`. `public.roznamcha_days` therefore **has one real row (2026-10-12)
  and the live book carries Rs 87,000** — that is the feature working, not test data; do not delete it.
  **Not verified:** clicking the confirmation's own "Close the day" action button from the preview (the Radix
  alert-dialog button does not accept the automated click, the long-standing limitation here) — the close was driven
  by the user, and the same path is proven by the SQL test.

## The New day button, entry times, and the posting rows that were removed (this branch)

- **"New day" replaces "Close day" on the cash book.** `src/components/roznamcha/CloseDayButton.jsx` is now
  `NewDayButton.jsx` (CalendarPlus icon, label "New day", confirmation "Start a new day?" → "Start new day"), and it
  makes the **same** database call — `close_roznamcha_day()` — from both `/roznamcha` and `/roznamcha/history`. The
  press closes the open day into History and carries the remaining forward as the new day's opening; the toast names
  the day and the exact closing time. The function still refuses a date that is already closed, so a second press on
  the same calendar date answers "The day … is already closed" — the database's rule, not a screen fault.
- **The press first says how far the day has run.** A day is 24 hours long, counted from the previous close's own
  `closed_at`, so `NewDayButton` takes `lastClosedDay` (the latest `roznamcha_days` row — `closedDay` on the cash book,
  `latest` on the history screen) and `dayElapsed()` / `DAY_LENGTH_HOURS` in `src/lib/roznamchaDays.js`, read **at the
  moment of the press**. Under 24 hours the dialog opens on a warning step ("This day has not completed 24 hours" —
  how long it has run, the day it began and the exact time — Cancel / Continue) and Continue moves the *same* dialog
  to the confirmation; a day that has completed its 24 hours goes straight to the confirmation, and so does the press
  before the first close, where no boundary exists to measure against. `formatAppDuration()` in `datetime.js` prints
  the span. Cancel still closes nothing.
- **Checking that flow:** wait for the page's own load (`Carried from …` hint on `/roznamcha`, the CARRIED FORWARD
  card on the history screen) before pressing New day — a press within the first few hundred ms reads a still-null
  `lastClosedDay` and answers the confirmation, which looks exactly like the warning being skipped. Verified in the
  preview both ways (2 minutes into a real day → warning → Continue → confirmation; a throwaway `roznamcha_days` row
  dated 25 hours earlier, created and removed again, → confirmation alone) on `/roznamcha` and `/roznamcha/history`,
  no console errors.

## Kharcha keeps the cash book's day (this branch)

- **One day boundary for both screens.** An expense is a `roznamcha` row of source `kharcha`, so it belongs to the open
  day until the day is closed: `/kharcha` now reads `{ source: 'kharcha', day_id: null }` (through `db.Roznamcha.filter`
  in `src/pages/Kharcha.jsx`) and shows the open day's expenses under the same `DayBanner`, with a **History** button and
  the same `NewDayButton`. Closing from either screen calls the one `close_roznamcha_day()`, and both screens start the
  new day at zero. There is no second day table and no second close path: the link **is** the shared `day_id`.
- **`/kharcha/history`** (`src/pages/KharchaHistory.jsx`, module `kharcha` — `kharcha` is an alias of `roznamcha` in
  `permissions.js`, so the same grants cover it) lists the closed days the cash book keeps, each with the day's kharcha
  and its entry count. Both figures are summed **from the day's own entries**, read in one grouped query
  (`listArchivedRoznamcha({ source: 'kharcha' })`), so a corrected expense moves the figure with it; the day row's own
  close snapshot is never rewritten. "Day's OUT" prints the day row's own Banam for context.
- **A closed day's expenses can be corrected** (`src/components/kharcha/KharchaDayDialog.jsx`): its rows carry the same
  view / edit / delete controls as the live screen, editing through `ExpenseForm` and removing through
  `softDelete('Roznamcha', …)` to the Recycle Bin. `listRoznamchaDayEntries()` therefore **excludes soft-deleted rows**
  — that filter is what takes a removed expense off the day (it applies to the Roznamcha history dialog too). The day
  row's `remaining` / carry-forward is deliberately **not** recomputed: the close is a snapshot, so an edit to a closed
  day's total leaves the carried balance as the day was closed — the one figure to keep in mind.
- **Supabase-only, like the day itself.** The `day_id` filter, `latestRoznamchaDay()` and the history page all go
  through the Supabase client, exactly as Roznamcha's day feature already does; the shipped Base44 builds keep their
  old code.
- **Verified in the preview** (Supabase, the user's replayed session): `/kharcha` opened on the closed day empty with
  the closed-day empty hint and New day / History present; an expense recorded through the dialog appeared at once
  (Rs 500 → TOTAL SPEND Rs 2,500); once it belonged to a closed day it left the open list (TOTAL SPEND back to the other
  row's Rs 2,000) and the history read `Rs 500 · 1` for Tuesday 13 Oct; the day's own page listed it with view / edit /
  delete, the edit moved it to Rs 750 on the day's page **and** in the history row, and the delete (the Radix action
  button needed a ~1 s settle pause before it accepted the click) left the day empty — `Rs 0 · 0`, "No expense was
  recorded on this day", with a "Moved to Recycle Bin" toast. No console errors. The agent's test expense was created
  and removed again; the user's own `Petrol` expense (open day) and both closed days are untouched.
- **The record carries day, date and time.** `src/components/roznamcha/DayBanner.jsx` (new) sits under the page
  header and ticks once a second: "DAY · DATE — Tuesday, 13 Oct 2026" beside "TIME NOW — 05:11:13 am ·
  Asia/Karachi". `datetime.js` gained `formatAppDayDate()` ("Tuesday, 13 Oct 2026"); the history list's column is
  now "Day · closed at" (day+date over `closed_at`'s exact time) and `DayHistoryDialog`'s title and meta line spell
  the same out ("closed Tuesday, 13 Oct 2026 at 04:48:46 am by …").
- **Every entry row prints the date and the exact time it was written.** The shared `entryColumns`
  (`roznamchaColumns.jsx`) render `entry_date` over `formatAppTime(created_date)` — live screen and closed-day dialog
  alike, so a day's book reads in the order it happened. Nothing new is stored: the row's own timestamp is shown.
- **The inline kata posting row is gone from `/purchases`, the customer/supplier kata pages and the labour page.**
  `src/components/PurchaseKataEntry.jsx` was **deleted** and its block removed from `Purchases.jsx`;
  `PartyDetailView.jsx` lost its "New entry · choose Jamma (credited) or Banam (debited)" row, its `entry`/`posting`
  state and its `postPayment()` call, plus the imports that only that row used (Input/Select, postPayment,
  newIdempotencyKey, TRANSACTION_TYPES, defaultSideFor, sideHint). Money is posted from the payment dialog behind
  **Receive payment** / **Pay supplier** / **Pay labour** — `post_payment()` is untouched, and the labour page never
  had such a row. The section above ("The kata's posting row on the purchase screen") describes code that no longer
  exists; `defaultSideFor()` still opens that dialog on the account's usual side.
- **Verified in the preview** (Supabase, the user's replayed session): the banner read `DAY · DATE | Tuesday, 13 Oct
  2026 | TIME NOW | 05:11:13 am | Asia/Karachi` with its seconds ticking between two reads; the live IN table's row
  showed `2026-10-13 / 05:10 am`; "New day" opened its confirmation with the new copy and Cancel closed it again
  (the day was deliberately **not** confirmed, so the user's own open day is untouched); `/roznamcha/history` read
  `Monday, 12 Oct 2026 / 04:48:46 am` and its dialog "closed Tuesday, 13 Oct 2026 at 04:48:46 am by
  hikerplusshoes@gmail.com" with 11 entries each dated and timed; `/purchases` had no "New supplier entry" row and no
  Post button; `/customers/<id>` had no posting row, no Jamma/Banam picker, the kata table still reading and Receive
  payment visible; `/labour/<id>` kept Pay labour and had no Post button. No console errors, no failed requests,
  `npm run lint` clean. **Not verified:** the confirmation's own "Start new day" click (the Radix alert-dialog button
  resists the automated click, as before) — the close path itself is the one proven by the 2026-10-12 SQL test, and
  the label and copy are the only things that changed.

## Profit and Zakat (0016, this branch)

- **Two new modules read the books; neither is a new ledger.** `0016_profit_and_zakat.sql` (**applied**) adds
  `profit_periods`, `zakat_years` and the functions that fill them, plus `settings.zakat_start_date`. Neither the
  profit figures nor the zakat wealth are computed in the browser: `profit_period_totals(from, to)` and
  `zakat_year_totals(as_of)` are the single place each arithmetic lives, and the live screen and the saved row both
  call them — screens over `src/lib/profit.js` / `src/lib/zakat.js`, pages `Profit.jsx`, `ProfitHistory.jsx`,
  `Zakat.jsx`, `ZakatHistory.jsx` at `/profit`, `/profit/history`, `/zakat`, `/zakat/history`. Saving goes through
  `close_profit_period()` / `close_zakat_year()`, which recompute server-side, refuse a range or cycle that is
  already saved and log it; `mark_zakat_paid()` writes only the paid date and amount. RLS on both tables is
  select-only for their module — the functions are the only writers, exactly as with `roznamcha_days`.
- **Profit is revenue − cost of sales − labour − expenses + other income**: invoices billed, purchases made,
  `labour_earnings` for the period (the accrual, not only what was paid out), the `source = 'kharcha'` side of the
  roznamcha, and its `other_income` side. Zakat counts cash in hand (`settings.opening_cash` + money in − money out
  up to the cycle's end), receivables (customers' opening balances + invoices billed + money paid *out* to them −
  receipts), stock at cost (raw stock's `amount` + ready shoes at their matching article's `unit_cost`), less
  payables on the same rule from the supplier side, floored at zero, at 2.5%. Stock has no movement history, so it
  is read as it stands today whatever date is asked for.
- **The zakat year is the twelve months from `settings.zakat_start_date`'s latest anniversary** (`zakatCycle()` in
  `src/lib/zakat.js`; the date is set on `/settings`). That needs a `public.settings` **row**: the table was empty
  on this branch, so the Zakat screen rightly showed "NOT SET YET" until Settings was saved once. A future start
  date simply makes the current cycle the one beginning then.
- **New permission modules `profit` and `zakat`** (`permissions.js`; sidebar group "Profit & Zakat"; the Accounts
  department preset now grants both at full access). The RPCs check `profit:view`/`profit:edit` and
  `zakat:view`/`zakat:edit` themselves, so an account without the grant gets the function's own error message rather
  than a bare empty screen. `databaseCenter.js` gained `profit_periods`, `zakat_years` **and** the previously missing
  `roznamcha_days`.
- **Trap: a dialog opened from inside a clickable table row leaks its clicks into the row.** `DataTable`'s
  `onRowClick` opens a record's detail, and `ZakatHistory` carries its "Mark paid" confirm in the row's action cell.
  Radix renders that dialog in a portal, but React still propagates its events up the **React** tree — so pressing
  the confirm also fired the row's `onClick` and opened the year's detail behind it. The guard is on the action cell
  (`<div onClick={event => event.stopPropagation()}>` around `RowActions`), with `MarkPaidButton`'s own trigger
  stopping it too. Any future dialog hung inside a row needs the same guard; `RowActions`' own buttons already do it.
- **Verified in the preview** (Supabase, the user's replayed session): `/profit` read revenue Rs 720,000 / cost
  Rs 0 / expenses Rs 2,000 / net Rs 718,000 for 2026-10-01 → 2026-10-13, and `/zakat` read cash Rs 105,000 +
  receivables Rs 744,000 + stock Rs 1,432,000 − payables Rs 2,000 = Rs 2,279,000, due Rs 56,975 — both exactly the
  figures the same functions return in SQL. The sidebar group renders, all four routes load (no Page-Not-Found),
  both histories show their empty states and their saved rows afterwards, "Save period" and "Save year" each wrote
  their row (Rs 718,000 / Rs 56,975, read back from the tables), "Mark paid" recorded the payment and the row then
  read "Paid 2026-10-13", and the confirm no longer opens the row's detail while the row's own eye still does. No
  console errors, `npm run lint` clean. **Everything this created was removed again** — both saved rows, their audit
  rows and the settings row; the books themselves were never written to.
  **Not automatically verified:** *typing* into the Settings date field. The harness's fill stored a date different
  from the one it was handed (it typed 2026-01-01, the row held 2027-01-01) while the value the field showed, the
  stored value and the cycle the Zakat screen then counted all agreed — so the app's input → row → cycle chain is
  consistent and the keystroke mapping into a native date input is what is suspect. Set that date by hand once;
  nothing else about it is in doubt. Also: in the preview the two alert-dialog action buttons must be clicked by
  **element** — `click('[role="alertdialog"] button.bg-primary')` silently misses, while passing the button node
  (query the dialog's buttons and click the last one) works.

## Hover glow, the Kharcha "Zakat" category, and 0017 (this branch)

- **Pointer feedback lives in one place: the end of `src/index.css`.** It sits outside Tailwind's layers on purpose,
  so it wins over the `transition-colors` / `shadow-*` utilities a component already carries without an `!important`.
  A grey-black drop shadow plus a neon edge — a new `--glow` token in `:root` and `.dark` — lands on
  `button:not(:disabled)`, `[role="menuitem"]`, `[role="option"]`, `[role="tab"]`, `nav a`, `a.group` (the dashboard
  module tiles) and `[data-record-id]`, the attribute `DataTable` and `KataCard` both already carry — so every
  ledger row and every party card takes the same edge, on hover and on press. Rows glow **inwards** (`inset`):
  their list is `overflow-hidden`, so an outer glow would be clipped. A new menu or button style should reuse one of
  those hooks rather than invent a class.
- **The hover/press state itself cannot be driven from the preview.** `window.__base44_preview` has no hover helper
  (its keys are `navigate/navigateAndConfirm/click/dragAndDrop/fill/waitFor/inspect/domSnapshot/reactState/
  getNetworkRequests/consoleLogs/screenshot/setViewport`), and a synthetic click does **not** set CSS `:hover` —
  `element.matches(':hover')` stays false and the computed `box-shadow` reads `none`. Only the static half is
  checkable: that both rules are in the live stylesheet and that real elements match their selectors. The look
  needs the user's own eye (or a Playwright `hover()` the harness does not expose).
- **Kharcha offers "Zakat" as a category** (`DEFAULT_CATEGORIES` in `src/components/forms/ExpenseForm.jsx`). It is an
  ordinary kharcha row (`source = 'kharcha'`, direction `out`) — it leaves the cash book like any other expense —
  but the Zakat screen reads those rows back.
- **0017 is applied** (`supabase/migrations/0017_zakat_paid_out.sql`): `zakat_years.zakat_paid`,
  `zakat_year_totals()` also returning `zakat_paid` + `zakat_remaining`, and `close_zakat_year()` storing the
  paid-out figure. `/zakat` gained two KPI cards (Zakat paid out · Zakat still to pay) and a
  due → paid → still-to-pay block; `/zakat/history` gained a "Paid out" column. **The rule is the user's:** the
  zakat already given comes off what is still to pay, while the wealth itself is left as the books read it (the
  payment also leaves the cash book, as every kharcha does, so the due moves slightly too). If they meant the
  subtraction somewhere else, `zakat_year_totals()` is the single place to change.
- **Verified:** the arithmetic in SQL, as the signed-in administrator, inside a transaction that was **rolled
  back** — with a Rs 500 Zakat kharcha row `zakat_paid` read 500 and `zakat_remaining` 56462.50 against a due of
  56962.50, and the table was clean after the rollback. `npm run lint` and `npm run build` are clean, and both new
  CSS rules are present in the live stylesheet.
- **Now verified in the preview** (Supabase, the user's replayed session, mobile + desktop). The Category combobox on
  the expense form lists `Wages · Utilities · Transport · Rent · Maintenance · Packing · Zakat · Misc · New category`
  with the current one ticked; an expense filed under Zakat saved and read back as `Category Zakat`; `/zakat` (with a
  start date saved first) showed **Zakat paid out Rs 500**, **Zakat still to pay Rs 56,462.5** against a due of
  **Rs 56,962.5**, and the "how this year adds up" block read due → `− Rs 500` → still to pay, the arithmetic holding
  exactly; "Save year" kept the cycle and `/zakat/history`'s **Paid out** column read **Rs 500** on the saved row,
  with the "Zakat still to pay" panel above it. No console errors, no sideways scroll at 360px. The two new CSS rules
  are in the live stylesheet and their base selectors match real elements — **the hover look itself still needs the
  user's own eye**, since the harness has no hover and a synthetic click never sets `:hover`.
- **Trap: the automated `click()` does not open a Radix `Select`.** `SelectTrigger` opens on **pointerdown**, and the
  harness's React-friendly click on `{role: 'combobox'}` leaves the list closed — the option click then silently
  matches nothing and the field keeps its old value (a "Zakat" expense was saved as `Misc` that way). Dispatch
  `pointerdown` (with `pointerType: 'mouse'`) on the trigger, then `pointermove` → `pointerdown` → `pointerup` on the
  option; both were recorded as `aria-expanded` / option-count assertions after the fact.
- Remember that `public.settings` has **0 rows** on this branch, so `/zakat` reads "NOT SET YET" until the zakat
  start date is saved in Settings once — only then do the figures appear. Everything the probe created for these
  checks (the Rs 500 Zakat expense, the temporary settings row and the saved year row with its audit entry) was
  removed again by exact id; the open day holds only the user's own `Petrol` row and `public.settings` is back to
  0 rows.

## Production stages: Lasting → Machine → Finishing (0018, this branch)

- **The shop-floor chain is the Labour module's own categories, numbered.** `0018_production_stages.sql`
  (**applied**) adds `labour_categories.stage_no` — 1 Upper / Last Process (Lasting), 2 Machine / Sole,
  3 Finishing — and one SECURITY DEFINER function, `post_production_stage(jsonb)`, which is the only writer of a
  stage entry. A category an administrator adds on the Labour screen keeps `stage_no` NULL and is simply not part
  of the chain. Rollback: `0018_production_stages.rollback.sql`.
- **One stage entry = the work AND its wage, in one transaction.** The function writes the `labour_production` row
  (pairs received = pairs completed) and the matching `labour_earnings` row at the rate in force on that date; the
  rate the dialog showed is upserted into `labour_rates` for that stage/date first, so "each stage records his own
  rate" holds on the books too. Stage 3 additionally calls `save_ready_stock()` — the finished batch enters Ready
  Shoes with the same article, carton size, cartons and pairs. If that write fails (no `ready_shoes:add`) the whole
  entry rolls back, so nothing is ever half-saved.
- **Nothing goes into the roznamcha at stage time** — that is the user's rule. The pairs live in the production
  records and the wage is a liability; the only money that moves is the OUT entry `post_payment()` writes when the
  labour is actually paid, which the stage table's **Pay labour** button posts through the ordinary payment dialog.
- **A stage save is never mistaken for a duplicate.** A blank reference would collide with
  `labour_production_duplicate_idx` (same labour + stage + article + date + ''), so a reference the user left empty
  becomes `STG<stage>-<YYMMDD>-<n>`. A genuine retry is still caught by the idempotency key.
- **Files.** `src/lib/productionStages.js` (the stage list, the RPC, and `stageBoard()` — the stage cards and the
  entry table read the same rows, so the two can never disagree), `src/components/production/ProductionStages.jsx`
  (three stage cards + the entries table + Pay labour), `src/components/production/StageEntryDialog.jsx` (one stage,
  one labour, his details, his rate for that stage). `src/pages/Production.jsx` gained one import and one element;
  the existing "New production" (uppers → cartons) form is untouched.
- **Driving the labour dropdown needs the real gesture:** the harness's `click()` does **not** open a Radix
  `Select`. `focus()` plus a `keydown` `ArrowDown` on the trigger, then `pointermove`/`pointerup` on the option,
  selects it; without that the save only shows the inline "Choose the labour who did this stage" and writes
  nothing.
- **Verified in the preview** (Supabase, the user's replayed session, 360px): the three stage cards and the entries
  table render; a Lasting entry (Sami, 1,200 pairs @ Rs 12) answered "Stage 1 · Lasting saved — 1,200 prs × Rs 12 =
  Rs 14,400 for Sami", the Lasting card read `1,200 prs · Wage Rs 14,400`, and Sami's kata showed `+Rs 14,400`; a
  Finishing entry (50 × 24-pair cartons = 1,200 pairs @ Rs 6) answered "… added to Ready Shoes", the card read
  `1,200 prs · Wage Rs 7,200` and the kata added `+Rs 7,200` (earned Rs 21,600) — no console errors, no failed
  requests. **Not verified:** the Ready Shoes *screen* — the hand-off is evidenced by that toast and by the
  `ready_shoes` row the function wrote (read back in SQL), not by opening `/ready-shoes`.
- **Trap, learned the hard way:** every row the test created (2 production, 2 earnings, the 2 rates it recorded, the
  `ready_shoes` row, the throwaway `TT-STAGE` article and their audit rows) was removed by exact id — but the first
  cleanup also deleted Sami's **pre-existing** Machine/Sole rate because its `created_date > now() - interval '3
  hours'` window was too wide, and it had to be restored with its original id and timestamp. Clean up test data by
  the exact ids the run produced, never by a time window.

## Stage-wise labour in the stage entry dialog (this branch)

- **A stage asks for its own men.** `StageEntryDialog` (the Production screen's stage entry) reads the stage's
  labour category back into the labour list: stage 1 lists only the men linked to the Stage 1 category
  (Upper / Last Process), stage 2 only Machine / Sole, stage 3 only Finishing. The link is each labour's
  `labour_category_links` row, which `listLabourAccounts()` already returns as `category_ids`. The **first of that
  stage's men is selected for you** when the dialog opens, so his details card, his recorded rate for that stage
  and the wage come up without a pick; changing the dropdown still clears the rate, exactly as before.
- **A stage with nobody assigned falls back to every active labour**, hinting "No labour is assigned to this stage
  yet — every active labour is listed", so a missing assignment never blocks an entry. That is **stage 3's state
  today**: no labour carries the Finishing category (only Upper / Last Process and Machine / Sole are linked), so
  the finishing dialog lists both men rather than one. Assign a labour to Finishing on the Labour screen to make it
  stage 3's own list. The entry path itself is untouched — `post_production_stage()` never required the labour to
  belong to the stage's category.
- The field now names the stage (`Labour (Lasting)`) with the matching hint ("Chosen from the Lasting labour").
- **Verified in the preview** (Supabase, the user's replayed session, desktop): stage 1 opened with
  `Hahahdb · Upper / Last Process` already in the field, its details card and the hint, and its dropdown held that
  one option; stage 2 opened on `Sami · Machine / Sole` with his card, `Rate / pair` prefilled `10` ("His recorded
  rate: Rs 10") and one option; stage 3 opened on the placeholder with the fallback hint and listed both men. All
  three dialogs carried the right title and Cancel closed them. The only console entries were the browser's benign
  `ResizeObserver loop completed with undelivered notifications`. Nothing was saved — no test data was created.
- **Reading a Radix Select's resting value needs a settle pause:** a read taken the instant the dialog becomes
  visible catches the still-empty trigger ("Choose labour"); ~1 s later it shows the selected item. And as
  everywhere else here, `click()` does not open the list — dispatch `pointerdown` on the trigger.

## The article on the stage chain, and linking a labour to a stage (this branch)

- **The batch is chosen once, in stage 1.** `StageEntryDialog` now takes stage 1's article from the **raw upper
  stock** — `analytics.uppersArticlePosition()`, the same figures the Uppers page shows — as a dropdown whose
  options read `H1 · 3,800 prs left`, with the field's hint printing the total (`Upper stock: 4,200 prs across 2
  article(s)`). The first article of that list is selected for you, so only a batch for another article needs a
  pick. With no upper stock the field says so and the save stops with "Choose the article from upper stock".
- **Stages 2 and 3 cannot change the article.** Their Article field is a read-only input carrying the article of the
  **previous stage's newest entry** — `ProductionStages` reads it out of the board it already loads (`stage_no <
  this stage`, the immediately-previous stage first, falling back to any earlier one) and hands it to the dialog as
  `previousArticle`. Nothing has reached the stage yet → "Waiting for the previous stage to record this batch" and
  the save stops with its own message. The article is still sent to `post_production_stage()` (which requires it),
  so the chain is recorded against the article that entered it; nothing about the function changed.
- **A labour can be linked to the stage from the dialog itself.** When the man showing in the Labour field does not
  belong to that stage's category, a `Link <name> to <Stage>` button appears under the dropdown —
  `linkLabourToCategory()` (`src/lib/labour.js`) upserts one `labour_category_links` row (the pair is the table's
  primary key, so a repeat is a no-op) and the dialog remembers it locally, so the stage's own list (and its
  auto-selection) picks him up from the next open. This is the one-click way to give Finishing its man; the Labour
  screen's stage toggles still work and are unchanged.
- **Stage 3's fallback is unchanged:** with nobody linked to Finishing the dialog still opens on the placeholder
  with "No labour is assigned to this stage yet — every active labour is listed" and lists every active labour, so
  pick a man and press the link button to make the stage his.
- **Verified in the preview** (Supabase, the user's replayed session): stage 1 opened on `H1 · 3,800 prs left` with
  `Upper stock: 4,200 prs across 2 article(s)` and both articles listed with their remaining pairs; with a
  temporary stage-1 entry for `H1` in place, stage 2 and stage 3 both showed `H1` in a read-only article field with
  "Carried from the previous stage — not editable here"; picking a man in stage 3 raised `Link Hahahdb to
  Finishing`, the press removed the button, and the next open of stage 3 read
  `Hahahdb · Upper / Last Process, Finishing` with "Chosen from the Finishing labour". No console errors.
  **Everything the check created was removed again** (the temporary `labour_production` row and the
  `labour_category_links` row, both by exact id), so no labour is linked to Finishing today and the stage-3 fallback
  is what the user will see until they press the button.
- **Trap, hit here:** after editing `ProductionStages.jsx` in several passes the Vite dev server served a module
  holding the new `previousArticle` memo but the **old** JSX (no prop passed), so stages 2–3 read empty. The served
  source is the thing to check — `curl -s http://localhost:3000/src/components/production/ProductionStages.jsx`
  must show `previousArticle,` among the dialog's props — and `docker compose -f docker-compose.base44.yml restart
  web` clears it. A stale module is not a code fault.

## Ready shoe grades: A / B / A Mix on the stage entry, the shelves and the invoice (0020, this branch)

- **The finished batch is graded.** `0020_ready_shoe_grades.sql` (**applied**) adds the grade categories
  (`ready_shoe_grades`, seeded **A** complete/no fault, **B** faulty, **A Mix** a little fault — manageable on the
  Ready Shoes screen), `ready_shoes.grade` (default `'A'`, so the batches already on the shelves read as good,
  ungraded stock), `invoice_lines.grade`, and `labour_production.grade_lines` (the entry's graded rows,
  `[{"grade","cartons","pairs"}]`). Rollback: `0020_ready_shoe_grades.rollback.sql`.
- **Every stage records its work grade by grade.** `StageEntryDialog` carries one row per grade (grade + cartons +
  pairs, opening on the three shipped grades at zero) with a **+ Add row** button, and a row left at zero is simply
  not part of the entry. The entry's `pairs_received` — and therefore the wage — is the rows' sum: the totals are the
  same, only the breakdown is new. A row that gives cartons but no pairs is counted cartons × carton size (the
  finishing stage's own rule) in the dialog and in `post_production_stage()` alike, so the wage shown is the wage
  recorded.
- **Stage 3 hands each grade to Ready Shoes as its own batch**, through the existing `save_ready_stock()` (now
  carrying `grade`), so the stock is held grade by grade. A payload without `lines` behaves exactly as before — one
  batch, grade A. The stage entry table gained a **Grades** column showing the recorded rows.
- **Ready Shoes** shows the grade on every batch and a **Grade-wise ready stock** row of raw-menu style
  cards (`src/components/ready/ReadyGradeCard.jsx`, replacing the table that was there): each grade carries its
  own cartons / pairs added / pairs sold / available and, inside the same card, the articles standing under
  that grade, article by article. `analytics.readyStockByGrade()` therefore reads a grade **and** its article
  in one aggregate (`groupBy: ["grade", "article_code"]` — see `entities.aggregate`, which accepts an array of
  fields and joins them into a NUL-separated key) and returns each grade with its `articles` breakdown; the
  grade totals are unchanged, only the breakdown is new. The **Grades** button opens
  `src/components/ready/ReadyGradesDialog.jsx` to add a grade. `articleStockMap()` is deliberately untouched, so the
  article-wise table, the dashboard alerts and the invoice's stock check keep their article-level arithmetic. Manual
  cartons (`ReadyShoeForm`) pick a grade too.
- **The invoice line has its grade dropdown** (`InvoiceLines`, backed by `src/lib/readyGrades.js`), stored on the
  line by `create_invoice()`. The ready-stock check is still per article — a grade is a label on the sale, not a
  second ledger. **Superseded below: the line now reads its grades and its carton size off the shelf.**
- **Verified in SQL** (as the signed-in administrator, inside a transaction that was **rolled back**): a stage-3
  entry with rows A 12/288, B 2/48 and A Mix 0 produced `pairs 336`, `amount 1680` (336 × Rs 5), `grade_lines` with
  the two non-zero rows and **two** `ready_shoes` batches (A 12/288, B 2/48); an invoice with a grade-B line stored
  `B` on `invoice_lines`. `npm run lint` and `npm run build` are clean.
- **Verified in the preview** (Supabase, the user's replayed session, 360px): `/ready-shoes` renders the **Grade**
  column on every batch and the **Grade-wise ready stock** table (`A · 244 / 2,928 sold 360 / 2,568 · IN STOCK`) with
  the **Grades** button; `/production` shows the three stage cards each with its `Add <Stage> entry` button and the
  entry table's **Grades** column; the Stage 1 dialog opens on the three graded rows labelled **A / B / A Mix** (each
  with Cartons and Pairs); `/invoices/new` carries the line's grade dropdown and its summary (`Grade A · …`). No
  console errors, no failed requests, no sideways scroll at 360px.
- **Fixed here:** `DataTable` keyed every row by `row.id`, but a computed row has none (the grade-wise and
  article-wise ready-stock aggregates), so `/ready-shoes` logged React's duplicate-key warning against `DataTable`.
  Rows now fall back to their natural label (`rowKey` in `src/components/DataTable.jsx`). `npm run lint` clean.
- **Not re-driven this check:** a graded stage-3 *save* through the UI — the write path itself (graded rows → wage →
  per-grade ready batches) is the SQL check above; the screens were inspected, not written to, so no test data was
  created.
- **Trap, hit here:** after adding `analytics.readyStockByGrade()` the Vite dev server kept serving the **old**
  `analytics.js` (a blank app: `does not provide an export named 'readyStockByGrade'`) while the source on disk was
  correct; `docker compose -f docker-compose.base44.yml restart web` cleared it — the same stale-module trap as
  `labour.js`.

## The sign-in showroom (this branch)

- **Only `/login` was rebuilt.** `src/pages/Login.jsx` renders the new shell itself; `AuthLayout` is untouched and
  still wraps every other auth screen (register, forgot/reset password, the PIN pages, OAuth consent), so the PIN
  sequence and those pages look and behave exactly as before. The fields, `signInWithPassword`, `safeReturnTo()` and
  the redirect are unchanged — the deer and the shoe are told what happened, they never decide it.
- **The screen is themed on its own.** `src/lib/loginThemes.js` holds the four skins (Midnight Showroom, Luxury
  Cream, Modern Graphite, Clean Studio); `src/lib/useLoginTheme.js` reads/writes `hiker-login-theme` in
  localStorage; the shell puts the id in `data-theme` on `.login-theme` and the four token sets live at the **end of
  `src/index.css`**. Because the shadcn primitives on the card read those same tokens, one attribute repaints the
  screen — and because the block is unlayered it also beats the utility classes the primitives carry (the same
  trick the pointer-feedback block uses). `.dark`/`hiker-theme` is never touched: the app behind the PIN gate keeps
  the light/dark theme the user chose there, and switching a skin cannot reset the form, the session or any auth
  setting. The four sets are scoped to that root element only — do not "promote" them to `:root`.
- **The deer and the shoe are hand-authored inline SVG, not assets** (`src/components/auth/DeerSilhouette.jsx`,
  `ShoeSilhouette.jsx`): the repo holds no deer image and no shoe photography or mesh, and the brief rules out both
  a cartoon deer and a distorted product image. The deer is a single-ink silhouette whose head group the scene tilts
  (`.deer-head`, `data-mood="noticed"`); the shoe is low-top line art that turns `rotateY(360deg)` while a valid
  submission is in flight. Both are `aria-hidden` decoration inside `.showroom` (`pointer-events: none`), so they
  can never swallow a click or cover a control; the deer lives in the left half and its box was measured clear of
  the card at every breakpoint. Art is dropped below `lg` (`display: none`) and only the room light remains.
- **Google sign-in is gone completely.** Removed from `Login.jsx` and `Register.jsx`, `signInWithProvider` deleted
  from `src/lib/authApi.js`, `src/components/GoogleIcon.jsx` deleted. Nothing else referenced them.
- **The floating theme button** (`src/components/auth/LoginThemeButton.jsx`) steps to the **next** skin on every
  press and wraps around at the end of `LOGIN_THEMES` — there is no menu to open, read or dismiss. Its `aria-label`
  and `title` name the skin on screen and the one the press moves to. Its position, including
  `env(safe-area-inset-*)`, is `.login-theme-button`; the picker's own rules (`.login-theme-menu`, `.theme-swatch`)
  and the `login-menu-in` keyframe were deleted with it.
- **"Remember me" recalls the email address only** (`hiker-login-email`), never the password, and it has no say in
  how the session is kept. It is a convenience of the browser and is written only after a sign-in the backend
  actually accepted.
- **Verified in the preview** (Supabase, the user's replayed session, `npm run lint` + `npm run build` clean):
  `/login` renders the card with the real `/hiker-logo.png` (naturalWidth 512, proportions and transparency kept on
  a light plate), no Google control anywhere in the text; the picker lists all four themes with the current one
  checked, choosing one repaints the card (`rgb(33,35,38)` graphite vs `rgb(255,255,255)` cream) and closes the
  menu (0 items left), and **the typed email and password survive the switch**; an empty submit is blocked by the
  form itself (`validity.valueMissing`, no alert, still on `/login`); a deliberately wrong password shows
  `Invalid login credentials` in the form's own `role="alert"`, the button returns to "Log in" and the page stays on
  `/login`; the password eye toggles `password → text → password`; the shoe's `rotateY` was sampled mid-flight
  (`matrix3d(0.77,…)` at ~39°, `matrix3d(-0.33,…)` at ~109°) and the deer's head computed
  `matrix(0.956,-0.292,0.292,0.956,0,0)` = exactly `rotate(-17deg)` once its transition landed, with the body's own
  sway still running; no sideways scroll at 375/768/1280 and the card fits the height at each; on mobile and tablet
  the artwork is `display:none`, the theme button sits below the card (y 748 vs card bottom 642) and the picker
  stays inside the viewport (right edge 353 of 375). Only console entry and failed request were the expected
  `Email login failed` / token `400` from that wrong-password probe.
- **Restore on the next visit:** the platform replays the pane's storage on every fresh load, so the skin chosen in
  one call was already `aria-checked` on the next fresh `/login` — that, plus an unmount/remount inside one script,
  is what `readLoginTheme()` on mount was verified with. The **prefers-reduced-motion** rule was confirmed present
  in the live stylesheet but its behaviour was not emulated (`window.__base44_preview` has no media emulation);
  likewise **hover/press** feedback still needs the user's own eye.
- **Not automatically verified:** a successful sign-in and the PIN screen after it (no credentials exist for the
  agent), the mobile keyboard covering/clearing the theme button, and a phone in landscape (a 375-tall viewport
  scrolls the 552px card instead of clipping it — `min-height`, not `height`, on `.login-stage`, so nothing is cut
  off at the top).
- **Trap, hit here:** a DOM node captured from the Radix menu (`querySelectorAll(...)[2]`) is stale by the time the
  helper clicks it — the theme silently did not change and the menu stayed open, which then swallowed the next
  clicks. Pass a **structured locator** instead (`{ role: "menuitemradio", name: "Modern Graphite" }`), which
  resolves fresh at dispatch time. The first attempt also read the deer's head immediately after the alert appeared
  and saw an identity matrix: that is the 900ms transition at t=0, not a missing rule — give it a pause before
  asserting.

## The ten design themes on the sign-in screen (this branch)

- **The login screen has two families of skin now, not four skins.** `LOGIN_THEMES` in `src/lib/loginThemes.js`
  holds the original **Showroom** four (one room, four colourways, the deer and the shoe) and ten **Design**
  screens drawn from a set of login-page references: Blue Skyline and Bold Blue (split brand panel), Member Login,
  Forest Adventure, Sunset Ocean, Lake Sunrise, Synthwave Ridge, Smarttime, Cosmic Nebula and Night Forest. The
  list is walked one press of the floating button at a time (it used to open a bounded, scrolling panel listing both
  families; that picker is gone — see the section on the button and the picture backdrops below).
- **A design is data plus CSS, never another branch in the page.** Each entry carries `group`, `layout`, `card`,
  `fields`, `button` and `labels`; `Login.jsx` puts them on the shell as `data-layout` / `data-card` /
  `data-fields` / `data-button` / `data-labels` and picks the scene. So adding a skin means an entry in
  `loginThemes.js` plus a token set and, if it needs one, an art block — `src/pages/Login.jsx` needs no edit. The
  card (`<section className="showroom-card">`) and every part of the sign-in — `signInWithPassword`, the
  remember-me email, `safeReturnTo()`, the redirect, the error alert — are untouched, and the showroom family
  renders exactly as before (verified).
- **The artwork is drawn, not photographed — except the five picture skins**, where
  `src/components/auth/LoginPhoto.jsx` shows the image the entry's `photo` names instead.
  `src/components/auth/DesignScene.jsx` renders one `aria-hidden`,
  `pointer-events: none` layer set (sky, stars, nebula, orb, glow, clouds, ridges, mirrored ridges, pines, water,
  mist, lattice, the existing `DeerSilhouette`, a member avatar, the peeking character) and `data-art` on the root
  decides which are painted — the same "decorative, never decides anything" rule the showroom follows. The
  split screens carry theirs in `src/components/auth/LoginBrandPanel.jsx` instead: the deep blue half from `lg` up,
  a rounded band across the top below it, with the wordmark, the app's one-line description and a footer row, and
  the "Blue Skyline" wave divider cut in the page colour.
- **A light card on a dark page re-declares its ink on the card.** The tokens are HSL triples read by the shadcn
  primitives, so `--foreground` / `--muted-foreground` / `--brand` on `.showroom-card` are what keep the text
  inside a white glass card dark while the page's own line under it ("Don't have an account?") stays light. The
  same reason makes the floating picker's icon need a dark ink on those three themes.
- **Verified in the preview** (Supabase, the user's replayed session, 360px + 1280px): all ten apply from the
  picker with the right `data-*` variants, the right scene art (or the brand panel), the pill button
  (`border-radius: 999px`) and the underline field rule, no console errors, and **no sideways scroll at either
  width** (every theme, both widths). On the phone the two split screens stack — the blue band 375px wide above a
  card that starts at y 272 — and on desktop the panel is `position: absolute`, 614px of 1280 (48%), with the card
  in the right half. The heading's ink was measured against the painted card on every theme (lowest 4.26:1 on
  Member Login's frosted card, which is that reference's own light card; the rest 8.8–17.6:1), and the scene never
  sits over the card (`elementsFromPoint` at the card's centre). Midnight Showroom still renders its room, shoe and
  deer with no design scene or brand panel. `npm run lint` and `npm run build` are clean.
- **Deliberately not copied from the references:** the marketing nav bars ("Home / Service / Contact / Login") —
  dead links have no place on this app's sign-in — the "USERNAME / CREATE ACCOUNT / SHOW" wording (the real fields
  are Email, Password, remember me, forgot password, create one), and their `#5171a1`-style flat fills where a
  token reads better. The fields' own icons stay where the form puts them (left for email and password, right for
  the eye), so an underline treatment changes the rule, not the field.
- **The peeking character of Smarttime is hidden below `lg`** (`@media (max-width: 1023px)`): it is anchored to
  the centred card's own left edge, which a phone card does not have — the same choice the showroom makes when it
  drops its artwork on narrow screens.
- **Trap, hit here:** the harness's `waitFor` with a structured locator cost ~2.7s per call and timed the sweep
  out; a fixed short pause plus a fresh `querySelectorAll('[role="menuitemradio"]')` lookup (scrolled into view,
  clicked in the same tick) is what makes a fourteen-theme sweep fit. And as everywhere in this repo, after adding
  modules the `web` service was restarted — Vite otherwise keeps serving a stale module.

## The theme button steps to the next skin, and five backdrops are pictures (this branch)

- **One press, next skin — no picker.** `LoginThemeButton` walks `LOGIN_THEMES` and wraps at the end; the Radix
  `DropdownMenu` went with it, so nothing opens, scrolls or has to be dismissed — the screen repainting is the
  feedback, and the button's own `aria-label`/`title` still say which skin is showing and which one is next.
- **Five design skins carry a photograph instead of the drawn scene**: `member` (biometric access),
  `sunset` (dragon over the water, portrait), `lake` (the same art, wide), `synthwave` (a red circuit board) and
  `nightforest` (a neon dragon on near-black). Each entry in `src/lib/loginThemes.js` names its file as `photo`,
  the files live in `public/login-art/`, and `LoginPhoto.jsx` renders the layer when an entry has one — every other
  skin keeps its `DesignScene`. **Only the backdrop changes**: the card, its fields, the button shape and the label
  case are still the theme's own. The drawn-art blocks for those five ids are left in `src/index.css` (unused), so a
  skin goes back to its drawn scene by deleting one field.
- **The scrim is what keeps the card readable.** `.login-photo__scrim` darkens the picture (12–50% black plus a soft
  radial), and `.login-theme[data-photo="1"]` raises the `glass-dark` / `glass-tint` card surfaces (0.62 / 0.6),
  because a photograph has bright areas a gradient does not. `Login.jsx` puts `data-photo="1"` on the shell for a
  picture skin.
- **Verified in the preview** (Supabase, the user's replayed session, 360px + desktop): a press moved
  `smarttime → nebula` and later `adventure → sunset`; **no menu appeared** (0 elements matching
  `[role="menu"]` / `[role="menuitemradio"]`); all five picture skins painted their own file (the
  `login-art/<name>.jpg` read back out of the computed `background-image`, with the drawn scene absent and the card
  keeping its ink — `rgb(251,249,251)` on the dark cards, `rgb(21,35,50)` on the white ones); no sideways scroll at
  either width, no console errors, and the user's own skin (`smarttime`) was left stored. **Preload the pictures
  before capturing** — a capture taken before the decode shows the theme's flat `--background` and looks exactly
  like a missing image. **Not re-checked:** the reduced-motion rule and the hover look, as before.

## The lock screen (this branch)

- **Only `/unlock` wears the phone-lock design, and it is the one auth screen that no longer uses `AuthLayout`.**
  `src/pages/PinUnlock.jsx` renders its own full-screen room: a near-black radial gradient (a utility class on the
  page root), the brand mark, "Enter your PIN", the dots, the keypad and a bottom row of `Sign out` (left, the same
  `logout()`) and `Cancel` (right, which only clears the digits typed so far and is disabled while none are). The
  **PIN itself, the lockout, `verifyPin()`, the redirects and `safeReturnTo()` are untouched** — the redesign is
  presentational. `/setup-pin` and `/change-pin` still use `AuthLayout` + `PinKeypad` exactly as before, so the
  setup/change sequence looks and behaves as it did.
- **`src/components/auth/PasscodeKeypad.jsx`** is the design's keypad (and `PasscodeDots`, its hollow→filled
  indicators): round translucent keys, the digit with its letters underneath, and the delete key in the last row's
  right-hand slot, `invisible` until something has been typed — the empty row a passcode screen shows. It reads
  `PIN_LENGTH` from `PinKeypad` so the app keeps **five** digits (the reference is a 4-digit phone passcode; the ERPs
  own rule wins). It is *not* a `PinKeypad` variant: nothing else should change shape by accident.
- **The keys' press state is scoped, and it has to be.** `src/index.css` ends with a small `.pin-lock .pin-key`
  block for the design's soft **green** glow, because the unlayered pointer-feedback rules above it would otherwise
  paint the keypad with the brand's orange neon (`button:not(:disabled):hover` is specificity `(0,2,1)` — a bare
  `.pin-key:hover` loses to it). Keep the `.pin-lock` scope if the block is ever moved. The two bottom text buttons
  keep the app's normal pointer feedback on purpose.
- **Verified in the preview** (Supabase, the user's replayed session, 360px + desktop): `/unlock` renders the
  gradient room (`rgb(28,28,30)` centre), the heading and sub-line, **five** hollow dots, eleven keys with their
  letters (`1`…`9`, `0`, `Delete`), 64px round, the real `/hiker-logo.png` (naturalWidth 512), `Sign out` enabled and
  `Cancel` disabled with nothing typed; two digits filled two dots **white** and revealed the delete key (measured
  `rgba(255,255,255,0.45)` on an empty dot's border, `rgb(255,255,255)` on a filled one), and `Cancel` cleared them
  again and disabled itself — still on `/unlock`, no console errors, no failed requests, no sideways scroll at either
  width. Both `.pin-lock .pin-key` rules were read back out of the **live** stylesheet with their green values.
  **Not automatically verified:** the press/hover look itself (the harness has no hover and a synthetic click never
  sets `:hover`, so the green glow needs the user's eye); an actual PIN submission (never driven — a wrong PIN would
  spend a real lockout attempt, and the agent must not guess one); and the `/setup-pin` / `/change-pin` layouts,
  untouched here and unreachable without an account that has no PIN yet.

## The Base44 code is gone — Supabase is the only backend (this branch)

- **The shipped bundles no longer contain a single Base44 reference.** Verified on the production
  build: `grep -o -i "base44[a-z_:-]*" dist/assets/*.js` returns **nothing**, and `node_modules/@base44`
  is no longer installed. This supersedes every earlier note that mentions `VITE_AUTH_BACKEND`,
  `src/api/base44Client.js`, `isBase44Configured`, `src/lib/app-params.js`, or a "shipped Base44 build"
  of the APK/EXE — none of those exist any more.
- **Deleted:** `src/api/base44Client.js`, `src/lib/app-params.js`, `src/lib/authMode.js`,
  `src/pages/OAuthConsent.jsx` (it was **unrouted dead code**, hard-wired to the platform's
  `/api/apps/<id>/mcp/consent-info`), `src/functions/recordPayment.js` (unimported; it called the hosted
  Base44 function). The `@base44/sdk` and `@base44/vite-plugin` dependencies are gone from
  `package.json`.
- **Rewritten Supabase-only:** `src/lib/authApi.js`, `src/lib/invoke.js`, `src/lib/settingsApi.js`,
  `src/lib/entities.js`, `src/lib/useBackendStatus.js`, `src/lib/SyncContext.jsx`,
  `src/pages/Register.jsx` (now only the "accounts are created by an administrator" notice — the
  Base44 OTP/self-sign-up flow it used to carry is deleted), `src/pages/ResetPassword.jsx`,
  `src/pages/Login.jsx`, `src/pages/Settings.jsx`, `src/components/layout/ProfileMenu.jsx`,
  `src/components/staff/StaffPermissions.jsx`, and the five RPC wrappers in `src/functions/`
  (the `base44Function` name is gone from `callBackend`'s payload). `src/lib/recycle.js` now stamps
  `deleted_by`/`deleted_by_name` unconditionally — in Supabase mode the payload is **identical to before**,
  which is why that path was not re-driven.
- **`vite.config.js` had to grow the import alias.** The `@/…` alias came from the Base44 Vite plugin; without
  it `vite build` fails with `Rolldown failed to resolve import "@/App.jsx" from "/app/src/main.jsx"`. It is
  now declared explicitly (`resolve.alias`, mirrored by `jsconfig.json`). If a build ever fails that way,
  this is the cause — not a missing file.
- **Deliberately kept:** the six `src/components/ui/` image-helper references (`data-base44-image`,
  the `base44:image-replace` listener, the `media.base44.com` host map). They are inert shadcn-registry DOM
  helpers — no SDK, no network call — and the host map is what rewrites any record image whose URL points at
  the old CDN, so deleting them could break existing pictures. Also kept: the Base44 *platform* files the
  sandbox needs (`docker-compose.base44.yml`, `.base44/environment.json`, `AGENTS.md`, the `base44/` config
  dir) and the root `functions/` Base44 serverless definitions, which are the Base44 app's own backend and
  are **not** part of any build.
- **The CI workflows build Supabase or nothing.** `android-apk.yml` and `windows-exe.yml` no longer read
  `VITE_AUTH_BACKEND` / `VITE_BASE44_APP_ID` / `VITE_BASE44_APP_BASE_URL`; step 3 requires
  `VITE_SUPABASE_URL` + `VITE_SUPABASE_PUBLISHABLE_KEY` (repository variable or secret) and nothing else.
  `.env.example` and `.env.base44-defaults` lost the same keys.
- **Verification (this branch).** `npm run lint` and `npm run build` are clean; the built bundle has no
  Base44 token (above). In the preview, with the user's replayed session: the dashboard renders live figures,
  `/articles` renders (the entity layer answers after the rewrite), and `/login` (full sign-in form),
  `/register` (the administrator notice), `/reset-password`, `/forgot-password` and `/recycle-bin` all
  resolve with **no console errors and no failed requests**. **One regression was caught and fixed here:**
  the first cut of the `AuthContext` edit deleted the `unlock`/`lock` helpers along with the Base44 branch
  (the context exposes both), so the app died with `ReferenceError: unlock is not defined` and a blank
  `#root` — re-verified after the fix.
  **Not automatically verified:** a fresh **signed-out** load of `/login` and an actual sign-in (the pane
  session is replayed, no credentials for the agent), the delete → Recycle Bin write path (see the note
  above: the payload is unchanged in this environment), and `npm run typecheck`, which is still not a
  passing gate here.

## Every Print / PDF button now hands over a real file (this branch)

- **The APK and the EXE could not print, and two of the three mechanisms the buttons used do not exist
  there.** A WebView ignores `window.print()` (the invoice dialog) and `window.open()` + the popup's own
  `window.print()` (the report button), and it has no download manager for `doc.save()`'s blob either. All
  of them now build a **real PDF file** and deliver it through one place: **`src/lib/pdfFile.js`**.
  `savePdf(doc, filename)` downloads the file in a browser and in the desktop build
  (`Capacitor.isNativePlatform()` is false there, so it is the same `doc.save()` as before) and, inside the
  Android shell, writes those bytes with `@capacitor/filesystem` into `Directory.Cache` and hands the URI
  to `@capacitor/share` — the share sheet is where the user saves the file to the device or sends it on to a
  print app. A write that fails toasts; a share sheet the user backs out of is not an error.
- **The invoice is drawn, not rebuilt.** `pdfFromElement(element, filename)` renders the printable sheet
  with html2canvas (already a dependency) and lays the image on A4 pages, so the teal letterhead, the
  payment block and the signature line survive exactly as they read on screen. Its button keeps the
  `loading` state while it works; `InvoiceDetailDialog` wraps `InvoicePrintView` in the ref it passes.
- **The report button writes the same table the screen shows.** `printReport()` in `src/lib/reportExport.js`
  no longer builds an HTML page for a popup — it calls `buildTablePdf()` (`src/lib/pdfTable.js`, the same
  drawing the Database Center export uses) and delivers it; `buildTablePdf` gained the `extra` second table
  so the Uppers page keeps its article-wise position in the PDF. `exportTablePdf()` and the kata/labour PDFs
  (`src/lib/kataPdf.js`) go through `savePdf` too, so nothing is left calling `doc.save()` directly where
  the shell would swallow it.
- **Capacitor's file plugins are dependencies now** (`@capacitor/core`, `@capacitor/filesystem`,
  `@capacitor/share`, all v7, in `package.json` + the lockfile) and `android-apk.yml`'s Capacitor step names
  them, because `npx cap sync android` only copies a plugin's native code when its package is installed. A
  new Print / PDF button must deliver through `pdfFile.js` rather than calling `window.print()`.
- **Verified in the preview** (Supabase, the user's replayed session, the harness standing in for the shell
  by setting `window.androidBridge`, which is exactly how Capacitor reports `android`):
  `/production`'s **PDF / Print** wrote `production.pdf` (5,848 base64 chars, `JVBERi0` = `%PDF-`) into the
  device store and showed the "PDF ready" toast; `/invoices` → the row's **View details** → the dialog's
  **Print / PDF** wrote `invoice-INV-0002.pdf` (240,788 base64 chars, same magic) and toasted the same way,
  both with no console errors. With the bridge removed (`isNativePlatform()` false) the same button performs
  and writes **nothing** to the device store — the branch that downloads instead. `npm run lint` and
  `npm run build` are clean. **Not automatically verified:** the real Android plugins and the share sheet
  itself (no device or emulator here — the harness ran the plugins' own web implementation), and the
  browsers' download itself, which the harness cannot observe. **The desktop EXE keeps the download it
  always had** for the kata / Database Center exports; the invoice and report buttons are the two that
  changed there (they used the print dialog before).
- **Trap, hit here:** the invoice dialog's buttons refuse a click for the first ~1.5 s after it opens
  (`pointer-events: none` while Radix animates it in) — the helper reports `found: true, performed: false`
  with `reason: pointer_events_none`. Pause, then re-query the button; do not treat it as a broken control.
- **The Excel / CSV button is no longer open — this note had gone stale, and trusting it cost a wasted sweep
  (2026-10-23).** `downloadCSV` (`src/lib/reportExport.js`), `exportXlsx` (`src/lib/xlsx.js`) and `src/lib/backup.js`
  all build their blob and hand it to `saveBlob()` in `src/lib/pdfFile.js`, so a CSV / XLSX reaches the user exactly
  as a PDF does — saved and shared in the APK, `<a download>` on web/EXE. The paragraph here used to say the opposite
  ("still use `<a download>` with a blob … moving them onto the same helper is the fix"). Before repeating any
  "still open" claim in this file, check the code: `grep -rn "saveBlob\|createObjectURL" src/lib`.

## The Raw Stock menu wears the same cards (this branch)

- **`src/pages/RawStock.jsx` renders `src/components/stock/RawCategoryCard.jsx`** — the same raw-menu card the
  Ready Shoes grades use: icon and the "Built in" badge, the category's name over "N lines · X bags", the three
  figures (Lines / Quantity / Pairs or Value) and, inside the same card, the stock lines held under it, each
  reading `<article or item>` over `N bags (· N pairs)` beside its own value. The three figures and the
  "Open <category>" link are unchanged, and the whole card still opens `/raw-stock/<slug>`: the page's own
  `<Link>` owns that navigation, the card is presentational (and carries `group-hover:` for the Link's hover).
- **`analytics.rawStockByCategory()` now groups by `["category", "article_code", "item_name"]`** in one aggregate
  and returns each category with the same report-facing keys (`count`, `sum_quantity`, `sum_total_pairs`,
  `sum_amount`) **plus `items`**, the per-line breakdown the card lists. Nothing else changed: the Stock report
  (`src/components/reports/StockReport.jsx`) reads the same keys and renders the same rows (verified: uppers
  `2 / 62 / 6,200 / Rs 49,600`, chemicals `1 / 20 / Rs 40,000`), and no read or write path was touched. A line is
  labelled by its `article_code`, falling back to `item_name` (a chemical has no article), then "—".
- **Verified in the preview** (Supabase, the user's replayed session, 360px + desktop): three cards — Uppers
  (`2 lines · 62 bags`, ARTICLES **H1** 50 bags · 5000 pairs / Rs 40,000 and **HK** 12 bags · 1200 pairs /
  Rs 9,600), Chemicals (`1 line · 20 units`, ITEMS **Ak-1** 20 units / Rs 40,000) and the empty custom category
  ("No stock recorded yet") — the grid reads three across on desktop and a single column on the phone, and the
  Stock report's raw rows are unchanged. No console errors, no failed requests, `npm run lint` + `npm run build`
  clean. Read-only: nothing was created or removed.
- **The category page wears the cards too (this branch).** `/raw-stock/<slug>` no longer uses a `DataTable`: its
  stock lines render as `src/components/stock/RawStockLineCard.jsx` in the same `sm:grid-cols-2 xl:grid-cols-3`
  grid, one card per line — item name, article, then Quantity / Total pairs (or Pack) / Value and the Updated date,
  with the row's own view / edit / delete controls (`RowActions`) and `data-record-id` so the delete flight and the
  hover glow still find it. `RawCategoryPage.jsx` keeps its `columns` array for the export sheet and the view
  dialog; only the list rendering changed, and the "Remaining in bag" section below (uppers only) is untouched.
  Verified in the preview at 360px on `/raw-stock/uppers`: 2 line cards, no `table`, the view dialog opens and
  closes, no sideways scroll, no console errors, `npm run lint` clean.
- **Trap, hit here:** grepping the *served* module for a one-line `groupBy: ["category", …]` finds nothing because
  Vite reformats it across lines — check `groupBy: [` plus the function name instead of calling the module stale.

## A grade card opens its own page, like a raw-stock category (this branch)

- **The Ready Shoes menu drills in the same way Raw Stock does.** `ReadyShoes.jsx` wraps each grade card in a
  `<Link to={`/ready-shoes/${encodeURIComponent(grade.grade)}`}>` (a grade name can hold a space — "A Mix" — so it
  is always encoded; `useParams()` hands it back decoded) and `ReadyGradeCard` gained the same
  `group-hover:border-brand/40` panel and "Open <grade> grade" footer `RawCategoryCard` carries. The card itself
  stays presentational, the `<Link>` owns the navigation.
- **`src/pages/ReadyGradePage.jsx`** is the new page at `/ready-shoes/:grade` (module `ready_shoes`): KPIs
  (Cartons added / Pairs added / Pairs sold / Available now), an **Article-wise ready stock** `DataTable` for that
  grade and a **Batches in this grade** table with the row's own view / edit / delete controls, plus Export and
  Add cartons. It reads the same `readyStockByGrade()` the menu used and filters batches by `grade`, so the page's
  figures are the card's figures. Nothing in the write path changed: Add cartons opens the existing
  `ReadyShoeForm` (opened with this grade, via a **stable** `useMemo` blank batch — a fresh object each render
  would re-run the form's reset effect on every keystroke) and delete still goes through `softDelete("ReadyShoe", …)`.
- **The batch columns moved to `src/components/ready/readyColumns.jsx`** (`readyBatchColumns()`), used by both
  pages and their batch detail dialog, so the two lists cannot drift apart. `ReadyShoes.jsx`'s own `columns` array
  and its now-unused `shortDate` import went with it; the article-wise table on the menu (fed by `articleStockMap`)
  is untouched.
- **Verified in the preview** (Supabase, the user's replayed session, 360px): the card's own click left `/ready-shoes`
  for `/ready-shoes/A`; that page read Cartons 244 / Pairs added 2,928 prs / Pairs sold 360 prs / Available 2,568 prs
  — the figures its card shows — with 4 batch rows **all graded A**, both sections present and the row's eye opening
  the batch dialog; `/ready-shoes/B` (a grade with no batches) renders its zeros and both empty states; Add cartons
  opened on Grade **A**; no sideways scroll, no failed requests, `npm run lint` clean. Read-only: nothing was
  created or removed.
- **Trap, hit here:** `waitFor` returns `{matched:false}` on timeout rather than throwing, and the page's data loads
  after mount — asserting straight after the click read the *loading* page (KPIs 0, no rows) and looked exactly like
  a broken grade lookup. Poll for the concrete loaded state (`[data-record-id]` present, or the empty-state text)
  before reading; also note `innerText` is uppercased by the `uppercase` class on the section headings, so compare
  case-insensitively. The one console entry, the Radix "uncontrolled input to controlled" warning, is pre-existing
  and fires on pages that never open a form.

## The invoice sells only what the shelf holds (this branch)

- **The line's grade list is the article's own shelf, and the carton size comes with it.** The user hit this on
  `/invoices/new`: the grade dropdown offered the factory's whole list, so **A Mix could be sold for an article whose
  only ready stock is grade A**, and the carton size was a free choice (24-pair by default) that had nothing to do
  with how the pairs are actually packed. `analytics.readyStockByArticleGrade()` is the new read behind it — one
  aggregate over `ready_shoes` grouped by `["article_code", "grade", "carton_type", "pairs_per_carton"]` minus one
  over `invoice_lines` grouped by `["article_code", "grade"]`, keyed by `shelfKey()` (`ARTICLE\0GRADE`, an empty
  grade reading as `A` exactly as `readyStockByGrade()` does). Each shelf returns its added/available pairs and **the
  carton most of its pairs came in on** (`pairs_per_carton` + `carton_type`); a batch recorded without a size falls
  back to the shipped `CARTON_TYPES`, then to the app's 24-pair default, in `InvoiceLines` alone.
- **`InvoiceNew.jsx` loads that map** (one more promise in the same `Promise.all`) and hands it to `InvoiceLines` as
  `stock`. A line with no article is inert: the grade field is disabled ("Pick an article first"), the cartons field
  is disabled, and nothing is prefilled — the old default line (grade A, 24-pair carton) is gone, because both of
  those values now come from the stock. Picking an article keeps the grade already chosen if that article still holds
  it, otherwise it takes the shelf's first grade, and either way it sets `carton_type` / `pairs_per_carton` from the
  shelf. The **Carton size field is a read-only `Input`** (`aria-label="Carton size from ready stock"`) — the user's
  rule: the invoice views the carton, it does not choose it.
- **The grade option prints what is left**: `Grade A · 114 carton(s) (1368 prs)`. The over-quantity warning is now
  per shelf — "Only 1368 pairs (114 carton(s) of 12) of HK · Grade A are ready — reduce the cartons." — and a grade
  with no stock at all says so instead. `create_invoice()` is **untouched**: it still checks the article's total
  ready pairs (a sale can no longer exceed a shelf, so it cannot exceed the article either) and still stores each
  line's `grade`, `carton_type` and `pairs_per_carton`.
- **Verified in the preview** (Supabase, the user's replayed session, 360px): with HK in the article field the grade
  field auto-filled `Grade A · 114 carton(s) (1368 prs)`, its option list held **that one option and no A Mix / B**,
  the carton field read `12-pair carton` and `readOnly`, and the summary read `Grade A · 12-pair carton · … × 12
  pairs`; 200 cartons raised the shelf warning above (summary 2,400 prs) and 5 cartons was clean (60 prs, totals
  "Pairs on this invoice 60 prs"). A full save then wrote **INV-0004**: `total_pairs 60`, line `article_code HK,
  grade A, carton_type "12-pair carton", pairs_per_carton 12, cartons 5`, no payment or roznamcha row (received 0) —
  and the invoice, its line and its `invoice_created` audit row were removed again by exact id, leaving
  `invoices` at INV-0001…0003 and HK's sold pairs back to 360. No console errors, no failed requests, no sideways
  scroll. `npm run lint` is clean.
- **Trap, hit here:** the article dropdown **does not select from the harness's pointer events** — `pointerdown` on
  the trigger opens it (`[role="option"]` present, node `isConnected`), but `pointermove → pointerdown → pointerup`
  on the option leaves the trigger on its placeholder, where the repo's earlier notes say it works. The **keyboard**
  route does select: `focus()` the trigger, `keydown ArrowDown` (opens and focuses the first option), then
  `keydown Enter` on the focused option. Use that whenever a script has to choose an article, grade or customer.

## Article-wise ready stock on its own page (this branch)

- **The article-wise list moved off the Ready Shoes menu.** The menu's inline "Article-wise ready stock"
  `DataTable` is gone; the menu now carries an **Article-wise stock** button in its header (`Package` icon,
  `Button asChild` around a `Link`) beside Export / Grades / Add cartons, and the grade cards below it are
  untouched. The same article figures are still read by `articleStockMap()` — only their presentation moved.
- **`/ready-shoes/articles`** (`src/pages/ReadyArticlesPage.jsx`) lists **every** article the factory carries
  (`db.Article`, not just those holding stock) as raw-menu style cards: `src/components/ready/ReadyArticleCard.jsx`
  prints the code, the name, Cartons / Pairs added / Pairs sold / Available with the same green-above /
  red-at-or-below `low_stock_threshold` rule, the **grades that article sits on** (folded out of
  `readyStockByGrade()`, so the card reads like `ReadyGradeCard` read by the other axis), and **its own
  "Article-wise stock" button** opening that article's page.
- **`/ready-shoes/articles/:code`** (`src/pages/ReadyArticlePage.jsx`) is one article's page, shaped like
  `ReadyGradePage`: KPIs, a **Grade-wise stock** table and a **Batches of this article** table (`readyBatchColumns`,
  with the row's own view / edit / delete, `ReadyShoeForm` opened on that article and the usual `softDelete`), plus
  Export and an **All articles** back button. A `/ready-shoes/articles` route must stay **before**
  `/ready-shoes/:grade` in `App.jsx`: the static first segment must not be read as a grade name.
- **The computed grade rows deliberately carry no `article_code`.** `DataTable`'s `rowKey` is
  `row.id ?? row.article_code ?? row.grade ?? index` — checked in that order — so spreading the shelf line (which
  holds the *same* article code on every row) keyed the whole table with one value and logged React's
  duplicate-key warning twice. The page maps only `grade / cartons / pairs / sold / sales_value / available`, and
  `grade` then keys the rows uniquely.
- **Verified in the preview** (Supabase, the user's replayed session, 360px): `/ready-shoes` shows the
  Article-wise stock button, the grade cards (A, A Mix) and **no** article-wise table; the button left for
  `/ready-shoes/articles` (h1 "Article-wise stock", 2 cards, each with its own button); H1's card opened
  `/ready-shoes/articles/H1` (KPIs 100 / 1,200 prs / 1,200 prs / 0 prs, Grade-wise stock rows **A** 100/1200/0/1200
  AVAILABLE and **A Mix** 0/0/1200/−1200 LOW STOCK, and its production batch), **All articles** returned to the
  list; no console errors (0 duplicate-key warnings before and after the fix), no failed requests, no sideways
  scroll, `npm run lint` clean. Read-only: nothing was created or removed. The grade list on a card is the same
  arithmetic the grade pages show, so A Mix's negative available on an article whose sales were invoiced under it
  with no matching batch is the pre-existing stock arithmetic, not this screen's fault.

## Investment: owner capital and its one cash-book entry (0031, this branch)

- **`0031_investments.sql` is applied.** It adds `public.investments` (the register: the
  date the money entered, the amount, the account it entered, notes, the linked
  `roznamcha_id`, an idempotency key and the soft-delete columns), the
  `sync_investment_entry()` trigger and `post_investment(jsonb)`. Rollback:
  `0031_investments.rollback.sql`.
- **One investment is exactly one entry, and the database is what guarantees it.** The
  trigger on the register row writes the single roznamcha entry (source `investment`,
  category `Investment Received`, direction `in`, `method` = the account the money
  entered, description = the notes), links it back through the UNIQUE `roznamcha_id`,
  and on every later update carries the investment's date/amount/method/particulars
  **and its deleted state** onto that same entry. A permanent delete removes the entry
  with it. So no write path — the app, the Recycle Bin, or SQL — can produce a second
  entry, an orphan entry, or a register row whose entry disagrees with it.
- **Capital is never sales and never profit.** Entries are money in on the cash book
  (the balance is right the moment it is invested) but `profit_period_totals()` reads
  only `kharcha`, `other_income`, invoices, purchases and labour earnings, so an
  investment cannot reach revenue or the net. Verified in SQL: with three investments
  posted, revenue / other income / net profit all read `0.00`.
- **`settings.opening_cash` is 0 on this branch, on purpose.** Every rupee of capital
  is an Investment record now; leaving the old opening-cash figure in place would show
  the same money twice (`Roznamcha` adds `settings.opening_cash` as its base, and the
  day-close reads it as the first day's opening).
- **The module.** `src/lib/investments.js` (register reads, `postInvestment()`,
  `updateInvestment()`, `investmentForEntry()`, the total), `src/pages/Investments.jsx`
  (`/investments`, module `investment` — sidebar under **Accounts**, between Payments and
  Roznamcha; `Total invested capital` KPI, the register table, export, date range), and
  `src/components/investments/InvestmentForm.jsx` (amount, date the money entered,
  payment method, notes — the "Add investment" button in the page header opens it).
  `entities.js` maps `Investment`, `recycle.js` lists it, so a removed investment waits
  in the Recycle Bin and restoring it puts its entry back (the trigger, again).
- **The cash book points back at the register.** `Roznamcha.jsx` sends an
  `source = 'investment'` row's **edit** to the Investment form (one write path, so the
  entry can never be edited into disagreement with its investment) and its **delete**
  through `softDelete('Investment', …)`, which takes the linked entry out with it.
  `SOURCE_LABELS.investment` reads "Investment received".
- **Verification (this branch).** In SQL, as the signed-in administrator, inside a
  transaction that was **rolled back**: three investments of 100,000 + 20,000 + 50,000
  produced exactly **three** roznamcha rows totalling **170,000**, each `direction in`,
  `category "Investment Received"`, `method` Cash/Bank as entered; a retry with a
  repeated idempotency key answered `duplicate: true` and left the count at three; an
  edit moved the linked entry to the new amount and description; marking one investment
  deleted left **two** live entries (125,000); revenue / other income / net profit stayed
  `0.00`. `npm run lint` and `npm run build` are clean. The register, the Roznamcha and
  `audit_logs` are all back to **0 rows** afterwards — nothing of the test remains.
- **Not automatically verified: the Investment screens themselves.** The pane was on
  `/unlock` when the check ran, so the preview browser was an anonymous visitor and a
  PIN is deliberately never set or guessed for the user (see "Auth backend and the PIN
  unlock"). Drive **Add investment** once in an unlocked pane: the page, its KPI total
  and the linked "Investment Received" row are unverified by automation, while the
  posting, the single-entry rule, the sync and the profit exclusion are proven above.

## The factory was emptied of its test records (this branch)

- Every record entered while the modules were being built and tested was deleted once,
  through the pooler connection (`dbadmin`), inside one transaction: invoices and their
  lines, payments, roznamcha and its closed days, purchases, production stock and
  entries, ready shoes, raw stock and the two test raw categories, labours with their
  rates/production/earnings/links, the price-calculator categories and designs, the
  profit/zakat saved rows, customers, suppliers, articles, manual categories, the
  audit log and the backups table. `settings.opening_cash` was set to **0** and the
  shipped `Kharcha` manual category was re-seeded.
- **Kept on purpose:** `profiles` (3 accounts), `user_permissions`, `labour_categories`
  (the three seeded stages), `ready_shoe_grades` (A / B / A Mix, seeded by 0020) and the
  `settings` row itself — the company's own name, address, phones, currency, packing
  defaults and zakat start date are configuration, not test data.
- The database now reads **0 rows** in every business table; a fresh load therefore
  shows empty modules with their empty states, and the Investment page opens at
  "No investment recorded yet".

## The app-wide unlock PIN: every install only asks for it (this branch)

- **The pre-login gate never offers to choose a PIN.** `src/pages/AppPin.jsx` has no setup/confirm mode any more: it
  renders "Enter your PIN" only, and `src/lib/appPin.js` lost `setAppPin()` with it. The PIN is the app's own, fixed
  one — `VITE_APP_PIN`, read from the build environment at **build time** and compiled into the bundle
  (`const APP_PIN = String(import.meta.env.VITE_APP_PIN ?? "").trim()`), so it is the same on every device and a
  freshly installed APK asks for it instead of letting whoever opens the app first claim it.
- **The value is a user-supplied secret, never committed.** It arrives through `/run/base44/app.env` (declared as an
  app secret) for the sandbox/dev server — Vite exposes `VITE_`-prefixed **process** env vars in dev, which is why
  `env_file:` alone is enough — and through a GitHub repository variable/secret named `VITE_APP_PIN` for both CI
  builds, where the two `Build HIKER ERP` steps now pass it (each workflow warns when it is missing: an installer
  built without it has no PIN to enter on a fresh device). `.env.example` documents the name only.
- **Upgrading a device is never a lockout.** `verifyAppPin()` still accepts the PIN a device stored itself under
  `hiker_app_pin` from an older build; the app-wide PIN is the fallback when the device has none. `isAppPinSet()`
  returns true when either exists, and the gate shows "No PIN has been set for this build. Ask an administrator for
  the app PIN." (keypad disabled) when neither does — no way in, which is the point, and the reason the secret must
  be set before an APK is handed out. The PIN stays a **deterrent gate** (it is inside the shipped bundle); real
  access control is still the Supabase login + RLS.
- The PIN itself is **not** an account PIN: `/unlock`, `/setup-pin`, `/change-pin` and the server-side
  `verify_pin`/`setup_pin` functions are untouched by this.
- **Verified in the preview** (fresh load, no stored device PIN, no `VITE_APP_PIN` in the container yet): the gate
  renders "Enter your PIN" with no set/confirm step, five digits produce "Incorrect PIN. Try again." and the same
  screen, and the "No PIN has been set for this build" notice shows while the variable is absent. **Not
  automatically verified:** unlocking with the real app PIN (the agent never sees the secret's value) — set it, then
  type it once on a fresh install.

## Party accounts in the cash-book entry form, and the duplicate confirmation (this branch)

- **`RoznamchaForm`'s Category field offers the three ledger accounts above the manual
  categories.** Customer / Supplier / Labour are Radix `SelectGroup` items whose value
  carries the `party:` prefix (`PARTY_TYPES` in `src/components/forms/RoznamchaForm.jsx`),
  so a category name can never collide with them; the manual categories follow in their
  own group, still filtered by the chosen direction. Choosing a ledger account reveals the
  account picker and opens the Direction on that account's usual side (customer → IN,
  supplier and labour → OUT); the side stays changeable, and changing it no longer clears
  the category.
- **A party entry posts through `postPayment()`, not through the manual-category path.**
  The form sends `account_type` = the ledger, `account_id` and
  `transaction_type` = jamma/banam from the chosen direction, so `post_payment()` still
  decides the money direction and writes the single roznamcha entry — the manual path
  (`account_type: "other"`) is unchanged. `listPartyAccounts(type)` in `src/lib/accounting.js`
  is the one account loader, now shared with `PaymentForm` (its local `loadAccounts` went).
- **A repeated party entry asks; it is never refused.** `findDuplicatePartyPayment({
  account_type, account_id, amount, payment_date, direction })` (same file) matches an
  earlier `payments` row for the same account, amount, day and side, ignoring soft-deleted
  and reversed rows; `src/components/DuplicateEntryDialog.jsx` shows what it found and the
  user either cancels or posts anyway. Both `RoznamchaForm` and `PaymentForm` run the check
  **only for customer / supplier / labour** — a manual category is never questioned, because
  the same expense legitimately repeats. The idempotency key is minted per open form, so
  confirming still posts exactly once.
- **A correction asks the same question (`PaymentEditDialog`).** Moving an amount or a day
  can leave a payment an exact copy of another one, so "Save changes" runs the same lookup
  whenever the amount or the date moved and the payment belongs to a party account — the
  account, the direction and the ledger side stay as posted, so nothing else can make it a
  duplicate. `findDuplicatePartyPayment(…, exclude_id)` takes the payment being corrected
  out of its own lookup, and the confirmation's action reads **Save anyway**. A notes-,
  reference- or method-only edit therefore never asks. Verified in the preview (Supabase,
  mobile, the pane unlocked): a Rs 3,000 entry moved to Rs 5,000 raised the confirmation
  naming the other entry (`Rs 5,000 · 2026-10-20 · Cash`) with the register unchanged
  (Rs 8,000, 2 entries); Cancel left it at Rs 3,000; "Save anyway" saved it, the register
  read Rs 10,000 and the linked roznamcha entry moved in step; an amount that stands alone
  (Rs 4,000) and a notes-only edit both saved without asking. The pane's notification stack
  sits over the dialog at phone width, so a capture shows the toasts rather than the
  confirmation itself — the dialog's own text was read from the DOM instead.
- **Verification status.** `npm run lint` and `npm run build` are clean and the dev server
  serves the new modules (`curl -s http://localhost:3000/src/components/forms/RoznamchaForm.jsx`
  shows `Ledger accounts`). The lookup rule itself was exercised against the live project
  through the REST API, as the service role, with a throwaway `payments` row (removed again,
  along with its customer): same account + amount + day + side matched; a different side,
  amount or day, a soft-deleted row and a reversed row all matched nothing. **The UI flow is
  NOT automatically verified:** every fresh preview load lands on `/unlock` (the PIN flag is
  session-storage only and is not in the replayed pane storage), and the agent must never
  enter the user's PIN — drive the Category list and the confirmation by hand in an unlocked
  pane.

## The article's cost per pair comes from the ready pair designs (this branch)

- **One dropdown, one source.** `ArticleForm` takes its **cost per pair** (and the selling
  price beside it) from `PriceDesignPicker`, which is no longer a two-step category → design
  browser: it lists the designs of the Pair Price Calculator's **ready pair** category alone
  (`listReadyPairDesigns()` / `readyPairCategory()` in `src/lib/priceCalculator.js`, matched by
  `/ready/i` against the category name — today "Ready pair Calculation", which holds
  `PU paper Wala` at Rs 600 and `PU chapati Wala H+` at Rs 1,010, each design's `total_cost`
  being its material rows' sum). The upper/sole/packing categories are calculations of their
  own and are deliberately not offered here. A new calculator button on the Cost per pair
  field opens it; `PICKER_FIELDS` decides which field the pick writes to.
- **The profit is the article's own two figures**, printed under them (`CalcRow`): selling
  price − cost per pair, emerald while it is at or above zero and `text-destructive` below.
  Nothing new is stored — the pair price calculator remains the one place a pair's cost is
  computed, and the article only reads it.
- **Renaming the calculator category breaks the match**: the picker finds it by name
  (`/ready/i`), so a category renamed without the word "ready" leaves the dropdown empty with
  its "not been set up yet" note. That is the one string to change if the name is ever moved.
- **Verification status.** `npm run lint` is clean apart from the two pre-existing
  `android/app/build/…/native-bridge.js` errors, `npm run build` is clean, and the dev server
  serves the new code (`curl -s http://localhost:3000/src/components/forms/PriceDesignPicker.jsx`
  shows `Select a ready pair design`). **NOT automatically verified:** the preview browser
  landed on the app-wide **`/`-gate** ("Enter your PIN" — the AppPin screen), not `/login`, so
  the form could not be opened and no PIN is ever guessed; drive the Cost per pair button →
  the dropdown → the profit line once by hand in an unlocked pane.

## Profit by design (0032, this branch)

- **`0032_profit_by_design.sql` is applied.** One new reader, `profit_by_design(from, to)` — the same books
  `profit_period_totals()` totals, read design by design: every design of the Pair Price Calculator's ready pair
  category (matched by name, `/ready/i`, exactly as `readyPairCategory()` does in the browser) with the pairs it
  sold, the price those pairs sold for on the period's invoices (`invoice_lines.line_total` ÷ `pairs`), its own
  `total_cost` per pair, and the profit it left — plus the total at the end. Rollback:
  `0032_profit_by_design.rollback.sql` (drops the reader; the books and the saved periods are untouched).
- **The rows are the designs, so a new design is a profit line the moment it is added** — unsold at first
  (zeros), which is what was asked for. A sale no design covers is listed as its own row (the "No design"
  badge), valued at that article's `unit_cost`, so no sale is hidden and the total is the period's whole selling
  margin. A design and an invoice line are the same pair when the design's `article_number` equals the line's
  `article_code`, or — the usual case, because `DesignDialog` never asks for an article number — when the
  **design's name equals the line's `article_name`**. Reusing the name is what links them today.
- **`/profit` gained the "Profit by design" panel** (each design with its selling price, cost per pair and
  profit, and the Total profit row) below the period's own blocks; `src/lib/profit.js` has `profitByDesign()`.
  It follows the same date filter as the period and is read **separately** from the totals, so a design read
  that fails still leaves the period's figures on screen.
- **Verification status.** Applied through the `dbadmin` pooler. The arithmetic was exercised in SQL as the
  signed-in administrator, inside a transaction that was **rolled back**: a 10-pair sale of the design
  `PU paper Wala` (sold at Rs 900, cost Rs 600) read profit Rs 3,000, the unsold `PU chapati Wala H+` read
  zeros, an unlinked 5-pair sale on a Rs 250-cost article read Rs 1,250, and the total read Rs 4,250 over 15 prs
  (Rs 11,500 billed, Rs 7,250 at cost); `invoice_lines` and `articles` were empty of it afterwards. `npm run
  lint` is clean apart from the two pre-existing `android/…/native-bridge.js` errors, and `npm run build` is
  clean. **NOT automatically verified: the panel's own rendering** — the preview browser stops on the
  app-wide PIN gate ("Enter your PIN", never guessed), so open `/profit` once in an unlocked pane.
- **The two summary panels are gone (this branch).** `/profit` now carries only the date filter, the four KPI
  cards (Revenue / Cost of sales / Gross profit / Net profit) and the **Profit by design** panel — the "How this
  period adds up" breakdown (the four signed lines and its Net profit row) and the "Also in this period" reference
  box (purchases, labour, kharcha, other income) were removed at the user's request, because the dashboard already
  carries the period's totals. Nothing else changed: `profitTotals()` / `profitByDesign()`, the KPIs and "Save
  period" read exactly the same figures, and the now-unused `lines` array and `shortDate` import went with the
  panels. `npm run lint` is clean apart from the two pre-existing `android/…/native-bridge.js` errors.

## The invoice register's daily history (0033, this branch)

- **`0033_invoice_day_history.sql` is applied.** The register keeps each day of billing on its own, and the
  **database writes it**: `public.invoice_days` (one row per `day_date`, UNIQUE) carries the day's invoice
  count, cartons, pairs, subtotal, discount, total, received and balance, the moment it was last stored and a
  JSON snapshot of its invoices. `refresh_invoice_day(date)` rewrites one day from the invoices dated that day;
  `sync_invoice_day()` and the **`invoice_days_keep` trigger** on `public.invoices` call it AFTER INSERT /
  UPDATE / DELETE. There is no close button and no cron — a day is always that day's own register, whatever
  writes the invoice (the app, the Recycle Bin, SQL). Rollback: `0033_invoice_day_history.rollback.sql`.
- **Nothing is stored twice and nothing is invented.** The row is an upsert on `day_date`; an edit that moves
  an invoice to another date refreshes **both** days; a day whose invoices are all in the Recycle Bin has
  nothing left to keep, so its row goes with them. RLS is **select-only** for `invoices:view` (there is no
  insert/update/delete policy at all — the trigger is the only writer), so a screen can never rewrite history.
  The migration backfills every date already in the register.
- **Files.** `src/lib/invoiceHistory.js` (`listInvoiceDays()`, `invoiceDayInvoices()` — the day's own snapshot),
  `src/pages/InvoicesHistory.jsx` at **`/invoices/history`** (module `invoices`), reached from the **History**
  button in the invoice header beside Export / Print all invoices, and
  `src/components/invoice/InvoiceDayDialog.jsx` (one stored day: its figures, the invoices it kept and their
  view / edit / delete controls — see "The invoice history prints and corrects its own invoices" below).
  `invoices`, `create_invoice()` and every profit figure are untouched.
- **Verified.** Applied through the `dbadmin` pooler; `npm run build` is clean and `npm run lint` shows only the
  two pre-existing `android/…/native-bridge.js` errors. The automatic storing was exercised in SQL inside a
  transaction that was **rolled back**: an inserted invoice created its day row (count 1, total 50,000,
  discount 10,000, received 20,000, balance 30,000, one snapshot), an update re-stored it, moving the invoice's
  date **removed the old day and wrote the new one**, and a soft delete took the day with it — the table was
  empty after the rollback. Then, as a second check, two invoices were inserted (dated today and yesterday):
  both day rows appeared **by themselves**, and as the signed-in administrator the RLS policy admitted them
  (2 days, the newest holding 1 snapshot). Deleting those two invoices removed both day rows again, so nothing
  of the check is left (`invoices` and `invoice_days` are back to 0 rows).
- **NOT automatically verified: the screens.** Every fresh preview load of this app stops on the app-wide PIN
  gate ("Enter your PIN" — the agent never guesses it), so `/invoices` was loaded (gate confirmed) and the new
  route could not be opened. The dev server serves the new modules (`/src/pages/InvoicesHistory.jsx`,
  `/src/components/invoice/InvoiceDayDialog.jsx`, `/src/lib/invoiceHistory.js` all answer 200) and the route is
  registered in `App.jsx` — but open `/invoices` → **History** once in an unlocked pane to see the day list and
  a day's own detail.

## The invoice history prints, and corrects its own invoices (this branch)

- **`/invoices/history` prints a real PDF, and a stored day can be corrected through the invoices it kept.**
  `printReport()` (`src/lib/reportExport.js` → `src/lib/pdfFile.js`, so the APK shares the file) draws the day
  list from the page's **Print / PDF** button, and the day dialog's own **Print / PDF** draws that day's
  invoices. Both print **raw values** — plain dates and numbers — because the built-in PDF fonts cannot draw a
  formatted currency string; the screen keeps its `money()` cells. `PRINT_COLUMNS` in each file is the only
  place the printed columns live.
- **A day's rows carry view / edit / delete** — the same controls the register gives an invoice (`RowActions`,
  `InvoiceDetailDialog`, `QuickEditDialog` for notes, `DeleteDialog` → `softDelete("Invoice", …)`, so the record
  waits in the Recycle Bin and its pairs go back to ready stock). A day keeps only a **snapshot**, so the actions
  act on the register's real row behind it: `liveInvoicesByNumber(dayDate)` (`src/lib/invoiceHistory.js`) reads
  that day's live invoices keyed by `invoice_number` — the number `create_invoice()` never repeats. An invoice
  no longer in the register (it is in the bin, or the day is older than a change) raises "Not in the register"
  instead of acting on nothing.
- **Nothing writes an `invoice_days` row from a screen** (RLS is still select-only). The edit and the delete go
  through the invoice, so the 0033 trigger re-stores the day in the same transaction; `InvoicesHistory` reads the
  days again and follows the open day — which **closes when its last invoice went to the Recycle Bin and the day
  went with it** (`reloadDay()`). The day rows themselves deliberately carry no edit/delete: a day has nothing of
  its own to correct except through its invoices.
- **Verification status.** `npm run lint` (only the two pre-existing `android/…/native-bridge.js` errors) and
  `npm run build` are clean, and the dev server serves the new modules. The data path the buttons drive was
  exercised in SQL inside a transaction that was **rolled back**: an insert stored its day (count 1, the snapshot
  naming the invoice), the day read back one live row (what `liveInvoicesByNumber()` reads), and the same
  `is_deleted` update `softDelete()` writes **took the day row with it** — then `rollback`, with `invoices` and
  `invoice_days` at 0 rows again. **NOT automatically verified: the screens.** The preview browser stops on the
  app-wide device PIN gate ("Enter your PIN — Five-digit access code"), because `hiker_app_pin_unlocked` lives in
  **sessionStorage** (`src/lib/appPin.js`) while the platform replays the pane's cookies + localStorage only (8
  keys, `hiker_app_pin` among them, `__b44_seed_applied` the only session key) — so no screen of this app is
  reachable by automation, and the PIN is never guessed. Drive it once in the user's unlocked pane: the day list's
  **Print / PDF**, a day's **Print / PDF**, and a row's **Edit** / **Delete** → the confirmation.
- **Test data.** One throwaway invoice (`TEST-HIST-1`, inserted through PostgREST) was used to confirm the day
  appears on its own; it was removed by exact id afterwards and the day row went with it (the trigger), so
  `invoices` and `invoice_days` are empty again — the factory's own state.

## The loading screen's shoe swings left and right (this branch)

- **The shoe on the splash swings, and the wordmark does not.** `src/components/SplashScreen.jsx` stages the poster
  (`/splash-screen.png`, 1024×1536) inside `.sole-splash__stage` — a box of the poster's own 2:3 ratio, centered and
  letterboxed on black — then renders **the same poster twice**: the background, a pure-black patch over the shoe's
  measured inset, and a **clipped copy** of the poster (`clip-path: inset(...)`) holding only the shoe, which is the
  layer that moves (`sole-splash-spin`, `0.9s ease-in-out infinite alternate` — a slow −20° → +20° swing, out and
  back inside the 1.8 s `DURATION` the screen lasts, not a full turn). The poster's own shoe is what moves, so
  nothing about the artwork changed.
- **Two details that are load-bearing:**
  - `mix-blend-mode: screen` on the spinning layer. The clip is a rectangle of the poster and the poster is black
    around the shoe, so without the blend the crop's black corner would paint over the wordmark as it sweeps past it.
    Blended, its black pixels contribute nothing and only the shoe shows.
  - `scale(0.9)` in the keyframes. The shoe fills its box corner to corner, so a full-size spin would reach up into
    the wordmark; at 0.9 the sweep stays below it.
- **The insets are measured, not guessed** (decoding the PNG row by row: the shoe's visible pixels sit at
  x 183–892, y 525–1262 of 1024×1536; `--sole-shoe-*` adds a small margin, giving `transform-origin: 52.5% 58.15%`,
  the shoe's own centre). Re-measure if the poster is ever replaced.
- `prefers-reduced-motion` turns the spin off (`.sole-splash__shoe { animation: none; }`), like the progress bar.
- **Verified in the preview** (fresh load, 360px viewport): the loading screen is caught by a **fresh** load only —
  the platform replays cookies + localStorage, and the splash is up for 1.8 s from mount, so a call must read
  synchronously at the top of its script (a `setViewport`/`inspect` first and it is gone; the `web` container's own
  page state carries over between calls, so force the reload with any shell command). Read back: the layer computes
  `sole-splash-spin · 0.9s · ease-in-out · alternate · infinite` with `mix-blend-mode screen`, `clip-path
  inset(33.2% 11.4% 16.9% 16.4%)` and `transform-origin 196.875px 327.094px` on a 375×562.5 stage, and its
  `matrix(…)` sampled **−14.4° → −19.9° → −17.2° → −6.3°** (a second run −7.4° → −19.9° → 0°): the angle turns
  around at about −20°, the keyframes' own extreme, instead of running monotonically round the circle — the swing
  the user asked for. The screenshot of the state shows the shoe tilted on the black room with the HIKER+ wordmark
  untouched and legible, and the splash lifts on its own into the app-wide PIN gate, with no console errors, no
  sideways scroll, `npm run lint` clean.
- **Ask for the splash capture as the script's *first* statement.** A capture requested after even ~0.8 s of poking
  at the element is taken once the 1.8 s life is over and comes back showing the **PIN gate**, not the splash; and
  an `elementFromPoint` reading of the poster taken during the fade returns `null` because the stage is already
  coming down. A still frame cannot show the motion itself, so the sampled angles above are the evidence for the
  swing — the *speed* of it still needs the user's eye. **Superseded: the splash shoe turns a single 360° now
  (see the section at the end of this file).**

## The splash shoe turns (this branch)

- **The lacing overlay is gone.** The shoe-tie animation that filled the sign-in's wait was removed at the user's
  request (it did not look good). The overlay component and its whole CSS block at the end of `src/index.css` (the
  `.shoe-tie` rules, `--shoe-tie-ms` and the four `shoe-tie-*` keyframes with their reduced-motion rule) were
  deleted, and `Login.jsx` lost the import, the lacing state, the timeline constant and the await that held
  `navigate()`. Signing in itself is untouched — the form, `signInWithPassword`, the remembered email,
  `safeReturnTo()` and the redirect are exactly as they were — and the app now opens as soon as the auth call
  resolves instead of waiting out the animation. The showroom shoe still turns in place while the call is in flight.
- **The splash shoe turns a full 360° from the quarter mark, not a swing.** `sole-splash-spin` is now
  `0% rotate(90deg) scale(0.9) | 100% rotate(450deg) scale(0.9)` with
  `animation: sole-splash-spin 1.8s ease-in-out both` — one complete revolution over exactly the 1.8s the screen
  lasts, so the shoe has gone right round as the splash fades (the `alternate` ±20° swing it replaced is described
  in the section above and no longer exists; the 0° → 180° turn and the 90° → 270° half turn before this are
  superseded by the 90° start and the 450° end, so the shoe still begins on its side and ends the same way round,
  but 360° later). The `mix-blend-mode: screen` and the `scale(0.9)` are still
  load-bearing for the same reasons.
- **Verification status (this branch).** The splash turn is verified: the live stylesheet serves the keyframes
  above (read back from the running page as
  `@keyframes sole-splash-spin { 0% { transform: rotate(90deg) scale(0.9); } 100% { transform: rotate(450deg) scale(0.9); } }`),
  `.sole-splash__shoe` computes `sole-splash-spin 1.8s ease-in-out both` (with `screen` blending,
  `transform-origin 52.5% 58.15%` and the `inset(33.2% 11.4% 16.9% 16.4%)` clip intact), and the layer's own matrix
  sampled **`matrix(0, 0.9, -0.9, 0, 0, 0)` = rotate(90deg) scale(0.9)** — the quarter-mark start of the revolution,
  read at the top of the script (a fresh load's render wait decides which instant of the 1.8s is caught, so this is
  the only sample obtainable in one call; take it as the script's *first* statement). The *speed* of the turn still
  needs the user's eye.
  **NOT automatically verified: the login overlay itself.** Every app open is gated by the device PIN
  (`App.jsx` calls `lockAppPin()` on mount and returns `<AppPin>` *before* the Router), and that flag lives in
  **sessionStorage**, which the platform does not replay (`sessionStorage` holds only `__b44_seed_applied`) —
  so the preview browser sits on "Enter your PIN" and `navigate('/login')` fails with "URL changed but the page
  content did not change". The PIN is never entered by automation. What *is* checked: the dev server serves
  `Login.jsx` with no lacing overlay wiring left in it, and that the **live** stylesheet carries no lace rule at
  all. Type the credentials once in an unlocked pane to see the sign-in itself.
- `npm run lint` is clean apart from the two pre-existing `android/…/native-bridge.js` errors, and
  `npm run build` is clean.

## The loading shoe turns in 3D (this branch)

- **The same one full turn, now about the shoe's own vertical axis.** `sole-splash-spin` is
  `0% rotateY(0deg) scale(0.9) | 100% rotateY(360deg) scale(0.9)` with the unchanged
  `animation: sole-splash-spin 1.8s ease-in-out both`, and `.sole-splash__stage` gained `perspective: 1000px`.
  The perspective **must** sit on the parent — `rotateY` on its own reads as a flat horizontal squash with no
  depth — and the shoe still revolves about its measured centre (`transform-origin: 52.5% 58.15%`), with
  `mix-blend-mode: screen`, the `clip-path` insets and `scale(0.9)` all unchanged and still load-bearing (the
  blend keeps the crop's black corner off the wordmark, the scale keeps the sweep below it). `prefers-reduced-motion`
  still turns it off (`animation: none`).
- **Two instants are empty by design.** A revolution about the vertical axis puts the shoe **edge-on and invisible**
  as it passes 90° and 270°, and shows its mirrored back for the half turn between them. Only the black patch behind
  it is on screen at those two instants, and the wordmark above is never touched. That is inherent to a 3D spin,
  not a fault: do not "fix" it by adding a second copy or a fill.
- **Verified by measuring the layer's own transform** (a controlled iframe of the app's own origin, sampling
  `getComputedStyle(shoe).transform` every ~60 ms): `.sole-splash__shoe` computes
  `sole-splash-spin | 1.8s | ease-in-out | both` with `mix-blend-mode: screen` and the unchanged clip/origin, the
  stage computes `perspective: 1000px`, and the samples run **`matrix(0.9, 0, 0, 0.9, 0, 0)` (rotateY 0°) then a
  monotonic `matrix3d` — m11 `0.9000 → 0.1027 → −0.2005`, m13 `−0.0084 → −0.8941 → −0.8774`** = a real Y-axis
  rotation from 0° through ~103° in ~660 ms, i.e. the shoe turns in depth rather than in the plane. The splash
  still lifts on its own into the app-wide PIN gate, with no console errors from the app (the one logged
  `App state check failed` is `AuthContext`'s stale replayed session, pre-existing).
- **Not automatically confirmed: the animated look itself.** Still captures of the splash in this environment came
  back black/blank (the poster `splash-screen.png`, 1024×1536, was not yet decoded in the captured load —
  `bg.complete` read `false` in one run — and a capture instance renders its own load), so the shoe over the poster
  mid-turn was not seen here. As with the swing and the flat 360° before it, the *motion* is what a still frame
  cannot show anyway: watch it once on the user's own pane. Re-measure the same way if the poster is ever replaced.

## The money mark: H / L / C at the end of an amount (this branch)

- **Every money figure carries the office's magnitude mark now.** `moneyMark(value)` (`src/lib/format.js`) reads
  the figure's own digit count — five digits (10,000–99,999) → **H**, six and seven (1,00,000–99,99,999) → **L**, eight and up
  (1,00,00,000 and above — a crore) → **C** — and anything smaller (zero included) carries nothing. `money()` appends it straight after
  the number (`Rs 20,000H`), so **no call site changed**: every screen, ledger, KPI, PDF and export that already
  reads `money()` prints it, and a screen written later gets it for free.
- **The mark is plain text on purpose.** The built-in jsPDF fonts and the CSV/XLSX writers carry text only, so a
  real `<sub>` there is impossible; in those the letter rides at the end of the figure.
- **On screen the letter is a real subscript.** `src/components/ui/money.jsx` exports `Money`, which renders the
  formatted string up to its last character as it is and that last letter as a small `<sub>` (`text-[0.7em]`); the
  string itself is never changed, so the PDF and export paths above are untouched. A codemod wrapped every site that
  puts money on screen as a value — JSX children, `KpiCard`'s `value`/`hint`, `CalcRow`'s and `Figure`'s `value`, the
  report shell's totals and `DataTable`'s `render:` cells: 248 sites in 74 files. A site that builds a *string* with
  `${money(…)}` (a hint, a label) deliberately stays plain text. Verified: the thresholds read back from the real
  module (`100,000 · 250,000 · 999,999 · 1,234,567 · 9,999,999` → L, `10,000,000 · 99,000,000 · 100,000,000` → C,
  `10,000`–`99,999` → H, `9,999` and below → nothing); the component rendered from its own source through sucrase +
  `react-dom/server` (5/5 cases — `Rs 12,500,000C` → `Rs 12,500,000<sub>C</sub>`, `Rs 500` and `—` untouched); and
  `npm run build` plus `npm run lint` are clean (only the two pre-existing `android/…/native-bridge.js` lint errors),
  with the dev server answering 200 and serving the `Money` import for every converted module checked. **The look on
  screen is still unverified by automation** — the app-wide device PIN gate sits before the Router, so no screen of
  this app is reachable from here.
- **A money field shows its mark while the amount is being typed.** `src/components/ui/money-input.jsx` wraps
  `Input` and renders the same letter as a real `<sub>` inside the field — the number is `text-right` so the mark
  sits against its last digit, `pr-8` reserves the room and `markClassName` moves the mark clear of a field's own
  trailing button (`ArticleForm`'s two price fields use `className="pr-16" markClassName="right-[3.5rem]"` for the
  calculator button), and it is kept clear of the browser's own number spinners, which paint over the last ~17px
  of the field on hover. **The typed value is never touched** — it stays the plain digits, so every amount posted,
  stored and printed is unchanged; only the display carries the letter.
- **The fields on it** (24 sites, 21 files): the new-payment amount (`PaymentForm`), the cash-book entry amount
  (`RoznamchaForm`), the payment correction amount (`PaymentEditDialog`), the expense amount (`ExpenseForm`), the
  investment amount, the invoice discount and amount received (`InvoiceNew`), the invoice line's price per pair
  (`InvoiceLines`), the kata entry amount, the price-calculator design price and the pair price rows
  (`DesignDialog`, `PairPriceDesign`), an article's cost per pair and selling price (`ArticleForm`), opening cash
  (`Settings`), customer and supplier opening balances, a raw line's price, a purchase's unit price, a production
  entry's value and its consumption value, a production-category value, a stage's rate per pair, and a labour rate
  per pair (`LabourDialogs`). **Quantity fields keep the plain `Input`** (cartons, bags, pairs, thresholds, stock
  levels) — a pair count is not money and must not be marked.
- **Verified.** The rule was run against the real module in the container (`node --input-type=module -e
  'await import("./src/lib/format.js")'`): 0, 500 and 9,999 read no mark; 10,000 · 20,000 · 25,000.5 · 99,999 read
  **H**; 100,000 · 250,000 · 999,999 · 1,234,567 · 9,999,999 read **L**; 10,000,000 · 99,000,000 · 100,000,000 read **C**; −250,000 reads
  **L** (the sign is ignored, as it should be) — i.e. `Rs 20,000H`, `Rs 250,000L`, `Rs 1,500,000C` exactly as asked.
  `npm run lint` is clean apart from the two pre-existing `android/…/native-bridge.js` errors and `npm run build`
  is clean; the dev server serves `src/components/ui/money-input.jsx` and the rewritten `format.js`.
## A tapped control no longer goes dark (this branch)

- **The pointer feedback is the same on a mouse and silent on a finger.** The user reported that opening Production and
  tapping into the **Uppers** category turns what they touched dark. Two things were doing that, both in the pointer
  block at the end of `src/index.css`:
  - the device's own **tap highlight** — Chrome/Safari paint a dark wash over whatever was touched, and only
    `.pin-key` had ever opted out of it (`-webkit-tap-highlight-color: transparent`). The same declaration is now on the
    block's own selector list (`button:not(:disabled)`, `[role="menuitem"]`, `[role="option"]`, `[role="tab"]`,
    `nav a`, `a.group`, `[data-record-id]`), so a card, a row or a button shows the app's feedback and nothing else.
  - **sticky `:hover`.** A touch device sets `:hover` on the element it taps and leaves it there, so the grey-black
    drop shadow (and the `hover-glow-pulse` animation that keeps re-painting it) stayed on the production-stock card,
    the ledger row or the button that had just been pressed. The hover rules — `button:not(:disabled):hover … a.group:hover`
    and `[data-record-id]:hover` — now sit inside `@media (hover: hover) and (pointer: fine)`, so only a real pointer
    keeps the effect. The `:active` rules are deliberately **outside** it: the press feedback the design asks for is
    unchanged on every device.
- **Still theme-specific:** each of the `theme-*` blocks (prism, cosmos, boutique, river, forest, space, shoelaces,
  notebook, glass, …) re-declares its own `:hover` glow further down the file and is **not** media-gated; the shipped
  `dark`/default theme, which is what is in use, is covered by the base block. Wrap those the same way if a themed
  build shows the stuck glow.
- **Verified.** `npm run build` is clean and the live stylesheet the browser receives carries
  `-webkit-tap-highlight-color: transparent` on the pointer block, **two** `@media (hover: hover) and (pointer: fine)`
  wrappers, the `hover-glow-pulse` animation inside one of them, and no top-level `[data-record-id]:hover` left.
- **NOT automatically verified: the look itself.** No app screen is reachable from the preview browser (the app-wide
  device PIN gate sits before the Router and its flag is sessionStorage), and a tap highlight is the platform's own
  paint, invisible to a scripted click — so the fix needs one tap on a phone in the user's own pane. The automation
  browser reports `(hover: hover) and (pointer: fine)` as **false**, which is exactly the touch case the hover rules
  are now excluded from.

## The money mark: H / L / C at the end of an amount (this branch)

- **NOT automatically verified: seeing it on screen (money mark).** The preview browser is on the app-wide PIN gate
  ("Enter your PIN — Five-digit access code") on every fresh load — the flag is sessionStorage and the platform
  replays cookies + localStorage only — so `navigate('/payments')` answers "URL changed but the page content did
  not change" and **no app screen is reachable by automation**; the PIN is never guessed. Type an amount into any
  money field in an unlocked pane (a 5-digit figure must show its H as the fifth digit lands, six digits L, seven
  C, and the plain value must stay what was typed) and look at a ledger or a printed sheet for the mark on the
  figures the app prints.

## Each stage takes only its own labour from the Labour menu (this branch)

- **A stage entry needs that stage's man, and the field no longer guesses one.** `StageEntryDialog`'s labour list is
  the stage's own category links alone — no fallback to every active labour, and the field opens **empty**
  (`labour_id: editing?.labour_id || ""`; the old `stageLabours[0]?.id` auto-pick went with it). `labourOptions`
  is `stageLabours` verbatim, the hint names the stage ("Chosen from the Machine labour in the Labour menu" /
  "No Finishing labour in the Labour menu yet — create one here and he joins Finishing") and the trigger's
  placeholder reads "Choose Machine labour". This **supersedes** the fallback described in "Stage-wise labour in
  the stage entry dialog" above: a stage with nobody linked now offers only **+ Create new labour**.
- **Saving without one is refused, so the chain cannot advance.** `submit()` rejects a missing labour
  ("Choose the Finishing labour who did this stage — his name comes from the Labour menu") and a labour that is not
  linked to this stage ("X does not work Machine — pick a Machine labour from the Labour menu"). Nothing is sent to
  `post_production_stage()`, so the stage records nothing and the next stage still has no article to carry forward —
  the block the user asked for. A man **created from this dialog** is linked to the stage by `linkLabourToCategory()`
  in `LabourForm`'s `onSaved` (and remembered in `linked`), so the new man belongs to the stage and the entry saves.
- **The one-click carry-forward enforces the same rule.** `ProductionStages.moveBatch()` no longer falls back to
  "any active labour": with no man assigned to the target stage it toasts
  "No Machine labour — add a Machine labour in the Labour menu first; Machine takes only its own men." and moves
  nothing.
- **Scope.** The rule lives in the dialog and in the arrow; `post_production_stage()` itself is untouched and still
  accepts any labour id, so nothing already recorded is invalidated. Give stage 3 its man on the Labour screen (or
  from the dialog's own Create/Select) — today no labour carries the Finishing category.
- **Verification status.** `npm run lint` is clean apart from the two pre-existing
  `android/…/native-bridge.js` errors and `npm run build` is clean; the **served** source was read back from the dev
  server (`labourOptions = stageLabours` and the two new error strings are in
  `http://localhost:3000/src/components/production/StageEntryDialog.jsx`), so the module is not stale. **NOT
  automatically verified: the dialog itself** — the preview browser stops on the app-wide PIN gate
  ("Enter your PIN — Five-digit access code"), whose flag is sessionStorage that the platform does not replay, so
  no app screen is reachable and the PIN is never guessed. In an unlocked pane: open Stage 1 → **Add entry** (the
  Labour field must read "Choose Lasting labour", not a name), press **Save stage entry** (must show the inline
  "Choose the Lasting labour…" and write nothing), then pick a man from the dropdown and save for real.

## The production register keeps its days and a daily log (0034, this branch)

- **`0034_production_day_history.sql` is applied.** The Production screen's register stays the **main
  record**; the database duplicates it into history, day by day, and logs every change — no button, no
  close, no cron. `public.production_days` (one row per `day_date`) carries the day's record count per
  source and in total, its pairs, uppers used, cartons, stock value, wage, the moment it was stored and
  a JSON snapshot of its records; `public.production_day_log` is the **append-only** daily log — one row
  per change (`created` / `updated` / `deleted` / `restored`) with the record's values before and after,
  who changed it and when.
- **Three sources, one day.** The Production table merges shoe assembly (`production_entries`),
  production stock (`production_stock`) and the stage entries (`labour_production`), so all three are
  kept: `log_production_change()` fires on each of them and `refresh_production_day(date)` rewrites the
  day from all three. A `production_stock` row has no date of its own, so its day is
  `public.app_day(created_date)` — the factory day (`Asia/Karachi`) `src/lib/datetime.js` prints.
- **An edit never moves a record.** The history day dialog's Edit goes to the **register row itself**
  (`db.ProductionEntry.update` / `db.ProductionStock.update`, the same fields the Production screen's own
  QuickEditDialog exposes); the trigger then re-stores the day and appends the log row, so the record
  stays in the register *and* in the day's history. Moving the record's own date is the only thing that
  re-homes it, and then **both** days are re-stored (the one it left and the one it joined). Stage
  entries are view-only here: their write path is `post_production_stage()` and their wage row.
- **A bookkeeping-only write is not a change.** The trigger compares the *normalized* side of the record
  (`production_record_values()`) first, so the day close's `day_id` stamp (0019) and the `updated_date`
  touch trigger neither log a row nor touch the kept day. A soft delete (the Recycle Bin) **is** a change:
  it logs `deleted` and the record leaves its day; a restore logs `restored` and the day takes it back.
- **`changed_at` defaults to `clock_timestamp()`, not `now()`.** One transaction can log several changes
  (a stage entry writes its production row and its earnings row), and `now()` would stamp them all with
  the transaction's one instant, leaving the log order arbitrary within it. This is why the migration
  also `alter table … set default`, so a re-run of the file repairs an already-created table.
- **Files.** `src/lib/productionHistory.js` (`listProductionDays()`, `listProductionDayLog()`,
  `productionDayEntries()` — the day's own snapshot, `liveProductionRecords()` — the register's real rows
  behind it keyed `kind:id`, `changedFields()`/`describeChange()` — the before → after line the log column
  prints, `EDIT_TARGETS`), `src/components/production/ProductionRegisterDayDialog.jsx` (one kept day: its
  figures, its records, and the view / edit controls), `src/pages/ProductionHistory.jsx` at
  `/production/history` — which now reads three things: the register **day by day**, the **daily log**,
  and the closed factory days the shop floor already kept. `ProductionDayDialog.jsx` (the closed day) is
  untouched. RLS on both new tables is select-only for `production:view`; the trigger is the only writer.
- **Verification.** Applied through the `dbadmin` pooler; `npm run lint` is clean apart from the two
  pre-existing `android/…/native-bridge.js` errors, `npm run build` is clean, and the dev server serves
  all three new modules. The trigger path was exercised in SQL as the signed-in administrator inside a
  transaction that was **rolled back** (a production entry created → its day row appeared by itself with
  its pairs and its snapshot, then an edit re-stored the day and logged `updated` with `240 -> 300`, a
  touch-only update logged **nothing**, a date move removed the old day and wrote the new one, a soft
  delete left no day and logged `deleted`, a restore brought both back, a `production_stock` insert was
  kept in the same day-wise history with its value, and a stage entry's bookkeeping stamp logged
  nothing — `production_days`/`production_day_log` were empty again after the `rollback`). The **edit the
  history dialog performs** was then driven through the API with the dialog's exact payload (a throwaway
  `TEST-HIST` entry): the PATCH answered 204, the log read `created` then `updated` with
  `notes "history probe" → "edited in history probe"`, the day row read 4 records / 1 assembly /
  5,496 pairs / 200 uppers used / 4 cartons, and the edited value was inside the day's snapshot. The probe
  record, its log rows and its `production_stock` probe were deleted by exact id afterwards — the day is
  back to the factory's own 3 stage entries (5,400 pairs, wage 64,800) and the log is empty.
- **NOT automatically verified: the screens themselves.** The preview browser stops on the app-wide PIN
  gate ("Enter your PIN — Five-digit access code"), whose flag is sessionStorage that the platform does
  not replay, so `/production/history` could not be opened (the capture shows the gate) and the PIN is
  never guessed. Open `/production` → **History** once in an unlocked pane: the register table day by
  day, the **daily log** under it, and a day's dialog with its records — then press a record's **Edit**,
  save, and confirm the record is still in the same day and that the change appears in the daily log.

## A `<Money>` without its import blanked the whole app (this branch)

- **The Daily Production screen took the entire app down.** `src/components/production/StageEntryDialog.jsx` rendered
  `<Money text={money(totalPairs * rate, currency)} />` in its wage `CalcRow` but never imported it — a **free
  identifier**, so the module loaded fine and the app worked everywhere else until the Daily Production page mounted:
  `ReferenceError: Money is not defined` threw during render, React unmounted `#root`, and the user was left with a
  blank/black screen and no sidebar. The dialog's children are built by `FormDialog` whether or not it is open, so the
  throw happened the moment `ProductionStages` rendered — clicking the sidebar's **Daily Production** was enough.
- **The money-mark codemod missed the import in 12 files**, not one: `pages/InvoiceNew.jsx`, `pages/PairPriceDesign.jsx`,
  `components/priceCalculator/DesignDialog.jsx`, `components/InvoiceLines.jsx` and the forms `ArticleForm`,
  `ProductionHistoryForm`, `RawStockForm`, `PurchaseForm`, `ProductionForm`, `PaymentForm`,
  `production/StageEntryDialog.jsx`, `production/CategoryProductionDialog.jsx` (each also uses `MoneyInput`, which it
  *did* import — the import line was simply added for the wrong of the two). All twelve now import
  `{ Money } from "@/components/ui/money"`. Every screen those files render — New payment, New invoice,
  New production, New purchase, a raw line, an article, a design — was one click from the same blank app, so this is
  a whole-app fix, not only the Daily Production one.
- **`npm run lint` does not catch this class** (the flat config leaves `no-undef` off), which is why it survived. The
  check that does: `grep -rlE '<Money[ />]' src/ | while read f; do grep -qE 'import \{[^}]*\bMoney\b' "$f" || echo "$f"; done`
  — no output means every `<Money>` has its import. A broader sweep for any other free identifier:
  `docker compose -f docker-compose.base44.yml exec -T web npx eslint src --rule '{"no-undef":"error"}' --quiet` and
  group the messages — with the browser globals (`window`, `document`, `crypto`, `requestAnimationFrame`, …) filtered
  out, **no app-level name is undefined any more**.
- **Verification (this branch).** `npm run lint` (only the two pre-existing `android/…/native-bridge.js` errors) and
  `npm run build` are clean, and the dev server serves the fixed module. The page itself was proved by **rendering its
  own tree headlessly** — Vite's `ssrLoadModule` on `/src/pages/DailyProduction.jsx` with the board injected into the
  component's initial state, then `renderToString`: before the fix it threw `ReferenceError: Money is not defined at
  StageEntryDialog`; after it, 11,387 chars of HTML with the stage cards, the worker section and the wage figures.
  **NOT automatically verified: the click itself in the preview** — the app-wide PIN gate sits before the Router and
  its flag is sessionStorage, which the platform does not replay, so no app screen is reachable by automation and the
  PIN is never guessed. Open **Daily Production** once in an unlocked pane (its stage entry dialog's wage line reads
  `Wage = 1,200 prs × Rs 12` with `Rs 14,400` beside it) and the same for New payment / New invoice.

## A category's production history keeps every register (this branch)

- **The Production Stock card's History used to read one table.** It listed `production_stock` alone — "what was moved
  into production" — so a category whose stock had already been consumed (or that only ever produced through the shop
  floor) opened on an empty page: the Uppers card's History was blank while the factory held three real stage entries.
  Each card's History must keep **all** of that category's production, whatever register it lives in.
- **`src/lib/productionCategoryHistory.js` is the one reader for it.** `categoryProductionHistory(slug)` folds four
  sources into one row shape, newest first: `production_stock` (In production), `production_stock_history`
  (Moved to history — written by `moveToHistory()` and never shown anywhere until now), `production_entries`
  (Production run) and the stage chain's entries (Stage 1 · Lasting …). It returns `{ rows, totals }`, with
  `stockValue` and `wage` totalled **apart** (a stock row's value and a stage row's wage are different figures, and a
  run records neither) and a `correctable` flag per row.
- **The shop floor's records belong to the uppers category.** The stage chain (Lasting → Machine → Finishing) is
  worked on uppers, so runs and stage entries are read for `slug === "uppers"` only; every other category reads its
  two stock tables and nothing else.
- **Trap: a stage entry carries no stage of its own.** `labour_production` has **no** `stage_no` column — the stage
  lives on `labour_categories.stage_no`, and the stage number, the labour's name and the wage are attached by
  `decorateStageEntries()` in `src/lib/productionStages.js` (which also reads `labour_earnings`). So the stage rows
  must come from `stageBoard().recentEntries`, never from a raw `db.LabourProduction.filter(...)` — that read returns
  rows with no stage, no name and no wage (`Stage null`, 0 values). `recentEntries` is every recent entry, closed
  days included, which is what a history needs.
- **`src/pages/ProductionCategoryHistory.jsx` is the page** at `/production/history/:slug` (unchanged route, reached
  from the card's History button on `/production` and on `/production/category/:slug`). One merged table with a
  **Source** column, KPIs (Entries · Pairs · Stock value · Wage earned), search and export as before. A stock row
  keeps its view / edit / delete (`QuickEditDialog`, `softDelete(entity, id)` — the entity is the row's own, so a
  history-stage row is removed from *its* table); a run or a stage entry is **view only**, because the register and
  the stage dialog own those records.
- **Verification (this branch).** `npm run lint` (only the two pre-existing `android/…/native-bridge.js` errors) and
  `npm run build` are clean, and the dev server serves the new module. The reader was exercised headlessly in the
  container (Vite's `ssrLoadModule`, the entity layer stubbed and the Supabase client stubbed only for the stage
  board's own reads): one row per source produced 4 rows, newest first, with `Stage 1 · Lasting` / `Sami` / `1,200 prs`
  / wage 14,400, the run row `value: null`, `correctable` true for the two stock rows and false for the run and the
  stage, and totals `entries 4 · pairs 2,084 · stockValue 6,200 · wage 14,400` — while `chemicals` touched only
  `production_stock` / `production_stock_history` and no stage read at all. The live project's own figures were then
  read back through the REST API: the uppers category holds 3 stage entries (1,800 pairs each, Rs 21,600 wage each),
  so its History now reads 3 rows / 5,400 prs / Rs 64,800 instead of an empty table.
- **NOT automatically verified: the screens.** The preview browser stops on the app-wide PIN gate ("Enter your PIN —
  Five-digit access code"), whose flag is sessionStorage that the platform does not replay, so
  `navigate('/production/history/uppers')` answers "URL changed but the page content did not change" and the capture
  shows the gate; the PIN is never guessed. A headless `renderToString` of the page is **not** possible here either —
  `src/lib/utils.js` reads `window` at module scope, so anything importing it throws under SSR. Open `/production` →
  a category card's **History** once in an unlocked pane to see the merged list.

## The kept production day is permanent (0035, this branch)

- **Why it was reported.** The user: *"Check history button of production why if I update any record it's disappear…*".
  Measured on the live project inside a rolled-back transaction (the probe below), 0034's behaviour was exactly that
  and only that: a **plain field edit** re-stores the day and keeps it (the record stays in the day and in the
  register — nothing disappears), but **moving a record's date** and **removing a record to the Recycle Bin** each
  leave the day with nothing live, and `refresh_production_day()` then deleted the whole day row — so the past day
  and everything it kept vanished from `/production/history`. Editing a record's date is the first field the day
  dialog's own Edit offers, and a delete happens from the register, so both land here.
- **`0035_production_days_permanent.sql` is applied** and replaces **one function**. `refresh_production_day(date)`
  no longer removes a stored day: the day's figures stay the register's live records for that date, and its record
  snapshot now also keeps the rows the day had already kept that the register no longer holds there — with the values
  the day stored for them and `"live": false`. A date that was never stored and holds nothing is still not a day, and
  the daily log (append-only since 0034) is untouched. Rollback: `0035_production_days_permanent.rollback.sql`
  (0034's function verbatim).
- **What the screens do with a row that left.** `src/lib/productionHistory.js` gained `leftTheRegister(entry)`
  (`entry.live === false`) and `DELETE_TARGETS` (`assembly → ProductionEntry`, `stock → ProductionStock`). In `ProductionRegisterDayDialog` such a row carries a **"Left the register"** chip,
  is view-only, and the meta line reads `N records still in the register · M kept from history`; a **live** row now
  carries the same **Edit** it had plus a **Delete** that opens `DeleteDialog` and then `softDelete(<the row's own
  entity>, id)` — the register's own removal path, so the record leaves every screen at once while the day keeps it.
  `ProductionHistory`'s day table shows `N` with a `+M kept` line under it. **A stage entry stays view-only in the
  day dialog** (its write path is the stage dialog, and removing it takes the wage and the ready batch with it) —
  remove one from the Production screen as before.
- **Fixed next to it: the Production table's edit of a stage entry saved nothing.** `Production.jsx`'s
  `QuickEditDialog` gave every non-stock row the production run's fields (`line`, `shift`, `operator`), but a stage
  row is a `labour_production` row and that table has only `production_date` and `notes` — so the save answered
  `column labour_production.line does not exist` and no change landed. A `_type === "stage"` branch now offers those
  two fields (the columns the table has). The register's own delete of a stage entry is `deleteStageEntry()` as
  before, and the day dialog keeps stage rows view-only.
- **The "complete app" half of the request is unchanged by design.** Both the edit and the delete in the day dialog
  act on the **register row** (`production_entries` / `production_stock`), never on the day, so the change is the one
  the whole app already reads; the trigger re-stores the day and logs the change in the same transaction. Confirming
  first is the dialog's own `DeleteDialog`; a `QuickEditDialog` is a form whose **Save changes** is the action.
- **Verified in SQL** (the `dbadmin` pooler, a transaction that was **rolled back**, a probe entry dated 2027-03-01
  so no real day could be touched): create → day row with 1 record / 120 pairs; plain notes edit → day unchanged;
  date moved to 2027-03-02 → **2027-03-01 stays** (`entry_count 0`, its row kept with `live: false`) and 2027-03-02
  holds it live; soft delete → 2027-03-02 **stays** with `entry_count 0` and the row kept `live: false`; restore →
  2027-03-02 live again; the log carried `created · updated · updated · deleted · restored`. `production_entries`
  and `production_days` held nothing of the probe after the rollback. `npm run lint` is clean apart from the two
  pre-existing `android/…/native-bridge.js` errors.
- **NOT automatically verified: the screens.** As every turn since the PIN gate: the preview browser lands on
  "Enter your PIN" (`hiker_pin_unlocked` is sessionStorage, which the platform does not replay) and the PIN is never
  guessed, so the chip, the `+M kept` line and the day dialog's Delete were not driven. In an unlocked pane:
  `/production` → **History** → open a day → **Delete** a record (its confirmation, then the row must stay in the
  dialog marked "Left the register" and the day must stay in the table) and **Edit** one (the change must appear in
  the row, in the register and in the daily log).

## One "today" for the app: the day close and every form date (0036, this branch)

- **The reported error.** *"Could not start a new day — The day 2026-10-21 is already closed — nothing was
  changed"*, under a banner reading **Thursday, 22 Oct 2026**, with *"This day has not completed 24 hours … it
  began Thursday, 22 Oct 2026 at 03:36:33 am"* behind it. Both dates are real and they are **one day apart**,
  because the app had two definitions of "today": every screen prints the factory day (`Asia/Karachi`,
  `src/lib/datetime.js`), while two writers used the **server's UTC day** — `todayISO()` in `src/lib/format.js`
  (`new Date().toISOString().slice(0, 10)`, the date every form opens on) and `close_roznamcha_day()`'s
  `current_date` default. Between midnight and 5 am local the two disagree, so the day was filed under a date no
  screen shows, an entry recorded at 3 am was dated to the previous day, and a second **New day** press inside
  the same UTC day was refused on a date the user had never seen.
- **Fixed in `src/lib/datetime.js`**: `appDayISO(value = new Date())` — `Intl.DateTimeFormat("en-CA", { timeZone:
  APP_TIME_ZONE })`, the one place "the factory's calendar day as YYYY-MM-DD" lives. `src/lib/format.js`'s
  `todayISO()` now returns it (so every form's date default, `InvoiceNew`, `RoznamchaForm`, `ExpenseForm`,
  `PaymentForm`, `ProductionForm`, `StageEntryDialog`, … moved with no call-site change), `monthStartISO()` reads
  its month, and `analytics.factorySummary()`'s "today's production" uses it instead of a second UTC literal.
- **Fixed in the database (`0036_factory_day_close.sql`, applied)**: `close_roznamcha_day()`'s fallback date is
  `public.app_day(now())` — 0034's own factory-day helper — and nothing else about the function changed. The day
  row is therefore named the day the banner and the history print. Rollback:
  `0036_factory_day_close.rollback.sql`.
- **`NewDayButton` no longer walks the user into a refusal.** `press()` compares the day it would close
  (`appDayISO()`) with `lastClosedDay.close_date`: when that day is already in the history the dialog opens on a
  third step — *"Today's day is already closed"*, when it was closed, and only a **Close** button — instead of the
  warning → "Continue" → "Start new day" path that could only end in the database's error toast.
- **The kept day's dialog now corrects every register it holds.** A stage entry used to be **view-only** there
  (the 0034/0035 notes above say so); it now carries the same **Edit** and **Delete** as the assembly and stock
  rows, through the paths the Production screen already uses: `liveStageEntry(id)` (new, in
  `src/lib/productionStages.js`) reads the register row back with its `stage_no`, labour name, wage and
  `grade_lines` — a snapshot holds none of those — then `StageEntryDialog` (edit) or `deleteStageEntry()` (delete,
  which takes the wage and, at Finishing, the Ready Shoes batches with it). `EDIT_TARGETS` / `DELETE_TARGETS` in
  `src/lib/productionHistory.js` stay the table-driven half; the day dialog's `canCorrect()` / `canRemove()` add
  the stage case. Nothing changed about *where* a change lands: always the register row, never the day, so the
  day row and the record stay in the history (0035) and the trigger re-stores the day and logs the change.
- **Verified.** `npm run lint` (only the two pre-existing `android/…/native-bridge.js` errors) and
  `npm run build` are clean, and the dev server serves the new modules. The day default was verified in SQL through
  the `dbadmin` pooler as the signed-in administrator inside a transaction that was **rolled back**: with the books
  as they stand the press now answers *"There is nothing open to close"* instead of naming the 21st; with a day row
  stored for the factory day it answers *"The day 2026-10-22 is already closed"* (the date the banner shows); and
  with one open entry dated the factory day the close wrote the day as **2026-10-22** and stamped that entry with
  it, a second call answering `already_closed: true`. `todayISO()` was read back through Vite's `ssrLoadModule` in
  the container: **2026-10-22** while the UTC `toISOString().slice(0, 10)` read 2026-10-21 at the same instant.
  `roznamcha_days` still holds only its one real row after the rollback (2026-10-21, 4 entries) and no probe rows
  were left. The three stage entries the factory holds were read back too: each labour is active and linked to its
  own stage, so editing one from the history opens with its labour, grades and rate already in place.
- **NOT automatically verified: the screens.** The preview browser stops on the app-wide device PIN gate
  ("Enter your PIN — Five-digit access code") on every fresh load — `hiker_app_pin_unlocked` is sessionStorage and
  the platform replays cookies + localStorage only — so `/production/history` could not be opened and the PIN is
  never guessed. Drive these once in an unlocked pane: **New day** on `/production` (the dialog must name today's
  date, not yesterday's), `/production` → **History** → open the kept day → **Edit** on a stage row (the stage
  dialog, on that entry's own values) and **Delete** (the "Clear this stage entry?" confirmation) — after either,
  the day must still be in the day table and the record still in the day (marked "Left the register" after a
  clear), and the change must appear in the daily log.

## The customer kata's page wears his card, and a row keeps its controls apart (this branch)

- **The white hero card on a customer's kata page is gone.** `PartyDetailView`'s hero wore
  `kata-card--arcticWhite` (a white face with an ice-blue glow); it now wears **`kata-card--purple`** — the
  same face `KataCard` gives a customer's card in the Customers list (`PartyGrid` passes
  `variant="customer"`, which `KataCard`'s `VARIANT_MAP` maps to `purple`) — so the page reads as the card
  the list showed. A supplier's page keeps `kata-card--blackGold`. Leaving `arcticWhite` also drops its
  dark-ink override (`color: hsl(var(--foreground))`), so the hero's white-tinted labels, dividers and
  figures sit on the dark face the rest of the app expects. `arcticWhite` itself is untouched in
  `index.css`/`VARIANT_MAP` — only this caller stopped asking for it.
- **A kata row's view / edit / bin are a real column now, not an overlay.** They were `absolute right-1
  bottom-0` *inside* the row, and the row grid's tracks overflow the row's own padding box (`min-w-[30rem]`
  against ~33rem of tracks inside `overflow-x-auto`), so `right-1` resolved to the **Balance column's**
  right edge: the eye and pencil painted inside the Balance cell, right beside the figure — the user's
  report ("the button inside balance"). The cell the grid already reserved for them (7th track, header `·`)
  now holds `RowActions` as an ordinary grid item (`no-print flex items-end justify-center`), so the
  notebook's own column divider separates them from Balance; the track grew 2.5rem → **3.25rem** so view and
  edit sit side by side with the bin beneath them (RowActions' stacked inner gap 0.5 → 1). `GRID_DIALOG`
  (the full-ledger dialog) has no actions column and is untouched, and the supplier's kata is the same
  component and table, so one change covers both. The labour statement's own `stackDelete` cell just gains
  the same 4px gap.
- **Not automatically verified: both changes on screen.** The preview browser stops on the app-wide device
  PIN gate ("Enter your PIN — Five-digit access code", 11 keypad buttons, no console errors) —
  `hiker_app_pin_unlocked` is sessionStorage and the platform does not replay it — so no kata page could be
  opened and the PIN is never guessed. Verified here instead: `npm run lint` (only the two pre-existing
  `android/…/native-bridge.js` errors) and `npm run build` are clean, and the dev server serves the changed
  modules (`3.25rem` and `no-print flex items-end justify-center` in `PartyDetailView.jsx`,
  `justify-center gap-1` in `RowActions.jsx`). Open a customer's kata once in an unlocked pane: the hero must
  be the dark purple card, and each row's eye/pencil must stand in their own column with the Balance figure
  clear of them.

## The kata row controls were rendered off the end of the notebook (this branch)

- **The user's report — "add these 3 buttons in supplier and customer too" — was a clipping fault, not missing
  buttons.** `PartyDetailView`'s ledger table is a 7-track grid (`GRID`: ~33.5rem of tracks plus gaps and padding
  ≈ **536 px**) inside `kata-notebook … overflow-hidden`, whose `min-w-` was **30rem (480 px)**. The notebook cut
  off everything past its own 480 px — the whole `3.25rem` actions column among it — and the `overflow-x-auto`
  wrapper scrolls only as far as the notebook's own width, so the row controls could not be scrolled into view at
  all. Measured in the live page at 360 px: notebook 478 px against 536 px of content, the action cell sitting at
  x 484–536, entirely inside the clipped strip; the labour statement's notebook was just 14 px short of its grid,
  which is exactly why the buttons in the screenshot the user sent were visible and the customer/supplier ones
  were not.
- **The rule: on these notebooks the min-width must cover the grid it holds.** The ledger now uses
  **`min-w-[35rem]`** (558 px, ~22 px of slack) and the full-ledger dialog **`min-w-[31rem]`** (494 px against its
  483 px of tracks — it was clipping its Balance column too). Re-measured after the change with the ledger's real
  cell contents: both notebooks read `clippedPx 0`, the actions column ends at 551 px inside a 558 px notebook, and
  a 360 px wrapper scrolls far enough to reveal it. The labour statement was left alone (its buttons were already
  visible).
- **NOT automatically verified: the screens.** As with every turn since the PIN gates arrived, the preview browser
  stops on the app-wide PIN screen, so no kata page could be opened; the evidence above is a measurement of the
  app's own compiled grid classes, not a capture of the page. Open a customer's and a supplier's kata on the phone
  once and scroll the ledger right: the eye, the pencil and the bin must stand in their own column beside the
  Balance figure.

## The screens were swept for the faults that blank a page (2026-10-23, this branch)

- **Nothing was broken — no code change came out of this sweep.** Every check ran in the container against the
  running app: the 53 routes in `App.jsx` against the 35 distinct link targets in `src/` (`to=`, `navigate()`, both
  template forms) → **no dead link** (the one near-miss, `/invoices?article=…`, is a query string on a real route);
  every capitalised JSX component against its own file's imports and declarations → **no undefined component**
  (`Money`-style free identifiers blank the whole app — see the section above — so this is the check worth
  repeating; the flags were the XML tags inside `xlsx.js`'s template strings, `<Link>` / `<Outlet>` inside comments,
  and `icon: Icon` destructured in `KpiCard`); every image / JSON / CSS the app references, the manifest's three
  icons included → **HTTP 200, none 404**; `supabase/migrations` at **`0001…0036`, all applied**; and the dev server
  serving the current source (`min-w-[35rem]` / `31rem` in `PartyDetailView.jsx`). Run these the same way —
  **a script written to the sandbox host's `/tmp` is not inside the container**; pipe it in:
  `docker compose -f docker-compose.base44.yml exec -T web sh -c 'node --input-type=module' < /tmp/audit.mjs`.
- **The ready-shoes "Add cartons" rule stays as it is — there is no missing guard to add.** `/ready-shoes` refuses to
  open the batch form until a Stage 3 (Finishing) entry exists *somewhere*, while `/ready-shoes/<grade>` and
  `/ready-shoes/articles/<article>` open it freely — which reads like a hole. It is not one: `save_ready_stock()`
  (0027) is the write path behind all three screens (each opens the same `ReadyShoeForm`) and **requires no
  production at all** — `source` defaults to `'manual'` — and both of those pages' empty states say "…or add cartons
  by hand". Adding the guard would block a supported path; removing it from the one screen that has it would drop a
  warning the factory may want. Owner's call, so nothing changed.
- **"Kata buttons" is the app's own vocabulary, not leftover developer copy.** The section headings on `/customers`,
  `/suppliers` and `/labour` (`Supplier kata buttons`) read like internal wording, but the forms use the same phrase
  in user-facing text ("Customers are shown as kata buttons on the customers page"), so it is the product's term and
  was left alone.
- **NOT automatically verified: the screens, as every turn since the device PIN gate.** `App.jsx` calls
  `lockAppPin()` in the `showAppPin` initialiser, so the pre-login gate re-arms on **every** mount — the preview
  browser therefore stops on "Enter your PIN" (the pane's 40s-old session replayed: 0 cookies, 8 storage keys, the
  gate still shown, no console errors), no screen behind it is reachable by automation and the PIN is never guessed.
  A change to this one would have to be asked for by the owner: it is the gate they wanted on every install.

## The APK's Print / PDF buttons never saved anything — the plugins were not in the build (this branch)

- **The report** ("PDF or print shows downloaded, but the file is not in my file explorer or anywhere") had a single
  cause: the shipped APK contained **no Capacitor plugins at all**. Its `assets/capacitor.plugins.json` read `[]`,
  and neither `com.capacitorjs.plugins.share.SharePlugin` nor `…filesystem.FilesystemPlugin` was in any dex — so
  `src/lib/pdfFile.js` failed at `Filesystem.writeFile`, had no native share sheet to fall back on, and ended in the
  browser-download path, whose only visible effect inside a WebView is the "PDF downloaded" toast. Nothing ever
  reached the device.
- **Why**: that APK was built from `/tmp/apk`, a throwaway Capacitor project whose `node_modules/@capacitor` held
  only `core` / `cli` / `android` / `assets`. `npx cap sync android` copies a plugin's native code only when its npm
  package is installed **in the project being synced** (`capacitor.settings.gradle` resolves it from there), so both
  plugins were silently dropped. The repo's own `package.json` listed them all along, and the committed `android/`
  scaffold referenced them correctly — the build project was the problem, never the code.
- **The APK is therefore built from the repo's own Android project now, not from `/tmp/apk`** (superseding the
  "Build outside the repo" recipe above, whose premise — "`android/` is not gitignored" — is false: 77 of its files
  are tracked source, its artifacts are ignored). In the `web` container:
  `cd /app && npm run build -- --base=./ && npx cap sync android`, then
  `cd /app/android && JAVA_HOME=/opt/jdk21 ./gradlew assembleDebug --no-daemon` (with `sdk.dir=/opt/android-sdk` in
  the gitignored `local.properties`; ~1m20s cold). `cap sync` resolves the plugins from `/app/node_modules` and
  regenerates them into the archive while leaving the tracked `capacitor.settings.gradle` / `app/capacitor.build.gradle`
  byte-identical — check `git status` after a build. **Acceptance check before handing any APK out:
  `assets/capacitor.plugins.json` must name Filesystem and Share.**
- **The file now lands in the phone's own Downloads folder.** `android/app/src/main/java/com/hiker/factoryerp/
  DownloadSaverPlugin.java` is a **local** plugin (registered in `MainActivity.onCreate()` **before**
  `super.onCreate()`, which is why it is deliberately absent from `capacitor.plugins.json` — that file lists npm
  plugins only). On Android 10+ it inserts the bytes into Android's `MediaStore.Downloads` collection (no storage
  permission needed since scoped storage) and on Android 9 and older it writes to the public Downloads folder.
  `src/lib/pdfFile.js` calls it **first** and toasts the exact location ("Downloads/<file> — open it from the phone's
  Files or Downloads app"); only an install without that plugin falls back to `Directory.Cache` + the share sheet.
  Two smaller fixes rode along: the fallback no longer writes to `Directory.Documents` (per Capacitor's own docs
  `ExternalStorage` is Android 9-and-older only and `Documents` is unreliable on Android 11+), and a share sheet the
  user backs out of is no longer treated as a failure — Capacitor rejects it with the message **"Share canceled"**,
  not an `AbortError`, so the old `name === "AbortError"` test missed it and re-toasted a fake "downloaded".
- **Verified (2026-10-22 21:34 UTC, built on this branch):** `release/HIKER-Factory-ERP-android-debug.apk`,
  **10,812,036 bytes, md5 `fa5daed047408876633736412b4ecdd1`**, `BUILD SUCCESSFUL` with no warnings —
  `assets/capacitor.plugins.json` names both plugins, `classes2.dex` holds `SharePlugin` + `FilesystemPlugin`,
  `classes4.dex` holds `DownloadSaverPlugin`, the FileProvider and 24 launcher icons / 31 splash resources are in
  place, the bundle inside (`assets/public/assets/index-GKM5S-6N.js`, md5 `fd79b501bb51abe1b7d325314299f582`)
  matches `dist/` byte for byte, it carries the publishable key (two `sb_publishable_` literals, zero unsubstituted
  `VITE_SUPABASE_PUBLISHABLE_KEY` — the white-screen trap) and the app PIN is compiled in, and the public download
  through `https://8000-${BASE44_PUBLIC_HOST_SUFFIX}/HIKER-Factory-ERP-android-debug.apk` is byte-identical.
  **NOT automatically verified: every Android-specific step** — no device or emulator exists here, so the Downloads
  insert, its appearance in the phone's file manager and the share-sheet fallback need one tap on the phone.
- **Open risk in CI, not fixed here (unverifiable from the sandbox):** `android-apk.yml` step 9 still runs
  `npx cap add android`, which errors when the platform folder already exists — and `android/` is committed. If that
  run is failing, the runner's APK never gets built at all; making the step idempotent (`test -d android || npx cap add android`)
  would make the runner build the same committed scaffold (and therefore this plugin) as the sandbox does. Its
  `paths:` filter also omits `android/**`, so a change to the plugin alone would not trigger a build.

## The daily log is gone; the day-wise history stays (0037, this branch)

- **The user's request:** *"Daily log every production change remove from the production history it takes more
  space"* → clarified to **remove it from the app**. So it was removed on both sides, not merely hidden:
  `src/pages/ProductionHistory.jsx` no longer renders the **Daily log · every production change** table and no
  longer reads the log (`logRows`, `logColumns`, its `listProductionDayLog` call, the local `ACTION_TONES` and the
  page description's daily-log sentence all went with it), and `src/lib/productionHistory.js` lost the pieces only
  that table used — `ACTION_LABELS`, `ACTION_TONES`, `TRACKED`, `FIELD_LABELS`, `show`, `same`, `changedFields()`,
  `describeChange()` and `listProductionDayLog()`. What remains is the register's day-wise reader:
  `listProductionDays()`, `productionDayEntries()`, `leftTheRegister()`, `liveProductionRecords()`,
  `KIND_LABELS` (still used by `ProductionRegisterDayDialog`) and the `EDIT_TARGETS` / `DELETE_TARGETS` pairs.
- **`0037_remove_production_daily_log.sql` is applied.** It replaces **one function** — 0034's
  `log_production_change()` without the log row, its label / stage-label / changed-by lookups and the variables
  they needed — and drops `public.production_day_log` (its two indexes and its select policy go with the table).
  The day-wise history is deliberately untouched: the same trigger still re-stores the day through
  `refresh_production_day()` (both days when an edit moves a record to another date), and a bookkeeping-only write
  still changes nothing. Rollback: re-run `0034_production_day_history.sql`, which recreates the table, the
  function and the trigger — the dropped log rows are gone for good.
- **The table is dropped, not emptied**: nothing else in the repo reads it (`grep -rn "production_day_log" src/`
  is empty; it is not in the Database Center's `EXPLORER_TABLES` and not in `restore_table_rows()`'s allow-list),
  and every write to it duplicated the register. The daily-log notes in the 0034 section above describe code that
  no longer exists.
- **Verification status.** `npm run lint` is clean apart from the two pre-existing
  `android/…/native-bridge.js` errors, and `npm run build` is clean. In SQL through the `dbadmin` pooler as the
  signed-in administrator: `pg_get_functiondef('public.log_production_change'::regproc)` no longer contains
  `production_day_log`, and `to_regclass('public.production_day_log')` is **NULL**.
  **NOT automatically verified: the screen itself.** The preview browser stops on the app-wide PIN gate ("Enter
  your PIN — Five-digit access code", its flag is sessionStorage and the platform replays cookies + localStorage
  only), so no app screen is reachable by automation and the PIN is never guessed. Open `/production` → **History**
  once in an unlocked pane: the register table (days, records, pairs, wage), a day's own dialog and the closed
  factory days must all be there, and **no** Daily log section under the register. Nothing else on the screen
  changed: the register read, `ProductionRegisterDayDialog`, the closed-day list and `ProductionDayDialog` are
  untouched.

## Every ledger entry sits on its own ruled line (this branch)

- **The user's report:** *"3 menus customer supplier labour ledger record it not sit on line correctly so gave a
  specific line to all the entry on specific line that all data fit on it"*. The kata notebooks rule a line every
  **44px**, but the header was `py-2` (≈33px), so the body began between two rules, and a row was only `min-h-11`:
  a row carrying `RowActions`' stacked controls (40px) with its own `pt-2 pb-0.5` measured **52px**, so each entry
  drifted further off the ruling as the ledger went down. The date and money tracks were narrower than the values
  they hold as well — the date cell had 35px of usable width for a 40.2px `23-10-26` and a 5rem money track 71px
  for a 75.9px `−Rs 1,620,000L` (both measured in the ledger's own Kalam face) — so a figure painted past its own
  column.
- **The fix, in `src/components/PartyDetailView.jsx` (customer and supplier kata) and
  `src/components/labour/LabourStatementView.jsx` (labour statement):** the header is exactly one ruled line
  (`h-11 items-center`, no `py-2`); every row is exactly one ruled line (`h-11`, never `min-h-11`, no `pt-2`, and
  `pb-1` so the writing sits just above the rule); the blank padding rows and the opening-balance row follow the
  same shape; and the tracks are sized to the widest value their column holds — date `3.25rem`, time `3rem`, money
  `5.5rem` each. The description is held to its one line (`truncate`, which the labour statement already did), so a
  long label can never push its row past its line. The labour row's controls were an `absolute right-1 bottom-0`
  overlay — 4px lower than the text beside them and free to paint over the last columns — and are an ordinary grid
  cell now, exactly as the kata's are.
- **The notebooks grew with the tracks:** `min-w-[37rem]` for the kata ledger, `min-w-[33.5rem]` for its
  full-ledger dialog, `min-w-[35rem]` for the labour statement — each ~8-12px clear of its own tracks, per the
  min-width rule above.
- **Verification status.** `npm run lint` is clean apart from the two pre-existing `android/…/native-bridge.js`
  errors, `npm run build` is clean, and the dev server serves the changed modules (the new grids and `h-11` headers
  read back from `curl -s http://localhost:3000/src/components/PartyDetailView.jsx`), so no stale module is in play.
  **NOT automatically verified: the rendering.** The app-wide device PIN gate sits before the Router and its flag is
  sessionStorage, which the platform does not replay, so no kata or labour page could be opened and the PIN is never
  guessed. In an unlocked pane open a customer's kata, a supplier's kata and `/labour/<id>`: every entry must sit on
  its own blue line, with its date, description, Jamma, Banam and Balance inside their own columns.

## The daily log is not in a backup (checked, this branch)

- **The user asked to "remove the daily log from the database backups too".** Checked instead of changed, because
  there is nothing to remove and the check is the evidence: `src/lib/backup.js` backs up exactly the Database
  Center's `EXPLORER_TABLES` (22 business tables — the log was never among them, in this or any earlier commit),
  `restore_table_rows()`'s allow-list names 13 tables and not it either, `public.production_day_log` was dropped by
  0037 (`to_regclass` returns NULL), no table, column, index, trigger, policy or function body in `public` mentions
  it, `public.backups` holds no rows, and no `audit_logs` row names it.
- **What is left in the database is two names and two comments:** the function that re-stores a production day is
  still called `log_production_change()` (its body logs nothing — 0037 replaced it), and that name plus
  `production_record_values()`'s comment still read "daily log". Renaming them would touch 0034's own rollback path,
  so they were reported to the user rather than changed on a guess. `production_days` — the day-wise register the
  user asked to keep — is untouched and is deliberately **not** in the backup's table list.

## Jamma green, Banam red, and the balance by which side is ahead (this branch)

- **The rule itself did not change — it was already in `src/lib/kata.js`** (`SIDE_TEXT` Jamma → emerald, Banam →
  rose; `netBalance()` green with a `+` when the Jamma side is ahead, red with a `−` when Banam has overtaken it,
  neutral at zero) and the ledger's **Balance** column already carried it. What was missing was where the two sides
  were *printed*: the kata ledgers rendered their Jamma and Banam figures with no colour class at all, so only the
  Balance column and the side pills were coloured.
- **Fixed in `PartyDetailView.jsx`** (the customer and supplier kata: the page's ledger table, the full-ledger
  dialog and both summary bars) **and `LabourStatementView.jsx`** (the labour statement). The Jamma cell now takes
  `jamma.className` and the Banam cell `banam.className` — the same `sideAmount()` values the columns were already
  computing, so only their colour was added, never the figures. The summary bars' **Closing** / **Balance** figure
  now wears `netBalance(closing, "").className` (`closingTone`), so it is green while Jamma is ahead and red once
  Banam is, exactly like the column below it. Nothing about the arithmetic, the posting paths or `kata.js` moved.
- **A neutral balance is black, not grey (this branch, the user's follow-up: "When neutral the remaining becomes
  black").** `netBalance()`'s zero case returned `text-muted-foreground`; it now returns `text-foreground`, the
  app's plain ink — the same three-state rule the invoice's Remaining box already follows
  (`InvoicePrintView`: red owing, green in advance, black at zero). Because the rule lives in the one helper, every
  balance figure moved together: the ledger's Balance column and opening row, the last-transaction balance, both
  kata summary bars' **Closing** (through `closingTone`), the labour statement's Balance and its outstanding figure.
  The Jamma / Banam **empty** cells keep `text-muted-foreground` (`sideAmount()` is untouched), and the party
  **cards** keep their light tints — `remainingOnCard()` and `PartyDetailView`'s own `cardBalance` still return no
  colour class at zero, because the card face is dark and black there would be unreadable.
- **The summary bar's two totals are the ledger's own columns now (this branch, the user's follow-up: "remaining
  balance work according as if total Banam is greater than total Jamma then red, and if total Jamma is greater than
  total Banam").** `PartyDetailView`'s bar totalled the `kind === "payment"` rows alone, so a customer's invoice sat
  in the **Banam** column while the bar above it read `Banam: Rs 0` — the two figures the balance rule is read from
  contradicted the ledger beneath them, and `Opening + Jamma − Banam` did **not** add up to the `Closing` figure.
  `totalJamma` / `totalBanam` are now `Σ r.credit` and `Σ r.debit` over every row (a customer's invoice's Banam, a
  supplier's purchase's Jamma, the synthetic "received against" rows included), which is what makes the rule hold
  literally: `Opening + Jamma − Banam` **is** `Closing`, so the Closing is green exactly when the Jamma total leads
  and red once the Banam total does. Both summary bars (the page's and the full-ledger dialog's) and the print-only
  header share those two variables and moved with it; nothing is stored, so no posting path, `partyLedger()` or
  `kata.js` moved. The labour statement already read its columns in full — its last row's running balance equals
  `statement.outstanding` (`earned − paid` = `Σ Jamma − Σ Banam`) — so it needed no change.
- **Verification of this change.** `npm run lint` is clean apart from the two pre-existing
  `android/…/native-bridge.js` errors, and the dev server serves the change (`totalJamma = rows.reduce((t, r) => t +
  r.credit, 0)` plus `jamma.className` / `banam.className` / `closingTone` read back from
  `curl -s http://localhost:3000/src/components/PartyDetailView.jsx`), so no stale module. The identity the rule
  rests on is arithmetic over `partyLedger()`'s own rows (`closing = openingCarry + Σ credit − Σ debit`), not a
  screen read: **the colours and the bar were NOT seen on screen** — every fresh load stops on the app-wide PIN gate
  (see below).
- **NOT automatically verified: the colours on screen.** The app-wide device PIN gate sits before the Router and its
  flag is sessionStorage, which the platform does not replay, so the preview browser stops on "Enter your PIN" and no
  ledger page is reachable by automation (the PIN is never guessed). Verified instead: `npm run lint` is clean apart
  from the two pre-existing `android/…/native-bridge.js` errors, and the dev server serves both changed modules with
  the new classes (`jamma.className` twice in `PartyDetailView.jsx`, once in `LabourStatementView.jsx`,
  `closingTone` in each). Open a customer's, a supplier's and a labour ledger in an unlocked pane: every Jamma figure
  must be green, every Banam figure red, and each row's Balance green while Jamma leads it and red once Banam does.

## The ledger columns' ink is per cell, not per position (this branch)

- **The report:** on the customer, supplier and labour ledgers Jamma read dark blue and Banam green — the colours were
  not "changing". Cause: `src/index.css` painted those columns with `.kata-notebook__row > :nth-child(n)` and
  `.kata-notebook__header > :nth-child(n)` colour rules, written for an **8-column** kata table
  ([checkbox] · Date · Time · Description · Jamma · Banam · Balance · Actions). `1bcdd4e` ("Remove selection
  checkboxes…") dropped the ledgers' leading checkbox track and shifted every column one place left, so the rules
  landed on their neighbours — Description red, **Jamma `#00008B`**, **Banam `#00693E`**, Balance `#E31B23` — which is
  exactly what the user's screenshot showed (JAMMA header blue, BANAM green, BALANCE red). The **labour statement
  never matched at all**: it has no Time column. And because a bare class selector (0,1,1) outranks a Tailwind utility
  (0,1,0), those rules beat the `sideAmount()` / `netBalance()` classes the components already put on the cells — so
  the Jamma/Banam colours added by the change described just above could not show, however right the JSX was.
- **The fix:** the positional rules are gone from `index.css` (the column-divider and padding rules
  `.kata-notebook--columns …` are untouched), and each cell now names its own ink: **`NOTEBOOK_INK` in
  `src/lib/kata.js`** — `date` red, `description` dark blue, `descriptionHeader` / `jammaHeader` / `banamHeader` /
  `balanceHeader` — applied in `PartyDetailView.jsx` (the page's ledger, its full-ledger dialog, and the
  opening-balance row, whose two empty dashes are `text-muted-foreground` now) and `LabourStatementView.jsx`. The
  Jamma / Banam / Balance cells keep their dynamic `sideAmount()` / `netBalance()` classes, which now win; nothing
  about the arithmetic, the posting paths or the summary bars moved. **A new ledger table must colour its own cells
  this way — never re-add positional CSS rules**, and remember a plain class selector here outranks the utilities.
- **The summary bars were already right** (`text-[#00693E]` / `text-[#E31B23]` on their own spans, outside any
  notebook), so they were left alone.
- **Verification.** `npx eslint` over the three changed files: 0 errors (only the two pre-existing unused-var
  warnings). The **live** stylesheet carries **no** `kata-notebook__row > :nth-child` / `…__header > :nth-child`
  rule while `.kata-notebook--columns` still does, and it now generates `.text-\[\#00008B\]`, `.text-\[\#1e3a8a\]`
  and `.text-\[\#E31B23\]` — so the new classes do paint. The served modules carry `NOTEBOOK_INK` (20 references in
  `PartyDetailView.jsx`, 8 in `LabourStatementView.jsx`). The `web` service was restarted after the edits: Vite was
  serving `LabourStatementView.jsx` without its default export (`does not provide an export named 'default'`, and the
  whole app rendered blank) — the known stale-module trap, not a code fault.
- **NOT automatically verified: the colours on screen.** Every fresh preview load stops on the app-wide device PIN
  gate ("Enter your PIN — Five-digit access code"), so `/customers/<id>` could not be read this turn either; the
  first load of the check showed the splash and the second the gate. In an unlocked pane open a customer's, a
  supplier's and a labour ledger: Jamma green, Banam red, each row's Balance green while Jamma leads it and red once
  Banam does, the date red and the description dark blue — and the same three columns in the full-ledger dialog.

## The ready-shoes table on the dashboard, cut for the phone (this branch)

- **`FactorySummaryDashboard`'s "Ready shoes by article" table is one grid with two shapes.** A phone
  (< `sm`) shows **Grade · Article · Cartons** alone and in that order; from `sm` up the money columns join
  in the original order — **Article · Grade · Cartons · Cost/pr · Price/pr · Pairs**. The column order is
  carried by per-cell `order-*` / `sm:order-*` utilities on `ARTICLE_COL` (`src/components/dashboard/
  FactorySummaryDashboard.jsx`), and **every cell on the money columns both hides and re-orders**
  (`hidden border-l sm:order-4 sm:block`) — Tailwind's `order` is a plain number, so a cell left at `order-0`
  would jump ahead of its neighbours on the wide layout. The two templates live on `ARTICLE_GRID`
  (`grid-cols-[auto_1fr_auto]` / `sm:grid-cols-[1.7fr_0.6fr_0.9fr_1.1fr_1.1fr_1.1fr]`).
- **Each cell draws its own left hairline** (`border-border/40`, with `border-l-0` on whichever cell is
  visually first at that width) instead of `divide-x`: Tailwind's divide rule follows *DOM* order, so with
  the phone's re-ordered columns the separators would land on the wrong edges.
- **Every width lists the rows article by article** (2026-10-23, at the user's request: the wide layout
  used to keep the pairs order, so an article's grades were interleaved with its neighbours'). `articleRows`
  is sorted by `article_code` with `localeCompare(…, { numeric: true })` so `H+2` follows `H+1` (and `H+10`
  after `H+9`), then by grade. The pairs-descending sort in the data load is now only the base order, and the
  `useIsMobile` import/hook went with the deleted wide branch. **Verified:** `npx eslint` on the file is clean
  and the served module carries the one comparator with no `isMobile`. **NOT automatically verified: the table
  on screen** — the app-wide device PIN gate keeps the dashboard out of the preview browser.
- **Every cell is `whitespace-nowrap` and all text is centred** (the Pairs column used to be right-aligned):
  the old `auto` tracks let `Rs 1,010` wrap mid-value and the cartons cell wrap to a second line, which is
  what made the table read compressed. Padding is `px-2.5 sm:px-3` with no `gap-x`, the hairlines doing the
  separating.
- **Verification status (2026-10-23).** `npx eslint` on the changed file is clean, and — the PIN gate below
  making the dashboard unreachable by automation — the checks that *could* run were read back from the
  running app: the dev server serves the module with both templates and every order utility, and the **live
  stylesheet carries the compiled rules** for `grid-cols-[auto_1fr_auto]`,
  `sm:grid-cols-[1.7fr_0.6fr_0.9fr_1.1fr_1.1fr_1.1fr]`, `.order-1/2/3`, `.sm\:order-1/2/4/5/6`,
  `.hidden` / `.sm\:block`, `.border-l` and `.border-border\/40` (a mistyped arbitrary value compiles to
  nothing, so this is the check worth repeating for a Tailwind layout change). **NOT automatically
  verified: the table itself on screen** — `App.jsx` gates the whole router behind the app-wide device PIN
  (`lockAppPin()` in `showAppPin`'s initialiser) and its flag is sessionStorage, which the platform does not
  replay, so the preview browser stopped on "Enter your PIN" (confirmed again here: 5 storage keys
  replayed, the keypad rendered, no console errors). Look at it once in an unlocked pane, on the phone and
  on a wide screen.

## The dashboard's ready-shoes table lost its money columns (this branch)

- **Cost/pr and Price/pr are gone** from "Ready shoes by article" at the user's request: the box now reads
  **Grade · Article · Cartons · Pairs**, with Pairs hidden on a phone (`ARTICLE_COL.pairs` is
  `hidden border-l sm:order-4 sm:block`) and the wide template
  `grid-cols-[auto_1fr_auto] sm:grid-cols-[1.7fr_0.6fr_0.9fr_1.1fr]`. The columns' `order-*` utilities moved with
  them: cartons keeps `order-3`, pairs is `sm:order-4`.
- **The `db.Article` read went with the columns.** It existed only to map `article_code` → `unit_cost` /
  `selling_price` for this box, so the `Promise.all` is one call shorter and a row no longer carries
  `cost_per_pair`, `selling_price`, `profit_per_pair` or `total_profit`. Nothing else read those fields
  (`Profit.jsx` builds its own rows), and the articles are not otherwise needed here.
- **Verification.** `npx eslint src/components/dashboard/FactorySummaryDashboard.jsx` is clean, and the **served**
  module carries the new grid with no `Cost/pr` / `Price/pr` and no `articleMap`. **NOT automatically verified: the
  table on screen** — the app-wide device PIN gate (`hiker_app_pin_unlocked` is sessionStorage, which the platform
  does not replay) stops every fresh preview load on "Enter your PIN", so the dashboard is unreachable by
  automation and the PIN is never guessed. Look at it once in an unlocked pane, on the phone and on a wide screen.

## The ready-shoes table's phone columns hold their places (this branch)

- **The report:** *"in mobile view the colums lines in specific place not irregular as text is not showing good in
  this"* — on the phone the "Ready shoes by article" table's hairlines wandered from row to row. Cause: every row is
  its **own** grid container, and `grid-cols-[auto_1fr_auto]` sizes an `auto` track to *that row's* content alone, so
  a row reading `A · H+1 · 98` put its rules ~14px left of a row reading `A Mix · H+1 · 2` (the real data: the grade
  "A" is 24px of text against "A Mix"'s 38px, both inside the cell's `px-2.5`).
- **The fix** (`FactorySummaryDashboard.jsx`, `ARTICLE_GRID` only): the phone's three tracks are fixed —
  `grid-cols-[4rem_minmax(0,1fr)_4.5rem]` — each side track sized to the widest thing its column holds ("A Mix", the
  "Cartons" heading, a "0.44" carton count), and the article track is `minmax(0,1fr)` so a long code truncates inside
  its own column instead of widening the row past the panel (a bare `1fr` carries an `auto` minimum, which a
  `truncate` cell — `white-space: nowrap` — would never shrink below). The wide template, the per-cell `order-*`
  utilities and the hairline-per-cell rule are untouched.
- **Verification.** `npx eslint` on the file is clean, the dev server serves the new `ARTICLE_GRID`, and the **live
  stylesheet carries the compiled rule** (`grid-template-columns: 4rem minmax(0,1fr) 4.5rem;`) — a Tailwind arbitrary
  value that fails to compile leaves no rule at all, so this is the check that matters for this kind of change.
  **NOT automatically verified: the table on screen** — the app-wide device PIN gate ("Enter your PIN — Five-digit
  access code") stops every fresh preview load and its flag is sessionStorage, which the platform does not replay, so
  the dashboard is unreachable by automation and the PIN is never guessed. Look at it once in an unlocked pane at
  phone width: the three columns must read as three straight columns, "A Mix" whole, and each cartons figure with
  room on both sides.

## The navigation is a drawer at every width, opened by hover or click (this branch)

- **The user's request:** *"Make the side bar in the exe view or exe or web view that it auto close when open the
  menu like mobile auto close and when hover the mouse or click the 3 line hamburger so open the menu if click on
  menu so close auto"* — i.e. the docked desktop sidebar is gone; the phone's drawer is the navigation everywhere,
  in a browser and in the packaged desktop shell alike.
- **`Sidebar.jsx` no longer docks above `lg`** (`lg:translate-x-0` is gone) and neither its backdrop nor its close
  button is `lg:hidden` any more; the panel now takes `open` / `onClose` / `onMouseLeave` (the prop was
  `mobileOpen`). `TopBar`'s 3-line button lost its own `lg:hidden` and gained `onMouseEnter={onHoverNav}`, so the
  mouse opens the menu on a big screen exactly as it does on a phone, and a click still opens it.
- **`Layout` holds two flags: `navOpen` (showing) and `navPinned` (opened by a click).** Hover opens **unpinned**,
  so the panel retracts when the pointer leaves it (`onMouseLeave` → `hideNavOnPointerLeave`) — otherwise a
  hover-open would stick around for no reason. A click pins it; a picked menu entry (every `NavLink` still calls
  `onClose`), the backdrop or the X clears both. That `onClose` on each entry *is* the "auto close" asked for.
- **`lg:pl-[264px]` went from the markup with it**: the panel no longer reserves width, so content is full width
  at every size. Nothing in `index.css` assumed the dock (checked: no 264/268px rule, no media query putting
  content beside the sidebar), so no CSS moved. On `/` the panel keeps its themed transparency
  (`sidebar-dashboard-transparent`) — the phone's own behaviour, unchanged.
- **NOT automatically verified: the drawer on screen.** Every fresh preview load stops on the app-wide device PIN
  gate ("Enter your PIN — Five-digit access code"; `hiker_app_pin_unlocked` is sessionStorage, which the platform
  does not replay), so `aside` and the 3-line button are not in the DOM at all and no click can reach them — the
  PIN is never guessed. Verified instead: `npx eslint` on the three changed files is clean, and the dev server
  serves them with the new props and without the `lg:` dock rules. In an unlocked pane (browser *and* the EXE): the
  3-line button must be there at full width, hovering it (or clicking) must slide the menu out, picking an entry
  must close it, and it must not stay open once the pointer has left it.

## The dashboard's "Uppers in factory" is the Uppers page's figure (this branch)

- **The report:** *"In dash board the production status must show the uppers in factory as available upper in
  factory not the total uppers"*. The Production Status card (`FactorySummaryDashboard`) and the dashboard's own
  `Uppers in factory` KPI (`src/pages/Dashboard.jsx`) both summed `articleStockMap().uppers_available` —
  `raw_stocks.total_pairs` (category `uppers`) less `production_entries.uppers_used_pairs`. **The shop floor does
  not write `production_entries`:** it records through the stage chain (`labour_production`), so that table has **0
  rows**, the subtraction is always zero, and the card read the pairs **bought** — 5,400 prs across H+1/H+2/H+3 —
  while the Uppers page read **2,512 prs** left. Read back through the REST API (the same three tables
  `uppersArticlePosition()` aggregates): added 5,400, `production_entries` 0, stage-1/stage-3 `pairs_received`
  2,888 → 2,512 remaining (H+1 0, H+2 712, H+3 1,800).
- **The fix: read the uppers position the Uppers page already uses.** Both call sites now add
  `analytics.uppersArticlePosition()` to their `Promise.all` and total `pairs_remaining`; `articleStockMap()` is
  still read (its `ready_available` feeds the Ready shoes card, and `Dashboard.jsx` still hands its map to
  `lowStockAlerts()`), so `stockMap` must not be dropped from either page's load. The alert-level tone on the card
  is unchanged — it compares the same new figure with `settings.low_stock_threshold`.
- **Do not "simplify" this back to `uppers_available`.** Two reads of "uppers in factory" is the trap: the
  article-wise map is right for the Articles screen and the invoice's stock check, but for the factory's remaining
  uppers the stage chain is what consumed them. `lowStockAlerts()` still uses `articleStockMap()`, so the Pending
  Stock list can still flag an article whose uppers are all consumed — reported to the user, not changed here.
- **Verification.** `npx eslint` on both changed files is clean, `npm run build` is clean, and the dev server
  serves the change in both modules (`uppersArticlePosition()` + `num(entry.pairs_remaining)`, no
  `uppers_available` left in either card's arithmetic). **NOT automatically verified: the card on screen** — every
  fresh preview load stops on the app-wide device PIN gate ("Enter your PIN — Five-digit access code";
  `hiker_app_pin_unlocked` is sessionStorage, which the platform does not replay), so the dashboard is unreachable
  by automation and the PIN is never guessed. Look at the dashboard once in an unlocked pane: the card must read
  the same figure as `/raw-stock/uppers` → **Remaining in bag**.

## Two professional factory themes, and a button design of their own (this branch)

- **`Steel` and `Carbon` are appended to the theme cycler** (`ThemeToggle`'s `THEMES` / `ALL_CLASSES`, icons
  `Hexagon` / `Gauge`), so the top-bar button reaches them one press at a time like every other skin. Their
  tokens are two `@layer base` blocks after `.theme-space`: Steel is the cool light works-order palette
  (blueprint grey paper, steel-blue brand, 205° glow), Carbon the dark night-shift one (carbon-charcoal
  surfaces, instrument teal, 174° glow). Both are **workspace-wide**, not decoration: surfaces, sidebar,
  top-bar, panels, inputs, badges and the chart ramp all move with the tokens.
- **The button design is their own, and it lives at the end of `src/index.css`.** Every other theme re-inks a
  `default`-variant button from `--primary`; these two turn the *solid* controls into a machined face —
  `.theme-steel button.bg-primary` / `.theme-carbon button.bg-primary` (plus `a.bg-primary`) set a two-stop
  `background-image` gradient, their own ink (**white** on Steel, the near-black teal of `--primary-foreground`
  on Carbon, which is what makes the teal legible), a hairline border, a weight and an inset top light;
  `bg-secondary` / `bg-destructive` get the matching milled edge, and the hover face, the active face, the
  cool/teal glow and the `[data-record-id]` row glow follow the repo's existing pointer hooks
  (`button:not(:disabled)`, `[role="menuitem"]`, `nav a`, `a.group`, `[data-record-id]`).
- **Two rules to keep when touching this:** the hover faces stay inside
  `@media (hover: hover) and (pointer: fine)` (a touch device must not keep a stuck glow — see the tap-flash
  section above), and this block must stay **outside** Tailwind's layers, below the other `theme-*` blocks, so
  it outranks the `bg-primary` / `hover:bg-primary/90` utilities the Button carries. A future theme that wants
  its own control family belongs in this same place.
- **Verification (2026-10-23).** `npm run build` is clean and `dist/`'s CSS carries both themes; `npx eslint
  src/components/ThemeToggle.jsx` is clean; the dev server serves both blocks (`.theme-steel` ×28,
  `.theme-carbon` ×28 in the transformed `src/index.css`) and the 22-entry toggle list. The rendering was read
  back from the **live** page by applying each class to the document and reading computed styles of the app's
  own hooks: `--primary` 222 26% 13% → **212 50% 26%** (Steel) / **175 64% 34%** (Carbon), `--glow` →
  205 90% 55% / 174 95% 50%, body `rgba(242,245,247,0.55)` / `rgba(19,22,27,0.72)` with each theme's own
  `::before` backdrop, `button.bg-primary` `background-image: linear-gradient(rgb(39,84,134), rgb(26,50,81))`
  with white ink at weight 600 (Steel) and `linear-gradient(rgb(43,182,168), rgb(24,119,114))` with
  `rgb(5,26,26)` ink at 700 (Carbon) — against `background-image: none` on the current default theme — and the
  panel's border and inset light moving with them.
- **NOT automatically verified: pressing the theme button.** The app-wide device PIN gate (`AppPin`, before
  the Router) stops every fresh preview load on "Enter your PIN" — `hiker_app_pin_unlocked` is sessionStorage
  and the platform replays cookies + localStorage only — so the top bar is not in the DOM and the cycle could
  not be driven; the PIN is never guessed. Unlock once and press the theme button round to **Steel** /
  **Carbon**: every panel must take the hairline edge, and every solid button the theme's own face.

## Every raw category on the dashboard (this branch)

- **`src/components/dashboard/RawMaterialPosition.jsx` is the dashboard's raw-material panel**, mounted by
  `FactorySummaryDashboard` between **Pending Stock** and **Current Orders** (its own component and its own reads, so
  the summary's own load is untouched). One row per raw category — the two built-ins plus whatever
  `raw_categories` holds — reading **Category** (with its own unit label under the name), **Remaining**, **Total**
  and **Used for production**, with a caption spelling the three out.
- **A row is read the way its own category records usage — do not "unify" the two.**
  - **uppers**: nothing subtracts `raw_stocks` when uppers go to the floor (the shop floor records through the stage
    chain), so `total` / `used` / `remaining` come from `uppersArticlePosition()` — the same position the Uppers
    page, the "Uppers in factory" card and the dashboard KPI show — and are counted in **pairs**.
  - **every other category**: `moveToProduction()` subtracts the quantity from `raw_stocks` and adds a
    `production_stock` line (later passed on to `production_stock_history`), so `remaining` is the raw stock's
    `sum_quantity` and `used` is **both** production tables together; `total = remaining + used`. Its unit is the
    category's own `unit_label`.
  - `rawStockByCategory()` (uppers included) is read for the non-uppers quantities only — using it for uppers would
    print what was **bought** as if it were what is left, the trap recorded in "The dashboard's 'Uppers in factory'
    is the Uppers page's figure".
- **The table follows the "Ready shoes by article" rules:** one grid with fixed tracks at every width
  (`grid-cols-[minmax(0,1fr)_4.25rem_4.25rem_4.25rem]`, the wide template from `sm` up), each cell drawing its own
  left hairline (never `divide-x`, which follows DOM order), everything `whitespace-nowrap`, the category name
  `truncate`d with its `title` as the fallback. A figure is red only when the category has run out while it was in
  use (`total > 0 && remaining <= 0`); a category with nothing recorded stays plain.
- **Verification (2026-10-23).** `npx eslint` on both changed files is clean, `npm run build` is clean, the dev
  server serves both modules (`RawMaterialPosition` imported and rendered in `FactorySummaryDashboard.jsx`, the new
  module 200), and the `web` service was restarted so no stale module is in play. The four figures were computed
  from the live tables with the panel's own arithmetic: **Uppers 737 pairs left · 5,400 total · 4,663 used**,
  **Chemicals 4 units left · 5 · 1**, **Carton 📦 400 Pieces · 400 · 0**. **NOT automatically verified: the panel on
  screen** — the preview browser stops on the app-wide device PIN gate ("Enter your PIN — Five-digit access code",
  sessionStorage, which the platform does not replay), confirmed again here (splash → gate, no console errors, the
  dashboard not in the DOM). Open `/` once in an unlocked pane: the panel must sit under Pending Stock with those
  rows and no sideways scroll at 360px.

## The message about a closed day can be ignored (0038, this branch)

- **The user's request:** *"make it only show the message not to stop the action … so must add ignore the message"*.
  The message was a dead end — `NewDayButton`'s "closed" step offered only **Close** — and the database refused the
  close a second time over, because `roznamcha_days.close_date` was unique. Asked what the ignore should be allowed
  to do, the owner chose **"Start a new day anyway (even if today was closed once already)"**.
- **`0038_day_close_again.sql` is applied — one index and one function.** `close_date` is no longer unique (the same
  index name, non-unique, so re-running 0015 stays a no-op); `close_roznamcha_day(p_payload)` accepts **`force`**
  (absent or false ⇒ 0036 verbatim, both refusals and the `already_closed` answer included) and with `force: true`
  closes the open day on a date that already holds a close, and may close a day with nothing open (0 entries, the
  balance carried forward). The carry-forward opening now takes the most recent close at or before the press — **the
  same date included** (`close_date desc, closed_at desc`) — otherwise a second close of a date would open from
  yesterday's remaining. Rollback: `0038_day_close_again.rollback.sql` (it fails while a date holds two closes, so
  reopen one first).
- **Client half:** `closeRoznamchaDay({ closeDate, force })` in `src/lib/roznamchaDays.js` sends it, and
  `NewDayButton`'s "closed" step keeps its message while adding **Start new day anyway** (`close(true)`). Its copy
  no longer claims the same day can never be closed twice. `latestRoznamchaDay()` and `listRoznamchaDays()` now
  break ties by `closed_at`, so the day banner, `lastClosedDay` and the history list read the newest close of a
  date. `NewDayButton` is the only caller of `closeRoznamchaDay` (`grep -rn closeRoznamchaDay src/`); the other
  `NewDayButton` mounts (Production, Daily Production, ProductionStages, Kharcha, the three history screens) all
  reach this one dialog.
- **Verified (2026-10-23).** Applied through the `dbadmin` pooler. In SQL as the signed-in administrator, inside a
  transaction that was **rolled back**: the index reads non-unique; the unforced press answered
  `already_closed: true` naming 2026-10-23 (the row closed at 02:57 that morning); the forced press wrote a
  **second day on 2026-10-23** — `opening_balance 19780000` (that close's remaining, not yesterday's),
  `total_in 58000`, `entry_count 1`, `production_count 3` (5,325 pairs), `forced: true`; forced again with nothing
  open it wrote a third row, 0 entries, `opening 19838000`. After `rollback` only the two real rows remained and the
  open book was untouched. `npx eslint` on both changed files is clean, and the dev server serves them
  (`Start new day anyway`, `force: !!force`).
- **NOT automatically verified: the dialog itself.** The preview browser stops on the app-wide device PIN gate
  ("Enter your PIN — Five-digit access code"; `hiker_app_pin_unlocked` is sessionStorage, which the platform does not
  replay) — confirmed again here: `/roznamcha` rendered the gate, the New day button was not in the DOM, nothing was
  pressed and no PIN was guessed. In an unlocked pane: **New day** → the message → **Start new day anyway**; the day
  that is open must move to History (filed under today's date as a second close) and the balance carry forward.

## The production history reads as one record a day (2026-10-23, this branch)

- **The user's request:** *"Update the existing Production History and History button. Do not create a separate
  history card for every production entry … If production is entered 2, 3, or more times on the same date, combine
  all entries into one daily history record … Every time new production is entered for that date, update the
  existing daily record and recalculate its totals … The History screen should show one card per date, sorted
  newest first."* Most of that was **already the database's own behaviour** and was checked, not rebuilt:
  `public.production_days` is one row per `day_date` (UNIQUE, upserted by `refresh_production_day()` through the
  `production_days_keep` triggers on `production_entries` / `production_stock` / `labour_production`), so a date
  holds one consolidated record however many times production is entered, pressing History can never create a
  duplicate, and every total is computed from the **saved** day row and its snapshot — never from screen state.
  Read back live: 2026-10-23 = 7 records / 8,589 prs / Rs 81,768H, 2026-10-21 = 3 records / 5,400 prs / Rs 43,200H.
- **What was missing was the presentation, and that is what changed.**
  - `src/components/production/ProductionDayCard.jsx` (new) is **one card per date**: the day and the moment it was
    last stored, the day's own figures (Production entries · Total pairs · Total uppers used · Total cartons ·
    Wage earned · Stock value · Cash entries where a closed factory day covers that date), the category-wise
    breakdown, and a `RowActions` eye that opens the day's full detail. It carries `data-record-id`, so the delete
    flight and the hover glow find it.
  - `src/components/production/DayCategoryTotals.jsx` (new) is the **category-wise totals** block — one line per
    category the day touched, with the **Grand total** row — rendered by the card **and** by the day's own dialog,
    so the two can never drift apart.
  - `src/pages/ProductionHistory.jsx` renders the register as a grid of those cards (`xl:grid-cols-2`, one column on
    a phone) instead of the day-wise `DataTable`, keeps the search, its loading and empty states, and reads
    `db.RawCategory` once so a stock line prints the category's **name** rather than its slug. The closed factory
    days section, its reopen path, `ProductionDayDialog` and the two History buttons are untouched — that is the
    cash book's own day and a different dataset, and the cards' **Cash entries** figure is read from it
    (`roznamcha_days.entry_count` for the matching `close_date`, newest close first, 0038).
  - `ProductionRegisterDayDialog` gained the category-wise block, the **Cash entries** figure, a heading over the
    records table (**Individual production entries** — every entry stays viewable) and the figures renamed to the
    spec's wording (Total pairs / Total uppers used / Total cartons / Total wage / Production entries).
- **`productionDayCategories(day, { categories })`** in `src/lib/productionHistory.js` is the one reader behind
  both. Grouping rules, worth keeping: a stage entry groups by its `stage_no` (`Stage N · <STAGE_NAMES>`, wage =
  its `value`); the day's assembly runs group as **Production**; a stock row groups by its raw `category`. A record
  with `live: false` (it has left the register) is **not counted** — the day's own figures exclude it too — and each
  saved record is counted exactly once. **A stock row's `value` is stock value, not wage**, so it contributes no
  wage: that is why the grand total ties to the day row's own `wage` and `total_pairs` exactly (checked live:
  2026-10-23 → rows Chemicals / Stage 1 34,356 / Stage 2 34,356 / Stage 3 13,056, grand total 8,589 prs and
  Rs 81,768H = the day row; 2026-10-21 → 5,400 prs / Rs 43,200H = the day row).
- **Verification (2026-10-23).** `npm run build` is clean and `npx eslint` on the five touched files reports no
  error (one pre-existing `react-hooks/exhaustive-deps` warning in the day dialog), and the dev server serves all
  four modules (HTTP 200). The arithmetic was run against the **live** snapshot through Vite's `ssrLoadModule` in
  the container — `productionDayCategories()` on the two real day rows returned the rows and totals above, `ties:
  true` for both — and `ProductionDayCard` was rendered headlessly (`renderToString` with a `window` shim, because
  `src/lib/utils.js` reads `window.self` at module scope) on the real 2026-10-23 row: 5,319 chars carrying the date,
  `Stored 04:34:31 am · 7 records`, all six figures + `Cash entries 4`, the four category lines and
  `Grand total 8589 / Rs 81,768H`.
  **NOT automatically verified: the screen itself.** The app-wide device PIN gate sits before the Router and its
  flag is sessionStorage, which the platform does not replay — a fresh `/production/history` load this turn showed
  "Enter your PIN" and the PIN is never guessed. Open it once in an unlocked pane: one card per date with the
  category-wise table, the eye opening the day's entries, and no sideways scroll at 360px.
- **The History button needed no change, and here is why (worth not re-litigating).** It already *is* "save or
  refresh, never duplicate": the day is stored by the register's own trigger the moment a production record is
  written, and `listProductionDays()` simply reads it back — there is no write path from the browser
  (`refresh_production_day()` is revoked from `public`/`anon`), so there is nothing for the button to save and no
  way for it to duplicate. Requirement 3's "totals calculated from saved records" is the same fact.

## The phone's Back button steps back, and leaves on a second press (this branch)

- **The report:** *"when I press back button … instead of closing the entire application immediately. Send me one
  step back"*. Inside the APK a single Back closed the whole app from any screen. `src/components/AndroidBackButton.jsx`
  (new) registers Capacitor's `backButton` listener **only when `Capacitor.isNativePlatform()`**, so the browser
  preview and the desktop EXE keep their own Back.
- **It is mounted in `App.jsx` next to `ScrollToTop`, inside the `Router` but outside the authenticated routes**, so
  it also answers on the app-wide PIN gate and the sign-in screens — that is where a first press would otherwise
  still close the app, since the gate renders before any route. `toast` is module-level, so no provider is needed
  there.
- **The behaviour:** one press walks one step back through the app's own history (`window.history.state.idx`, which
  React Router keeps on every entry; 0 = the entry the app was opened on). At 0 a press only warns — "Press back
  again to exit" — and a second press within **2 s** calls `App.exitApp()`, i.e. the phone's home screen instead of
  the app vanishing on the first tap.
- **`@capacitor/app@^7.1.2`** is a dependency now (`package.json` + lockfile) and `npx cap sync android` registered
  it in the **tracked** scaffold (`android/capacitor.settings.gradle`, `android/app/capacitor.build.gradle`). A
  plugin that is not installed in the project being synced is silently dropped — that is how the earlier APK lost
  Filesystem and Share. `android-apk.yml` installs `@capacitor/app@7` in its Capacitor step, and its platform step
  is `test -d android || npx cap add android` (the committed `android/` folder *is* the platform; `cap add` refuses
  one that already exists, so the runner would otherwise never build an APK at all).
- **Verification.** The web app boots with the component mounted and no console errors (the new import resolves in
  the bundle), `npm run build` is clean, `npx eslint` shows only the two pre-existing
  `android/…/native-bridge.js` errors, and the APK below carries the new bundle. **NOT automatically verified: the
  gesture itself** — there is no device or emulator here and the listener registers only inside the Android shell.
  On the phone: open a page a step or two deep and press Back (one step back, no exit), then press Back twice at
  the dashboard (the warning, then the home screen).
- **The rebuilt APK (2026-10-23 21:13 UTC):** `release/HIKER-Factory-ERP-android-debug.apk`, **10,868,883 bytes,
  md5 `775a186d005ba8b1e5fb33df0a31f896`** — `assets/capacitor.plugins.json` names `@capacitor/app` beside Filesystem
  and Share, `com/capacitorjs/plugins/app/AppPlugin` is in the dex, its `assets/public/assets/index-V-QP7jgM.js`
  (md5 `a0fe873206f8d91a25e0ca5c80459e7f`) matches `dist/` byte for byte and carries `Press back again to exit` /
  `backButton`, and the public download through
  `https://8000-${BASE44_PUBLIC_HOST_SUFFIX}/HIKER-Factory-ERP-android-debug.apk` is byte-identical. It was built
  from the **committed** scaffold, not `/tmp/apk`. The toolchain lives only in the container layer: `apt-get install
  unzip curl`, Temurin 21 → `/opt/jdk21`, cmdline-tools plus `platforms;android-35` + `build-tools;35.0.0` →
  `/opt/android-sdk`, then `npm run build -- --base=./`, `npx cap sync android`, `sdk.dir=/opt/android-sdk` in the
  gitignored `local.properties`, `JAVA_HOME=/opt/jdk21 ./gradlew assembleDebug --no-daemon` (26 s warm).

## The Uppers card shows what production used (this branch)

- **The report:** *"In production menu the upper category … it must show the total upper product used by production
  and quantity pair"*. The card read **0 / 0 / 0** because `productionStockByCategory()` counted `production_stock`
  rows alone, and **nothing ever writes an uppers row there** — uppers leave the raw shelf through the shop floor's
  own records (the production runs and the stage chain), which is the same reason the dashboard's "Uppers in factory"
  card was wrong twice before (see "The dashboard's 'Uppers in factory' is the Uppers page's figure").
- **The fix is one branch in `src/lib/productionStock.js`.** `uppersProductionStat()` reads
  `analytics.uppersArticlePosition()` — the position the Uppers page, the "Uppers in factory" card, the Raw Material
  Position panel and the stage-1 article dropdown all use — and reports what production consumed: **Items** = the
  articles used, **Quantity** = the bags they came in (the article's own `total_pairs` ÷ `quantity`, rounded per
  article, since the shop floor records pairs and never bags), **Pairs** = the pairs used. A read that fails leaves
  the category on its `production_stock` figures, so the Base44-era path is unchanged.
- **Do not read uppers from `production_stock`**, and do not "unify" the two: a category moved through
  `moveToProduction()` has its quantity in `production_stock`, uppers never do. `productionHistoryByCategory()`, the
  category page (`/production/category/uppers`) and the card's History button already read all registers and needed
  no change — they pick the new row up because they share `productionStockByCategory()`.
- **Verification (2026-10-23).** `npx eslint src/lib/productionStock.js` and `npm run build` are clean, and the dev
  server serves the change (`uppersProductionStat` in the transformed module). The figures were computed from the
  live tables with the function's own arithmetic (raw `total_pairs`/`quantity` per article, `production_entries`
  `input_bags`/`uppers_used_pairs`, stage-3 `labour_production.pairs_received`): **3 articles · 51 bags · 5,033 prs**
  (H+1 1,800, H+2 1,458, H+3 1,775), and the card rendered headlessly with that stat reads
  `Uppers · 3 items in production · Items 3 · Quantity 51 · Pairs 5,033 prs`.
  **NOT automatically verified: the card on screen** — the app-wide device PIN gate stops every fresh preview load
  ("Enter your PIN — Five-digit access code"; `hiker_app_pin_unlocked` is sessionStorage, which the platform replays
  no part of) and the PIN is never guessed. Look at `/production` once in an unlocked pane: the Uppers card must read
  the same pairs its own page's **Remaining in bag** section and the dashboard's Raw Material Position row read.

## The stored day's uppers and cartons read the shop floor (0040, this branch)

- **The report:** *"Uppers used / cartons read 0"* — on the Production history day card (and in its day dialog) both
  figures read **0** on every stored day while the same day held thousands of pairs. Cause: `production_days.uppers_used`
  and `output_cartons` are written by `refresh_production_day()` from `production_entries` alone, and this factory
  records its production on the shop floor through the stage chain — **`production_entries` holds no row at all**
  (read back live: 0 rows), so those two columns could only ever be 0. The day's `total_pairs` and `wage` were right
  all along, because 0039 already counts the stages there.
- **`0040_production_day_stage_totals.sql` is applied — one function.** `refresh_production_day()` is 0039's verbatim
  plus two aggregates: **uppers used** = the assembly's `uppers_used_pairs` + the day's **stage-1** pairs
  (`labour_categories.stage_no = 1`, "Upper / Last Process" — where the uppers are issued and consumed, and the rows
  `uppersConsumptionHistory()` already lists as the upper consumption), and **cartons** = the assembly's
  `output_cartons` + the graded cartons of the **furthest** stage's entries (`grade_lines`, 0020) — counted once with
  the batch, never stage by stage, because the same batch carries its grade split on every stage it passes through.
  A day that did use the assembly form keeps its figures and the stage ones are added, exactly as `total_pairs`
  already adds its three sources. The migration re-stores every day already stored. Rollback:
  `0040_production_day_stage_totals.rollback.sql`.
- **Nothing on a screen computes these.** `ProductionDayCard` and `ProductionRegisterDayDialog` read the day row's
  own `uppers_used` / `output_cartons` (0034/0035/0039); the write path is the same trigger, so a day card can never
  disagree with the record behind it. Do not "fix" a future 0 on the client — the day row is the place.
- **Verification (2026-10-23).** Applied through the `dbadmin` pooler (`CREATE FUNCTION` / `COMMIT`, no error) and
  read back through REST: **2026-10-23 → `uppers_used` 3233, `output_cartons` 179.61**; **2026-10-21 → 1800 / 100** —
  the two dates' own furthest-stage rows (1,088 + 1,775 + 370 pairs and 60.44 + 98.61 + 20.56 cartons; one 1,800-pair
  batch with 100 cartons), while `total_pairs` (3,233 / 1,800) and `wage` (Rs 116,388H / Rs 64,800H) stayed exactly
  as they were. The dev server serves the module that reads them (`uppers_used` + `output_cartons` in
  `ProductionDayCard.jsx`, HTTP 200). **NOT automatically verified: the two figures on screen** — the app-wide
  device PIN gate ("Enter your PIN — Five-digit access code", sessionStorage, which the platform does not replay)
  stops every fresh preview load: this turn's `/production/history` load replayed the pane's 9 storage keys and
  still rendered the keypad, and the PIN is never guessed. Open `/production` → **History** once in an unlocked
  pane: each day card's **Uppers used** and **Cartons** must read the figures above, matching the pairs and the
  grades the day's own stage entries hold.

## The production register is permanent; closing a day no longer empties it (this branch)

- **The report:** *"when close day click the record disappear so I need there permanently as it the main recording
  table for all product … day wise auto close in 24 h to history day wise record correctly so not disappear from
  there"*. Cause: `src/pages/Production.jsx`'s load filtered `day_id: null` on `production_entries` /
  `production_stock` and read `stageBoard()`'s `entries` (the open day), so the moment a factory day was closed
  (0039/0019 stamp `day_id` on the records, the stock rows and the stage entries) the whole register rendered
  empty. Measured live through REST: **all 12 `labour_production` rows and both `production_stock` rows carry a
  `day_id`, and `production_entries` holds 0 rows** — so the list showed nothing at all.
- **The change is one file, `src/pages/Production.jsx`.** The two register reads drop the `day_id` filter
  (`ProductionEntry`'s limit 100 → 500, matching the other two sources) and the stage rows come from
  `board.recentEntries` (every recent entry, a closed day's included) instead of `board.entries`. The day-wise
  grouping in `ProductionRecordsList` was already there, so every day keeps its own heading; a new `dayInfo` prints
  **Open day** / **Closed day** with the day's record count and pairs beside its date.
- **The four summary cards total all days** (the user's request: *"All days total summary added"*). They read the
  register's own day-wise rows — `listProductionDays()` (`production_days`, one row per day, 0034/0040): runs =
  `assembly_count + stage_count`, uppers = `uppers_used`, bags = `input_bags`, pairs = `total_pairs`, cartons =
  `output_cartons`. So each day's pairs are counted once, at the furthest stage that worked the batch, and the cards
  can never disagree with the days `ProductionHistory` lists. They follow the **date range** filter (not the record
  list's category filter), and a factory with no stored day reads 0. **The `openDayRows` / `prodEntries` filter that
  read the live register rows is gone — do not put it back**: that reduction counted every stage of a batch (each
  stage re-records the same pairs), so an all-days figure off the rows would read ~3× the factory's real output
  (15,099 against the 5,033 pairs the three days actually hold). To change what the cards say, change the day rows'
  source — the `refresh_production_day()` function — never the client arithmetic.
- **Do not put the `day_id` filter back** on the two register reads; a closed day's records stay listed under their
  own heading.
- **Verification.** The live counts above (REST, service role), `npx eslint src/pages/Production.jsx` → **0
  errors** (its two warnings are pre-existing: the unused `dayKey` state and a stale `eslint-disable`), and the
  **served** module read back from the dev server (no `day_id: null` left, `recentEntries`, `openDayRows` and
  `dayInfo` all present), so no stale module is in play. Re-checked after the all-days change: the served module
  carries `listProductionDays` / `summaryDays` / `totals.runs` and **no** `openDayRows` / `prodEntries`, `npx eslint
  src/pages/Production.jsx --rule '{"no-undef":"error"}'` (the check that catches the free-identifier class that
  once blanked the app) is clean, and `npm run build` is clean. **NOT automatically verified: the list on screen** — the
  preview browser stops on the app-wide device PIN gate ("Enter your PIN — Five-digit access code"; the flag is
  sessionStorage, which the platform replays no part of — the pane's 9 storage keys were replayed and the keypad
  still rendered) and the PIN is never guessed. Open `/production` once in an unlocked pane: the records must be
  there under day headings reading **Closed day**, and the four cards must read the **all-days** figures —
  **Production runs 12** (hint `3 day(s)`), **Uppers issued 5,033 prs** (`0 bag(s)`), **Pairs produced 5,033 prs**
  (`279.61 carton(s)`) and **Yield 100%** on 2026-10-23. Those are the sums of the three stored days (2026-10-24 ·
  2026-10-23 · 2026-10-21), computed this branch from the live `production_days` rows with the page's own
  arithmetic; on screen they were not seen (the PIN gate above).

## The history screen shows the same all-days summary as the register (this branch)

- **The user's request:** *"Now make the same all days total summary on the production history screen too"*. The
  page's single `PAIRS IN HISTORY` panel (the closed factory days' stage entries) is replaced by the **same four
  KPI cards** the Production screen shows — **Production runs** (`N day(s)`), **Uppers issued** (`N bag(s)`),
  **Pairs produced** (`N carton(s)`) and **Yield** — totalled over **every day the register keeps**. The closed
  days' count line ("N closed days — the open day's stage entries stay on the Production screen.") moved under the
  **Closed factory days** heading, where that list actually lives; nothing else on the screen changed.
- **One aggregate, two screens.** The reduction was extracted out of `Production.jsx` into
  **`productionDayTotals(days)`** in `src/lib/productionHistory.js`, and both pages call it: Production over the
  days its own **date range** covers (`summaryDays`), History over `registerDays` (everything `listProductionDays()`
  returns). So the two summaries cannot drift — change the arithmetic in one place, or better, change the day rows'
  source (`refresh_production_day()`) as the section above says.
- **Do not total the records again on this screen.** The history's records are read for the list (`recordRows`,
  `productionDayRecords`) and must never feed the cards: a batch is re-recorded at every stage it passes through,
  so summing rows would read roughly three times the factory's real output. The cards read the **day rows**
  (`assembly_count` + `stage_count`, `uppers_used`, `input_bags`, `total_pairs`, `output_cartons`) exactly as the
  register does. The page's old `overall` (closed factory days only) and its lone `cn` import went with the panel.
- **Verification.** `npx eslint` on the three changed files is **0 errors** (the two warnings on
  `Production.jsx` — the unused `dayKey` and a stale `eslint-disable` — are pre-existing), `eslint
  --rule '{"no-undef":"error"}'` on them is clean (the free-identifier class that once blanked the app), and
  `npm run build` is clean. The **served** modules were read back from the dev server, so no stale module:
  `productionDayTotals` is exported by `productionHistory.js`, `ProductionHistory.jsx` imports `KpiCard` and the
  helper and renders the four cards off `totals.*`, and `Production.jsx` renders `productionDayTotals(summaryDays)`.
  **NOT automatically verified: the screen itself.** A fresh `/production/history` load in the preview stopped on
  the app-wide device PIN gate ("Enter your PIN — Five-digit access code", its flag is sessionStorage and the
  platform replays cookies + localStorage only — the pane's 9 storage keys were replayed and the keypad still
  rendered), so no card was seen and the PIN is never guessed. Open `/production` → **History** once in an unlocked
  pane: the four cards must read the same figures the Production screen's cards read (the register's days, not the
  history's record list), with the same hints, above the register list.

## The APK was rebuilt after the summary change (this branch)

- **The link:** `https://8000-${BASE44_PUBLIC_HOST_SUFFIX}/HIKER-Factory-ERP-android-debug.apk` (the `downloads`
  service, host port 8000, serving the gitignored `release/`). Rebuilt **2026-10-24** —
  `release/HIKER-Factory-ERP-android-debug.apk`, **10,866,932 bytes, md5 `a27b67ac5ce1a8a53d8e1c7265438e05`**.
- **It holds exactly this build.** Built from the **committed** `android/` scaffold, the way the section above
  describes (`npm run build -- --base=./` → `npx cap sync android` → `JAVA_HOME=/opt/jdk21 ./gradlew assembleDebug
  --no-daemon`, 49 s with the container's warm `/opt/jdk21`, `/opt/android-sdk` and `/root/.gradle`; no toolchain
  reinstall was needed this time), then copied over `release/`. The bundle inside
  (`assets/public/assets/index-BM525NHZ.js`, md5 `5bd8712b860138faa2430174b8e57710`) matches `dist/` **byte for
  byte** — that is the check that proves the archive is this build and not a stale one.
- **Acceptance checks, all green:** `assets/capacitor.plugins.json` names **@capacitor/app, @capacitor/filesystem
  and @capacitor/share** (the print/share path), the plugin classes are in `classes2.dex` / `classes4.dex`, the
  bundle carries the publishable key (**2** `sb_publishable_` literals, **0** unsubstituted
  `VITE_SUPABASE_PUBLISHABLE_KEY` — the white-screen trap), `git status` is clean of the tracked `android/` scaffold
  after `cap sync`, and the public download answers **200** with
  `application/vnd.android.package-archive` and a **byte-identical** md5.
- **Still not automatically verified:** every Android-specific step (no device or emulator exists here) — install
  it on the phone and confirm the new summary renders on `/production` and `/production/history`.

## A register record is corrected from the history too, through one path (this branch)

- **The report:** *"Production Record one record a row in history and production add edit delete viewbutton to each
  entry history so I can manage my daily production entries."* The row-based register was already in place on both
  screens (see "The production register is permanent" / "The history screen shows the same all-days summary"); what
  the `/production/history` list was missing was the **edit and delete** the Production screen gives a row — it
  offered only the eye, and a correction had to go through a day's dialog.
- **`src/components/production/ProductionRecordManager.jsx` (new) is the one path both lists correct a record
  through.** It is a render-prop component: a list nests the rows it draws inside it and gets the row's own
  `RowActions` back (`children({ actions, canCorrect, canRemove })`, `actions(row, onView)`), while the dialogs live
  in the manager: `QuickEditDialog` (assembly / stock, written to the register row itself), `StageEntryDialog`
  (`liveStageEntry()` → `post_production_stage()`, so a stage entry's grade rows, wage and Finished Ready Shoes
  batch stay in step) and `DeleteDialog` → `softDelete(<the row's own entity>)` / `deleteStageEntry()`. The
  snapshot row names its record by the register's own id, so the manager reads the live row back **by id**
  (`db[entity].filter({ ...ALIVE, id })`, and `liveStageEntry(id)` for a stage) and toasts "Not in the register"
  instead of acting on nothing. A row marked `leftTheRegister` is drawn **view-only** on both screens.
- **`ProductionRegisterDayDialog.jsx` now uses it too** — its own edit / delete state, handlers and dialogs
  (`live` map, `liveProductionRecords`, `recordKey`, `EDIT_TARGETS` / `DELETE_TARGETS` handling, `useToast`) were
  removed and it renders `recordActions(entry, () => setViewing(entry))`, so the two screens cannot drift. Its
  figures, category breakdown, view dialog and copy are unchanged; `onChanged` is the page's own reload
  (`reloadRegisterDay(day)` on the history, `loadRegister()` for the list itself), so the day re-reads and a removed
  record reads back marked as one that left.
- **`ProductionHistory.jsx`** wraps its `ProductionRecordsList` in the manager and passes
  `actions={(row) => row.left ? <RowActions onView/> : recordActions(row, () => setViewingRecord(row))}` (and the
  same pair to the phone `ProductionRecordCard`, which previously got no controls at all). No read, write path,
  filter or KPI changed — **new entries are still recorded on `/production`** with **New production**.
- **Verification (this branch).** `npx eslint` on the three changed files with `--rule '{"no-undef":"error"}'` is
  clean (that rule catches the free-identifier class that once blanked the app) and `npm run build` is clean. The
  list composition was rendered headlessly in the container (Vite's `ssrLoadModule` + `renderToString`, a `window`
  shim; **`node --input-type=module` needs `timeout` and no `globalThis.navigator` assignment — Node 22 makes it a
  getter and the run hangs**) over a stored day built by `productionDayRecords()`: the assembly, the stock and the
  stage row each rendered **view + edit + delete**, the `live: false` row rendered **view only**, 26,601 chars of
  HTML. The `web` service was restarted afterwards, and the served modules carry the manager.
- **NOT automatically verified: the buttons on screen.** Every fresh preview load stops on the app-wide device PIN
  gate ("Enter your PIN — Five-digit access code"; `hiker_app_pin_unlocked` is sessionStorage and the platform
  replays cookies + localStorage only — the pane's 9 storage keys were replayed here and the keypad still rendered),
  so `/production/history` could not be opened and the PIN is never guessed. In an unlocked pane: open
  `/production` → **History**, press a row's **Edit** (the dialog must open on the register row's own values; the
  day's figures and the row must follow the save) and its **Delete** (the confirmation, then the row must read
  "Left the register" and stay in the day), and check the phone card carries the same three controls.

## The APK link was handed out again after the row-actions commit (this branch)

- **The link:** `https://8000-${BASE44_PUBLIC_HOST_SUFFIX}/HIKER-Factory-ERP-android-debug.apk` (the `downloads`
  service, host port 8000, serving the gitignored `release/`). The file sitting there was from **2026-10-24 07:48**,
  i.e. older than commit `780f278` (the per-row view/edit/delete controls), so it was rebuilt before being handed out.
- **Built from the committed `android/` scaffold** with the recipe in "The APK is therefore built from the repo's own
  Android project now" — `npm run build -- --base=./` → `npx cap sync android` →
  `JAVA_HOME=/opt/jdk21 ./gradlew assembleDebug --no-daemon` (15 s; `/opt/jdk21`, `/opt/android-sdk` and
  `/root/.gradle` were all still in the container layer) — then copied over `release/`.
- **Result:** `release/HIKER-Factory-ERP-android-debug.apk`, **11,559,779 bytes, md5
  `5b37314fe353d4e93d8a643427e0f4ef`**. Acceptance checks all green: `assets/capacitor.plugins.json` names
  @capacitor/app + @capacitor/filesystem + @capacitor/share, the bundle inside
  (`assets/public/assets/index-Cataq84W.js`, md5 `4376b65f3552143494d4c58adc731b5f`) matches `dist/` **byte for
  byte**, the publishable key is baked in (1 `sb_publishable_` literal, 0 unsubstituted
  `VITE_SUPABASE_PUBLISHABLE_KEY` — the white-screen trap), the PIN-gate copy is in the bundle, `git status` is clean
  of the tracked scaffold after `cap sync`, and the public download answers **200**
  `application/vnd.android.package-archive` with a **byte-identical** md5.
- **Still not automatically verified:** every Android-specific step (no device or emulator exists here) — install it
  on the phone and confirm the row controls render on `/production` → **History**.

## The app comes back where the user left it (this branch)

- **The report:** *"When I back from app to other app or home screen I didn't resume where I left as it starts from
  scratch instead of resuming my current session … so please fix the app state persistence."* Leaving the app in the
  background and coming back re-mounted `AuthenticatedApp`, and **`App.jsx` locked the app in the initialiser it ran
  on every mount** (`lockAppPin()` — the note "the pre-login gate re-arms on every mount" above is superseded by
  this section): the loading screen played again, the PIN was asked again, and the router opened on `/` (the APK's
  WebView reloads at `hiker://app/`, not at the route the user was on), so the user was back at the dashboard.
- **`src/lib/appState.js` (new) is the whole memory of one app open**, in **sessionStorage** — a cold launch has
  none, which is exactly the distinction wanted: `beginAppOpen()` (the `hiker_app_open` marker) says "this is the
  same open coming back", `rememberScreen()` / `lastScreen()` (the `hiker_last_screen` key) hold the screen the user
  was on, path and query. `lastScreen()` refuses `/`, and the auth screens (`/login`, `/unlock`, `/setup-pin`,
  `/change-pin`, `/pin-not-issued`, `/register`, `/forgot-password`, `/reset-password`) — a step is not a screen to
  come back to.
- **`App.jsx`** now takes `const [resumed] = useState(beginAppOpen)`: the **splash is skipped** when `resumed`, and
  the gate is `!(resumed && isAppPinUnlocked())` — i.e. **a resume inside the session that already gave the PIN goes
  straight in**, while a cold launch (no marker, no `hiker_app_pin_unlocked`, which only `AppPin`'s own
  `unlockAppPin()` ever sets) still asks it. `lockAppPin()` was removed from `src/lib/appPin.js` with its only
  caller. Never make the gate skip on the marker alone — it would let a session with no PIN in.
- **`src/components/SessionRestore.jsx` (new, mounted inside the `Router` next to `AndroidBackButton`)** does both
  halves: it remembers every signed-in screen, and **once per app open** (a `settled` ref) it navigates to the
  remembered one, but **only when the load opened on `/`** — a load whose URL already names a screen (a browser
  reload on a route, the `hiker://` shell) needs no help. Two traps it encodes: the remembered screen is read in
  `useState`'s initialiser *before* the effect can overwrite it with `/`, and **the restore must be one-shot** — the
  first version re-applied `navigate(resume)` on every navigation, so leaving the first screen bounced the user
  back (caught in the preview as "the app navigated away to /articles while confirming /production").
- **Verified in the preview** (Supabase, the user's replayed session, 360px): on a fresh load of `/` the app landed
  on `/articles` (h1 "Articles"), with **no loading screen and no PIN screen** — twice, in two different calls, each
  after a shell command had forced the reload; `sessionStorage.hiker_last_screen` read `/articles` and
  `hiker_app_open` read `1` on arrival, and navigating to `/production` afterwards stuck (the one-shot fix), leaving
  `hiker_last_screen` = `/production`.
- **NOT automatically verified: the cold-launch half.** It cannot be produced in this browser — the platform
  replays the pane's storage (the PIN flag included) on **every** document load, so clearing
  `hiker_app_open` / `hiker_app_pin_unlocked` / `hiker_last_screen` and then `location.assign('/')` came back with
  all three present again and the app resumed (the check is recorded here so it is not retried). By code, a cold
  launch has neither key, so `showSplash` and `showAppPin` are both true. **Also not verified: the phone's own
  background/resume gesture** (no device or emulator here) — install the APK and check that leaving the app and
  returning holds the screen. **And a half-filled form is deliberately not remembered**: this is the *screen*, not
  the field — say so if draft fields are wanted.

## The article's cost per pair is a snapshot of one ready pair design (0041, this branch)

- **The request:** *"when creating new article make cost price auto fetch from pair price calculation menu ready
  pair category and selling price by input manually, and if I change the ready shoes category price it fetches for
  the new article or current new production so it does NOT affect the already made ready shoes cost … and make
  dropdown to select the specific design for each article from ready shoes category."*
- **`ArticleForm`'s Cost per pair field is that dropdown.** The calculator button and the
  `PriceDesignPicker` dialog (the file is **deleted**) are gone; the field is a `MoneyInput` with a `Select` of the
  ready pair category's designs under it (`listReadyPairDesigns()`), each option reading `name · Rs N / pair`.
  Choosing one writes the design's `total_cost` into `unit_cost` **and** its id into `price_design_id`. The Selling
  price field lost its calculator button with it — it is typed by hand, as asked — and the profit line
  (`selling − cost`) follows both.
- **`0041_article_price_design.sql` is applied**: `articles.price_design_id uuid` + FK to `price_designs(id)` with
  `on delete set null`. It is a **reference only**. `articles.unit_cost` stays the article's own snapshot, so
  re-costing a design never rewrites an article or the pairs already made from it: the article created next picks
  the new figure up. The form shows the drift instead — when the chosen design's cost has moved since the article
  was saved, the hint under the dropdown becomes an offer (`PU paper Wala now costs Rs 1,052 a pair — use the new
  cost`, the `[#F89E1B]` button) which re-fills the figure; when they agree, the plain note shows.
- **Verified in the preview** (Supabase, the user's replayed session, 360px, the whole flow driven in the app):
  the Selling field holds **0 buttons**; the dropdown listed `PU paper Wala · Rs 852 / pair` and
  `PU chapati Wala H+ · Rs 1,010 / pair`; picking the first filled Cost **852** and the profit row read
  `Rs 348` for a typed `1200`; Save answered a `201` on `articles` and the row read back
  `unit_cost 852, selling_price 1200, price_design_id 5628e08c…` (the design's own id). Then that design's
  **Upper** material was edited 500 → 700 through `/pair-price-calculator/<cat>/<design>` (total `Rs 1,052`): the
  article's stored cost **stayed 852** and its form showed the offer above; filling the material back to 500
  (`Rs 852`) cleared the offer, with the cost still 852. The probe article was then deleted by exact id and the
  design's six material rows read back exactly as they were (500 · 50 · 20 · 30 · 250 · 2 = 852), so nothing of the
  check is left.
- **Driving a Radix `Select` here:** a **`pointerdown` on the trigger** opens it (the keyboard `ArrowDown` route
  did not in this dialog) and the option takes `pointermove → pointerdown → pointerup`; the trigger's own text is
  the read-back that the pick landed. `/pair-price-calculator/<cat>/<design>` — the design's material page — has no
  link from the design card, so a script has to navigate to it by URL.
- **NOT automatically verified: the "use the new cost" button's own press** (the offer was read, the press was
  not driven). Press it once in an unlocked pane: the figure must become the design's current cost and the offer
  must disappear.

## A half-filled form survives leaving the app (this branch)

- **The request:** *"Also remember my half-filled form when I switch apps and come back"* — the follow-up to "The app
  comes back where the user left it", whose last line said a half-filled form was deliberately **not** remembered.
- **`src/lib/formDraft.js` (new) is the whole memory of one half-typed entry**, in **sessionStorage** for the same
  reason the remembered screen lives there: a cold launch has none. `useFormDraft(scope, { open, onOpenChange, values,
  enabled })` keeps the values while the dialog is open (a dialog merely opened and left alone keeps nothing — every
  value empty/0/false), and **opens the dialog again on them** when the app comes back, which is what "and come back"
  needs: a reload loses the page's own `formOpen` state, so the kept entry is what reopens it.
  - `draft.dialog` (`{ open, onOpenChange }`) is spread onto `<FormDialog>`; `draft.active` replaces the `open` prop
    in the form's effects, so a reopened dialog still loads its dropdowns, today's date and its account list;
    `draft.restore(base)` puts the kept values on top of the defaults the form opens with; `draft.close()` is what
    Cancel and a successful save call — **that is also what forgets the entry**, so a stale draft can never
    resurface later (Cancel, Escape, overlay-click and Save are one path).
  - **Only a *new* entry is kept** (`enabled: !initial?.id`). An edit form carries a record id, and reopening it on
    values read back from storage is how a record gets overwritten with something the user may no longer mean.
- **Wired into all twelve entry forms in `src/components/forms/`**: Article, Raw category, Customer, Supplier,
  Kharcha (`kharcha`), Payment, Roznamcha, Purchase, Raw stock (`raw-stock:<slug>` — one entry per category), Ready
  shoes, Production history and Production. `ExpenseForm` names its hook result `formDraft` because it already has a
  `draft` (the category being typed). **`PaymentEditDialog` is deliberately out**: it is an edit-only correction that
  takes a `payment` prop, never a new entry. The Production form keeps **`{ category, uppers }`** — the uppers entry
  is the one that is typed; the consumption branch's own figures are read from the stock item it picks each time it
  opens, and the stage dialog (grades, rate) is untouched.
- **A form wired this way must use `draft.active`, never `open`, in its effects** (`if (!draft.active) return;`,
  `}, [draft.active, …])`) — otherwise a reopened dialog comes back with empty dropdowns. And `onOpenChange(false)`
  must not be left on a Cancel button or a save path: it leaves the entry behind and the dialog reopens later.
- **Verification (this branch).** `npm run lint` is clean apart from the two pre-existing
  `android/…/native-bridge.js` errors, `npm run build` is clean, `eslint src --rule '{"no-undef":"error"}'` reports
  only browser globals (no app-level free identifier), and every wired form was checked to carry the import, the
  `{...draft.dialog}` spread and no `onOpenChange(false)` of its own. **Driven in the preview** (Supabase, the user's
  replayed session, 360px, `/articles`): **New article** opened the dialog, `PROBE-9` / `Draft probe` were typed into
  it and `sessionStorage['hiker_form_draft:article']` held exactly those values; leaving the screen for `/production`
  and coming back **remounted the form, which reopened the dialog on its own** with `PROBE-9` / `Draft probe` in it
  (the same mount-time read a reload performs); **Cancel** closed the dialog and removed the key, and the Articles
  list still read 0 — nothing was saved or left behind. **The remount was used instead of a real reload because the
  preview harness replaces sessionStorage with the pane's on every document load** (observed here: the kept entry
  written in one call was already gone on the next fresh load, as the pane's own keys are replayed) — so a real
  reload cannot be read back in *this* browser, while on a phone the reload and the remount are the same code path.
  **Not automatically verified:** the phone's own background/resume gesture (no device here) and the same check on
  the other eleven forms — one form proves the mechanism; the rest were read, not driven.

## Sizes, colours and the uppers bags (this branch)

- **The article's sizes and colours are pickers now.** `ArticleForm`'s two comma-typed `Input`s are `TagInput`s
  (the component the customers/suppliers forms already use) with `SIZE_OPTIONS` (36–46) and `COLOUR_OPTIONS`
  offered as `+ 42` / `+ Black` chips; a tag can still be typed by hand, clicking a chip adds it and the chip
  disappears from the suggestions, and the form keeps its own `"41, 42"` string in state (so `formDraft`, the
  restore path and the saved jsonb array are untouched). The lists live in **`src/lib/articleOptions.js`**
  (`SIZE_OPTIONS`, `COLOUR_OPTIONS`, `parseList`, `articleList`).
- **An uppers line carries its bags, `custom_json.upper_bags` = `[{ color, size, bags }]`.** One row per bag type —
  a bag holds one size of one colour — entered in `RawStockForm` through the "Colour and size" button beside the
  Low stock alert field, which opens **`src/components/stock/UpperBagsDialog.jsx`** (see the section at the end of
  this file; the breakdown used to be an inline block in the form). **Nothing about `raw_stocks` changed**: the breakdown is a `custom_json` key, the line's
  `quantity` is the rows' total (the field turns read-only and shows it), `total_pairs` stays `bags × pairs_per_pack`,
  and the rows ride inside `values` so a half-filled form is remembered like every other field. A line with no rows
  behaves exactly as before.
- **`src/lib/upperBags.js` is the one reader of that key** — `parseBagBreakdown()` (object or JSON string,
  unreadable → `[]`), `mergeBagRows()` (the same colour+size in two lines becomes one row), `bagRowsTotal()`,
  `allocateBagRows()` and `groupByColor()`.
- **The deduction is spread evenly, and that is the user's rule.** `allocateBagRows(rows, bagsUsed)` takes the
  bags **one at a time, round and round the whole size-and-colour run**, instead of emptying the first row — so
  issuing N bags takes a bag from each size/colour in turn, which is how a carton is packed ("all sizes and colours
  equally"). It is derived, never stored: the bags used are the ones production already records
  (`production_entries.input_bags`, summed per article), so no second ledger exists and nothing can disagree with
  the register.
- **Where it shows.** `analytics.uppersArticlePosition()` now also reads the uppers lines themselves (the aggregate
  cannot see `custom_json`) and returns `bag_rows` per article (used/remaining per size and colour).
  `UppersByArticle` prints them colour by colour as `42 · 1/2` chips (red at zero) under the article's figures, and
  `RawStockLineCard` lists a line's own bags. `ReadyArticleCard` shows the article's sizes and colours as a
  read-only chip line, `ReadyArticlePage` as a panel, and **`readyBatchColumns(articles)` gained a "Sizes · Colours"
  column** (right after Carton, read from the batch's article) — it is only added when a caller passes the article
  list, so `/ready-shoes` and `/ready-shoes/<grade>` and `/ready-shoes/articles/<code>` show it and any caller that
  does not keeps its old columns. `ReadyShoeForm` prints "What the cartons hold" from the chosen article.
- **Do not "fix" the deduction on a screen.** The remaining figure is a read of `input_bags` against the line's own
  bag rows; if the spread is ever wrong, `allocateBagRows()` is the single place to change.
- **Verified in the preview** (Supabase, the user's replayed session, 360px — the app-wide PIN gate did **not**
  appear this turn: the pane's storage took the browser straight in):
  `/articles` → **New article** offered `+ 36 … + 46` and `+ Black / Brown / White …`; picking `+ 42` and
  `+ Black` added both tags, the picked chips left the suggestions, the tag's own `Remove 42` took it off again,
  and **Cancel closed the dialog with no `hiker_form_draft:article` left**.
  `/raw-stock/uppers` → **Add item** opened with no bag rows and the note "No size and colour split yet";
  **+ Add bag** twice made two rows, typing `Black 41 2` and `Black 42 3` left the Quantity field reading **5**
  ("Added up from the size and colour bags below") and the block's own line reading **5 bag(s) · 500 prs**;
  Cancel closed it. No console errors in either flow.
  **Headlessly** (Vite `ssrLoadModule` in `web`, `renderToStaticMarkup` with a `window` shim; `react`/`react-dom`
  must be imported normally — `ssrLoadModule("react")` dies on `module is not defined`): `mergeBagRows` folded
  `Black 42 ×2 + ×1` into `bags: 3`; `allocateBagRows(rows, 3)` took one bag from each of Black 41 / Black 42 /
  Brown 41 (`remaining 0/2/0`), 999 took every bag, 0 took none; `parseBagBreakdown` accepted both an object and a
  JSON string and dropped the blank row; `UppersByArticle` and `RawStockLineCard` rendered the bag chips;
  `ReadyArticleCard` rendered `41 42 Black` (and nothing when the article has no lists); `readyBatchColumns` read
  `Article | Name | Grade | Carton | Sizes · Colours | Cartons | Pairs | Batch | Date`, that cell rendered
  `41, 42 / Black` and `—` for an unknown article, and with no article list the old eight columns came back
  unchanged. `npm run lint` on the thirteen touched files: **0 errors** (the three "unused eslint-disable
  directive" warnings are pre-existing, two of them on untouched lines), `eslint --rule '{"no-undef":"error"}'`
  clean (the free-identifier class that once blanked the app), and `npm run build` is clean.
- **Trap, hit here (and worth remembering): a Radix dialog refuses clicks for the first ~1.5 s it is open.** The
  first runs' `+ Add bag` and `Cancel` clicks came back `performed: false` and everything downstream then read "no
  element" — which looks exactly like a broken form. Wait ~2 s after the dialog opens (and re-query the node right
  before acting) and every gesture lands. The article dialog's own click was fine for the same reason: it was
  second in the script.
- **Not verified here:** with no articles and no uppers lines in the factory this branch, no saved record carries a
  breakdown yet, so a saved line's read-back, the "Remaining in bag" chips on a real article and the sizes/colours
  column on a real batch row were rendered headlessly only. Enter an uppers line with a couple of bag rows and then
  a production run against its article in an unlocked pane: the line's card must list the bags, the article's card
  must show `size · bags left / bags entered` with the used bags spread one per size and colour, and the Ready
  Shoes batch row must carry the article's sizes and colours.

## Every field reads from the left (this branch)

- **The request:** *"make the all fields left alignment as texts number must be on left side alignment for all input
  fields and labels throughout the app"*. Nothing else moved — no value, no label text, no layout, only which side of
  the box the writing starts on.
- **`text-left` is now in the three primitives**, so a field added later is left-aligned without being told:
  `Input` (`src/components/ui/input.jsx`), `Textarea` and `Label` (the `field-label` class the forms use carries no
  alignment of its own). Labels were already left; the class makes it explicit rather than inherited. Because `cn`
  is `twMerge`, a caller that passes `text-center` / `text-right` still wins — that is deliberate, so a future field
  that genuinely needs another alignment can still say so.
- **The money fields were the ones that did not read from the left.** `src/components/ui/money-input.jsx` was
  `text-right` so the H / L / C mark could sit against the last digit, and the price-per-pair rows in
  `DesignDialog` / `PairPriceDesign` passed `text-right` on top of it. The field is `text-left` now, and **the mark
  travels with the digits**: an invisible copy of the value (`.invisible`, inside a `pointer-events-none` layer that
  mirrors the field's own `px-3` / `text-base md:text-sm`) carries the `<sub>` to just after the last figure, so a
  wide field does not leave the letter stranded at its right edge. `pr-8` stays (it keeps the figure clear of the
  browser's number spinners) and `markClassName` still overrides the mark's own classes. **The typed value is still
  never touched** — only the display carries the letter, so every amount posted, stored, printed and exported is
  unchanged, and `Money` (the table/KPI/PDF renderer) is untouched: this is the input field alone.
- **Verified in the preview** (Supabase, the user's replayed session, 360px, `/purchases` → **New purchase**, then
  Cancel — nothing was saved): every `input`, the `date` field and the `textarea` in the form compute
  `text-align: left` (text · number · number · date · textarea), and **all nine labels** compute `left`. Typing
  `25000` into the pair-price money field left the value reading `25000` with its mark rendering `H` **2px after the
  digits** (`mirrorOffsetFromField: 12px`, i.e. at the field's own padding, and the mark inside the field's right
  edge) — the screenshot shows `25000H` as one left-aligned figure. The only console entry was the pre-existing
  React "uncontrolled input to controlled" warning this form already logged.
- **NOT automatically verified:** the money mark on the app's other money fields (payment, expense, invoice, kata,
  settings, article prices — the module is shared, so the mechanism is the same one checked here) and the
  price-calculator rows, whose figures (Rs 500–1,010) are below the 10,000 mark threshold and so show no letter;
  look at one money field in an unlocked pane if the mark's position there matters.
- **Table columns are untouched on purpose.** A numeric column keeps whatever alignment its own table already
  carried (`DataTable`'s `numeric` ⇒ `text-right`, the dashboard grids' per-cell rules, the kata notebook's per-cell
  ink) — the request was about input fields and labels, and the ledgers' alignment is its own documented design.

## A labour created in the stage dialog now appears in it (this branch)

- **The report:** *"when add new labour from the production upper category stage 1 … I created new labour but it
  didn't fetch"*. The man **was** written (`public.labours` row created, `labour_category_links` row written by
  `linkLabourToCategory()`), but `StageEntryDialog`'s labour list is the `labours` **prop** — `ProductionStages`'
  `board.labours`, read by `stageBoard()` on its last load — so the new man was in no option list: the Radix
  trigger rendered **blank** (a value with no matching item shows neither item text nor placeholder), `selected`
  (`activeLabours.find(…)`) was `undefined`, and `submit()` refused with "Choose the Lasting labour who did this
  stage — his name comes from the Labour menu". Measured before the fix in the live app: the trigger read empty
  while the DB held the new labour. **`listLabourAccounts()` had returned him all along** — the dialog simply
  never merged the result into the list it renders.
- **The fix is in `src/components/production/StageEntryDialog.jsx`.** `createdLabours` state (set in
  `LabourForm`'s `onSaved`, which now receives the saved id) is merged over the `labours` prop into `allLabours`,
  and `activeLabours` / `stageLabours` / `labourOptions` / the `LabourForm`'s own `accounts` read that merged
  list. The manual `knownLabourIds`-diff (the ref, its effect, and `useRef`) went with it — two creates in a row
  diffed wrongly. The man is merged **with this stage's link already on him** (`category_ids` + `category_names`),
  so the stage's own list shows him even if the link call itself failed.
- **Two traps fixed next to it.** The form's reset effect was keyed on `stageLabours` (an array that changes
  identity whenever the labour list does), so any reload of the board wiped what had been typed into an open
  entry — a merged labour would have been selected and immediately cleared again; the effect is no longer keyed on
  it. And `LabourDialogs.jsx`'s `LabourForm.onSaved` now passes the new id (`onSaved?.(labourId)`) instead of a
  bare call; the other three callers ignore the argument, so nothing else changed. `ProductionStages` passes
  `onLaboursChanged={reload}` so the board's own list (used by the **Move to <stage>** arrow) is fresh too.
- **Do not read this as "`post_production_stage()` needed the link".** It never did — it checks only that the
  labour exists and is active (`0018`); the link is what a stage's own dropdown lists.
- **Verified in the preview** (Supabase, the user's replayed session, desktop, the app-wide PIN gate did not
  appear): Stage 1 → **Add entry** → the labour dropdown listed this stage's own men plus **+ Create new labour**;
  creating one from it closed the form with the stage dialog's labour field reading
  `ZZ Verify Labour 8131 · Upper / Last Process`, his details card showing **Works in: Upper / Last Process**, and
  no "Choose the Lasting labour…" block; a Grade A entry of **1 carton (24 prs) @ Rs 10** then saved —
  "Stage 1 · Lasting saved — 24 prs × Rs 10 = Rs 240 for ZZ Verify Labour 8131" — and the Stage 1 card read
  `24 prs · Wage Rs 240`, with no console errors and no failed requests. **Everything the check created was
  removed again by exact id** (both test labours, their `labour_production` / `labour_earnings` rows, the links,
  the rates and their `audit_logs` rows), so the factory is back to its own records.
- **NOT automatically verified:** the phone-width rendering of this dialog (the flow was driven at desktop width;
  no layout changed) and the earlier failed cut of the same flow, whose only fault was the automation's own fill
  target.


## Only the view dialogs are draggable (this branch)

- **The press-to-move is opt-in now, not app-wide.** `DialogContent` (`src/components/ui/dialog.jsx`) takes
  `draggable` (default `false`): only then is `useDialogDrag`'s `onPointerDown` / `dragStyle` attached, and only
  then does `DialogHeader` mark itself `data-dialog-header` and take `cursor-grab` / `touch-none`. A plain
  `DialogHeader` is an ordinary header: no handle, no swallowed scroll. The prop reaches the header through
  `DialogDragContext`, so a dialog can never be half-wired.
- **The read-only view dialogs are the ones that opt in** — `RecordDetailDialog` (the eye button in every
  module) and `recycle/RecycleBinDetailDialog` — by passing `draggable` on their own `DialogContent`. That is the
  whole surface: **every other dialog and confirmation is centred and still**, including the delete confirms,
  which is the point of the change (a press on a form or a confirmation used to shift it).
- **`alert-dialog.jsx` carries no drag at all now** (the import, the handler and the `data-dialog-header` on
  `AlertDialogHeader` are gone). A new confirmation needs nothing; a new *view* dialog that should be movable
  passes `draggable`.
- **Verified in the preview** (the user's replayed session, `/raw-stock/uppers`): the row's **View** dialog
  reported `data-dialog-header` on its header and moved with a dispatched press-drag on it — inline
  `transform: translate(calc(-50% + 80px), calc(-50% + 60px))`, bounding box `dx 80, dy 60`; the **Add item** form
  (an ordinary `FormDialog`) reported **no** handle and did not move at all (`transform: ""`, `dx 0, dy 0`), then
  closed from Cancel; no console errors. **Trap that cost the first run:** the drag only starts once the window
  listeners are attached by the effect that follows `setDragging(true)`, so a script must **pause between the
  `pointerdown` and the `pointermove`s** (~150 ms) — dispatch them in one tick and nothing moves, which reads
  exactly like a broken drag.
- **Not driven by hand/automation: the delete confirmation's own gesture.** Its code path is the one reverted
  (the served `alert-dialog.jsx` contains no `useDialogDrag`), so it cannot move; the live press was deliberately
  not attempted, because the only confirmation reachable on that screen deletes a real stock line if the wrong
  button is hit. `npm run lint` and `npm run build` are clean.

## The sales up / down card and graph, and two more themes (this branch)

- **`src/components/dashboard/SalesPerformance.jsx` is the dashboard's new sales block**, mounted by
  `Dashboard.jsx` **above** the two existing sales panels, which are untouched (`SalesCharts` — "Sales by date" and
  "Daily sales trend"). One panel holds all of it: the period's own figure with a percentage badge against the
  period before it, a **Day / Week / Month / Year** toggle, and a line graph of the same series.
- **The four readings are one read.** `salesSeries({ unit })` (`src/lib/analytics.js`) is called per period — the
  component owns that read, and `Dashboard.jsx`'s own day series for the existing trend panel is a separate,
  unchanged call. `bucketKey()` in `src/lib/entities.js` gained the **year** branch (`YYYY-01-01`): it supported
  day / week / month only, so `unit: "year"` would have been bucketed per day. The graph shows the last
  14 day / 8 week / 12 month / 5 year buckets — small windows on purpose, because the chart is read at phone width.
- **The badge is the change; the tooltip is the share.** The badge compares the newest bucket with the one before
  it (emerald up, `text-destructive` down, muted "no earlier period" when there is no earlier bucket or the
  previous figure is 0), and the graph's tooltip prints the amount with its share of the window it is showing
  (`Rs 200,000L (67%)`) — the reference picture's own pattern. Nothing is stored: both figures are read from the
  invoices the register already holds, so no posting path, report or other screen changed.
- **Two themes appended to the top-bar cycler**: **Beige** (the phone reference's warm soft-UI — beige paper,
  near-white raised cards on long soft shadows, charcoal-brown ink, muted emerald brand) and **CRM** (the
  admin-panel reference — cool blue-grey canvas, white cards, near-black ink, deep violet brand carrying the
  actions and the chart ramp). Tokens are two `@layer base` blocks after `.theme-carbon`; the surface treatment is
  two sections at the end of `src/index.css` (each skin's own `.app-shell` background wash, `.panel` radius and
  shadow, `.eyebrow` ink, and CRM's violet `bg-primary` gradient, whose hover face stays inside
  `@media (hover: hover) and (pointer: fine)` like Steel's and Carbon's).
- **Both keep a dark sidebar on purpose.** `Sidebar.jsx` prints the wordmark and its tagline in **white** over
  `--sidebar-background`, so a light sidebar would hide them; the two skins use a warm brown / navy panel instead.
  A future light-sidebar theme has to change those hard-coded `text-white`s first.
- **Verified in the preview** (the pane's replayed session took the browser straight in — no PIN gate this turn;
  375px): the section renders with its four period buttons. With three throwaway invoices — 2026-09-15
  (100,000), 2026-10-10 (150,000), 2026-10-20 (50,000) — inserted through PostgREST for the check: **Day** read
  `Rs 50,000H` with a **red** down-arrow badge (`rgb(176, 39, 39)`) `66.7%` and "10-20 vs previous day" over **3**
  plotted points; **Month** read `Rs 200,000L` with a **green** up-arrow badge (`rgb(5, 150, 105)`) `100.0%`,
  "2026-10 vs previous month", 2 points and the axis `2026-09 / 2026-10`; and the tooltip read
  `2026-10 Sales : Rs 200,000L (67%)`. Pressing the theme button round applied each skin's own tokens
  (`--background` `40 23% 95%` / `216 55% 96%`, shell `rgb(245, 243, 239)` / `rgb(239, 244, 250)`, 20px panels with
  the beige soft shadow, the CRM violet gradient on `button.bg-primary`), and the user's own theme was pressed back
  on afterwards (**Off-white**). No console errors, no failed requests, no sideways scroll at 375px. `npx eslint`
  on the four changed files is clean. **The three probe invoices were removed by exact id**: `invoices` and
  `invoice_days` are both **0 rows** again (0033's trigger took the days with them) and no audit row names them.
- **NOT automatically verified: the badge on the app's real books, because the factory holds no invoices at all
  today** — with none, the card honestly reads "No sales recorded yet" and the badge "no earlier period", which is
  what the theme captures show. Enter an invoice and the figure, the badge and the curve appear as above. Also not
  driven: recharts' own touch/drag interaction, and both skins at desktop width.

## The upper bags are broken down in their own dialog (this branch)

- **The request:** *"cut down the bags by size range and color … I want Button for this size range by bag and color
  … in button add after low stock alert that for Color Size Button which open this small sizes and color separate
  dialog and it auto total the bags by colors and sizes and value must be made by pairs x with price per unit"* —
  clarified to the button sitting **inside the Upper category's entry form** (no other category, no page header,
  no per-line card button).
- **`src/components/stock/UpperBagsDialog.jsx` (new)** is that dialog: the size range once, then a line per colour
  whose bags are spread over it (`distributeBags`) with every size dialled by hand afterwards, and a totals block
  that adds up as the user types — **bags by size** (`40 · 2  41 · 2  42 · 2`), **bags by colour** (each with its
  own value), `Bags entered over N colour(s)`, `Total pairs = N bag(s) × N pairs`, and
  **`Value = N prs × Rs N` = the pairs × the line's price per unit** (the answer given to the clarifying question;
  the stored `amount` column is still `price × quantity` on the server, so this is the dialog's figure only).
  It is `FormDialog size="sm"`, so it opens **inside** the entry form — that nesting works (Radix keeps the inner
  dialog on top) and needs no portal trickery.
- **`RawStockForm` keeps the state and hands it down.** The dialog is the editor, not a second copy of the line:
  the form still owns `values.upper_colours` and the size range (so `formDraft` and `submit()`'s
  `custom_json.upper_bags` are untouched and `quantity` still turns read-only on the bags' total), and it passes
  `groups` / `range` / `onRangeChange` / `onGroupsChange` / `pairsPerPack` / `price` / `colourOptions` down. The
  parent's own `setRange` is the only reshaping handler left (`shapeColours`, keyed on `"from"` / `"to"`, because
  the values live in `upper_size_from` / `upper_size_to`); every other bag helper moved into the dialog.
- **The trigger replaces the old inline block, and it sits after the Low stock alert field** — a small panel reading
  `Bags by size range and colour` with the line's own summary (`6 bag(s) · 600 prs over 1 colour(s)`) and the
  **Colour and size** button. It is rendered only for `isUppers`, and it is shown in **both** the add and the edit
  form on purpose: an edit form that hid it would leave a line's saved breakdown unreachable (and the reader would
  have to trust nothing dropped it). Closing the form closes the dialog (`useEffect` on `draft.active`), so a
  reopened draft never comes back with the breakdown dialog already up.
- **The dead code went with the block:** `colourSizes`, `addColour`, `setColour`, `setColourBags`, `setSizeBags`,
  `removeColour`, the `ColorDot` / `COLOUR_OPTIONS` / `distributeBags` / `num` imports and the `Plus` / `Trash2`
  icons. `rangeSizes` stays (the submit path still writes `upper_size_range`).
- **Verified in the preview** (Supabase, the user's replayed session, desktop, no PIN gate this turn):
  `/raw-stock/uppers` → **Add item** showed the new panel with its summary and button; the price field was set to
  **500**; **Colour and size** opened the dialog with both size inputs, and `40` → `42` gave the three size chips;
  **Add colour** + `Black` + a total of `6` spread **2 · 2 · 2** over 40/41/42, the colour's own line reading
  `Black · 6 bag(s) · 600 prs over 3 size(s) · Rs 300,000L` and the block
  `Bags entered over 1 colour(s) 6 · Total pairs = 6 bag(s) × 100 pairs 600 prs · Value = 600 prs × Rs 500
  Rs 300,000L · BAGS BY SIZE 40 · 2  41 · 2  42 · 2 · BAGS BY COLOUR Black · 6 bag(s) · Rs 300,000L`;
  **Done** returned to the form with the bag dialog gone (one `[role="dialog"]` left), its panel reading
  `6 bag(s) · 600 prs over 1 colour(s)` and **Quantity in bags** reading `6` (read-only); **Cancel** closed the
  form with **no** `hiker_form_draft:raw-stock:uppers` left behind and no console errors. Nothing was saved, so no
  test record was created.
- **NOT automatically verified:** saving a line through the new dialog (the write path — `values.upper_colours` →
  `bagRowsFromColours` → `custom_json.upper_bags` — is unchanged from the inline block and was covered by the
  earlier bag work), and the phone-width rendering of the dialog (it was driven at desktop width; the form is
  scrollable, so the trigger sits below the fold at 360px). Save one uppers line in an unlocked pane and check the
  line's card lists the bags colour by colour.

## The clean-build pass: lint, the installer's icon, and the 2026-10-24 artifacts (this branch)

- **`npm run lint` is clean now — the two `native-bridge.js` errors are gone.** They were never app code:
  `android/app/build/intermediates/…/native-bridge.js` is Gradle's output, and Capacitor's bundled bridge carries an
  `eslint-disable` comment for `@typescript-eslint/no-unused-vars`, a rule this project does not load — so the flat
  config reported "Definition for rule … was not found" against generated code. `eslint.config.js` now opens with an
  `ignores` block (`dist/**`, `release/**`, `node_modules/**`, `android/app/build/**`, `android/build/**`,
  `android/.gradle/**`, `android/capacitor-cordova-android-plugins/**`). Every earlier note that says "clean apart
  from the two pre-existing `android/…/native-bridge.js` errors" is superseded: lint reports **0 problems**.
- **The Windows installer had no icon: `build/icon.png` was missing from the tree.** `electron-builder.yml` sets
  `directories.buildResources: build`, and that folder did not exist (it is neither tracked nor gitignored, so it
  does not survive a fresh checkout), so electron-builder logged `default Electron icon is used reason=application
  icon is not set` — the 2026-10-19 installer had shipped with Electron's own logo too. `build/icon.png` is now the
  HIKER+ mark (`resources/icon.png`, 1024×1024, the same source the APK's launcher icon comes from); electron-builder
  converts it to a 53,980-byte `icon.ico` itself. **A future EXE build needs that file committed** — without it the
  installer silently goes back to the default icon.
- **The 2026-10-24 artifacts** (built from this branch with `npm run build -- --base=./`, served by the `downloads`
  service on host port 8000):
  - `release/HIKER-Factory-ERP-android-debug.apk` — **11,572,014 bytes, md5 `2a71fcbe460e0f370625e8fd4e11dfe1`**,
    built from the committed `android/` scaffold (`npx cap sync android` → `JAVA_HOME=/opt/jdk21 ./gradlew
    assembleDebug --no-daemon`, 16 s warm). `assets/capacitor.plugins.json` names @capacitor/app, filesystem and
    share; the bundle inside (`assets/public/assets/index-PUPiWNjL.js`) matches `dist/` **byte for byte**
    (md5 `ce0d0331a1fa5ecfbcc00d479f5bb1f6`); one `sb_publishable_` literal and zero unsubstituted
    `VITE_SUPABASE_PUBLISHABLE_KEY` (the white-screen trap is clear).
  - `release/HIKER-Factory-ERP-windows-setup.exe` — **87,955,603 bytes, md5 `4ea8e07e83d3321415fa13f842f0f96c`**,
    NSIS x64 (`xvfb-run -a npx electron-builder … --win nsis --x64`). The container needed
    `wine wine64 wine32:i386 xvfb xauth zip` — **`xauth` is required or `xvfb-run` aborts with "xauth command not
    found"** before electron-builder even starts. This installer carries the HIKER icon.
  - `release/HIKER-Factory-ERP-windows-setup.zip` — **87,944,798 bytes, md5 `fb7b6cfec93bd2329d6e6d71af107191`**,
    the installer zipped (the same shape the 2026-10-19 zip had). Its byproducts (`win-unpacked/`, `.icon-ico/`,
    `*.blockmap`, `latest.yml`, `builder-debug.yml`) were removed so `release/` holds the three deliverables alone.
- **The error sweep run alongside the build** (all through the `web` container): `npm run lint` → 0 problems;
  `npm run build` → clean; `npx eslint src --rule '{"no-undef":"error"}'` → the only undefined names are browser
  globals (window, document, crypto, requestAnimationFrame/…, sessionStorage, performance, localStorage, URL,
  navigator, Blob, timers, btoa, URLSearchParams, TextEncoder, FileReader) and **no app-level identifier** — the
  free-identifier class that once blanked the app (`Money` without its import) is absent; every `<Money>` and
  `<MoneyInput>` usage was confirmed to carry its import. `npm run typecheck` is still **not** a gate: it reports
  1,905 pre-existing JSX prop-type errors across the untyped `.jsx` components, unchanged by this pass.
- **Preview check (2026-10-24).** A fresh load came back on `/raw-stock/uppers` (the remembered screen) with `#root`
  mounted, **0 console errors and 0 failed requests**; the loading state cleared on its own and the page rendered its
  own data (1 line · 18 bags · 1,800 prs · Rs 9,000, the H7 · A card with its Black/Brown/White 6-bag breakdown and
  the BAGS BY SIZE & COLOUR block), LIVE in the top bar and the whole sidebar present. The app these artifacts are
  built from therefore boots and reads the live project without errors; nothing was created or removed.

## Every row of the production history carries its own controls (this branch)

- **The request:** *"Add an edit and delete button in production menu history in each row of the production history
  table. to allow managing individual production records."* The controls were already there for a record the register
  still holds; what the screen omitted was the row this day **kept** after the record left the register (0035) — the
  register list and the kept day's own dialog drew those rows **view-only**, and the register's only row today is
  exactly that one. Both screens now draw `recordActions(...)` on **every** row, so the "view-only" note in "A
  register record is corrected from the history too, through one path" no longer describes the code.
- **What decides is the register row, not the row's mark.** `ProductionRecordManager` reads the record back **by id**
  at the moment of the press — edit: `liveRow()` / `liveStageEntry()`; delete: the same read **added for the assembly
  and stock kinds**, because `softDelete()` is an update and an update of a row that is no longer there changes
  nothing (a kept row would have silently "succeeded") — so a record still in the register, **including one whose
  date was corrected to another day** and therefore left this day, is corrected or removed through its own row, while
  one that is genuinely gone answers `Not in the register` ("AH1 is not in the production register any more, so it
  cannot be changed from here."). A screen still never writes the day.
- **Files:** `src/pages/ProductionHistory.jsx` (the list's `actions` / `card` no longer branch on `row.left`),
  `src/components/production/ProductionRegisterDayDialog.jsx` (the same for its own records table; its `RowActions`
  import went with the branch and its footer copy now spells the behaviour out), and
  `src/components/production/ProductionRecordManager.jsx` (the delete's read-back). The `Left the register` chip,
  the `+M kept` line, `leftTheRegister()` and every read/write path are untouched. **A category's own production
  history (`/production/history/:slug`) is deliberately not part of this** — its shop-floor rows stay view-only.
- **Verified in the preview** (Supabase, the user's replayed session, 360px — the app-wide PIN gate did **not**
  appear this turn): `/production/history` rendered its one row (`Stage 1 · Lasting · AH1 · 24 prs in the stage ·
  STG1-261024-01 · Left the register`) carrying **view + edit + delete** in its action cell; the day heading opened
  the day's dialog, whose own records table row carried the same three controls; that row's **Delete** raised its
  confirmation ("Clear this stage entry?" → "Clear entry") and confirming it answered the toast **"Not in the
  register — AH1 is not in the production register any more, so it cannot be changed from here."**, with the row
  still listed and **no record touched**; 0 console errors. `npm run lint` → 0 problems, `npm run build` clean.
- **NOT automatically verified:** the **Edit** press on a kept row (it takes the same `notInRegister()` path whose
  toast was read for the delete) and the new read-back on a kept **assembly / stock** row — the factory holds no such
  row, so that branch was not produced. A **live** row's edit and delete are unchanged by this work and were not
  re-driven.
- **Driving these checks:** a Radix dialog's content is `position: fixed`, so `offsetParent` is **null** for it —
  a visibility filter written as `offsetParent !== null` silently reports "no dialog" while the screenshot shows it
  open. Match a fixed layer by its own button text instead.

## The Recycle Bin is emptied in one press (this branch)

- **The request:** *"Add Clear Bin Symbol btn in the recycle bin to clear the bin contents with a single click. And
  animation as all the deleted items came to bin and Bin eat and make small pieces animation to the recycle bin clear
  down in the right bottom only in recycle bin menu."*
- **`src/pages/RecycleBin.jsx` gained a `Clear Bin (N)` button** — destructive, in the page header, disabled while the
  bin is empty or busy. It opens the same `DeleteDialog` the single-record purge uses (its own title and description),
  then purges **every** record the bin holds (not only the rows a filter is showing) through `purgeRecord()`.
- **The order is the safety rule, as it is for a single delete: the rows are measured, then purged, and only then
  does the animation play.** A refused write aborts before anything falls into the bin (the toast reads "Could not
  clear the bin" and the list reloads), and the "Bin cleared" toast waits for the animation to finish — it sits in
  the same lower-right corner the bin is drawn in, and showing it during the animation painted over the bin.
- **`src/components/recycle/ClearBinAnimation.jsx` (new) is the animation**, mounted by the Recycle Bin page alone
  (never by `Layout`), so it appears only in that menu. Each row lifts off its own line — `recordAnchor(id)` per row,
  the same anchor `deleteFlight` uses, falling back to the table's own place for a row a filter hides — flies into the
  bin's mouth in the lower-right corner (a `76×88` bin, `20px` in from both edges), the lid chomps
  (`rotate [0,-34,-2,-34,0]`), `20` shredded pieces spray out of the mouth, and then the whole bin sinks, shrinks and
  fades — "clear down" — which is the emptied list the user is left with. The flight is capped at about a second
  however many records the bin held, it honours `prefers-reduced-motion` (the records are still purged, they simply do
  not fly), and the layer is `pointer-events-none`, so it never swallows a click.
- **Verified in the preview** (Supabase, the user's replayed session, 360px; probe articles inserted through PostgREST
  with `is_deleted = true` and removed by the feature itself — `articles` is back to 0 rows): the header read
  `Clear Bin (N)` and went disabled once the bin was empty; the dialog read "Clear the Recycle Bin? / All N records in
  the bin will be erased for good."; the layer carried one flying card per record, the bin measured
  `right 20 · bottom 20 · 76×88`, the lid's computed transform was mid-rotation, **26** span pieces were on screen
  during the chew and no toast was up yet, and the layer was gone afterwards; the table then read "Recycle Bin is
  empty" with 0 rows and the toast followed the animation. 0 console errors, `npm run lint` → 0 problems,
  `npm run build` clean.

## The sidebar drops its footer card, Recycle Bin moves last, and Clear Bin sits in the corner (this branch)

- **The "Automatic postings · Stock · Kata · Roznamcha" card is gone from the foot of the sidebar** — descriptive
  copy only (no link, no logic), removed at the user's request. The `nav` list is the `aside`'s last child now; if
  anything is ever put back there it needs a `px-4 pb-5` wrapper of its own again.
- **Recycle Bin is the menu's last entry**, under **Administration** after **Users** (it used to sit in **System**
  between Settings and Pair Price Calculator). Pure list order: the route, its `recycle_bin` module gate and the
  `RequirePermission` in `App.jsx` are untouched.
- **`Clear Bin (N)` moved out of the Recycle Bin page's header to the bottom-right of the screen** — below the amber
  permanent-delete strip, inside a `mt-6 flex justify-end` row in `src/pages/RecycleBin.jsx`; the `PageHeader` there
  carries no `actions` any more. The same button, disabled while the bin is empty or busy, with the same confirmation
  and the same `ClearBinAnimation` behind it. (The bin's own animation layer is `fixed` in the lower-right corner and
  is mounted only while it plays, so it does not fight the in-flow button.) This supersedes "in the page header" in
  the section above.
- **Verified in the preview** (the pane's replayed session, the app-wide PIN gate did **not** appear this turn): the
  sidebar's own DOM listed the menu ending `… Users, Recycle Bin` with **Administration** last and **no** "Automatic
  postings" text anywhere in the `aside`; the Recycle Bin screen's header rendered no buttons, and the corner button
  measured bottom-right at both widths (desktop right 1225 of 1280, i.e. flush with the content column; phone right
  359 of 375 with a 16px inset, on screen after scrolling, following the warning strip in DOM order and clear of the
  floating calculator) — no sideways scroll at 375px, **0** console errors. `npm run lint` → 0 problems,
  `npm run build` clean. The bin is empty on this branch, so the button was read in its disabled state.
- **Settings sits at the foot of the menu, between Users and Recycle Bin** (this branch, the user's request: *"Shift
  the settings at last after users before recycle bin in the sidebar menu."*). It used to be in **System**, between
  Reports and Pair Price Calculator, so that group is now Reports + Pair Price Calculator and **Administration**
  reads Database Center · Backup & Restore · Users · Settings · Recycle Bin (this supersedes the ordering sentence
  in the section above; the bin stays last). Pure list order in `Sidebar.jsx` — the `/settings` route, its `settings`
  module gate and the `RequirePermission` in `App.jsx` are untouched. Verified in the preview (the user's replayed
  session, the drawer opened with the 3-line button): the sidebar's nav order ends `… Reports · Pair Price
  Calculator · Database Center · Backup & Restore · Users · Settings · Recycle Bin`, 25 entries, the screenshot
  showing Settings between Users and Recycle Bin, 0 console errors, `npm run lint` 0 problems.

## The uppers production history no longer adds stock (this branch)

- **The request:** *"Remove add item btn from the history of the production of the upper category"* — the **Add item**
  button is gone from `/raw-stock/uppers/history` (`UppersHistory.jsx`), the Uppers category's first-stage production
  history. It was the page's only write path — a `RawStockForm` for the uppers category — and it opened the same form
  the Uppers page's own **Add item** opens, so uppers stock is still added from `/raw-stock/uppers`.
- **The page is read-and-correct now.** With the button went everything only it used: the `RawStockForm` import, the
  `stockFormOpen` / `stockEditing` state, `findCategory` / `ALIVE` and the `RawCategory` read in `load()` (which
  existed only to find the uppers category for that form), the now-unused `Plus` icon and the page's own trailing
  `<RawStockForm>`. `db` is still imported — the edit dialog writes `db.LabourProduction.update`. Nothing else moved:
  the KPI cards, search, export, the view / edit / delete row controls and the delete confirmation are untouched.
  **Another raw category's history (`RawStockHistory.jsx`) keeps its own Add item** — only the uppers one was asked for.
- **Verified in the preview** (the user's replayed session, the app-wide PIN gate did **not** appear this turn, 360px):
  `/raw-stock/uppers/history` rendered "Uppers consumption history" with header actions reading Search · Excel / CSV ·
  PDF / Print · **Back to Uppers** and **no Add item** button anywhere (the page's button list was exactly those
  three), the three KPI cards and the empty state, with no console errors. `npx eslint src/pages/UppersHistory.jsx` is
  clean and the dev server serves the module with **0** occurrences of `Add item`, so no stale module is in play.

## Every row of a category's production history corrects, and no history page adds stock (this branch)

- **The request:** *"add edit and delete controls to each row of the uppers history table & Totally production
  history table rows to allow correcting past entries. In all history delete the 'add item' button as no need in
  history … so remove the button from every production history page in my app."*
- **`/production/history/:slug` (a category's production history — the Uppers card's History) now draws view / edit /
  delete on every row.** The rows are the register's, not the page's own copy: `src/lib/productionCategoryHistory.js`
  names each row's register with the `kind` the one correction path reads (`stock`, `history`, `assembly`, `stage`)
  instead of the `correctable` flag it used to carry, and `ProductionCategoryHistory.jsx` nests its `DataTable`
  inside **`ProductionRecordManager`** (`{({ actions }) => …}`, `actions(row, () => setViewing(row))`) — so a stock
  row, a row already moved on to history, a production run and a stage entry are all corrected and removed through
  the same dialogs the register's own history and a stored day's dialog use. With that went the page's local
  `QuickEditDialog` / `DeleteDialog` / `softDelete` / toast state. **This supersedes** "a run or a stage entry is
  view only" in "A category's production history keeps every register" and the closing line of "Every row of the
  production history carries its own controls" ("A category's own production history … is deliberately not part of
  this").
- **A new `history` kind** in `src/lib/productionHistory.js` (`KIND_LABELS`, `EDIT_TARGETS`, `DELETE_TARGETS`) is
  `production_stock_history` — the stock a category has already moved on to history, corrected (notes) and removed
  like the stock it came from. A day's snapshot never carries that kind, so no other screen changed.
- **Add item is gone from every history page.** `/raw-stock/:slug/history` (`RawStockHistory.jsx`) lost the header's
  **Add item** button, its `Plus` icon and the blank-open branch behind it (a row's own **Edit** still opens the same
  `RawStockForm` on that row), and its empty state now points at the category page ("add one with **Add item** on the
  … page"). This supersedes "Another raw category's history (`RawStockHistory.jsx`) keeps its own Add item".
  `UppersHistory.jsx` lost its own in the section above. No other history screen has an add control
  (`ProductionHistory`, the category history, the invoice / Roznamcha / Kharcha / Profit / Zakat histories), and the
  **live** pages keep theirs (`/raw-stock/<slug>` → Add item, `/production` → New production, …), which is where a
  record is added.
- **`0042_production_stock_policies.sql` is applied — the delete itself was refused by RLS.** `production_stock` and
  `production_stock_history` were the only soft-deletable tables whose SELECT policy carried `is_deleted = false`
  (every other module's table has the permission check alone), and `softDelete()` writes `is_deleted = true` and
  PostgREST returns the row it wrote (`select=*`) — so the PATCH answered **403 `new row violates row-level security
  policy for table "production_stock_history"`**, with the app's own toast "Could not delete …". The Recycle Bin's
  listing (`is_deleted = true`) could not read either table for the same reason (a removed row waited nowhere and
  could never be restored), and 0024 declared no `for delete` policy, so a permanent delete — the bin's purge and
  **Clear Bin** — was refused as well. The migration replaces the two SELECT policies with the app's own form and
  adds the `production:delete` delete policies, matching `production_entries_delete`. Rollback:
  `0042_production_stock_policies.rollback.sql`.
- **Measured, both ways, as the signed-in administrator inside a transaction that was rolled back:** before the
  migration `update public.production_stock_history set is_deleted = true … returning id` errored with the message
  above; after it the same statement read `UPDATE 1` with the row returned, the soft-deleted row was listable as the
  bin lists it, and `delete … where id = …` read `DELETE 1`. **PostgREST's `select=*` is the trap worth
  remembering:** a SELECT policy that hides the row a write just produced turns a soft delete into a 403.
- **Verified in the preview** (Supabase, the user's replayed session — the PIN gate did **not** appear this turn,
  360px; one probe row inserted through PostgREST and removed by exact id afterwards): `/production/history/chemicals`
  rendered its row (`MOVED TO HISTORY · PRB1 · PROBE-HIST-ROW`) carrying **view + edit + delete**; the row's
  **Edit** opened "Edit production stock history entry · PRB1" on that row's own Notes value (the new `history` kind
  resolving `db.ProductionStockHistory`), and Cancel closed it; its **Delete** raised "Move this production entry to
  the Recycle Bin?" and confirming wrote the row (`PATCH 200`) with the toast "Moved to Recycle Bin — PRB1 is out of
  the register — this day keeps it as one that left." and the list back to its empty state (`ENTRIES 0`); 0 console
  errors. The probe row was purged by exact id, so `production_stock_history`, `production_stock`,
  `production_entries` and `labour_production` are all 0 rows and `production_days` still holds its one day.
  `npm run lint` → 0 problems (the dev server served the changed modules — the manager's new dialog title was read
  back from the live page).
- **NOT automatically verified:** a **run** row's and a **stage** row's edit / delete on the category history (the
  factory holds no production record at all — all four tables are empty, so those two branches were not produced),
  the **Uppers** category's own history page (it renders its empty state, so its rows were not seen), and the
  category history's phone layout on the uppers slug (the row controls were checked at 360px on the chemicals page).

## A record that has left the register is cleared out of the day's history (0043, this branch)

- **The report:** *"Clear the AH1 record from upper history … if I press edit or delete in history buttons it should
  trigger the correct action for that record."* The row was real: the factory's only stored day (2026-10-24) kept a
  **stage-1 (Upper / Last Process) entry for `AH1`** with `"live": false` — the `labour_production` row behind it had
  already gone (the earlier check's `ZZ Verify Labour 8131` cleanup), so the day's own snapshot was the only place it
  still lived. Both controls on that row were dead ends: **Edit** answered "Not in the register", and **Delete**
  opened the "Clear this stage entry?" confirmation and then answered the same thing — because 0035 keeps a record
  that has left, and nothing could ever take it out again (`production_days` is SELECT-only, so no screen can write
  the day).
- **`0043_production_day_entry_clear.sql` is applied** — one function,
  `public.clear_production_day_entry(p_day_id, p_kind, p_entry_id)`, the only writer of a stored day's own snapshot.
  It drops one record out of the day's `entries` JSON (the rest keep their stored order), requires
  `production:edit`, logs `production_history_cleared` in `audit_logs`, and **refuses a record the register still
  holds for that day** (`{"error": …, "in_register": true}`) — that one is corrected or removed through its own
  register row, and the day would keep it again the next time the register re-stores it. Rollback:
  `0043_production_day_entry_clear.rollback.sql` (drops the function; every day row is left as it is).
- **Two SQL traps, both hit here:** an entry's `id` is **text inside JSONB**, so a `uuid` argument must be compared
  as text (`e.value->>'id' = p_entry_id::text`, otherwise `operator does not exist: text = uuid`), and
  `log_audit()`'s `p_entity_id` is **text**, so a uuid is passed `p_day_id::text` (a bare uuid raises
  `function public.log_audit(unknown, unknown, unknown, uuid, jsonb, boolean) does not exist` — uuid → text is only
  an assignment cast, so it never resolves).
- **The controls now do what they say, on every screen that lists a record.** `ProductionRecordManager` is the one
  path `/production/history`, a stored day's dialog and `/production/history/:slug` all correct a record through:
  - a record the register **still holds** is unchanged — **Edit** opens its own editor, **Delete** moves it to the
    Recycle Bin;
  - a record that **has left** (`left` on a row the day's reader built, `live: false` on a day's own snapshot entry)
    carries **no Edit** — there is nothing left in the register to change — and its **Delete** clears it out of the
    day's history, with its own copy: "*Clear this record from the day's history?*" / "*Clear this stage entry from
    the history?*", confirm **Clear from history**, then "Cleared from the history — … is out of <day>'s history for
    good."
  - **What decides is the read-back, never the mark:** the delete reads the register row back by id first (as the
    edit always did), so a record removed between the render and the press is cleared rather than silently
    "deleted"; the old `Not in the register` toast is now the fallback for a row that names no day.
- **`ProductionRegisterDayDialog` tells each of its rows which day it belongs to** (`day_id` / `day_date` added to the
  snapshot rows), which is what the clear call needs and what its confirmation prints. Its footer copy and the
  history page's empty state ("**The stored days keep no record**" when days exist but hold none) moved with it.
  Nothing else changed: the day's figures, `productionDayCategories()`, the register reads and every write path are
  untouched.
- **Verified in the preview** (Supabase, the user's replayed session, 360px; one probe `production_stock` row inserted
  through PostgREST and removed by exact id afterwards): `/production/history` listed the probe row with **view +
  edit + delete** and the `AH1` row with **view + delete only**; the probe's **Edit** opened "Edit production stock
  entry · PRB-AH1", its **Delete** raised "Move this production stock entry to the Recycle Bin?" (the ordinary copy)
  and confirming answered "Moved to Recycle Bin — PRB-AH1 is out of the register — this day keeps it as one that
  left.", with the row re-listed **marked "Left the register"** and the record waiting in `/recycle-bin`
  (Production Stock · Deleted by hikerplusshoes@gmail.com); then **AH1's Delete** raised "Clear this stage entry from
  the history?" → "Clear from history" → toast "Cleared from the history — AH1 is out of Saturday, 24 Oct 2026's
  history for good." with the row gone, and the same press on the probe's kept row ("Clear this record from the day's
  history?") cleared it too, leaving the list at its empty state. **0 console errors.** The function itself was
  exercised in SQL as the signed-in administrator inside a transaction that was **rolled back**: it cleared the stage
  entry (`cleared: true`, one record left), refused the second call ("That record is not kept in this production
  day") and refused a record still in the register (`in_register: true`). `npm run lint` → 0 problems, `npm run build`
  clean.
- **What was cleaned up afterwards:** the probe row was purged by exact id and its `audit_logs` row removed
  (`production_stock` is 0 rows, nothing soft-deleted left anywhere), so the factory is back to its own state — except
  the requested one: the **`AH1` record is gone from the history**. The stored day 2026-10-24 remains (a day is
  permanent) holding no record, and its `production_history_cleared` audit row is kept, because that clear really
  happened.

## The history row controls, verified on both production history screens

- **Edit and Delete on a production history row act on that row's own record.** Driven in the preview (Supabase, the
  user's replayed session, 360px) against two throwaway `production_stock` probes dated into the existing stored day
  (2026-10-24, so no new day appeared in the history):
  - **`/production/history`** (the register, one record a row) and **`/production/history/uppers`** (a category's own
    history — `ProductionCategoryHistory`, whose rows carry `kind` `stock`) both opened **Edit** on *"Edit production
    stock entry · PB44-UP1 / UP2"* — the record's own editor carrying its own `notes` — and closed on Cancel.
  - **Delete** raised *"Move this production stock entry to the Recycle Bin?"* and, confirmed, answered *"…is out of
    the register — this day keeps it as one that left."*: the row left both lists, the day's own row re-read
    *"Left the register"* with **no Edit** (there is nothing left in the register to change) and the record was
    waiting in `/recycle-bin` (`Production Stock · PB44-UP1 · 10 prs`, *Deleted by hikerplusshoes@gmail.com*, with
    its time), where **Restore** and **Delete permanently** both worked.
  - **Clear from history** then took each left row out of the stored day (*"… is out of Saturday, 24 Oct 2026's
    history for good."*), the register returned to its empty state and each probe was purged from the bin.
    `production_stock` is 0 rows, the day 2026-10-24 holds 0 records, and no `audit_logs` row mentions the probes
    (the two `production_history_cleared` rows those clears wrote were removed by id). **0 console errors**
    throughout.
- **Deliberately not the bin:** a live **stage entry's** Delete is a *Clear* — `deleteStageEntry()` takes the wage it
  earned off the labour's kata (and at Finishing the Ready Shoes batches it handed over), which is the Production
  screen's own Clear, and its confirmation says so. That path is still unexercised (the factory holds no live stage
  entry), and so are the raw-stock history screens (`/raw-stock/uppers/history`, `/raw-stock/:slug/history`): they
  carry the same `RowActions`, but the factory has no raw-stock rows to drive them with.

## The iOS app, and the 2026-10-25 APK / EXE / ZIP builds (this branch)

- **iOS cannot be compiled in this sandbox — Xcode ships only with macOS.** So the iOS half is the project plus a
  build path, not an artifact: `npx cap add ios` was run in the `web` container (it works on Linux — it copies the
  platform template and the SPM package and needs neither CocoaPods nor Xcode), the scaffold is **committed** at
  `ios/` (its own `.gitignore` keeps `App/App/public`, `App/App/capacitor.config.json`, `App/Pods` and `DerivedData`
  out), `npx @capacitor/assets generate --ios --assetPath resources …` wrote the launcher icon and the splash from
  `resources/` into `ios/App/App/Assets.xcassets` (14 files, 4.21 MB), and **`.github/workflows/ios.yml`** builds it
  on a **macos-15** runner.
- **The workflow follows `android-apk.yml`'s shape** — the same variables-or-secrets env check, `npm install`,
  `npm run build -- --base=./`, `test -d ios || npx cap add ios`, the assets step, `npx cap sync ios` — then
  `xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Release -sdk iphoneos -destination
  'generic/platform=iOS' … archive` with **`CODE_SIGNING_ALLOWED=NO`**, and the archive's `App.app` zipped into
  `HIKER-Shoes-Factory-ios-unsigned.ipa` (an .ipa is a zip holding `Payload/<app>.app`). It is **`-project`, not
  `-workspace`**: Capacitor 7 uses **SPM** (`ios/App/CapApp-SPM/Package.swift`, referencing `@capacitor/app`,
  `@capacitor/filesystem` and `@capacitor/share` out of `node_modules`), so there is no Podfile and no
  `.xcworkspace` beside the project.
- **The .ipa is unsigned and installs only after re-signing** — this repository holds no Apple certificate or
  provisioning profile. Xcode with an Apple ID, or a sideloading tool (AltStore / Sideloadly), is what turns it into
  something a device accepts; adding the signing identity as secrets and dropping the three `CODE_SIGNING_*`
  overrides is the path to a signed build. **iOS has no equivalent of tapping an APK**: an .ipa cannot be installed
  from a download link, so the honest routes to a phone are a Mac running Xcode (free Apple ID → 7-day build) or a
  sideloading tool on a Windows/Mac PC (same 7-day window), and for a build that simply installs, an Apple Developer
  account (ad-hoc / TestFlight — a link staff can open). The one no-account route is the **web build on a Home Screen
  icon** (Safari → Share → Add to Home Screen), which needs the app hosted at a public HTTPS URL — nothing in this
  repo hosts it yet, and the sandbox link dies with the sandbox.
- `@capacitor/ios@^7.6.9` is declared in `devDependencies` beside `@capacitor/android@^7.6.9` (and in the lockfile).
- **NOT automatically verified: every iOS step.** Nothing here can compile Swift — `xcodebuild` does not exist on
  Linux — and the workflow has still never produced a run (the Actions API reports `total_count: 0` workflows and
  `0` runs for this repo, because the default branch `main` holds only the initial commit and no workflow file).
  Open `ios/App/App.xcodeproj` on a Mac, or let the runner build it, and treat that first run as the verification.
- **How a build is started (measured 2026-10-25) — a push to a listed branch, and nothing else.** `workflow_dispatch`
  requires the workflow file to exist on the **default branch**, which it does not (`main` = "Initial commit"), so the
  Actions tab offers no manual run; and none of the branches the file listed (`App-exe`,
  `scratch-supabase-apk-exe`, `personal-oct-11`) exists on the remote — `git ls-remote --heads origin` lists `main`
  only. A build could therefore never start at all. **`base44/setup-0ed2dbd6` is now the fifth entry in
  `on.push.branches`**, which is the branch the platform pushes at the end of every turn, so each push starts a build
  and its artifacts (`.ipa` + `.xcarchive`) land on that run's page. Running it by hand from the Actions tab still
  needs this file on `main` (a merged PR). The same gap exists in `android-apk.yml` (its `paths:` filter also omits
  `android/**`) — not touched, since only the iOS workflow was asked for.
- **The scaffold is the official Capacitor 7 SPM template** — diffed 2026-10-25 against
  `node_modules/@capacitor/cli/assets/ios-spm-template.tar.gz` (this is where the iOS template lives, **not** in the
  `@capacitor/ios` npm package, which ships only Swift sources): `project.pbxproj`, `Info.plist`, `AppDelegate.swift`,
  `SceneDelegate.swift`, `Package.swift`, the storyboards and the asset catalogs differ only in the bundle id
  (`com.hiker.factoryerp`), the display name and the plugin dependencies pinned into the SPM manifest. Two things
  follow. (a) The template ships **no shared scheme** either, so `xcodebuild -scheme App` relies on the scheme Xcode
  creates for the `App` target — do not "fix" that by hand unless a run proves it was the fault. (b) The three
  plugin packages the SPM manifest references by path (`@capacitor/app`, `@capacitor/filesystem`, `@capacitor/share`)
  each ship their own `Package.swift` in the published tarball (checked: `app-7.1.2.tgz` carries one), so the
  workflow's plain `npm install` is enough to resolve them — but the package must be installed in the project being
  synced, which is the trap the APK already hit (see "The APK's Print / PDF buttons never saved anything").
- **What the run needs from the repository that this sandbox cannot supply: `VITE_SUPABASE_URL` and
  `VITE_SUPABASE_PUBLISHABLE_KEY`** (Actions repository variable or secret — step 3 exits 1 without them), plus
  `VITE_APP_PIN` (warn-only; without it a fresh install has no PIN to enter). The sandbox has **no GitHub credentials
  at all** — no `gh` binary, no token — and the connected integration may only read: `/actions/variables` and
  `/actions/secrets` both answer `403`, so whether those values are set cannot be checked from here. The URL is
  public and already committed (`.env.base44-defaults`); the publishable key is an app secret in this sandbox
  (`/run/base44/app.env`) that is deliberately not in git. **If the run stops at step 3, that is the missing
  configuration, not a code fault** — set those variables, then re-run the same run (`gh run rerun` works; a
  re-dispatch does not exist).
- **The 2026-10-25 artifacts, built from this branch's source** (`npm run build -- --base=./`, handed out by the
  `downloads` service on host port 8000):
  - `release/HIKER-Factory-ERP-android-debug.apk` — **11,574,433 bytes, md5 `1b4a5d8052eaa44add06eac6a9c10e88`**,
    built from the committed `android/` scaffold (`npx cap sync android` →
    `JAVA_HOME=/opt/jdk21 ./gradlew assembleDebug --no-daemon`, 25 s warm, `BUILD SUCCESSFUL`). Acceptance checks
    green: `assets/capacitor.plugins.json` names **@capacitor/app + @capacitor/filesystem + @capacitor/share**, and
    the bundle inside (`assets/public/assets/index-gsJwOflL.js`, md5 `858a9983b5cf5abb56327d024c3f9f6e`) matches
    `dist/` **byte for byte** (one `sb_publishable_` literal, zero unsubstituted `VITE_SUPABASE_PUBLISHABLE_KEY` —
    the white-screen trap is clear).
  - `release/HIKER-Factory-ERP-windows-setup.exe` — **87,957,380 bytes**, NSIS x64, built with
    `xvfb-run -a npx electron-builder --config electron-builder.yml --win nsis zip --x64 --publish never`
    (md5 `f1a57243b484c47c1a15cacbcb2e2809`); `file` reports a NSIS self-extracting PE32 installer.
  - `release/HIKER-Factory-ERP-windows-setup.zip` — **119,081,577 bytes**, electron-builder's own `zip` target:
    the portable `HIKER Factory ERP.exe` with its Electron runtime beside it, nothing to install. (It is larger
    than the installer because it packs `win-unpacked/` as it stands — the older 87 MB zip was the installer
    zipped, which is why the two used to match.)
  - **Windows installer rebuilt 2026-10-26 16:33 UTC from the working tree** (the 2026-10-25 installer above
    predated the 2-column party/labour card grid and the KataCard hover-effect removal): the same two files,
    **renamed over the old ones** — `release/HIKER-Factory-ERP-windows-setup.exe`, **87,957,629 bytes, md5
    `1e535fd1faa0f760dd67415bdad57bf6`**, NSIS x64, and `release/HIKER-Factory-ERP-windows-setup.zip`,
    119,082,511 bytes. **electron-builder names its output `HIKER-Factory-ERP-0.0.0-setup.{exe,zip}`**
    (`artifactName` + the `0.0.0` package version), so a fresh build must be renamed over the handed-out name or
    the download link keeps serving the stale artifact; the `.blockmap`, `latest.yml`, `builder-debug.yml` and
    `win-unpacked/` it also writes are metadata for an update feed that does not exist here and are deleted after
    the build. Currency proved by unpacking the installer (`7za x`, from `node_modules/7zip-bin/linux/x64/7za`) and
    finding the bundle `dist/index.html` names (`assets/index-TmxFxwvX.js`) inside `resources/app.asar` — present,
    so the installer carries that build; the public download is byte-identical (md5 matches local). **The APK in
    `release/` was not rebuilt in that pass and is still the 2026-10-25 build** (11,575,303 bytes).
  - The toolchain was already in the container layer (`/opt/jdk21`, `/opt/android-sdk`, `/tmp/apk`, `wine` +
    `wine32` + `xvfb`); electron and electron-builder came from
    `npm install --no-save electron@35.1.5 electron-builder@26.0.12` — build tools, deliberately not dependencies,
    and both a `docker compose … up --build` and a platform-driven recreate wipe the lot.
- **Still not automatically verified:** every Android- and Windows-specific step (no device, no emulator, no Windows
  here) — install the APK / run the installer and check the app opens, the PIN gate asks, and a Print / PDF button
  saves a file.

## The purchase form breaks its uppers bags down, and the bags must complete the quantity (0044, this branch)

- **The request:** *"In adding upper or editing upper … I want to show color and sizes this button in purchase … if I
  enter 18 bags so it must validation for 18 bags completion not more not less."* The New purchase form now carries
  the same **Bags by size range and colour** panel the uppers stock form has, with the same
  **`src/components/stock/UpperBagsDialog.jsx`** behind its **Colour and size** button (`isUppers` only; the panel
  sits between the fields grid and the totals block, and the dialog opens inside the form).
- **The quantity in bags is the constraint, and it is typed by hand.** The form keeps `upper_size_from` /
  `upper_size_to` / `upper_colours` in its own `values` (so `formDraft` remembers them) and passes them to the dialog
  — the dialog is only the editor, exactly as in `RawStockForm` (the parent owns `setUpperRange`, which reshapes every
  colour's size list when the run changes). What is **different from the stock form** is that the quantity stays
  editable: the panel shows `N bag(s) still to place` / `N too many` / `All N bag(s) placed.` live, and `submit()`
  **refuses the save** when the bags and the quantity disagree ("The bags must complete 18 — 15 placed, 3 still to
  place."). A purchase entered with no breakdown behaves exactly as before.
- **`0044_purchase_bag_split.sql` is applied** (`0044_purchase_bag_split.rollback.sql` reverses it): a new nullable
  `purchases.custom_json`, `public.jsonb_or_null(text)` and `public.merge_upper_bags(jsonb, jsonb)`, and
  `record_purchase()` re-issued (0025's pair-price arithmetic verbatim) to store the split on the purchase **and**
  merge it into the uppers stock line the purchase creates or tops up — so `/raw-stock/uppers` shows the bags colour
  by colour and its card's per-size "left/entered" chips work for purchased stock too. Both helpers are revoked from
  `public` / `anon` / `authenticated`, like 0007's own. A malformed `custom_json` never fails a purchase: the
  purchase stores the string and the split simply does not apply. **The merge is what a top-up needs** — a second
  purchase of the same item/article/pack adds to the line's colours and sizes, and the line keeps its own size range.
- **The two keys are `upperBags.js`'s own** (`upper_bags`, `upper_size_range`), stored as a JSON *string* exactly as
  `save_raw_stock()` stores custom fields, so `parseBagBreakdown()` / `parseSizeRange()` read a purchase and a stock
  line alike — which is what makes the edit form reopen on the saved split.
- **Verified in the preview** (Supabase, the user's replayed session, 360px — the device PIN gate did **not** appear
  this turn): `/purchases` → **New purchase** showed the panel; the dialog took the run `40` → `44` (5 size chips),
  **Add colour** + `Black` + a total of `18` spread **4 · 4 · 4 · 3 · 3** with `Black · 18 bag(s) · 1,800 prs over 5
  size(s) · Rs 1,620,000`, `Total pairs = 18 bag(s) × 100 pairs` and `Value = 1,800 prs × Rs 900` = **Rs 1,620,000**
  (the figures the user's own reference screenshot shows); **Done** left the form's panel reading
  `18 bag(s) · 1,800 prs over 1 colour(s)` with **All 18 bag(s) placed.**; **Save purchase** answered
  "Purchase created" and the row appeared in the register; its **Edit** reopened on quantity `18`, the same panel and
  the same `40`/`44` split — the `custom_json` round trip. With the quantity moved to `15` the panel warned
  `3 bag(s) too many` and the **Save purchase** press was refused with the inline
  "The bags must complete 15 — 18 placed, 3 too many." (nothing written). Read back through REST, the purchase's
  `custom_json` held the five bag rows + the range and the **raw stock line it created carried the same split in its
  own `custom_json`**. The probe (its `purchases` row, the `raw_stocks` line and the `purchase_recorded` audit row)
  was removed by exact id afterwards — no test record is left. `npm run lint` → 0 problems, `npm run build` clean.
- **Trap, hit here:** `innerText` applies CSS `text-transform`, so a `[role="dialog"]` lookup by `/Sizes from/` never
  matched this dialog's uppercase `SIZES FROM` label — match case-insensitively (or use `textContent`). And a
  `[role="dialog"] input` selector also matches the **outer** form dialog's inputs, so the bags dialog must be found
  by its own text before its inputs are read.

## The party cards sit two-up on a wide screen (this branch)

- **The request:** *"In web or exe add two card side by side supplier labour customer as in WebView it look too
  wide … not change mobile APK as only this for exe"*. `PartyGrid` (customers, suppliers) and `LabourCards`
  (labour) each wrapped their cards in `flex flex-col gap-3`, so one card filled the whole content column — and
  because the sidebar is an overlay drawer (`Layout`'s `main` carries no dock offset), that column is the viewport.
- **The fix is one class list in each of the two files:** `grid grid-cols-1 gap-3 lg:grid-cols-2` replaces the flex
  wrapper; nothing else about a card, a list or a handler moved. **`lg` (1024px) and not `md`** on purpose: a phone
  in landscape reaches 768–932px, and the APK must keep one card per row at every orientation, while a laptop
  browser and the desktop EXE (1440×900 window) are far above it. A tablet in portrait stays as it was.
- **Verification (this branch).** `npx eslint` on both files → **0 problems**; the dev server serves both modules
  with the new class list. The compiled rule was measured **in the live page** (a throwaway probe element carrying
  exactly those classes, `getComputedStyle().gridTemplateColumns`): **`394px 394px` at desktop width and `800px` at
  360px** — two tracks above the breakpoint, one below. A selector scan of `document.styleSheets` finds nothing,
  because Tailwind serves this build's CSS through a constructable sheet; measure the computed style instead of
  grepping the sheet. **NOT automatically verified: the cards on screen** — every fresh preview load stops on the
  app-wide device PIN gate ("Enter your PIN — Five-digit access code"; the pane replayed 10 storage keys and the
  keypad still rendered), so `/customers`, `/suppliers` and `/labour` could not be opened and the PIN is never
  guessed. Look at those three lists once in an unlocked browser window (two cards a row) and on the phone (one).

## The desktop shell wears its own face (this branch)

- **The request:** the **Windows EXE only** — glossy black Venom-inspired pill buttons for the app's action
  buttons, with a live mutation (black tendrils crawling around the edge, wet white highlights) on hover, and the
  reference's slim electric-blue → purple curved rail for the navigation drawer. Existing functionality, pages and
  layout unchanged, and the browser preview / Android APK keep the faces they had.
- **`desktop-shell` is the gate, and nothing else is.** `src/lib/desktopShell.js` is the one place that asks
  (`/Electron\/\d/` on the user agent: Electron appends `Electron/35.1.5` to it, `electron/main.cjs` never
  overrides the agent, and neither a browser nor the Android WebView reports the token), and `src/main.jsx` puts
  `<html class="desktop-shell">` on **before the first render**, so the shell's face is never painted twice.
  Everything is scoped to `html.desktop-shell`; the block is the **last** one in `src/index.css` (outside
  Tailwind's layers and below the `theme-*` blocks, per the pointer-feedback and Steel/Carbon rules), so the
  browser and the APK are untouched. **Never hardcode the class** — nothing but `main.jsx` sets it.
- **The pill.** `html.desktop-shell button.bg-primary` / `a.bg-primary` (every primary action: "New customer",
  "Save", "Post", …) **plus** `button:has(svg.lucide-plus)` — which is what catches the add-affordances that are
  `outline` rather than primary ("Add item" in `InvoiceLines` / `RawCategoryPage`, "Add row", "Add entry", "Add new
  article"). **A new action button needs no class of its own: keep the plus icon or the primary variant and the
  skin follows.** A black face (top gloss + deep black gradient), a full pill radius, white ink, and the house neon
  pulse stood down (`animation: none`) while the pointer is on it.
- **The symbiote is two pseudo-elements, drawn like `.kata-card`'s face.** `::before` is the blade of lobes that
  reaches in over the top edge and `::after` the one from the bottom and both ends, each lobe a black body with a
  white "wet crest" just above it, plus a sheen sweep on `::after`. They sit at `z-index: -1` inside the button's
  own stacking context (`isolation: isolate`), which is what paints them **over** the black face and **under** the
  label and lets them reach past the pill's rounded edge. At rest both are `opacity: 0` and carry no animation —
  the surface is a clean glossy pill. On hover they fade in, scale up and run `venom-crawl`
  (`background-size` / `background-position`, one value repeating across every layer, the two layers out of phase),
  and the transition is what carries them back out when the pointer leaves. `prefers-reduced-motion` keeps the
  lobes but stops the crawl.
- **The sign-in portal is deliberately excluded** (`:not(.login-theme button)` / `:not(.login-theme a)`): each
  login theme dresses the one submit button itself (Sole's neon green among them), and the PIN keypad is a
  `PasscodeKeypad`, not a `Button`.
- **The rail.** `Sidebar.jsx`'s `aside` carries **`app-sidebar`** now — the hook, because a bare `aside` would also
  match the sign-in portal's own (`LoginBrandPanel`) — and `html.desktop-shell .app-sidebar` gives it the
  reference's face: 254px, an elliptical `border-radius` (a long curved right edge rather than a corner), the
  `#4A29FF → #8C3BFF` gradient with a light arc catching the curve, white links on pill rows, a bright active row
  with a cyan glow and glowing icon. **The drawer still behaves exactly as it did** at every width (opened from the
  3-line button, closed by a pick, the backdrop or the X); only its face changed. Note the per-theme
  `sidebar-dashboard-transparent` rule sets `background-color: transparent !important`, which still wins on a
  fancy theme's dashboard — the gradient is a `background-image`, so the rail keeps its face there.
- **Verified in the preview** (the user's replayed session, no PIN gate this turn, 360px + desktop; the page's
  `desktop-shell` class forced by hand, which is exactly what `main.jsx` does inside Electron): **without** the
  class the "New customer" button computes the theme's own `rgb(180, 34, 83)` at `10px` — untouched; **with** it,
  `rgb(0, 0, 0)` at `9999px`, weight 600, white ink, and both layers `content: ""`, `opacity: 0`,
  `animation-name: none` (the rest state is static, as designed); an ordinary `outline` control (the dialog's
  Cancel) keeps `10px` / transparent; the rail measured **254px**, `border-radius: 0px 52px 52px 0px / 0px 88px
  88px 0px`, the gradient, `rgba(255,255,255,0.86)` links, an active row at `rgba(255,255,255,0.2)`, 25 icons, and
  it opens/closes on the 3-line button and closes on the drawer's own X. The **served** stylesheet carries the
  hover layers, `@keyframes venom-crawl` and the rail rule, and with the hovered declarations forced on the pill
  both layers read `opacity: 1` with `venom-crawl` running and their own `background-position` / `background-size`
  sampled **0.39px / 100.7% at t≈0.1s against 6.64px / 111.6% at t≈0.8s** — the mutation moves, it is not a static
  gradient. **0 console errors** throughout; `npx eslint` on the changed files → 0 problems and `npm run build` is
  clean.
- **NOT automatically verified: the pointer's own hover.** This repo's long-standing limitation — the harness has
  no hover helper and its click leaves no `:hover` (`matches(':hover')` read `false` with the pseudo still at
  `opacity: 0` after a real click on the pill, whose dialog then covered it). The hovered artwork above was
  therefore **rendered by forcing the same declarations**, not by the pointer. Move a real cursor over "New
  customer" (or any Add / Create button) in the EXE once: the tendrils must crawl in from the edges and settle back
  when the cursor leaves. Nothing about the gesture is device-specific — it is plain `:hover` CSS.

## The preview wears the desktop shell, for now (this branch)

- **The request:** *"Add this for now only on preview to check"* — the EXE-only skin above cannot otherwise be
  looked at without building the installer, so it is switched on **in the sandbox preview only**.
- **What changed, and nothing else:** `src/lib/desktopShell.js`'s `isDesktopShell()` now answers true when
  `import.meta.env.VITE_BASE44_PREVIEW_MODE === "1"` as well as for Electron, and `docker-compose.base44.yml`
  passes the platform's flag through as `VITE_BASE44_PREVIEW_MODE=${BASE44_PREVIEW_MODE:-}`. `src/main.jsx`,
  `src/index.css` and every `html.desktop-shell` rule are untouched.
- **Enabled vs unset.** In this sandbox the platform sets `BASE44_PREVIEW_MODE=1`, so the preview `<html>` carries
  `desktop-shell` and the preview (browser, 360px included) wears the EXE's black Venom pills and the purple
  navigation rail. Every real build — a browser build, the Android APK, the Windows EXE's own bundle — leaves the
  variable unset, so it resolves to an empty string, the comparison is false, and the gate is Electron's user-agent
  token alone, exactly as before. **This is a temporary check aid:** remove the `|| import.meta.env…` half of
  `isDesktopShell()` and the compose line to take the preview back to its own face. Never hardcode the class, and
  never gate the *EXE* on this flag.

## The Venom tendrils are a real animation now (this branch)

- **The report:** *"Fix the Venom button animation — not just its appearance … rebuild the hover effect so that
  when the mouse enters the button, animated black symbiote tendrils emerge from the button, stretch upward, split
  into thin strands, and crawl … When the mouse leaves, the tendrils retract and merge back into the button …
  Trigger the animation on actual mouse hover, not on click."* The first cut was two blurred gradient layers that
  faded and scaled — a glow, which is exactly what this request rules out.
- **`src/lib/venomTendrils.js` (new) is the whole animation**, installed by `src/main.jsx` inside its
  `isDesktopShell()` branch (so a real browser and the APK build never run it) and standing down under
  `prefers-reduced-motion`. Every tendril is a real SVG `<path>`: a centreline of 9 samples whose length, lean,
  sway and width come from that strand's own progress `p`, with 1–2 branches sprouting from each strand (and again
  from those), a tapered black body filled by a gradient with a wet crest at its base and a last catch of light at
  its tip, a sharp white specular stroke riding the lit edge, and a wet dot where it leaves the pill. Growing out
  (`p` 0→1, 800ms) and retracting (`p`→0, 430ms) are the same motion played in either direction, so the strands
  visibly *shorten back into* the pill.
- **It is driven by the pointer, one overlay per button.** A single pair of capture-phase `pointerenter` /
  `pointerleave` listeners on the document (delegation, so a button React renders later is covered and an unmounted
  one leaves nothing behind), the same action-button selector the CSS block dresses
  (`button.bg-primary, a.bg-primary, button:has(svg.lucide-plus)`, the sign-in portal excluded), one
  `requestAnimationFrame` loop that runs only while a button is hovered, and a `window.blur` / `visibilitychange`
  retract for a pointer that leaves the window without leaving the button. **No click and no focus is involved.**
- **The overlay lives inside the button** — appended *after* its own children (React only ever removes the nodes it
  created itself, so it never fights over that slot), `position: absolute`, its box and `viewBox` recomputed from
  the button's rect every frame (button width plus 20px either side, 92px of air above it), `pointer-events: none`
  and `z-index: 1`, so the button stays clickable through it and its label is never covered. The arrangement is
  seeded per button, so a pill always grows the same symbiote.
- **`src/index.css` keeps only the pill and its gloss.** The old `::before` / `::after` blob layers and the
  `venom-crawl` keyframes are gone (this supersedes the "two pseudo-elements, drawn like `.kata-card`'s face" half
  of "The desktop shell wears its own face" above); what remains is the black glossy pill, the `.venom-tendrils`
  overlay hook, one `::after` wet sheen that runs once per hover at `z-index: -1` (over the face, under the label),
  and the reduced-motion rule.
- **Verified in the packaged desktop shell** — the real Electron renderer at `hiker://app/`, driven over the
  DevTools protocol with `Input.dispatchMouseEvent` (a real mouse move; nothing was clicked): the shell rendered
  with `desktop-shell` on `<html>`, and a `.bg-primary` pill measured `rgb(0, 0, 0)` at a `9999px` radius with
  white ink when idle. On hover the overlay appeared with 34 black bodies, 17 specular strokes and 3 wet dots; its
  painted ink grew **915 → 1675** of total path length and its top edge **reached 83px above the pill's own top
  edge** (measured path by path against the button's rect); the pointer leaving removed it again (`overlay: false`
  after ~1s), and the probe left no overlay behind. The capture of that state shows the black tree-like strands
  standing above the pill. The app's own screens are behind the app-wide PIN gate in the EXE, so the hovered
  control was a `.bg-primary` pill of the app's own class, in the packaged `dist/` the EXE loads — this branch's
  real build.
- **Verified on the app's own screen in the preview** (`/raw-stock/uppers`, `desktop-shell` on `<html>`, its real
  **Add item** button): idle → no overlay; the pointer arriving gave the overlay 56 bodies / 28 specular strokes /
  4 wet dots, **42px above the pill at 150ms against 83px at 700ms**, its ink totalling **1,419 → 2,697**; the
  pointer leaving held it at 83px 140ms in and removed it entirely by 1s — **0 console errors**. The gesture was
  dispatched as the DOM events a real cursor fires (`pointerenter` / `pointerleave` with `pointerType: "mouse"`),
  because this repo's harness has no hover helper — which is exactly why the EXE check above drives real input
  events instead.
- **Not measured:** the frame cost of ~56 path updates a frame. No profiling was done; the loop runs only while
  the pointer is on a button and stops when the last strand has been swallowed.
- **Trap, for the next person:** `svg.getBBox()` on the **root** `<svg>` element reported the ink *below* the pill
  (y ≈ 103 in user units) while every path's own `getBBox()` put it correctly above it — measure the paths, not
  the root, and never conclude from the root's box that the tendrils are misplaced.
- **The Windows artifacts were rebuilt so the EXE a user downloads carries this animation** (`npm run build --
  --base=./` → `xvfb-run -a npx electron-builder --config electron-builder.yml --win nsis zip --x64 --publish
  never`, the container needing `wine wine64 wine32:i386 xvfb xauth zip`, and **`electron` and `electron-builder`
  installed in one `npm install --no-save`** — installing electron-builder alone prunes electron and the build then
  stops with "Cannot compute electron version from installed node modules"): `release/HIKER-Factory-ERP-windows-setup.exe`
  (**87,960,098 bytes, md5 `fc826bf3923d23d80133c589ccc11003`**, renamed over the old name — electron-builder writes
  `…-0.0.0-setup.exe`) and `release/HIKER-Factory-ERP-windows-setup.zip` (119,085,553 bytes, md5
  `0a8650eecb73690fc4d6ae69527a1597`). `win-unpacked/`, the blockmap, `latest.yml` and `builder-debug.yml` were
  removed after the build. Currency proved by unpacking the installer (`7za x`, `node_modules/7zip-bin/linux/x64/7za`):
  `resources/app.asar` holds `assets/index-DI4RsUyA.js` — the bundle `dist/index.html` names, md5
  `3deb8554326264b4efbec4a05d94c22a` — and two `venom-tendrils` references, and the public download
  (`https://8000-${BASE44_PUBLIC_HOST_SUFFIX}/HIKER-Factory-ERP-windows-setup.exe`) is byte-identical (md5 matches).
  **The APK in `release/` was not rebuilt:** the animation is desktop-only by design (`isDesktopShell()`), so the
  Android and browser builds are unaffected by it.

## The navigation rail wears the top bar's colours (this branch)

- **The request:** *"Change the colors of side bar according like top bar theme buttons"* — the drawer's own
  electric-blue → purple rail (see "The desktop shell wears its own face") is gone; it now paints with **the same
  tokens the top bar itself uses**, so it repaints with every theme the theme button cycles instead of holding a
  colour of its own.
- **One CSS rule, in `src/index.css`'s desktop-shell block.** `html.desktop-shell .app-sidebar` re-points the
  sidebar tokens at the header's — `--sidebar-background: var(--topbar)` and
  `--sidebar-foreground: var(--topbar-foreground)` — and paints itself from `hsl(var(--topbar))`, so the
  `bg-sidebar` / `text-sidebar-foreground` / `text-sidebar-foreground/60` utilities `Sidebar.jsx` already carries
  follow on their own (every theme defines `--topbar` / `--topbar-foreground`, so nothing is hardcoded). The
  **shape** is unchanged (254px, the elliptical right edge); the sheen, hairline and shadow are now derived from the
  header's own pair, and the white mark's tile gained a hairline ring because it sits on a light rail.
- **The link rules moved with it:** the group labels, the links, the hover pill and the close button are
  `hsl(var(--topbar-foreground) / …)` now, and the **active row** is the theme's own `--brand` tint
  (`hsl(var(--brand) / 0.16)` with brand ink) instead of the rail's white-tint. The hover keeps the house rule
  (a `--glow` neon edge plus a grey-black drop shadow) and stays inside
  `@media (hover: hover) and (pointer: fine)` for the touch case.
- **`Sidebar.jsx`'s hardcoded whites are tokens now** — the wordmark's `text-white` → `text-sidebar-foreground`, and
  the close button's and the inactive links' `hover:text-white` → `hover:text-sidebar-foreground` (the note in "The
  sales up / down card" saying a light sidebar needs those changed first is what this is). In the browser and the
  APK the dark rail is unaffected: `--sidebar-foreground` there is the same near-white ink white was.
- **Verified in the preview** (the user's replayed session, `desktop-shell` on `<html>`): at **24 themes** — the
  theme button pressed through the whole cycler and returned to the user's own **Float** (`hiker-theme` read `float`
  before and after) — the rail's computed `background-color` equalled the `header`'s **exactly at every one**
  (`rgb(219, 240, 240)` on Float, `rgb(23, 27, 43)` on Glass, `rgb(249, 235, 225)`-family on Light, …), and its ink
  flipped light↔dark with it (`rgb(21, 48, 50)` on Float, `rgb(237, 238, 243)` on Glass), i.e. the rail follows the
  theme button. At Float, with the drawer open at both 360px and desktop: rail `rgb(219, 240, 240)` = header, ink
  `rgb(21, 48, 50)`, wordmark `rgb(21, 48, 50)`, group labels `rgba(21, 48, 50, 0.55)`, inactive links
  `rgba(21, 48, 50, 0.8)`, the **Raw Stock** active row `rgba(33, 202, 202, 0.16)` with `rgb(33, 202, 202)` ink and
  dark icons, the close button `rgba(21, 48, 50, 0.75)` — the drawer opened on the 3-line button and closed on its
  own X, no sideways scroll, **0 console errors**.
- **Not re-driven:** the hover pill and the focus ring inside the rail (the harness has no hover — see the
  pointer-feedback section), and the same rail in the packaged EXE (the preview carries the identical
  `html.desktop-shell` rules). To go back to the purple reference rail, restore the previous
  `html.desktop-shell .app-sidebar` block (the gradient, its `color`, the white-tint link rules) — the token
  override is the only thing that makes it follow the theme.

## The rail is the header's colour flat, and its rows glow (this branch)

- **The request:** *"Make the sidebar hover buttons glow like the top bar ones too And add colors of the side bar
  backgrounds to make the match like top bar backgrounds for a consistent look."*
- **One `background-image` was what stood between the two surfaces.** `html.desktop-shell .app-sidebar` painted
  `hsl(var(--topbar))` all along, but a `linear-gradient(168deg, hsl(0 0% 100% / 0.4), hsl(0 0% 0% / 0.05))` layer sat
  over it, so the rail read a shade lighter than the bar it is meant to match (measured on `theme-notebook`: rail
  `rgb(215, 221, 234)` under that light gradient against the header's flat `rgb(215, 221, 234)`). The note above that
  "the rail's computed `background-color` equalled the header's exactly" was therefore true of the colour only,
  never of the painted surface — compare `background-image` too when checking a surface against another. The layer
  is gone (`background-image: none`); nothing else about the rail moved.
- **A menu row now answers the pointer the way the header's buttons do.** The desktop-shell rules used to stand the
  house glow down (`animation: none`) and leave a static 1px inset edge, while the top bar's own buttons keep the
  pulsing `hover-glow-pulse` halo. `nav a:hover` and the close `button:hover` now carry the same light drawn
  **inwards** — `inset 0 0 0 1px hsl(var(--glow) / 0.7)` + `inset 0 0 22px hsl(var(--glow) / 0.16)` with
  `hover-glow-pulse-inset`, the twin of the top bar's `hover-glow-pulse` — because the drawer is a scroll container
  and an outward halo would be cut off at the rail's edge (the reason `[data-record-id]` rows glow inwards too).
  The **active** row (`a.bg-brand`) keeps its brand tint and edge, deliberately unchanged.
- **Verified** (the user's replayed session; `desktop-shell` on `<html>`, 360px, `theme-carbon`): the rail computes
  `rgb(28, 31, 38)` with `background-image: none`, exactly the header's own pair, with the drawer open and the
  screenshot showing one dark surface over the other; both hover rules read back from the **live** stylesheet carry
  the inset glow and `animation: … infinite hover-glow-pulse-inset`, `@keyframes hover-glow-pulse-inset` is present,
  no `linear-gradient(168deg…)` rule is left on `.app-sidebar`, and a real `nav a` and `button` match those
  selectors. 0 console errors.
- **NOT automatically verified: the hover look itself** — the standing limitation in this repo (the harness has no
  hover and its click never sets `:hover`; see the pointer-feedback section). Move a cursor over the drawer's rows
  once in an unlocked pane: each must take the neon edge and pulse exactly as the top bar's buttons do.

## The selected menu row's name reads on its own pill (this branch)

- **The report:** *"Check sidebar as button colors when press or hover color not showing … for the themes that for
  dark button background make the color text white … so the text remains legible on dark backgrounds."* The
  drawer's **active** row (`a.bg-brand`, `Sidebar.jsx`) was painted `hsl(var(--brand) / 0.16)` with **brand ink** —
  the theme's own colour on a wash of itself — so the name sank into its own background, worst of all in the two
  directions the request names. Measured on the live page before the change: **Light 2.74:1** (orange `rgb(194,110,46)`
  on its own pale orange wash) and **Forest 2.74:1** (olive on dark green); ten of the 23 themes sat under 3:1.
- **One rule in `src/index.css`'s desktop-shell block, one declaration that matters.** The selected row's **label now
  wears the rail's own ink** — `color: hsl(var(--topbar-foreground))` — which is the pair every theme already reads
  its own rows with, so a light rail gets a dark label and a **dark rail gets a near-white one** (the white the
  request asks for) without a per-theme list. The pill's brand tint went 0.16 → **0.28** and its inset ring
  0.45 → **0.6**, because the brand is now carried by the tint and the ring rather than by the text, and the row
  must still read as selected next to the (ink-tinted) hover pill. `:active` was added to the same selector list,
  and a **new press rule** (`nav a:not(.bg-brand):active`) gives an ordinary row the same feedback on a **touch**
  screen, where `:hover` never fires — it is deliberately outside the `@media (hover: hover) and (pointer: fine)`
  wrapper the hover rule lives in.
- **Verified in the preview** (the user's replayed session, `desktop-shell` on `<html>`, 360px, `/kharcha` with the
  drawer opened from the 3-line button):
  - **Settled computed styles, Light** (the user's own theme): the selected **Kharcha** row paints
    `rgba(194, 110, 46, 0.28)` over the rail's `rgb(250, 235, 225)` with ink `rgb(21, 25, 35)` → **11.2:1**
    (was 2.74:1) — the screenshot shows the row as a tan pill with a dark legible name.
  - **A dark rail, `theme-carbon`**: pill `rgba(39, 165, 153, 0.28)` over `rgb(28, 31, 38)`, ink
    `rgb(231, 235, 238)` — **pale, i.e. the white the request asked for**, → **8.82:1**; the screenshot shows the
    light label on the teal pill.
  - **Every theme**: the rule's own arithmetic (`--topbar-foreground` on the brand tint over `--topbar`, read from
    each theme's tokens) gives a **minimum of 5.89:1** for the selected row and **7.21:1** for the hover pill across
    all **23** themes — none below 4.5:1.
  - The new rule was read back **out of the live stylesheet** (`nav a.bg-brand, …:hover, …:active` with
    `hsl(var(--brand) / 0.28)` and `color: hsl(var(--topbar-foreground))`), `npm run build` is clean, and the user's
    own theme (`light`) was left stored — the sweep set `<html>`'s classes directly and restored them, the app's
    theme is untouched.
- **A transition trap worth keeping:** a theme-class sweep that reads computed colours on the next animation frame
  samples the links **mid-`transition-colors`** (a 150ms transition), so it reported nonsense (e.g. Light 14.4:1 and
  a "dark" reading of 1.13:1). Read the **tokens** (which do not transition) and compute, or wait ~350ms after the
  class change — that is what the figures above do.
- **NOT automatically verified: the press feedback on a touch screen** (`:active` cannot be set from the harness) and
  the hover look itself (the standing limitation: no hover helper, a synthetic click never sets `:hover`). Tap a menu
  row on the phone and hover one in the drawer of an unlocked pane: the row must tint and its name must stay
  readable.

## The menu rows hover like the menu, not like the header (this branch)

- **The request:** *"As first colors is ok according as hover effect change as in 2 button match hover to 1 img like the
  same style as the primary navigation buttons."* — the colours stay as they are; the **two** hover rules the previous
  turn gave the neon pulse (`html.desktop-shell .app-sidebar nav a:hover` and `html.desktop-shell .app-sidebar
  button:hover`) now answer the pointer in the menu's own language: the tinted pill under a **hairline ring in the
  rail's own ink** (`box-shadow: inset 0 0 0 1px hsl(var(--topbar-foreground) / 0.22)`), with `animation: none` and
  `transform: none`.
- **Why those declarations went:** the halo (`inset … hsl(var(--glow) / 0.7)` + `inset 0 0 22px
  hsl(var(--glow) / 0.16)` with `hover-glow-pulse-inset`) is the **top bar's** language, and the drawer's own
  highlight is a filled pill (the selected row, `a.bg-brand`). The hover is now that pill's quieter twin — the same
  fill, one hairline ring, no glow, no pulse and no 1px lift — so hovering reads as "this is the row about to become
  the pill". The fill and the label's ink are deliberately unchanged (`hsl(var(--topbar-foreground) / 0.1)` and full
  ink), which is what "the colours are okay" asked for, and the **selected** row's brand tint + ring are untouched, so
  hover and selected still read differently.
- **Nothing else moved:** the top bar's own buttons keep `hover-glow-pulse` (`button:not(:disabled):hover`), the ledger
  rows keep `hover-glow-pulse-inset` through `[data-record-id]:hover` (the keyframes are still defined and still used),
  and the rail's background, width, radius and resting colours are as they were.
- **Verified in the preview** (`desktop-shell theme-skyblue` on `<html>`, `/ready-shoes`, the user's replayed session):
  both rules read back **out of the live stylesheet** carry `box-shadow: inset 0 0 0 1px
  hsl(var(--topbar-foreground) / 0.22); animation: none; transform: none;` with the fill and the ink unchanged (CSSOM
  drops a declaration that does not parse, so reading them back is also the syntax check); the selected row's own rule
  is unchanged; the top bar's `button:not(:disabled):hover` still carries `hover-glow-pulse`; `@keyframes
  hover-glow-pulse-inset` is still present; the drawer renders with the rail `rgb(209, 227, 240)`, its links
  `rgba(25, 41, 56, 0.8)` and the close cross `rgba(25, 41, 56, 0.75)` — the resting colours untouched — and there
  were **0 console errors**.
- **NOT automatically verified: the hover look itself** — the standing limitation, and this turn is the measurement
  that confirms it: a real press on the drawer's **Articles** row performed (`performed: true`, the router moved to
  `/articles`) and the row then computed the **selected** pill, while `matches(':hover')` read **false** and no hovered
  `box-shadow` ever appeared — the harness's click sets no `:hover`. Move a cursor over a drawer row once in an
  unlocked pane: it must take the pale pill with its thin ring, with no neon halo, no pulse and no lift.
- **If the hover should read stronger** (nearer the selected row), the one declaration to change is the ring's alpha
  (`/ 0.22`) — the fill and the ink are the colours that were approved.

## The three installers, rebuilt for this branch (2026-10-27)

- **`release/` held stale files again and all three were rebuilt from this branch's tree (source at `0112a3b`).** The
  APK on disk was from 09:16 — older than the Android PDF revert (`a0947c5`, 09:28) and than every `desktop-shell`
  CSS commit — and the installer/zip were from 10:34/10:35, older than the four sidebar/drawer restyles
  (`30ac008`, `42c6cb2`, `5e01324`, `0112a3b`). Rebuilt in the `web` container in the documented order
  (`npm run build -- --base=./` → `npx cap sync android` → `JAVA_HOME=/opt/jdk21 ./gradlew assembleDebug --no-daemon`,
  1 m 24 s on a cold `/root/.gradle`; then `xvfb-run -a npx electron-builder --config electron-builder.yml --win nsis
  zip --x64 --publish never`), each new artifact **renamed over** the handed-out name.
- **Final artifacts** (served by the `downloads` service on host port 8000, `https://8000-${BASE44_PUBLIC_HOST_SUFFIX}/<file>`):
  - `release/HIKER-Factory-ERP-android-debug.apk` — **10,841,664 bytes, md5 `dc179168dfdb79f0047b762c53a65f85`**,
    debug-signed, `BUILD SUCCESSFUL`. Its `assets/public/assets/index-DsS4-SvC.js` is **byte-identical to `dist/`**
    (md5 `1c90f849d94b144f12c60bfe5472db62`), carries the publishable key literal and **zero** unsubstituted
    `VITE_SUPABASE_PUBLISHABLE_KEY` — the white-screen trap is clear.
  - `release/HIKER-Factory-ERP-windows-setup.exe` — **87,961,069 bytes, md5 `7d18bc84114f1987f7c6a1423d3d6118`**,
    NSIS x64 (7za lists 74 files incl. `HIKER Factory ERP.exe`).
  - `release/HIKER-Factory-ERP-windows-setup.zip` — **119,085,870 bytes, md5 `1f44cf232ef594aa4d921380c9187b7d`**,
    electron-builder's own `zip` target. Currency proved by extracting `resources/app.asar` out of it and pulling
    `dist/assets/index-DsS4-SvC.js` with `@electron/asar`: 2,470,813 bytes, the same md5 as `dist/`.
  - The `.blockmap`, `latest.yml`, `builder-debug.yml` and `win-unpacked/` electron-builder also writes were deleted
    again, so `release/` holds the three deliverables alone. Public downloads verified: `content-length` matches
    disk for all three and the APK fetched over the proxy is byte-identical (md5 matches).
- **CRITICAL when rebuilding: unset `VITE_BASE44_PREVIEW_MODE` for the bundle build.** `docker-compose.base44.yml`
  passes the platform flag through as `VITE_BASE44_PREVIEW_MODE` (it is `1` inside the `web` container), and Vite
  bakes `import.meta.env.VITE_*` at build time — so a plain `npm run build` here would freeze the sandbox's
  desktop-shell preview branch into the APK and give Android the Windows skin. Use
  `env -u VITE_BASE44_PREVIEW_MODE npm run build -- --base=./`; the rebuilt bundle is clean (grep for
  `VITE_BASE44_PREVIEW_MODE` in `dist/assets/index-*.js` → 0). The Windows build consumes the same `dist/`, so one
  bundle build serves both.
- **A platform recreate or `up --build` wipes the Android toolchain** (`/opt/jdk21`, `/opt/android-sdk`,
  `/root/.gradle`) — it had happened before this rebuild, while `wine`, `xvfb` and `zip` survived. Reinstall cost was
  ~3 minutes: `apt-get install unzip curl`, Temurin 21 tarball from the Adoptium API → `/opt/jdk21`,
  `commandlinetools-linux-*_latest.zip` → `/opt/android-sdk/cmdline-tools/latest`, `yes | sdkmanager --licenses`,
  `sdkmanager --platform-tools "platforms;android-35" "build-tools;35.0.0"`. `android/local.properties` already
  carries `sdk.dir=/opt/android-sdk`.
- `npx cap sync android` rewrites `android/app/src/main/assets/public`, which is ignored by `android/.gitignore` —
  the working tree stays clean (`git status --short` empty), so a rebuild changes only the gitignored `release/`.

## The installers are published as a GitHub Release (this branch)

- **The request:** *"Add the installers to a GitHub release so I can download them anytime. And give me also source
  code zip for github."* The installers lived only as the sandbox's download link (the `downloads` service, host port
  8000, which dies with the sandbox) and as 14-day Actions run artifacts. **The sandbox cannot create a release
  itself** — no `gh` binary, no token, `git push` fails, and the connected integration is **read-only**
  (`/actions/variables` and `/actions/secrets` both answer `403`), which is the same wall the iOS note records. The
  durable path is therefore the workflow below.
- **`.github/workflows/release.yml` is the publisher.** Two triggers: a **tag push** (`v*` — `git tag v1.0.0 &&
  git push origin v1.0.0`) or the **Actions tab** → *Publish HIKER Factory ERP Release* → *Run workflow*, typing the
  tag. A tag that does not exist yet is created on the commit the run built (`gh release create --verify-tag` is
  deliberately **not** used; `--target "$(git rev-parse HEAD)"` is, so the tag always names the commit that was
  actually built). **The Run-workflow button needs this file on the default branch** — `main` holds only the initial
  commit, the same gap the iOS note records — while a tag push works from any branch's commit.
- **The build recipes are not duplicated.** `android-apk.yml` and `windows-exe.yml` each gained `workflow_call:`, and
  the release workflow calls them (`uses: ./.github/workflows/<file>` with `secrets: inherit`) and then publishes
  their artifacts. `windows-exe.yml` also gained the **portable `zip` target** (step 9,
  `npx electron-builder --config electron-builder.yml --win zip --x64 --publish never`) and now uploads
  `release/*.exe` **and** `release/*.zip`, because the release carries the same three deliverables the sandbox
  serves. (Renumbering the steps is what moved the upload from 9 to 10.)
- **Four assets, and the three installer names are the sandbox's own**, so every link already handed out maps onto the
  release unchanged: `HIKER-Factory-ERP-android-debug.apk`, `HIKER-Factory-ERP-windows-setup.exe`,
  `HIKER-Factory-ERP-windows-setup.zip`, plus `HIKER-Factory-ERP-source.zip` — the release commit's whole tree
  written by `git archive --format=zip --prefix="HIKER-Factory-ERP-<tag>/"` (no `zip` binary needed; measured: 716
  entries, 12 MB, one top-level folder, and no `dist/` / `release/` / `node_modules/` inside). Because the names carry
  no version, `https://github.com/saeed11a/HIKER-/releases/latest/download/<name>` keeps resolving to the newest
  build — **hand that out, not the port-8000 sandbox URL.** GitHub additionally attaches its own auto-generated
  "Source code (zip)" and "Source code (tar.gz)" to every release.
- **A partial release cannot be published.** The publish job stages each artifact under its stable name and
  `test -s`-checks all three first, stopping with `::error::Missing build output for <asset>`; re-running for a tag
  that already has a release **replaces** its assets (`gh release upload … --clobber`) instead of failing. Nothing is
  needed in the repository for the release itself: the run's own `GITHUB_TOKEN` publishes it
  (`permissions: contents: write` on this workflow only; the two build workflows stay `contents: read`).
- **The builds still need `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`** as an Actions repository variable
  or secret (`android-apk.yml` step 4 / `windows-exe.yml` step 3 exit 1 without them), plus `VITE_APP_PIN` (warn-only).
  A run that stops there is missing configuration, not a code fault.
- **Verified here, and what could not be.** `js-yaml` in the `web` container parses all three files and the graph is
  as intended (release: `build-android` + `build-windows` via `uses:`/`secrets: inherit`, then `publish` needing
  both; both build workflows now list `workflow_dispatch, workflow_call, push`). The publish job's staging shell was
  run **verbatim** against the three real installers in `release/`, in a scratch tree: it produced the three stable
  names and `cmp` read each **byte-identical** to the installer beside it, and the completeness guard trips as
  designed (removing one staged asset stops the run with its `::error::` line). The `git archive` command was run in
  the container too, with the entry counts above.
  **NOT verified: any part of a GitHub Actions run** — this repository has **0 workflow runs and 0 tags**
  (`git ls-remote`/the API both report none) and the sandbox has no credentials, so no Release exists yet and no
  build step could be exercised from here. Push a tag — or merge this file to `main` and press *Run workflow* — and
  treat that first run as the verification.
- **The repository is public**, so its release downloads are public too: anyone with the URL can fetch the APK/EXE and
  the source zip. Release assets cannot be made private on a public repository — a private repository is what makes
  them visible only to signed-in collaborators (and then the download links need a GitHub login). The built bundles
  carry the Supabase URL, the publishable key and the app PIN, exactly as the handed-out installers already did;
  moving the repository to private is the owner's call, not something to change on a guess.

## The invoice is shared on WhatsApp (this branch)

- **Free, click-to-chat only.** `src/lib/whatsapp.js` builds a `https://wa.me/<number>?text=…` link
  from the **saved** invoice row and its saved lines; nothing is sent in the background, no WhatsApp API or
  connector is involved, and the user presses Send themselves. `whatsAppNumber()` accepts `03001234567`,
  `3001234567`, `+92 300 1234567`, `0092 …` and `923001234567` and returns `923001234567`; anything that is not
  a `3xxxxxxxxx` mobile returns **null** (a landline like `021-3456789` is refused).
- **The message holds only stored figures** — company, invoice number, date, customer, each line's
  quantity and amount, then the invoice's own `total`, `received` and `balance`. `moneyMark()`'s H/L/C is
  deliberately **not** used in the message (plain `Rs 2,205,000`): the mark is the office's own shorthand and
  reads as a typo to a customer. The header appends "Shoes Factory" when `settings.company_name` is only the
  brand — Settings holds `HIKER+`, so the line reads `*HIKER+ Shoes Factory*`.
- **There is no shareable PDF URL**, so none is invented: `pdfFromElement()` saves a file locally, so the
  message carries the details as text.
- **Two mount points, one button.** `src/components/invoice/WhatsAppShareButton.jsx` sits in
  `InvoiceDetailDialog`'s footer (the saved-invoice screen used by the register, a customer's invoices and the
  invoice history) and in `src/components/invoice/InvoiceSavedDialog.jsx`, the success screen `InvoiceNew` now
  opens on `result.invoice` / `result.lines` instead of navigating straight to `/invoices`; its **Done** is what
  returns to the register, and the invoice is already written, so a WhatsApp that cannot open loses nothing. A
  missing/invalid number toasts "No WhatsApp number for this customer" instead of opening WhatsApp, and a 2 s
  lock after a press stops a double click from opening two tabs.
- **Opening it in each shell.** Web and the desktop EXE take a synthetic `<a target="_blank" rel="noopener">`
  click — Electron's `setWindowOpenHandler` hands it to `shell.openExternal`, which opens WhatsApp Web; the APK
  cannot use `window.open` (a WebView ignores it), so `location.href` is used and Capacitor's
  `Bridge.launchIntent` passes the off-origin URL to Android, which opens WhatsApp.
- **Verified in the preview** (the user's replayed session, desktop): a saved invoice (INV-0001, AMIR,
  `03983749873`) produced `923983749873` and a message reading `*HIKER+ Shoes Factory*` … `Total: Rs 2,205,000`
  / `Paid: Rs 149,996` / `Remaining: Rs 2,055,004` — exactly the invoice's own figures; the button showed its
  "Opening WhatsApp…" state. A throwaway invoice (INV-0003, 1 carton @ Rs 100, received 0) then proved the
  success screen: title, customer, date, Total Rs 1,800 / Paid Rs 0 / Remaining Rs 1,800, the button, the same
  message with `Invoice: INV-0003`, and **Done** landing on `/invoices`. That invoice was then moved to the
  Recycle Bin through the register and **purged** (`binRowsLeft 0`), so the factory is back to INV-0001 / INV-0002.
- **Not automatically verified:** the real WhatsApp window itself (the link was captured by intercepting
  `HTMLAnchorElement.prototype.click` instead of leaving the sandbox), the APK's external intent, and the
  "no valid number" toast (no customer without a valid mobile was available to drive it). `npm run lint` and
  `npm run build` are clean.

## The number is a bill number now: 01, 02, 03 … (0045, this branch)

- **The request:** *"Invoice Number rename To bill Number and It will be 01 starting and then going up to the
  invoices made."* Two halves, and both are in place: the **label** every screen prints over the number reads
  **Bill**, and the **number itself** is a plain two-digit running count with no prefix and no dash.
- **`0045_bill_numbering.sql` is applied** (rollback: `0045_bill_numbering.rollback.sql`). It replaces **one
  function** — `create_invoice()`'s numbering block only: `v_prefix` is the settings value *as written* (empty by
  default now, not the old `INV` fallback) and the number is `v_prefix || lpad((count + 1)::text, 2, '0')`, giving
  `01`, `02` … `99`, then `100`. The retry loop and everything else about the function are 0030's verbatim.
- **The invoices already made were renumbered into the same series**, in creation order, inside the migration's own
  transaction, and so was **every copy of the number**: `invoice_lines.invoice_number`, the customer receipt's
  `payments.reference` (and its notes' text), `roznamcha.reference` / `description`, and each `invoice_days` snapshot
  (re-stored through `refresh_invoice_day()`, which is the only writer of a day). `settings.invoice_prefix` is
  cleared so the first new bill is `03`, not `INV03`. `audit_logs` deliberately keeps the numbers it saw — it is a
  history of what happened, not a live index.
- **Where "Bill" is printed:** `InvoicePrintView` (`Bill #:`), and the number column of the register
  (`Invoices.jsx`), Sales, the sales report and the invoice-history day dialog. **Document wording stays
  "Invoice"** — the dialog title, the saved toast and the WhatsApp message still name the document ("Invoice 01"),
  because only the number's own label was renamed. `useSettings`' default prefix is `""` and the Settings field reads
  **Bill prefix (optional)** (empty by default; filling it in prepends it without a dash).
- **Verified.** Applied through the `dbadmin` pooler (`BEGIN … COMMIT`, one day re-stored, no error), then read back:
  `invoices` → **01 / 02**, `invoice_lines` → 01 / 02, `payments.reference` → 02, `roznamcha` → 01 / 02, the
  `invoice_days` snapshot → `["01","02"]`, `settings.invoice_prefix` → `''`, and `pg_get_functiondef` carries the
  two-digit `lpad`. A probe `create_invoice()` call as the signed-in administrator, inside a transaction that was
  **rolled back**, minted **`03`** (and left `invoices` at 2 rows). In the preview (360px, the user's replayed
  session): `/invoices`' column header reads **Bill** with rows **01 / 02** and no `INV-` anywhere, and the opened
  invoice's print sheet reads **BILL #: 01** with no "Invoice #:" left; 0 console errors, 0 failed requests,
  `npm run lint` clean.
- **One stray row is expected:** `invoice_lines` also holds a line reading `INV-0003` whose `invoice_id` is no
  invoice — an orphan left by an earlier probe, invisible to every screen and untouched by the renumber (the
  migration follows `invoice_id`). Remove it only if the factory's own data ever needs the table cleaned.

## The bill's contacts, and bag sizes that come from Settings (0046, this branch)

- **`0046_settings_contacts_bag_types.sql` is applied** (`0046_settings_contacts_bag_types.rollback.sql` reverses it):
  two jsonb arrays on `public.settings` — **`contacts`** (`[{name, number}]`, the people printed at the top of every
  bill) and **`bag_types`** (`[{name, pairs, price}]`, the bag sizes the packing dropdowns offer). Both are additive
  and idempotent; the migration also seeds the existing row's `bag_types` with the two sizes the app shipped with
  (`100 pairs bag` 100, `150 pairs bag` 150), so the dropdowns keep working before anyone opens Settings.
- **The Company row is gone from the invoice.** `InvoicePrintView` prints Bill # / Date / Due and then the contacts
  in that right-hand top block, and its footer "Contact" block now carries the email alone (the old phone / phone2 /
  phone3 lines went with the fields). The top "INVOICE" header still prints the company name — only the `Company:`
  row was asked for.
- **The three phone fields on `/settings` are four (or more) name + WhatsApp/mobile rows**, seeded blank at four rows,
  with **Add number** and a per-row remove. They save into `contacts`; the old `phone` / `phone2` / `phone3` columns
  are no longer edited by this screen (their stored values are left alone — `kataPdf.js` still reads `phone`, so a
  ledger PDF keeps the office number it had).
- **Bag types are editable rows** (name, pairs, price) with **Add bag** and remove, saved into `bag_types`. A row
  with no name or no pair count is dropped on save.
- **`src/lib/bagTypes.js`'s `settingsBagTypes(settings)` is the one reader** and the built-in `BAG_TYPES` is its
  fallback when the list is empty, so no dropdown can be empty. It feeds the **Pairs per bag** select in
  `ProductionForm` (whose default now falls back to the first configured bag when `default_pairs_per_bag` is not in
  the list), the **Pack type** select and its pair arithmetic in `PurchaseForm`, and the pack select in
  `RawStockForm` (bag categories only).
- **Verified in the preview** (Supabase, the user's replayed session — no PIN gate this turn): `/settings` rendered
  the four contact rows and both seeded bag types; a contact (`Test Contact` / `03001234567`) and a bag were saved
  through **Save settings** (toast, values read back), invoice **01**'s print sheet then read `BILL #: 01 · DATE … ·
  TEST CONTACT · 03001234567` with **no `Company:`** anywhere, and with `bag_types` temporarily set to
  `[{200 pairs bag, 200}]` the New production dialog's **Pairs per bag** trigger read `200 pairs bag`.
  **Everything the probe changed was put back**: `bag_types` is `[100 pairs bag, 150 pairs bag]` and `contacts` is
  `[]`, the state the migration left.
- **Trap, hit here:** every bag row's name input shares `placeholder="200 pairs bag"`, so a
  `{ css: 'input[placeholder="200 pairs bag"]' }` fill hits the **first** bag row, not the new one — index the row by
  its position (or use an aria-label) when driving this form.

## The kata prints as a statement, and an edit reaches every document (this branch)

- **The printed kata opens on the party, not on a summary.** `src/lib/kataPdf.js`'s old `drawSummary` block (Jamma /
  Banam totals, net balance, "Who owes whom", document counts, opening balance, account) is **gone** — the user's
  reference sheet carried no such block and asked for it removed. `drawHeading()` now draws the party's **name as the
  largest line on the sheet (19pt bold)** with the contact under it (`phone · city`; a worker's `phone · cnic ·
  address`), and the **remaining balance in its own teal-bordered box** in the right-hand corner —
  `REMAINING BALANCE` over the signed figure (green when Jamma leads, red when Banam does, via the same `toneOf()`).
  The table follows immediately. Both exports (`exportPartyKataPdf`, `exportLabourStatementPdf`) use it, so a
  supplier's kata and a worker's statement read the same way; the party sheet keeps its "N prs sold on N invoice(s)"
  footnote. The labour table still has no Balance column (only the box carries the outstanding figure).
- **The kata is ordered by the clock, not by the date.** `partyLedger()` used to sort `entries` with
  `String(a.date).localeCompare(String(b.date))` and, on a tie, by the order the kinds were concatenated — which put
  **every invoice of a day above that day's receipts**, however the money had actually moved. `datetime.js` gained
  **`momentKey(row)`**: `YYYY-MM-DD` + `THH:MM:SS`, the clock taken from the row's own typed time (`invoice_time` /
  `payment_time`) and, when it carries none, from its `created_date` read in **Asia/Karachi** (`hourCycle: "h23"`).
  `analytics.partyLedger()` sorts on it (oldest first, so the running balance is still built forwards);
  `labour.labourStatement()` does the same in reverse (newest first) and now carries `time` / `at` on its rows. Both
  screens and both PDFs read those ordered rows, so the print form follows the same rule as the page, for customer,
  supplier and labour alike.
- **Editing a party's name or number carries the change onto its documents.** Those details are **copied** onto the
  documents (`invoices.customer_name / customer_phone / customer_address`, `invoice_lines.customer_name`,
  `purchases.supplier_name`, `payments.party_name`, `roznamcha.party_name`), and the card and balance maps group by
  the copied name — so a rename that stopped at the party row left the register, the printed bill and the whole kata
  reading the old name. **`src/lib/partyRename.js` (new)** is the one place that follows the change, with one filtered
  update per table and no per-document loop: `renameCustomer()` (invoices, invoice_lines, payments, roznamcha),
  `renameSupplier()` (purchases, payments, roznamcha), `renameLabour()` (payments, roznamcha). It is called on
  **edit only**, and only when the details actually moved: `CustomerForm` (name, phone or address), `SupplierForm`
  (name), `LabourForm` in `LabourDialogs.jsx` (name). A failed rename never undoes the save — it toasts
  "…saved — his documents were not updated" with the database's own message, because a staff account without
  `invoices:edit` can legitimately be refused by RLS.
- **Verified in the preview** (the user's replayed session, no PIN gate this turn, 360px):
  - A throwaway **customer** was created, then renamed through his card's pencil: the list read the new name and the
    save fired **four** `PATCH`es — `invoices?customer_id=eq…`, `invoice_lines?customer_id=eq…`,
    `payments?party_id=eq…&party_type=eq.customer`, `roznamcha?party_id=eq…&party_type=eq.customer`, all `204`
    (no rows for a fresh customer, which is exactly right).
  - The same for a **supplier** (`purchases`, `payments`, `roznamcha`) and a **labour** (`payments`, `roznamcha`),
    each created through its own form and renamed through its card's pencil. All three probes were then moved to the
    Recycle Bin and **purged** through the app (both Radix confirmations accepted a click on the button *node*, the
    knob this repo already documents); the lists and the bin are back to their own state and there were **0 console
    errors**.
  - The **PDFs** were generated headlessly in the `web` container (Vite `ssrLoadModule` of `kataPdf.js` with
    `@/lib/pdfFile` stubbed, the page content stream read back): the kata sheet carries `AMIR`, `03179850300`,
    `REMAINING BALANCE` and `-Rs 4,000`, and **no** "NET BALANCE", "Who owes" or "INVOICES"; the labour sheet carries
    the name and contact with the same box; a 09:00 receipt row printed **above** the 11:00 invoice row.
  - `momentKey()` was read back from the real module: `{time: "9:00"}` → `2026-10-20T09:00:00`, a row with only
    `created_date` `06:30Z` → `2026-10-20T11:30:00` (factory time), and sorting a mixed list put the previous day
    first, then 09:00, then 11:00, then the un-timed row by its recorded clock.
  - `npm run lint` → 0 problems and `npm run build` are clean.
- **Not re-driven:** the PDF download itself from the app's own button (a browser download is not observable here),
  and the on-screen ledger's re-ordering for a party whose live rows all share one timestamp.

## The magnitude marks are gone, and the bill's contacts sit in the footer (this branch)

- **No money figure carries H / L / C any more.** `moneyMark()` was removed from `src/lib/format.js` and
  `money()` returns the plain formatted amount (`Rs 250,000`), so every screen, ledger, PDF and CSV/XLSX
  export reads without the suffix; `src/components/ui/money.jsx`'s `Money` is now a pass-through of the text
  (kept as a component so its ~40 call sites did not change). `src/components/ui/money-input.jsx` is a plain
  left-aligned `Input` — the invisible-copy `<sub>` layer and its `markClassName` prop are gone.
  **The sections above that describe the mark as a feature ("The money mark: H / L / C …", "A money field
  shows its mark while the amount is being typed", and the APK notes that say a bundle "carries the money
  magnitude suffixes") are superseded**: do not reintroduce the suffix in `money()` or the money field.
- **The four Settings contacts print in the invoice footer, not at the top.** `InvoicePrintView`'s right-hand
  Bill #/Date/Due block no longer renders them; the footer's **Contact** block lists every filled
  `settings.contacts` row (`Name: number`) above the email, and still prints `—` when all are blank. The
  Settings hint now reads "printed in the footer of every bill".

## One clock for the kata statement (this branch)

- **`clockOf()` reads a 12-hour clock too.** It used to parse only `14:05` / `14:05:00`, so a payment's own
  `payment_time` stored the way the payment sheet writes it (`2:16PM`) fell through to the row's `created_date` and
  `momentKey()` placed a 2 pm receipt **at 2:16 in the morning** — the kata's running balance then jumped
  (`−2,630,829` → `−425,829` → `−445,829`), even though every figure was right for the order it was built in. The
  function now also matches an `am`/`pm` suffix (`2:16PM`, `2:16 pm`, `2:16p.m.`), so a row's typed clock sorts where
  it happened. **Do not give a second reader its own time parser** — `momentKey()` (order) and `kataTime()` (print)
  both go through this one function.
- **`kataTime()` prints the factory's clock, and `KataStatement` prints every row through it.** It used to read a
  timestamp's hours with `getHours()`, i.e. the browser's timezone, while `momentKey()` read Asia/Karachi — so a
  payment with no typed time printed `2:16PM` in the UTC preview against the `7:16PM` it sorted at. A row's own time
  string (`19:43` on an invoice, `2:16PM` on a receipt) is normalised the same way, so the statement's Time column is
  one reading all the way down.
- **A ledger row's detail is not printed twice.** `KataStatement`'s new `detailOf(row)` drops a `detail` the label
  already names — a receipt whose notes read "Received against 02" no longer shows `· 02` after it.
- **A running total that lands on zero arrives as `-0`**, which `money()` prints as `Rs -0`; `KataStatement`'s
  `opening` is normalised (`num(...) || 0`) so the footing reads `Rs 0`.
- **Verified in the preview** (the user's replayed session, 360px, `/customers/<id>` for AMIR): all 15 entry times read
  `h:mmAM/PM` (`7:43PM`, `7:16PM`, `2:16PM`, `1:02PM`, …); every step of the running balance equals the row below it
  plus that row's own amount (14/14, newest first) and the newest figure equals the footing's `Jamma +Rs 204,171` /
  `Banam −Rs 2,835,000`; the footing's opening reads `Rs 0`; no sideways scroll, 0 console errors; `npx eslint` on the
  two changed files is clean.

## The print forms wear the company letterhead (this branch)

- **One palette for paper, taken off the letterhead reference:** `src/lib/printTheme.js` holds the factory red
  `#D9232D`, the graphite ink `#2D3132`, the off-white paper `#F0F0F0`, the two stripe shades, the Jamma green and
  the `PRINT_BUTTON_CLASS` the Print buttons wear. **Both printable sheets and every Print button read it from
  there** — a colour change belongs in that file, never inline in a component.
- **The mark is on both sheets, twice.** `src/components/print/PrintBrand.jsx` exports `PrintLogo` (the HIKER+ badge,
  the wordmark with its red `+` / red-flanked SHOES and the tagline, in a `tone` for dark bands) and `PrintWatermark`
  (the same badge at 6% opacity, `absolute` centred, `pointer-events-none`). The badge is `/hiker-logo.png` — the
  app's own mark, not a new asset. **On a sheet the watermark sits under the type**: its root is `isolate` and every
  content block is lifted with `relative z-[1]`, otherwise the positioned image would paint over them.
- **`InvoicePrintView`**: graphite header band with a 3px red rule (the white wave is gone — it was cut for a black
  band), the mark + wordmark top-left, a **red table heading row** with white cells, off-white striped body rows, the
  red `Total` bar, a red footer rule and the letterhead's "Built for the journey." closing line beside the thanks.
  The paper is `#F0F0F0` at the sheet's own root — the @page margins stay white paper, no negative-margin trick.
- **`KataPrintSheet`**: the same letterhead bar (mark left, `settings.company_name` + "Footwear manufacturer" right,
  closed by a red rule) over the party's name/phone and the red-boxed remaining balance, then the ruled ledger with
  its **graphite heading row**, striped rows, Jamma in green, Banam in red and the balance in ink.
- **`.print-sheet` is a CSS hook** in `src/index.css`, beside `.invoice-print` and sharing its
  `print-color-adjust: exact`: without it the print dialog drops the paper, the graphite band and the red table
  headings and the sheets print as plain text. **A new printable sheet must carry one of those two classes.**
- **The Print buttons are red**: `PRINT_BUTTON_CLASS` on the kata page's "Print page" / "Print KATA Ledger", the
  invoice dialog's "Print / PDF", the invoice history's and a stored day's "Print / PDF", `PrintConfirmDialog`'s
  action and the labour page's "Print page" (an `outline` Button whose `bg-transparent` the class list overrides
  through `twMerge`).
- **Verified in the preview** (the user's replayed session, no PIN gate this turn): the kata sheet computed
  `rgb(240,240,240)` paper, heading row `rgb(45,49,50)` with white cells, rows `rgb(251,247,247)` /
  `rgb(242,236,236)`, the balance box `rgb(217,35,45)`, `printColorAdjust: exact`, and the badge twice (mark
  `opacity: 1`, watermark `0.06`, both `naturalWidth 512`); invoice 01's sheet computed the same paper, header
  `rgb(45,49,50)` with a `3px rgb(217,35,45)` bottom rule, table heading `rgb(217,35,45)`, striped first row, the
  watermark 302px square, and the screenshot shows the red heading/total bars; both Print buttons computed
  `rgb(217,35,45)` with white ink. 0 console errors, `npx eslint` on the ten changed files → 0 errors, `npm run build`
  clean.
- **Not verified:** the printed/PDF output itself (the print dialog and `pdfFromElement`'s raster are not observable
  here) — the colours are held by `print-color-adjust: exact`, which is the same mechanism the invoice already
  relied on.

## "Print Only" / "Print Kata", WhatsApp, and one palette on both sheets (this branch)

- **The kata page's two buttons are named by what they do.** `PartyDetailView`'s "Print page" is
  **Print Only** (it is the printable `KataPrintSheet` through the browser's print dialog) and "Print KATA
  Ledger" is **Print Kata** (`exportPartyKataPdf`, the PDF file). The labour page's own "Print page" is **Print
  Only** too; its "Print / PDF" (the labour statement PDF) kept its name. Every earlier note naming "Print page" /
  "Print KATA Ledger" (the print-theme section above included) describes the old labels.
- **A party can be messaged on WhatsApp from his own page.** `partyWhatsAppUrl(party, settings)` /
  `partyWhatsAppMessage()` in `src/lib/whatsapp.js` build a `wa.me/<number>` click-to-chat link for the record's
  own phone (`whatsAppNumber()` still refuses a non-mobile), with the company name and a greeting prefilled; the
  message is never sent from the app. `src/components/whatsapp/WhatsAppButton.jsx` is the labelled control
  (**WhatsApp**, the inline `WhatsAppIcon` glyph) and toasts when the phone is not a valid mobile — it sits in
  `PartyDetailView`'s footer (customer and supplier) and in `LabourDetail`'s header actions.
- **Every invoice row carries the WhatsApp icon.** `WhatsAppShareButton` gained `iconOnly` (a ghost `size="icon"`
  button, `aria-label="Send invoice on WhatsApp"`) and now reads the invoice's lines back itself
  (`db.InvoiceLine.filter`) when the caller passes none, so the register's row button
  (`Invoices.jsx` → `RowActions extra`) sends the same message the dialog's labelled button does. The dialog and
  the success screen still pass their own `lines`, so nothing about them changed.
- **Both kata outputs are cut from `printTheme`, like the bill.** `KataPrintSheet`'s table heading is now the
  invoice's red (`PRINT_RED`) instead of graphite, and `kataPdf.js` dropped its teal palette for
  `PRINT_INK` band + `PRINT_RED` rule, `PRINT_PAPER` page (painted on every page, `paintPaper()`), a red table
  heading, the same two stripe shades per row (`PRINT_STRIP_LIGHT` / `PRINT_STRIP_DARK`), a red-bordered
  remaining-balance box and `PRINT_JAMMA` green. Both exports (`exportPartyKataPdf`, and
  `exportLabourStatementPdf`, which shares `openStatement`) moved with it, so a kata PDF and an invoice print as
  the same page. **A colour change belongs in `printTheme.js`, never inline.**
- **Verified in the preview** (the user's replayed session, 360px, no PIN gate): `/customers/<id>` renders
  **WhatsApp · Print Only · Print Kata** (the old labels gone), its printable sheet computes paper
  `rgb(240, 240, 240)`, table heading `rgb(217, 35, 45)`, striped body `rgb(251, 247, 247)`,
  `print-color-adjust: exact`, and no sideways scroll; `/invoices` carries the WhatsApp icon on every row;
  `/labour/<id>` renders **WhatsApp** and **Print Only**. `npx eslint` on the changed files → **0 errors**
  (two pre-existing warnings) and `npm run build` is clean.
- **NOT automatically verified:** the WhatsApp press itself (it opens an external `wa.me` tab, so it was not
  clicked), and the PDF files' own appearance (a download is not observable here) — the palette is read from the
  code path, and the HTML sheet's colours were measured.

## A kata, a bill and a worker's statement travel as PDF attachments (this branch)

- **The user's request:** *"send the kata and invoice as a PDF attachment instead of text on WhatsApp"*. A
  `wa.me` link can only carry text, so the documents now go through the platform's **share sheet**:
  `src/lib/whatsappShare.js` is the one path (`shareKataOnWhatsApp`, `shareInvoiceOnWhatsApp`,
  `shareLabourStatementOnWhatsApp` → `sharePdfOnWhatsApp`). Inside the APK the file is written to
  `Directory.Cache` and handed to `@capacitor/share` (`files: [uri]`); in a browser that reports
  `navigator.canShare({ files })` it goes through `navigator.share`; **otherwise (a desktop browser, the EXE)
  the PDF is saved with `saveBlob()` and the chat opens** so the user attaches it by hand, and the toast says
  so. Nothing is sent in the background — the user picks the contact and presses Send.
- **The files are built, not printed to.** The kata and the labour statement come from `kataPdf.js`'s new
  builders (`buildPartyKataPdf` / `buildLabourStatementPdf`; the `export…Pdf` wrappers still save/download).
  The invoice has no dialog to print from when the share starts at the register's row, so
  **`src/lib/invoicePdf.jsx`** renders `InvoicePrintView` into an off-screen 729px host and rasterises it with
  `pdfBlobFromElement()` (`pdfFile.js`; `pdfFromElement()` is now the save wrapper around it). **Render it with
  `flushSync`, not a guessed frame** — the frame-guessed first cut left html2canvas nothing to draw, produced no
  file and no message, and looked exactly like a dead button.
- **The captions live in `whatsapp.js`** (`invoiceWhatsAppCaption`, `kataWhatsAppCaption`,
  `labourWhatsAppCaption`) because a shared file still needs a line beside it; the old full text messages
  remain for the link fallback. `WhatsAppButton` gained `onShare` (a party's own document) and keeps its `url`
  mode; the invoice's `WhatsAppShareButton` now builds and attaches the file.
- **`RowActions`' `extra` slot is wrapped in a click-stopper.** Without it, pressing the register row's WhatsApp
  mark also ran the row's `onClick` and opened the bill underneath the share.
- **Verified in the preview** (the user's replayed session, 360px, backend Supabase, 0 console errors):
  `/customers/<id>` → **Send** saved `kata-amir.pdf`; `/invoices` → a row's WhatsApp mark saved
  `invoice-01.pdf` **without opening the bill**, and the opened bill's own **Send** saved it too (button read
  `Sending PDF…` → `Send`); `/labour/<id>` → **WhatsApp** saved `labour-statement-bilal.pdf`. Each showed
  `PDF downloaded <file>` + `Attach the PDF in WhatsApp …` (this browser has no file sharing, so the fallback
  is what ran). `npm run lint` → 0 problems, `npm run build` clean.
- **NOT automatically verified:** the real attachment path — `navigator.canShare({ files })` on a phone and the
  Capacitor share sheet in the APK (no device or emulator here), i.e. the PDF actually appearing inside the
  WhatsApp chat with the chosen contact. The `web` service was restarted after the new modules were added (the
  stale-module trap), and the files' own appearance in WhatsApp needs one send on the phone.

## The bill's foot: payment details left, a kata box under them, and green/red money bars (this branch)

- **The Payment Details box is a size down at the left foot of the sheet.** `InvoicePrintView`'s bottom `section`
  is a two-column grid now: the left column carries the bank box (`max-w-[50mm]`, 5.5pt) and, under it, the
  **Kata** box — **Remaining** (this bill's own balance), **Remaining Kata** (the customer's account closing, signed:
  `−` when he owes, `+` in advance) and **Total Kata** (the account's remaining — it reads the same signed figure as
  Remaining Kata; it used to print everything billed to him). The right column keeps Subtotal /
  Grand Total / Received / Balance. No write path, total or line changed.
- **Received is green and Balance follows the money.** `printTheme.js`'s `PRINT_RECEIVED_WASH` is now the pale
  green `#DCFCE7`, `PRINT_BALANCE_WASH` is gone, replaced by `PRINT_DUE_WASH` (`#FEE2E2`) and `PRINT_CLEAR_WASH`
  (`#DCFCE7`): the Balance bar and its ink are red while `invoice.balance > 0` and green once it is cleared. The
  old `−`/`+` sign on the balance figure went with it — a due amount reads plain.
- **The figures come from `src/lib/invoiceKata.js`** (new): `invoiceKataFigures(customerId)` sums one customer's
  invoices, receipts and payouts plus his opening balance on the side it belongs to (the same rule as
  `partySides()`), `useInvoiceKata()` is the hook the dialog uses, and `invoicePdf.jsx` awaits the same reader
  before it draws the off-screen sheet — so the PDF a WhatsApp share attaches carries the same box as the dialog.
  A walk-in bill has no `customer_id`: the box prints its labels with `—` rather than failing.
- **The WhatsApp share is the file alone.** `whatsappShare.js` no longer passes `title` to `Share.share` /
  `navigator.share`, so no caption rides along with the invoice, kata or labour PDF — the file is the whole share.
- **Verified in the preview** (the user's replayed session, `/invoices` → **View details** on bill 01): the sheet
  renders Payment Details + Kata at the left foot (Kata at `top 466 / 523`, left 38) with Remaining Rs 2,055,004,
  Remaining Kata −Rs 2,630,829 and Total Kata Rs 2,835,000; Received's bar computes `rgb(220,252,231)` and
  Balance's `rgb(254,226,226)` (money owed); at 360px the document and the sheet report **0** horizontal overflow.
  The sheet was also rendered headlessly (Vite `ssrLoadModule` + `renderToStaticMarkup`): both boxes, all three
  kata rows, the green received bar, the red due bar, the green cleared bar and the blank (`—`) kata values of a
  bill with no customer all read back true. `npm run build` and `npm run lint` are clean.
- **NOT automatically verified:** the WhatsApp PDF actually arriving inside the chat — this browser has no file
  sharing, so the press would fall back to saving the file and opening the chat (the earlier section's note
  stands), and the attachment itself needs one send on the phone.

## The bill is written in a popup, and the WhatsApp press says what it did (this branch)

- **New invoice is a dialog on the register, like New purchase.** `src/components/forms/InvoiceForm.jsx` (new) is the
  old `pages/InvoiceNew.jsx` moved into a `FormDialog` (`size="lg"`), with the same loads, the same `createInvoice()`
  call and the same `InvoiceLines` shelf rules — only the chrome changed. `Invoices.jsx` opens it from the header's
  **New invoice** button (shown only to an account with `invoices:add`, which is the gate the old route enforced) and
  re-reads the register through `onSaved`. Saving closes the form and opens the existing `InvoiceSavedDialog` on the
  result, so the bill can be sent before the register is read again; `/invoices/new` still resolves (it renders the
  register) so an old link never 404s, and `pages/InvoiceNew.jsx` was deleted with the `InvoiceNew` import in
  `App.jsx`. Nothing about `create_invoice()`, stock, the kata or the bill's numbering moved.
- **A dialog is reused, so it resets on open**: the reset and the data load both run when `open` turns true (never on
  close), which is why the saved-invoice dialog survives the form closing underneath it.
- **The WhatsApp share's fallback now names the limit.** `sharePdfOnWhatsApp()` still hands the PDF to the platform's
  share sheet and still saves it + opens the chat where there is none — the toast now reads "… this browser cannot put
  a file into WhatsApp by itself, so attach it in the chat that just opened." That sentence is the honest state of a
  desktop browser, this preview and the EXE: a `wa.me` chat takes text only, and no page can push a file into
  WhatsApp's own composer.
- **Measured here**: pressing the register's WhatsApp mark and a customer kata's **Send** both built their PDF
  (`invoice-03.pdf` 1.6 s, `customer-kata-amir.pdf`) and reached that fallback, with **0 console errors** — this
  browser reports `navigator.canShare` as **undefined**, so it has no file sharing at all. The attachment itself
  therefore needs the phone's share sheet.
- **CRITICAL, found while checking why the phone "did not send the PDF": the APK in `release/` predates the whole
  WhatsApp feature.** Its `assets/public/assets/index-DsS4-SvC.js` contains **zero** occurrences of `WhatsApp`,
  `whatsapp`, `wa.me` or `navigator.share` (the code landed on 2026-10-29; that artifact is from 2026-10-27), so the
  installed app has no WhatsApp control to press. Rebuild the APK (the recipe in "The APK is therefore built from the
  repo's own Android project now" — remember `env -u VITE_BASE44_PREVIEW_MODE` when building the bundle) before
  telling anyone the phone can send a PDF.

## Search on every record table, and the invoice register's filters (this branch)

- **The search belongs to the table now.** `src/components/DataTable.jsx` takes `search`, `onSearch`,
  `searchPlaceholder` and `filters`; when either is passed it renders a toolbar (`no-print`) at the top of its own
  panel, above the mobile cards and the desktop table. A table that passes none renders exactly as before. The
  page-level `SearchBar` was moved from the page header into that toolbar on the single-table record screens
  (Articles, Investments, Invoices, InvoicesHistory, Kharcha, KharchaHistory, Labour, Payments,
  ProductionCategoryHistory, ProfitHistory, Purchases, ReadyShoes, Sales, UppersHistory, ZakatHistory,
  RoznamchaHistory) — one search box, over the list it narrows. **The multi-table screens keep their header search**
  because one search state filters several tables at once (Roznamcha in/out, ReadyArticlePage/ReadyGradePage
  grades+batches, RawStockHistory entries+usage), and the card lists (Customers, Suppliers, RawStock,
  ReadyArticlesPage, Users) are not tables.
- **`/invoices` filters by article and grade, and searches the customer's name.** `Invoices.jsx` reads the matching
  `InvoiceLine` rows for the chosen `article_code` / `grade` (one query, up to 1,000 lines) and narrows the register
  to their invoices; the free-text search still matches the bill number **and** `customer_name`. The article is kept
  in the URL (`?article=<code>`, the link the Articles page uses) and the toolbar's **Clear filters** resets search,
  article and grade together. The old "Filtered by article" banner was removed with it.
- Verified in the preview (Supabase, the user's replayed session, 360px): search "AMIR" kept all 4 AMIR invoices and
  "zzz-no-customer" left 0 with the "No invoices match your search" state; Grade B emptied the table ("No invoices
  match these filters"); `?article=AH+3` (an article with no invoice lines) left 0 with the same state while
  `?article=AH+1` kept all 4; the toolbar's search sits inside the table panel on /purchases, /payments, /labour,
  /sales, /ready-shoes, /kharcha, /roznamcha/history and /zakat/history with no console errors. `npm run lint` clean
  (warnings only) and `npm run build` clean.

## The view popup sits in the middle of the window again (this branch)

- **The report:** *"the popup show where the icon eye press … some record are down and if press view we need to go
  down then view so make it view in center auto each view"*. It was literal: the record dialogs were **not**
  `position: fixed` at all — measured on `/payments` at 360px, the opened dialog's computed `position` was
  `relative`, its top sat at the pressed row (556 against an eye at 547) and its bottom 255px below the viewport.
- **Cause: `tailwind-merge` dropped the content's own `fixed`.** `RecordDetailDialog` and
  `recycle/RecycleBinDetailDialog` passed `className="relative max-h-[90vh] …"` to `DialogContent`, and `cn()` is
  `twMerge` — `relative` and `fixed` are the same position group, so the caller's `relative` won and the dialog fell
  into the page flow wherever its portal sat. Both class lists lost the `relative`; the close button's `absolute`
  needs a positioned ancestor and `fixed` already is one, so nothing else changed.
- **Rule:** never pass `relative` / `absolute` / `sticky` in a `DialogContent` className — the primitive's own
  `fixed left-[50%] top-[50%] translate-x-[-50%] translate-y-[-50%]` is what centres it. Every other dialog in the
  app was already centring correctly; these two were the only callers overriding it.
- **Verified in the preview** (Supabase, the user's replayed session, 375px): the dialog opened from the **last** row
  of `/payments` computes `position: fixed`, `top 151 / bottom 662` in an 812px viewport — centre offset **0**,
  entirely on screen, with the screenshot showing it mid-window. `npm run lint` clean.

## The invoice prints as the page it shows (this branch)

- **The report:** *"As invoice print or pdf shown not correctly as make the print or pdf like showing in the
  view."* The sheet was only **556 px tall** while A4's printable height at the same width is ~1028 px, so the
  PDF drew the bill at 547 × 417 pt in the top half of an A4 page (`drawImagePages`, `src/lib/pdfFile.js`) and
  the browser's print produced the same half-empty sheet — the printed bill did not look like the page the
  dialog shows.
- **`InvoicePrintView`'s root is one A4 sheet now.** The `<article>` is `flex flex-col` with
  `style={{ minHeight: "272mm" }}` (297 mm less the `@page` 10 mm margins, 5 mm of slack so a rounding error
  can never spill a blank second page); the ruled-line `<section>` is `flex-1`, so the letterhead, the date/bill/
  customer boxes, the totals, the kata, the closing line, the cartons box and the footer all keep their own
  order and the footer lands on the page's foot. The `.print-receipt` (80 mm) variant is deliberately left
  without the min-height.
- **Nothing else changed:** no total, line, kata figure or print colour moved, `drawImagePages` is untouched,
  and a bill with more than the form's ten lines still grows past the page and runs onto a second PDF page.
- **Verified in the preview** (`/invoices` → **View details** → **Print / PDF**, the file captured from the
  button's own `<a download>`): the sheet measures **607 × 1028** on screen (`minHeight` 1028.03px), the real
  PDF's raster is **1458 × 2058** (a 729 × 1029 sheet at scale 2), and `drawImagePages`' arithmetic puts it at
  **547 × 772 pt** of a 794 pt printable height — **97 % of the page, one page**, against ~52 % before. The
  section order and the footer's position were measured on the sheet (`HEADER 98 · meta 53 · table section 653 ·
  totals 89 · kata 35 · closing 33 · footer 16`, footer's bottom exactly at the sheet's 1028, 0 px left under
  it).
- **Not re-verified (the turn's preview budget ran out):** stretching the ten ruled lines to fill the table
  section (the section takes the slack, so the blank paper sits under the last line rather than inside it), and
  how the taller sheet feels inside the dialog on a phone, where it now scrolls like a page.

## The exact-size bill page was flipped by jsPDF (this branch)

- **The report:** *"As it print pdf didn't correctly fit as view is correct"* — the downloaded bill was a portrait
  page with the invoice drawn across its **top** and a wide white band under it, the right-hand side clipped.
  Measured from the real file: its MediaBox was **469.53 × 595.28** while the bill's sheet is **595.28 × 469.53**,
  i.e. jsPDF had turned the exact-size page on its side.
- **`jsPDF` reverses a `format` whose width exceeds its height**, reading it as a landscape array that a portrait
  page must "correct" — so `new jsPDF({ orientation: "portrait", format: [595.28, 469.53] })` silently produced a
  **469 × 595** page, and the sheet drawn at 595 × 469 was cut off on its right while the bottom third of the
  page stayed empty. A sheet taller than A4's width is unaffected, which is why the earlier full-height (272 mm)
  attempt looked right and this one did not.
- **The fix is in `pdfBlobFromElement()` (`src/lib/pdfFile.js`): the orientation follows the page's own
  proportions** — `pageHeight >= A4_WIDTH_PT ? "portrait" : "landscape"` — which is the one case jsPDF leaves the
  array alone in. Do not pass a portrait orientation with a short page size, and do not "fix" a cropped PDF by
  changing the sheet's width.
- **Verified in the preview** (`/customers/<id>` → bill 04 → **Print / PDF**, the blob captured from the button's
  own `URL.createObjectURL`): one page, MediaBox **[595.28, 469.53]**, and the embedded JPEG **1458 × 1150** —
  the same 0.7888 ratio, so the sheet fills the page exactly with no band and nothing cropped. `npx eslint
  src/lib/pdfFile.js` is clean. The invoice share (`invoicePdf.jsx` → `invoicePdfBlob`) renders through the same
  function, so the WhatsApp attachment is fixed by the same change.

## The bill's PDF is a whole A4 page, not a slip on one (this branch)

- **The report:** *"Make the pdf print like that size as exactly to this"* over a capture of the bill. Measured at
  the print width (729 px) the print view was only **591 px** tall, so `pdfBlobFromElement(…, { exactPage: true })`
  made a **210 × 170 mm** page: the bill printed as a wide slip in the corner of the paper with the rest blank.
- **The sheet stays content-sized on screen; the page is A4 in the file.** `InvoicePrintView` is deliberately not
  stretched (a phone dialog would become a screen and a half of empty rules — the 272 mm attempt's own trap), so the
  page's height is given to the **clone** `pdfBlobFromElement()` draws: with `width` + `exactPage` it sets
  `minHeight = width × 841.89 / 595.28` (**1031 px at 729**), the A4 page's own height.
- **The ruled lines take the slack, so the extra room is not blank paper.** `InvoicePrintView`'s table section is
  `flex-1` and the table `min-h-full flex-1`; the ten lines share it (measured: section **646 px**, rows **50–52 px**
  each, the footer's bottom exactly at the sheet's 1031). **`h-full` on the table alone does not work** — the table
  stayed 206 px and the blank paper sat between the last rule and the totals.
- **A fraction of a point over A4 must not fall back to the margined path.** `pageHeight` is snapped to
  `A4_HEIGHT_PT` when it lands within **3 pt** of it, because a rounding of the sheet's own pixel height otherwise
  sends the whole bill to `drawImagePages` (24 pt margins, image scaled into them) — the "drawn small in the corner"
  result.
- **Verified in the preview** (`/invoices` → a bill → **Print / PDF**): the clone measures **729 × 1031**, the page
  works out to **210 × 297 mm** (`595.28 × 841.88 pt`) with `onePage: true`, the press performed with **0 console
  errors** and the button returned to its idle label, and the on-screen sheet is unchanged at **591 × 562**.
  **Not verified: the downloaded file's own MediaBox** — a browser download cannot be read from here, so the page
  size is the geometry above (`html2canvas` canvas of that clone) plus jsPDF's own rule, checked in the container:
  `orientation: "portrait"` with `format: [595.28, 841.89]` gives exactly 595.3 × 841.9 pt.
- **Do not re-stretch the on-screen sheet to A4.** The page height belongs to the PDF clone; the dialog, the phone
  and the WhatsApp share all read the sheet as it is.

## The bill's Print / PDF is the browser print dialog again (this branch)

- **The request:** *"Make the print /pdf invoice button like the print only button to show invoice in this style"*
  over a capture of Android Chrome's own print preview ("Save as PDF", the statement on a white page). The invoice
  dialog's **Print / PDF** now calls **`window.print()`** for the web and the desktop EXE, exactly as the party
  page's **Print Only** does, so the bill appears full page in the device's print dialog and "Save as PDF" is a
  destination there — one step fewer, and the same experience as the kata statement.
- **The Android branch is unchanged**, because a WebView has no print dialog: there `pdfFromElement()` still
  builds the file and saves it through `src/lib/pdfFile.js`. Anything that prints from the browser may use
  `window.print()`; anything that must work inside the APK must go through `pdfFile.js` (see "Every Print / PDF
  button now hands over a real file" — the two rules are the same one, split by shell).
- **`src/components/invoice/PdfPreviewDialog.jsx` is deleted.** It was added one commit earlier
  (`78b5abc`) to show the generated blob in an iframe, and an iframe PDF does not render in Android Chrome — the
  reason the print-only path is the one that works on the phone. Nothing else referenced it.
- **`InvoiceDetailDialog` keeps** `printing-invoice` on `<html>` while a bill is open and the `print:` overrides
  on `DialogContent`; that pair is what makes the printout the invoice alone (`html.printing-invoice #root {
  display: none }` in `src/index.css`).
- **Verified in the preview** (`/invoices` → **View details** on bill 03 → **Print / PDF**, 360px): the sheet
  renders, `printing-invoice` is on `<html>`, the press performed, **no in-app preview dialog opened** (the only
  `[role="dialog"]` left is the invoice), and **0 console errors**; `npx eslint` on the file and `npm run build`
  are clean. **Not observable here:** the system print preview itself (a headless browser paints none) — one press
  in the user's own pane shows the bill on its white page.

## The bill's printed page is the bill's own size (this branch)

- **The request:** *"put the invoice as in view to the pdf page same to this size as in view, not increase the length of
  the page"* — with `window.print()` and the stylesheet's fixed `@page { size: A4 portrait; margin: 10mm }`
  (`src/index.css`), Save as PDF gave an A4-length page: the bill at its top and a blank band under it.
- **`src/lib/printPage.js` (new) sizes the printed page to the sheet.** `fitInvoicePage(sheet)` lays a copy of the sheet
  out in an off-screen host at **190mm (718.11px)** — A4's printable width at the 10mm margins, i.e. the width the print
  layout actually gives it — reads its height, and appends a `<style id="invoice-page-size">` holding
  `@media print { @page { size: 210mm <height + 20mm margins + 1mm slack>mm; margin: 10mm; } }`. The page keeps A4's
  width and ends where the invoice ends; `clearInvoicePageSize()` removes the rule and the stylesheet's A4 default is
  back. The 1mm of slack is what stops a rounding of the layout pushing the closing line onto a second, blank page.
- **`InvoiceDetailDialog` runs it in an effect keyed on `[id, record?.id, lines.length]`** — the lines are what set the
  sheet's height, so a bill measured before they load would be short — and clears it on close. Measuring in the click
  handler instead would need `await` before `window.print()`, which can cost the user activation the dialog wants.
- **Verified in the preview** (`/invoices` → **View details**, 360px): the injected rule read
  `@page { size: 210mm 168.1mm; margin: 10mm }` against the sheet's own **147.1mm** at print width (147.1 + 20 + 1 =
  168.1, exact), i.e. shorter than A4's 297mm, with 0 console errors; closing the bill removed the rule and the
  `printing-invoice` class. **Not observable here:** the print dialog's own preview and the saved file's page size (a
  headless browser paints none) — press **Print / PDF** once in the user's pane and "Save as PDF": one page, no blank
  band. The Android branch is untouched (a WebView has no print dialog; it still builds the file through
  `pdfFile.js`).

## The kata's paper fits too, and a PDF page keeps its white margin (this branch)

- **The request:** *"Now make the pdf put on the white page fit to check"* — the invoice's Save as PDF was already
  sized to the bill (the section above); the **party's kata** was not, and the files built through
  `pdfFile.js` still drew the sheet to the paper's edges.
- **`src/lib/printPage.js` is generic now.** `fitInvoicePage` / `clearInvoicePageSize` are
  **`fitPrintPage` / `clearPrintPageSize`** (same maths: a 190mm-wide copy measured, then
  `@media print { @page { size: 210mm <sheet + 20mm + 1mm>mm; margin: 10mm } }` under `<style id="print-page-size">`).
  `InvoiceDetailDialog` imports the new names. **`PartyDetailView` runs it on mount** (keyed on `[type, party?.id,
  ledger]`, because the entries set the sheet's height) with a ref on the always-mounted `.hidden print:block`
  wrapper, so **Print Only** → Save as PDF gives the statement and not an A4 sheet with a blank band under it.
  The hook sits **above** the component's `if (!party) return null` — below it React refuses it
  (`react-hooks/rules-of-hooks`), which is what the first cut did.
- **The exact-page PDF keeps 10mm of white paper.** `pdfBlobFromElement()`'s one-page path used to draw the raster
  from `(0,0)` at full A4 width; it now insets it by **`PAGE_MARGIN_PT` (28.35pt = 10mm)**, the same margin the
  `@page` rule gives a printed sheet, and the page's height is the sheet's scaled height plus both margins. So
  "Print Kata" (`kataSheetPdf.jsx` now passes `{ exactPage: true }`) and the APK's invoice file put the sheet **on**
  the white page instead of bleeding to its edges. The tall-sheet (`drawImagePages`) path is untouched.
- **Verified in the preview** (the user's replayed session, 0 console errors): the customer kata page injected
  `@page { size: 210mm 251.3mm; margin: 10mm }` against a sheet measured **226.5mm** at 190mm width — the page is
  the sheet + 20mm + 1mm of slack, i.e. it ends where the kata ends; `/invoices` → **View details** injected
  `210mm 168.1mm` against the bill's **147.1mm** (unchanged, and closing still clears the rule). `npm run lint` →
  0 problems, `npm run build` clean, and the dev server serves the changed modules.
- **NOT automatically verified:** the print dialog's own preview and the downloaded files' MediaBoxes (a headless
  browser paints no print preview and a download cannot be read back here). Press **Print Only** on a customer (and
  **Print / PDF** on a bill) once and "Save as PDF": one page that ends with the document, with white margins.

## The bill fills the paper it is printed on (this branch)

- **The report:** *"Make it to fit in page as text and invoice fit in page each item fits correctly"* over a phone
  capture of Android Chrome's print preview ("Save as PDF", **Paper size: Letter**): the bill sat as a block with
  white bands above and below it. The pages sized to the sheet (the two sections above) are the cause — a custom
  `@page { size: 210mm 168.1mm }` is not one of the papers Android's print dialog offers, so it fell back to Letter
  and the sheet filled only part of it. Measured at the print width now: the bill's own sheet is **211.7mm** of A4's
  277mm printable height, i.e. ~76 % of the paper with the rest blank.
- **The invoice takes the other route: the page stays A4 and the sheet fills it.** `src/lib/printPage.js` gained
  **`fillPrintPage(sheet)` / `clearPageFill()`** beside `fitPrintPage()` (which the kata statement still uses, and
  which the invoice no longer calls — **no dynamic `@page` rule is injected for a bill any more**, so the dialog
  shows its own A4 portrait paper). It measures a 190mm-wide copy exactly as `fitPrintPage()` does, and — only when
  the sheet does fit one page (`≤ 277mm − 1mm`) — puts **`print-fill-page`** on the sheet.
- **The rules are `.invoice-print.print-fill-page` in `src/index.css`, inside `@media print`.** The sheet takes
  `height: 100vh` — in paged media that is the page's own content area, so it follows whatever paper the dialog is
  set to instead of a hard-coded A4 height — with `overflow: visible` (a longer bill must run on to page two, never be
  cut). `.invoice-lines` (the new class on the ruled-line `<section>`) becomes a `flex` column with `flex: 1 1 auto`
  and its `<table>` takes `flex: 1 1 auto; min-height: 100%`, so the ten ruled lines share the room the page has left
  and the closing line, cartons box and footer land on the page's foot.
- **`InvoiceDetailDialog` runs it in the same effect** (keyed on `[id, record?.id, lines.length]`) and clears the
  class on close. The on-screen dialog is untouched: every rule is inside `@media print`, so a phone still reads the
  compact sheet it always did.
- **Verified in the preview** (`/invoices` → the first bill, the user's replayed session, 360px): the sheet carried
  `print-fill-page` and **no `print-page-size` rule was injected**; the three rules were read back out of the
  stylesheet the dev server serves, then applied on screen with a 277mm sheet to exercise the same declarations —
  article **1047px (277mm)**, `.invoice-lines` **672px**, the table the same, rows sharing it (the line holding data
  **25.5mm**, the blank lines **16.5mm**, none below 100 %), the footer's bottom **exactly at the sheet's bottom**
  (`footerGap 0`, `overflowBelow 0`). At the print width (718px) the sheet is **211.7mm** naturally and **277mm**
  filled. Closing the bill removed the class with the dialog; `npm run lint` (0 problems) and `npm run build` are
  clean.
- **NOT automatically verified: the print dialog's own preview and the saved file** (a headless browser paints no
  print preview and the download cannot be read back here). Press **Print / PDF** on a bill once and "Save as PDF":
  one A4 page whose ruled lines run down to the foot of the paper.

## The bill prints at the size of the invoice view (this branch)

- **The invoice view is the master, and the printed page is cut to it.** `printSheetAtViewSize(sheet)`
  (`src/lib/printPage.js`) measures the sheet that is on screen — `offsetWidth` / `offsetHeight`, so a
  dialog animation's transform cannot skew it — and writes an `@media print { @page { size: <w>mm <h>mm;
  margin: 0 } }` rule exactly that size, plus `html, body { margin: 0; padding: 0; background: #fff }` and
  `.invoice-print { width: <w>mm !important; max-width: none }`. The width is pinned in the print layout
  because the dialog's `p-6` is dropped on paper (`print:p-0`), so `w-full` alone would print the sheet
  wider than it reads on screen. `InvoiceDetailDialog` calls it when the dialog opens (and again at the
  Print press, re-measuring in case the window changed) and clears it on close.
- **`fillPrintPage()` / `.print-fill-page` are gone.** They stretched the sheet to A4's printable height and
  shared that room between the ruled lines — i.e. the printed bill was a *different* layout from the view.
  Do not reintroduce a stretching rule: the user's rule is 1:1, same size and proportions, no A4 page and
  no white band under the last line. The only slack is 0.8mm below the sheet, so a rounding of the print
  layout cannot spill the closing line onto a second page; it falls on the sheet's own white edge.
- **The Android PDF path passes no forced width any more.** `pdfFromElement(..., { exactPage: true })` draws
  the same sheet as it reads on the device (the old `width: 729` re-laid it out at A4's width, a different
  layout from the view). `exactPage` still cuts the page to the sheet, inside the PDF's own 10mm margin.
- **The kata statement keeps `fitPrintPage()`** (A4 printable width, page cut to the sheet's height) —
  only the bill changed.
- **Verification.** `npx eslint` on the three changed files is clean. In the preview, opening an invoice
  (`/invoices` → View details) produced the injected rule **`@page { size: 164.57mm 147.91mm; margin: 0 }`**
  against a sheet measuring **622×556 px** (164.57 × 147.11 mm at 96 dpi) — the page is the view plus the
  0.8mm slack — the `print-fill-page` class is absent from both the sheet and the live stylesheet, and no
  console errors. **NOT automatically verified: the print dialog's own Save as PDF output** — the harness
  cannot open a print preview — so open an invoice and press **Print / PDF** once; the page must be the
  invoice itself, with no A4 band around it.

## The WhatsApp share carries its caption, and the fallback preselects the customer (this branch)

- **The PDF is no longer shared bare.** `sharePdfOnWhatsApp({ blob, filename, number, title, text })`
  (`src/lib/whatsappShare.js`) now passes `title` and `text` through to **both** real share paths —
  `navigator.share({ files, title, text })` in a file-sharing browser and `Share.share({ files, title, text })`
  inside the APK. The captions are the existing `invoiceWhatsAppCaption` / `kataWhatsAppCaption` /
  `labourWhatsAppCaption` from `whatsapp.js`; the invoice caption gained the bill's **date** and **Paid** line
  (bill number, date, total, paid, remaining). This supersedes the earlier note that "the WhatsApp share is the
  file alone" — that was a deliberate choice, now reversed by the user's request for a message with the bill.
- **The fallback opens the customer's own chat, not a blank WhatsApp.** Where the device cannot share a file
  (desktop browser, the EXE, this preview), the PDF is still saved through `saveBlob()` and the chat is opened
  with `whatsAppChatUrl(number, caption)` — the new helper in `whatsapp.js`, `wa.me/<number>?text=…`, or bare
  `wa.me/` with the caption when the record has no number. The toast still says the file must be attached there.
- **Preselecting the recipient is not something a web/WebView API can do.** Android's share sheet chooses the
  target app and the chat; `navigator.share` and Capacitor's Share plugin cannot name a contact. What the app
  can do — and does — is put the bill number and the customer's name in the caption and keep the number ready
  in the fallback. Do not claim the contact is preselected in the share-sheet path.
- **Verified in the preview** (the user's replayed session, 360px; `navigator.canShare`/`navigator.share`
  stubbed inside the script to record what the app hands to the OS, then restored): the customer kata's
  **Send** produced `customer-kata-amir.pdf` (455,285 bytes, `%PDF-`) with the company header, "Assalam-o-Alaikum
  AMIR" and the closing balance; the invoice register's row button produced `invoice-03.pdf` (235,395 bytes,
  `%PDF-`) with "Please find bill 03 dated 2026-10-30 attached as a PDF", Total Rs 157,500 / Paid Rs 50,000 /
  Remaining Rs 107,500. Both calls carried `files[0].type === "application/pdf"`; 0 console errors.
  `npx eslint` on both modules → 0 problems, `npm run build` clean.
- **NOT automatically verified: the real Android share sheet and WhatsApp itself** (no device or emulator here) —
  install an APK built from this branch and press **Send** on a bill and on a customer's kata: WhatsApp must be
  in the sheet, the PDF must arrive in the chosen chat, and the caption must ride with it. The installed APK in
  `release/` still predates the whole WhatsApp feature (see the earlier section), so it must be rebuilt first.
- **The APK in `release/` was rebuilt from this branch (2026-10-30).** `release/HIKER-Factory-ERP-android-debug.apk`
  — **10,981,694 bytes, md5 `d81494ced7e45c3130c59bf49ccbcc4e`** — built from the committed `android/` scaffold
  (`env -u VITE_BASE44_PREVIEW_MODE npm run build -- --base=./` → `npx cap sync android` →
  `JAVA_HOME=/opt/jdk21 ./gradlew assembleDebug --no-daemon`). `assets/capacitor.plugins.json` names
  **@capacitor/app, @capacitor/filesystem and @capacitor/share**; its bundle `assets/public/assets/index-CyK-m_gQ.js`
  is **byte-identical to `dist/`** (md5 `2cd70eb4b708cfbe31f5c0f91d6994fe`), carries the WhatsApp captions,
  "Attach the PDF in WhatsApp", `wa.me` and `navigator.share`, two `sb_publishable_` literals with **zero**
  unsubstituted `VITE_SUPABASE_PUBLISHABLE_KEY`, and no `VITE_BASE44_PREVIEW_MODE`. It is served at
  `https://8000-${BASE44_PUBLIC_HOST_SUFFIX}/HIKER-Factory-ERP-android-debug.apk`. **The Windows EXE/zip in
  `release/` were not rebuilt** — WhatsApp on Windows only reaches the save-then-attach fallback, so nothing about
  them blocks the phone check.

## The WhatsApp buttons are gone (this branch)

- **The request:** *"Remove the whatsapp buttons it didn't need"*. Every **control** was removed; the printed
  contact numbers on the letterhead (with their WhatsApp icon) are contact details, not buttons, and are untouched.
- **What went:** the customer/supplier kata footer's green **Send** (`PartyDetailView`), the labour statement's
  header **WhatsApp** (`LabourDetail`), the invoices register's per-row WhatsApp mark (`Invoices` → `RowActions`
  `extra`), the invoice dialog's share button (`InvoiceDetailDialog`) and the saved-invoice dialog's
  (`InvoiceSavedDialog`). The components that carried them were deleted with them — `src/components/invoice/
  WhatsAppShareButton.jsx`, `src/components/whatsapp/WhatsAppButton.jsx`, `src/lib/whatsappShare.js`,
  `src/lib/whatsapp.js` — because nothing else imported them. `WhatsAppIcon.jsx` stays: `HikerLetterhead` still
  prints it beside each contact's number.
- **Untouched:** every Print / PDF / Print Only control, the posting paths, and the letterhead. `InvoiceSavedDialog`
  no longer takes a `lines` prop (the form holds the invoice object alone), and the comments in `RowActions`,
  `InvoiceDetailDialog` and `InvoiceForm` that named the invoice's WhatsApp mark were reworded.
- **NOT verified by a build/lint gate change:** `npx eslint` on the six touched files reports **0 errors** (its two
  warnings, `setViewRow` in `PartyDetailView` and an unused `eslint-disable` in `Invoices`, are pre-existing —
  `setViewRow` is unused in `HEAD` too). **Verified in the preview** (the user's replayed session, 360px): the
  customer kata footer reads Back · Print Only · Print Kata · Delete · Receive payment and holds **0** WhatsApp
  controls; the invoices register holds **0**; an invoice's view dialog offers only **Print / PDF** (and Close);
  and `/labour/<id>` reads Back · Print / PDF · Print Only · Pay labour · Edit · Delete, also **0**. No console
  errors in any of them.

## The payment carries its own clock, and the kata reads it newest first (this branch)

- **`0047_post_payment_time.sql` is applied** and it is why a typed time now sticks: `0016_payment_time.sql` added
  `payments.payment_time` and the app had been *sending* it since, but `post_payment()` never wrote it. 0047
  re-issues `post_payment()` (0014's definition verbatim) with one addition — a `v_time` from the payload stored on
  the row it writes. Everything else (direction, account check, single roznamcha entry, idempotency, audit) is
  unchanged; a payload with no time stores NULL and the ledger falls back to `created_date` exactly as before.
- **`PaymentForm` has one new control, and it is the only UI it grew.** The Date field now carries a
  **Manual Date & Time** toggle beside it (a `Button`, `aria-pressed`). Off — the default — the date input is
  disabled and the posting sends `todayISO()` + `nowClock()` (`src/lib/datetime.js`, the factory clock as `HH:MM`),
  so the saved moment is the moment it was posted. On, the date becomes editable and a `<input type="time">`
  appears; both are sent as typed. The toggle sits outside the account-type branch, so **all four** types
  (Customer / Supplier / Labour / Other · Manual) get it without a per-type copy. `nowClock()` is the only new
  helper; `momentKey()`/`kataTime()` were already the one clock reader.
- **The ledger already ordered by the clock; it now has a deterministic tie-break.** `partyLedger()` and
  `labourStatement()` sort on `` `${momentKey(row)}|${row.at}` `` so two rows saved inside the same minute keep the
  order they were recorded in. `momentKey()` reads a row's typed `payment_time` / `invoice_time` first and falls
  back to `created_date`.
- **Both printed ledgers follow the screen: newest first.** `KataPrintSheet` and `kataPdf.js`'s party kata and
  labour statement no longer `.reverse()` the ledger's rows; the **opening balance row moved to the foot** of the
  table, because it is the oldest line (it used to head an oldest-first statement). Nothing about the print
  design, columns, totals or colours changed — only the row sequence.
- **Verified.** SQL through the `dbadmin` pooler as the signed-in administrator inside a transaction that was
  **rolled back**: `post_payment(... 'payment_time':'09:41')` stored `payment_date 2026-10-30 / payment_time 09:41`.
  In the preview (the user's replayed session): the form's date computes **disabled** with no time input and the
  toggle `aria-pressed="false"`; pressing it enables the date, reveals the time field (typed `09:30`) and flips
  `aria-pressed`; pressing it again disables both. A real payment was posted for a throwaway customer through
  **Receive payment → Manual Date & Time → 09:30 → Post payment** — the toast read "Payment posted" and the kata's
  last transaction read `2026-10-30 · 09:30` (the throwaway customer, its payment, roznamcha entry and audit row
  were removed afterwards by exact id). AMIR's ledger at 375px then read, in order,
  `30-10-26 · 9:25PM · 8:54PM · 12:38PM · 2:25AM · 1:54AM`, then `27-10-26 · 7:43PM …` — **newest first**,
  descending on the clock, not only the date. `npx eslint` on the six changed files is clean.
- **NOT automatically verified: the PDFs' own row order.** The code path is the same `ledger.rows` the screen
  reads and both builders were edited (no `.reverse()`), but a download cannot be read back in this preview —
  press **Print Kata** on a customer once and check the first row is the newest entry and the opening balance the
  last.

## A kata row opens that entry, and an invoice row opens its bill (this branch)

- **The eye on a customer/supplier ledger row shows that one entry, never the whole kata.** It used to open a
  full-statement dialog (a second copy of `KataStatement` plus its own pagination) — which the user reported as
  "it show view the whole kata". `PartyDetailView`'s `handleView(row)` now uses the row detail dialog that was
  already in the file but unwired (`RecordDetailDialog` + `viewFields(row)`), and the whole-kata dialog, its
  `ledgerViewOpen` state, its `Dialog*` imports and its "Add New" button were deleted with it. The kata itself is
  the page, and posting still goes through the footer's **Receive payment** / **Pay supplier**.
- **Edit on an invoice row opens the invoice's own view.** `handleEdit` used to open `QuickEditDialog` on the
  invoice's `notes`; an invoice row now opens `InvoiceDetailDialog` (the bill, its kata box and its **Print / PDF**),
  the same dialog the register and the customer's invoice list use. Editing an invoice's notes is still available
  on `/invoices`. A **purchase** row keeps its `PurchaseForm`, and a **payment** row keeps `KataEntryEditDialog`.
- Verified in the preview (the user's replayed session, `/customers/<id>`): the eye on `Invoice 04` opened
  "Invoice 04 · 30-10-26 · 21:25" with Date / Time / Description / Jamma / Banam / Balance / Type / Reference and
  **no** statement heading, totals or footer; Escape closed it; the same row's pencil opened the bill
  (`BILL NO.: 04`, lines, Grand Total Rs 84,600, **Print / PDF**) with no notes textarea. No console errors,
  `npx eslint src/components/PartyDetailView.jsx` clean.

## The kata row's pencil edits the invoice, the eye still shows the entry (this branch)

- **The request:** *"edit button inside kata ledger open the invoice popup … editable invoice form"* — the pencil on an
  invoice row was opening the read-only bill (the section above), and it now opens **`QuickEditDialog`** on the
  invoice, the same dialog the invoice register's own pencil opens (`Edit invoice` · notes). Nothing about the bill
  moved: `InvoiceDetailDialog` is still the register's, the customer's invoice list's and the invoice history's view.
- **`PartyDetailView.jsx`:** the `invoiceDoc` / `InvoiceDetailDialog` pair became `editInvoice` / `QuickEditDialog`
  (`entity="Invoice"`, one `notes` textarea, `onSaved={onRefresh}` so the kata re-reads). The **eye is untouched** —
  it still opens `RecordDetailDialog` for that one entry. A payment row keeps `KataEntryEditDialog`, a purchase row
  keeps `PurchaseForm`.
- **Verified in the preview** (the user's replayed session, 360px, `/customers/<id>`): the pencil on `Invoice 04`
  opened **`Edit invoice · 04 · AMIR`** with the Notes field; typing a probe note and **Save changes** wrote
  `PATCH /invoices?id=eq.…&select=*` → **200**, toasted "Record updated" and closed; reopening read the note back,
  it was restored to its original empty value and saved again (the field now reads `""`); the eye on the same row
  still opened the entry (`Invoice 04 · BANAM · 30-10-26 · 21:25` with its Date / Time / Description fields). No
  console errors; `npx eslint src/components/PartyDetailView.jsx` reports 0 problems.

## The kata row's eye views the bill, the pencil edits it (this branch)

- **The request:** *"Make the kata ledger pencil also edit the invoice and the view to view the invoice"* — the pencil
  keeps opening the invoice's edit dialog (above); the **eye now opens the bill itself** (`InvoiceDetailDialog`, the
  same view / Print / PDF dialog the invoice register's eye opens) instead of the single-entry
  `RecordDetailDialog`, which supersedes the "eye is untouched" half of the section above.
- **`PartyDetailView.jsx`:** `viewInvoice` state + `handleView(row)` sends an **invoice** row to
  `InvoiceDetailDialog`; a **payment** or **purchase** row still opens `RecordDetailDialog` with that entry's
  fields. The pencil's `QuickEditDialog` and the payment / purchase rows' editors are unchanged.
- **Verified in the preview** (the user's replayed session, 360px, `/customers/<id>` for AMIR): the eye on
  `Invoice 04` opened the bill — `Bill No.: 04`, the customer, the line items, Grand Total Rs 84,600, Received
  +Rs 2,000, the kata box and **Print / PDF** — with **no** notes textarea; closing it and pressing the same row's
  pencil opened **`Edit invoice · 04 · AMIR`** with the Notes field and **no** bill. 0 console errors and
  `npx eslint src/components/PartyDetailView.jsx` reports 0 problems.
- **Driving it:** the ledger rows carry no `data-record-id` — find them by the row's own text around a
  `button[aria-label="View details"]` / `button[aria-label="Edit"]`, and the bill dialog's close control is the
  `Close` button inside the dialog (it has no `aria-label`).

## The kata row's pencil opens the bill's own form (this branch)

- **The report:** *"click on pencil in kata … it show the notes only not the invoice form popup"* — the pencil opened
  a `QuickEditDialog` with one notes textarea. It now opens **`InvoiceForm`** (the New invoice dialog) filled with
  the saved bill: its customer (read-only — the account, and the receipt that follows it, stay as posted), its
  **bill date**, every item line with its grade, cartons and price, its discount and its notes. The money it brought
  in is shown read-only ("Received with this bill" / payment method) with a hint to correct the receipt from its own
  payment row in the kata. This supersedes the `QuickEditDialog` half of the two sections above.
- **`src/lib/invoiceEdit.js` (new) is the write path.** `updateInvoice()` re-writes the bill's own figures
  (`invoice_date`, `total_cartons`, `total_pairs`, `subtotal`, `discount`, `total`, `balance`, `status`, `notes`),
  keeps the line rows it still has (by id), inserts the new ones and **deletes** the ones taken off, and — when the
  bill moved to another day — dates its receipt (`payments.idempotency_key = 'invoice:<id>'`) and that receipt's
  roznamcha entry along with it. **Ready Shoes stock needs no posting**: `article_ready_stock()` subtracts
  `invoice_lines.pairs`, so writing the lines is what moves the shelf.
- **`InvoiceForm` gained `initial`** (an invoice object) and an edit branch; without it the form behaves exactly as
  before (`Invoices.jsx` passes none). In edit mode the article list also keeps any article the bill sold that the
  article map no longer carries, and **the bill's own pairs are added back onto the shelf map** — otherwise a line it
  already holds would read as oversold and could not be kept.
- **Verified in the preview** (the user's replayed session, 360px, `/customers/<id>` for AMIR): the pencil on
  `Invoice 04` opened **Edit invoice** with `AMIR · 03179850300`, Bill date `2026-10-30`, **3** item lines
  (`Grade A · 18-pair carton · 1 carton × 18 pairs = 18 prs · Rs 31,500`, the `A Mix` line, the third `A` line), the
  discount/notes fields and the read-only received `2000` / `Cash`; **Save changes** toasted
  "Bill 04 updated — the bill and the customer kata now read the corrected figures" and closed the dialog. Read back
  from the tables: `invoices` 04 still reads 3 cartons / 54 pairs / subtotal 84,600 / total 84,600 / received 2,000 /
  balance 82,600 / partial, and its three `invoice_lines` came through with the same cartons, pairs and prices, none
  soft-deleted. Reopening the pencil showed the same bill, **Cancel** closed it. 0 console errors, 0 failed requests.
- **Not automatically verified:** a *changed* line or discount (only a no-change save was written, to leave the
  factory's own bill untouched) — edit one line's cartons in an unlocked pane and check the bill's total, the
  customer's kata and Ready Shoes' available pairs all follow.

## The labour statement reads oldest first, like the kata (this branch)

- **The technique is one rule, shared.** The row tint the kata carried inline (`rose` for a document, `emerald` for a
  payment, both at 10 %) is **`ledgerTint(kind)` in `src/lib/kata.js`** now; `KataStatement` reads it and so does
  `LabourStatementView`, so the two ledgers cannot drift apart. A wage entry (`kind: "earning"`) is a document and
  reads red, a payment green — the same mapping the customer / supplier kata uses for its invoice and its receipt.
- **The labour statement is built oldest-first and shown that way.** `LabourStatementView`'s `allRows` reverses the
  rows `labourStatement()` hands over (newest first), builds the running balance forwards and returns **that**
  order, with the page state opening on the **last** page (a `rowCount` effect), exactly as `PartyDetailView` does
  its kata — so the newest entries are what the worker's page shows first and **Previous** walks back through the
  older ones. It also returns **clones** (`{ ...row, balance }`) instead of writing `row.balance` onto the statement.
- **Both printed ledgers follow.** `kataPdf.js`'s `buildPartyKataPdf` now puts the **opening balance first** and the
  entries oldest-first (it used to print newest first with the opening line at the foot), matching `KataPrintSheet`
  and the screen, and `buildLabourStatementPdf` reverses its rows the same way. The columns, colours, totals and
  page geometry are untouched.
- **Supplier needed no change of its own:** a supplier's page is the same `PartyDetailView` + `KataStatement` the
  customer's is, so the oldest-first ledger and the tints already covered it; only the shared tint rule moved.
- **Verified.** `npm run build` is clean and `npx eslint` on the four changed files reports **0 errors** (one
  pre-existing `isPayment` unused-variable warning in `LabourStatementView`). `LabourStatementView` was rendered
  **headlessly** in the container (Vite `ssrLoadModule` + `renderToStaticMarkup`, a `window` / `document` shim): with
  rows handed over newest-first (`Wages paid` 20 Oct, `Stage 1 · Lasting` 10 Oct) the HTML put the **wage entry
  first** (`oldestFirst: true`) with `bg-rose-500/10` and the payment second with `bg-emerald-500/10`.
  **NOT automatically verified on screen:** the preview's own database holds **no labour and no customer entries**,
  so `/labour` lists no card to open and `/customers/<id>` renders an empty ledger — open `/labour/<id>` in an
  unlocked pane once a worker has entries: the ledger must read oldest at the top, newest at the foot, with the
  wages row tinted red and the payments green.

## The APK prints through Android's own "Save as PDF" dialog (this branch)

- **The request:** *"make the apk file show this type save as pdf dialog … for invoice too … make the invoice and
  kata print and print only show this type save as pdf"* — over a capture of Android's print sheet ("Save as PDF",
  Paper size, the page preview). Until now a Print button in the APK **saved** a PDF into Downloads through
  `DownloadSaverPlugin` and never opened a print dialog, because a WebView has no `window.print()`.
- **`android/app/src/main/java/com/hiker/factoryerp/PdfPrinterPlugin.java` (new, local plugin)** opens the system
  print dialog: it writes the finished bytes to a cache file, reads the page count off the PDF itself
  (`/Type /Page`, skipping the `/Type /Pages` tree node), and calls `PrintManager.print()` on the UI thread with a
  `PrintDocumentAdapter` that **copies the file** to whatever destination the dialog chose (the same approach
  React Native's print module uses; nothing is re-drawn). It is registered in `MainActivity.onCreate()` beside
  `DownloadSaverPlugin`, **before** `super.onCreate()`, and is deliberately absent from
  `assets/capacitor.plugins.json` (that file lists npm plugins only).
- **`src/lib/pdfFile.js` gained the print route:** `printPdfBlob(blob, filename)` → the `PdfPrinter` plugin when
  `isNativeApp()`, **falling back to `saveBlob()`** (the Downloads route) for an older install; on the web and the
  desktop EXE it stays a plain download. `printPdf(doc, filename)` wraps a jsPDF document and
  `printPdfFromElement(element, filename, { exactPage })` wraps the bill's sheet through `pdfBlobFromElement()`.
- **Who uses it:** `kataPdf.js`'s `exportPartyKataPdf()` and `exportLabourStatementPdf()` (so the kata page's
  **Print Kata** and **Print Only**, and the labour page's **Print / PDF**, all open the dialog in the APK), and
  `InvoiceDetailDialog`'s **Print / PDF** native branch (the bill's sheet). **Reports, Excel/CSV, backups and the
  Database Center exports still download** — only the kata/labour statements and the bill were asked for.
- **The web and the EXE are unchanged:** the invoice dialog still calls `window.print()` there (and Print Only uses
  `fitPrintPage`), and a non-native `printPdfBlob()` downloads exactly as `savePdf()` did.
- **Verified:** `npx eslint` on the three changed files → 0 problems, `env -u VITE_BASE44_PREVIEW_MODE npm run build`
  clean, and the web preview still renders `/customers/<id>` (h1 "AMIR", **Print Only** + **Print Kata** present,
  0 console errors). The APK was rebuilt from the committed scaffold —
  `release/HIKER-Factory-ERP-android-debug.apk`, **11,784,795 bytes, md5 `df8e58e46ff3d3e4ae9c0ebfc78ec414`**,
  `BUILD SUCCESSFUL` — and checked: `PdfPrinterPlugin` is in `classes4.dex` (5 references), the bundle inside
  (`assets/public/assets/index-Bv1su7uI.js`, md5 `f8afe2315e2892b84e67ea83fb48cd59`) is **byte-identical to
  `dist/`**, no `VITE_BASE44_PREVIEW_MODE` is baked in, `assets/capacitor.plugins.json` still names app /
  filesystem / share, and the public download
  (`https://8000-${BASE44_PUBLIC_HOST_SUFFIX}/HIKER-Factory-ERP-android-debug.apk`) is byte-identical (md5 matches).
- **NOT automatically verified: the dialog itself** — no device or emulator exists here, so install the APK and
  press **Print Kata** on a customer/supplier, **Print Only**, and a bill's **Print / PDF**: Android's print sheet
  must open with the statement/bill page in its preview, and "Save as PDF" must write the file.

## The APK's bill prints on A4, not an index card (this branch)

- **The report:** two captures of Android's "Save as PDF" sheet side by side — the browser preview's, a Letter page with
  the whole bill laid out on it, and the APK's, whose paper size read **Index Card 4x6** with the invoice squashed into
  it: *"I want the apk save as pdf like in preview everything fit correctly"*.
- **Two causes, both fixed.**
  - **`PdfPrinterPlugin` passed `null` as the job's `PrintAttributes`.** With no media size of its own the dialog falls
    back to the smallest media it knows (*Index Card 4x6*). It now builds **A4** attributes —
    `MediaSize.ISO_A4`, a 300dpi resolution and `Margins.NO_MARGINS`, because the file already carries its own 10mm of
    white paper — so the sheet opens on A4 and the PDF's page maps onto it 1:1.
  - **The bill's file was the sheet at the phone's size** (`pdfBlobFromElement(…, { exactPage: true })`), i.e. a
    622 × 556 px slip — the page Android read the paper from. It is now a **full A4 page**: the sheet is laid out at
    A4's printable width (`A4_PRINT_WIDTH_PX`, 718 px) and given the page's own height
    (`A4_PRINT_HEIGHT_PX`, 1047 px), with `.invoice-lines` and its table flexed so the ten ruled lines take the room
    the bill's own content leaves — the `fillPage` option of `pdfBlobFromElement()`. So the header sits at the top, the
    closing line, cartons box and footer land on the page's foot, and nothing is stretched or cut. A bill longer than
    the page still runs over onto further A4 pages (`drawImagePages`), and the on-screen sheet is untouched — it stays
    content-sized, as every note above requires.
- **The browser's own Print / PDF is unchanged** (`window.print()` + `printSheetAtViewSize`), and so is the WhatsApp
  share path (`invoicePdf.jsx` still asks for `exactPage`).
- **Verified.** `npx eslint` on the two JS files → 0 problems; `env -u VITE_BASE44_PREVIEW_MODE npm run build` clean.
  In the preview the exact clone the print builds measured **718 × 1047 px**, `.invoice-lines` table **672 px** with its
  rows sharing it (62 px each), footer's bottom **exactly at the sheet's bottom** (0 px), `scrollWidth`/`scrollHeight`
  within the box — the screenshot shows the bill filling the page like the browser's own preview. The page maths at that
  canvas is `1047 × 538.58 / 718 + 56.7 = 842.06 pt`, within 3 pt of A4 and therefore snapped to it: one page,
  **595.28 × 841.89 pt**. The rebuilt APK
  (`release/HIKER-Factory-ERP-android-debug.apk`, **11,785,020 bytes, md5 `c9022286ffe703cee8f5221402ebb1c7`**) holds
  `PdfPrinterPlugin` (5 references) and `ISO_A4` in its dex, its bundle `assets/public/assets/index-DJTZtqfm.js` is
  **byte-identical to `dist/`** (md5 `0b1af798b480e49ba2e20ead6bbec8ed`, 0 `VITE_BASE44_PREVIEW_MODE`, 0 unsubstituted
  `VITE_SUPABASE_PUBLISHABLE_KEY`), `assets/capacitor.plugins.json` still names app / filesystem / share, and the
  public download is byte-identical (md5 matches).
- **NOT automatically verified: the dialog on the phone** — no device or emulator exists here. Install this APK, open a
  bill, press **Print / PDF**: the sheet must read **A4**, show the whole bill on one page with its footer at the foot,
  and "Save as PDF" must write it. The toolchain had been wiped again (`/opt/jdk21`, `/opt/android-sdk`,
  `/root/.gradle`), so it was reinstalled with the recipe above (~3 min) before the build.

## The print dialog's paper comes from a *plain* attribute set (this branch)

- **The report:** the APK's "Save as PDF" sheet still opened on **Index Card 3x5** (the previous turn's capture read
  Index Card 4x6), with the A4 bill squeezed into a strip — *"Didn't work correctly like in preview"*.
- **`PdfPrinterPlugin`'s `PrintAttributes` asked for too much.** It carried `MediaSize.ISO_A4` **plus** a made-up
  `Resolution("pdf", "PDF", 300, 300)` and `Margins.NO_MARGINS`. A print service that cannot honour a resolution or a
  zero margin does not reject the job — it shows it on the **smallest media it knows**, which is exactly the 3x5 the
  user saw, and why the paper changed when the attributes changed. The job now sets **only** `MediaSize.ISO_A4` and
  `COLOR_MODE_COLOR` (the documented way to pick the dialog's paper: `builder.setMediaSize(...).build()`), and leaves
  the resolution and the margins to the service.
- `PrintAttributes.PageSize` / `PrintDocumentInfo.Builder.setPageSize` **do not exist** in the Android SDK stubs —
  `android.jar` (API 35) carries only `Builder`, `MediaSize`, `Margins` and `Resolution` under `PrintAttributes`. A
  build using them fails with `cannot find symbol: class PageSize`; state the paper on the job's attributes only.
- **The APK was rebuilt from the committed `android/` scaffold** (`env -u VITE_BASE44_PREVIEW_MODE npm run build --
  --base=./` → `npx cap sync android` → `JAVA_HOME=/opt/jdk21 ./gradlew assembleDebug --no-daemon`) and copied over
  `release/HIKER-Factory-ERP-android-debug.apk`: **11,785,020 bytes, md5 `222161f14467eb03e6537315a0ca727e`**,
  `assets/public/assets/index-DJTZtqfm.js` byte-identical to `dist/`, `assets/capacitor.plugins.json` still names
  app / filesystem / share. `Margins.NO_MARGINS` is **gone** from the dex (the field reference the old code left);
  the public download is byte-identical.
- **NOT automatically verified: the dialog on the phone** — no device or emulator here. Install this APK, open a
  bill and press **Print / PDF**: the "Paper size" line must read **A4** and the whole bill must sit on one page. If a
  device still opens on a card size, its print service is ignoring the attribute set and the paper has to be picked in
  the dropdown once — there is no second switch an app can flip.

## The bill prints as the view, and the view has a pencil (this branch)

- **The invoice view is the master again for the APK's file.** `InvoiceDetailDialog`'s native branch passes
  `{ exactPage: true }` to `printPdfFromElement()` — the sheet is drawn exactly as it reads on the screen, with no
  `width` re-layout and no `fillPage` stretch — so the PDF is the invoice view, 1:1 in proportions, and the page is
  cut to the sheet inside the PDF's own 10mm margin. `PdfPrinterPlugin` still asks for `MediaSize.ISO_A4`, so the
  paper stays A4. This supersedes the A4 `fillPage` half of "The APK's bill prints on A4, not an index card": the
  user's rule is that the print must read as the view, not as a re-stretched sheet.
- **The browser/EXE path is unchanged** (`printSheetAtViewSize()` then `window.print()`); the page rule it injects is
  the view's own size (measured: `@page { size: 164.57mm 147.91mm; margin: 0 }` for a 622 × 556 px sheet).
- **The invoice view carries an edit pencil.** `InvoiceDetailDialog`'s header holds a pencil
  (`aria-label="Edit invoice"`) that opens **`InvoiceForm`** with `initial={record}` — the bill's own items,
  discount, date and notes. Saving bumps a `reload` counter the load effect depends on, so the sheet above re-reads
  the corrected invoice and its lines. `InvoiceForm` is a nested Radix dialog inside the bill's dialog; it renders on
  top and closing it leaves the bill open.
- **The register's row pencil opens the same popup.** `Invoices.jsx`'s `RowActions.onEdit` used to open a
  `QuickEditDialog` with one notes field; it now opens **`InvoiceForm`** on that saved bill (one form serves New and
  Edit: `open={formOpen || !!editing}`, `initial={editing || undefined}`, and closing clears both). `InvoiceDayDialog`
  in the invoice history still uses its own `QuickEditDialog` (notes only) — not changed.
- **Verified in the preview** (the user's replayed session, 360px): the register's pencil opened **Edit invoice** on
  bill 03 (`AMIR · 03179850300`, bill date 2026-10-30, the `AH+1` line with 5 cartons @ 1750, discount 0, received
  50000), Cancel closed it; the bill's view (>Invoice 03 · PARTIAL) showed the new pencil and **Print / PDF**; that
  pencil opened the same **Edit invoice** on top of the bill and Cancel closed it; 0 console errors; nothing was
  saved. `npx eslint` on both files → 0 errors (one pre-existing unused eslint-disable warning in `Invoices.jsx`)
  and `npm run build` clean.
- **NOT automatically verified:** the APK's own print dialog and file (no device/emulator here) — install an APK
  built from this branch, open a bill and press **Print / PDF**: the page must read A4 and show the bill exactly as
  the view shows it.

## The ledger's green, and the kata's statement polish (this branch)

- **`ledgerTint` takes a row's `kind`, never the row — and `KataStatement` was handing it the
  whole row**, so `kind === "payment"` was never true and every entry on a customer's or
  supplier's kata painted **red**. `KataStatement` now calls `ledgerTint(row.kind)` /
  `ledgerEdge(row.kind)`, so money received from a customer and money paid to a supplier reads
  **green at 10% opacity** and a document (invoice / purchase / wage earned) stays red.
  `LabourStatementView` already passed `row.kind` and needed no change. A 3px `ledgerEdge` bar
  repeats the side down the row's left edge, so the row is never read by tint alone.
- **The statement is a letterhead again.** `KataStatement` prints the statement's period
  (`kataPeriod(rows)`) under the "Customer / Supplier statement" label, colours the Jamma and
  Banam column headings green/red, and tones the Remaining balance box (green in advance, red
  owing, neutral at zero, the same rule as the figures).
- **Verified in the preview** (`/customers/<id>` for AMIR, 360px + desktop): 8 payment rows
  compute `rgba(16,185,129,0.1)` with a green edge and 8 invoice rows `rgba(244,63,94,0.1)` with
  a red edge, the letterhead reads `27 Oct 26 - 30 Oct 26`, 0 console errors. The supplier and
  labour katas render but **hold no payment row today**, so their green state is the same
  helper, not an observed row.
- **Checks:** `npm run lint` 0 problems, `eslint src --rule no-undef` only browser globals,
  `env -u VITE_BASE44_PREVIEW_MODE npm run build` clean.
- **APK rebuilt (2026-10-30 20:38 UTC)** from the committed scaffold:
  `release/HIKER-Factory-ERP-android-debug.apk`, **11,785,013 bytes, md5
  `4c37e1e9713cb2d2d333d8fb4d350fd2`**; `assets/capacitor.plugins.json` names app / filesystem /
  share, `assets/public/assets/index-Dpswm0mE.js` matches `dist/` **byte for byte**
  (`1f1ef5501f299f93c07e2513db8ad7f1`), one `sb_publishable_` literal, no
  `VITE_BASE44_PREVIEW_MODE`, and the public download answers 200 with that size.

## The printed kata's letterhead is the reference sheet (this branch)

- **`src/components/print/HikerLetterhead.jsx` was redrawn to the reference header** — the top rule is one
  thick red band dropping from both top corners to a flat horizontal section in the middle (the `TopChevron`
  SVG, `preserveAspectRatio="none"` so it stretches with the sheet), the mark is **`/hiker-logo-red.png`**
  (the real torn H with its white cross and the hiker on the peak — the old drawn `HikerMark` and its white
  person glyph are gone), the lockup is `HIKER` with a red superscript `+`, `SHOES` between two thin red
  rules and the tagline, and the contact ribbon is a **thin** red-bordered rounded box whose columns are
  separated by red hairlines: a red person disc beside each name, the WhatsApp number on its **green**
  disc (`PRINT_BRAND_GREEN`) and the landline on a **red** handset — not the old white-on-red pair.
- **`banner="image"` still draws the bill's corner banners** (`invoiceAccent`) and keeps its bottom rule, so
  `InvoicePrintView` (compact) is unchanged apart from the contact icons, which it shares.
- **The kata PDF keeps its own orange header.** `kataPdf.js`'s `openKataSheet()` draws the orange band with
  the company name and the `H+` disc; it does not use this component and was **not** changed. So "Print
  Only" (browser print of `KataPrintSheet`) carries the new letterhead, while "Print Kata" (the PDF file,
  and the APK's own print route) still carries the old band — say so before claiming the PDF matches.
- **Verified in the preview** (`/customers/<id>`, the print-only wrapper forced visible, desktop): the
  letterhead measures 213px tall at 1185px wide, the chevron band 45px, the logo image 60×60 and loaded
  (`naturalWidth > 0`), the ribbon border `1px rgb(230,27,35)`, the WhatsApp disc `rgb(37,211,102)`, the
  phone handset `rgb(230,27,35)`, all four contacts printed. The bill's own letterhead still renders its two
  corner banners, the mark and the ribbon. `npx eslint` on the file → 0 problems, `npm run build` clean.

## The customer kata's foot is print only, and the bill prints on one page (this branch)

- **The customer kata's footer holds only its two print actions** — `PartyDetailView`'s action row
  (`Print Only` · `Print Kata`) no longer renders Back, Delete or Receive payment for `type="customer"`;
  they live in the page header (`PartyDetailPage`) and the payment dialog. The buttons are gated on
  `!isCustomer`, so a **supplier's kata keeps all five**. The invoice dialog (`InvoiceDetailDialog`)
  already carried `Print / PDF` alone and is unchanged in that respect.
- **The bill is printed at A4's printable width, and the page is cut to its height.** `InvoiceDetailDialog` now
  calls **`fitPrintPage()`** (`src/lib/printPage.js`, the kata statement's own helper) instead of
  `printSheetAtViewSize()`, so the printed sheet is laid out at 190mm and the page is
  `210mm × (sheet + 20mm + 1mm)`. **This supersedes "The bill prints at the size of the invoice view"**: a page
  cut to a phone screen's own width (an 87 × 300mm slip) is not a paper any print dialog offers, so Android
  Chrome fell back to its own paper and "Save as PDF" produced **five pages**. At 190mm the bill is ~148mm tall
  and fits one sheet of any paper the dialog offers. The print width no longer follows the window, so the resize
  listener went with it; measured live: `@page { size: 210mm 167.7mm; margin: 10mm }` for a 622 × 554 sheet.
- **The APK's file is one page too.** `printPdfFromElement()` is now passed
  `{ width: A4_PRINT_WIDTH_PX, exactPage: true }`: the clone is laid out at 718px, so `pageHeight` works out to
  ~475pt of A4's 842 — one page — instead of the phone-width raster's ~1,860pt, which `drawImagePages()` split
  into several A4 pages. `PdfPrinterPlugin` still asks for `MediaSize.ISO_A4`.
- **Verified in the preview** (the user's replayed session, `/customers/<id>`): the kata's action row reads
  exactly `Print Only` · `Print Kata` (the header still carries Back / Edit / Delete), an invoice row's eye opens
  the bill with only `Print / PDF`, and the injected page rule is the one above. **Not automatically verified:**
  the print dialog's own output and the APK's file (no print preview in a headless browser, no device here) —
  press **Print / PDF** on a bill once and "Save as PDF": one page holding the whole bill.

## The kata PDF opens on the factory letterhead (this branch)

- **`exportPartyKataPdf` / `buildPartyKataPdf` (`src/lib/kataPdf.js`) now draw the same letterhead the
  screen prints**: the two red corner banners (`src/assets/invoice-accent.png`, and its mirror
  `invoice-accent-right.png`, generated with `convert … -flop`), the mark (`/hiker-logo-red.png`) over the
  HIKER+ / SHOES / tagline lockup, and the four-person contact ribbon. The old orange band is gone.
- **The pictures are loaded before the sheet is drawn.** `loadLetterheadPictures()` fetches each PNG, paints it to a
  canvas and hands jsPDF a **PNG data URL** plus its own size — do not pass the `HTMLImageElement` through:
  jsPDF then falls back to a synchronous XHR (`loadFile`) for a non-data URL. `buildPartyKataPdf` stays
  synchronous and takes `pictures`; only `exportPartyKataPdf` awaits. A missing picture leaves the text
  letterhead intact, so nothing throws.
- The contacts come from **`src/lib/printContacts.js`** (`ribbonContacts()`), which `HikerLetterhead` uses too, so the
  screen sheet and the PDF cannot list different people.
- **The Grand Total is a band of its own on both printouts**: 30pt below the ledger in the PDF (40pt tall, 12pt
  label, 12.5pt columns, 16pt balance) and `mt-10` / `py-[14px]` / 11pt · 11.5pt · 14pt on `KataPrintSheet`.
  Verified by rendering the PDF headlessly (Vite `ssrLoadModule`, `@/lib/pdfFile` stubbed, the PNGs passed as data
  URLs) and rasterising page 1 with `pdftoppm` (the band's label moved from y 343.5 to 361.5 of 841.9 and reads 12pt
  against the rows' 8.5pt), and by measuring the live sheet (its print-only wrapper forced into a 718px clone): the
  band sits **40px** under the ledger's last line with label 14.67px, amounts 15.33px, balance 18.67px, the two
  corner banners (99×83, both loaded) and the 60×60 mark above them. **Print Kata** itself was pressed in the
  preview: the PDF built and opened for printing (`blob:` frame, 794px), 0 console errors.

## A ledger row's colour follows the money, not the record (this branch)

- **`ledgerTint(side)` / `ledgerEdge(side)` take the row's `side` now, not its `kind`.** The old rule painted every
  payment green and every document red, which is right only on a customer's kata: a supplier's purchase (Jamma,
  money in) read red and the payment made to him (Banam, money out) green — the opposite of the truth. Colour now
  follows the money, so **Jamma green / Banam red** is one rule that turns round by itself: a customer's invoice red
  and his receipt green, a supplier's purchase green and his payment red, a worker's wage entry green and his payment
  red. `KataStatement` (customer + supplier) and `LabourStatementView` both pass the side; the labour view derives it
  with its own `sideOfRow()` (an `earning` is Jamma). **Never pass `row.kind` again** — several notes above
  ("The labour statement reads oldest first", "The ledger's green…") describe the superseded kind-based rule.
- **The printed sheet washes the whole row, not only its amount cells.** `KataPrintSheet`'s `<tr>` takes
  `PRINT_JAMMA_WASH` / `PRINT_BANAM_WASH` by side (the amount cells keep their green/red ink but no longer their own
  background, so a row is one colour), and `kataPdf.js`'s `drawKataTable()` fills each row the same way
  (`JAMMA_WASH` / `BANAM_WASH`, the side at 10 % over the paper). The header row and the Grand Total band keep
  their column washes — the columns still read green/red.
- **The party's name and address are a size up on both printouts.** `KataPrintSheet`'s title is 16pt with the phone
  and a new `Address:` line at 9.5pt (the address falls back to `party.city` when the record has none), and
  `kataPdf.js`'s `drawKataHeading()` is 17pt / 10pt with the same address line — `buildPartyKataPdf` passes
  `party.address || party.city`.
- **Verified in the preview** (the user's replayed session, 360px): AMIR's kata gave 4 invoice rows
  `bg-rose-500/10` and 4 receipt/payment rows `bg-emerald-500/10`; the print sheet measured `AMIR Statement` at
  **21.33px (16pt)**, `Phone Number` / `Address: Lahore Pakistan` at **12.67px (9.5pt)**, its invoice rows
  `rgba(217,35,45,0.1)` and its receipt rows `rgba(21,128,61,0.1)`; a supplier's purchase row and a worker's wage
  entry each rendered green. `npx eslint` on the five changed files → 0 errors (the pre-existing `isPayment`
  warning in `LabourStatementView`) and `npm run build` is clean.
- **NOT automatically verified:** the PDF file itself (a download/print frame cannot be read back here) — press
  **Print Kata** once and check the rows are washed and the address sits under the phone.

## Rebuilding `release/` can leave the download server on the old folder (this branch)

- **`rm -rf release` makes every download 404 until the service is recreated.** The `downloads` service bind-mounts
  `./release`; deleting the folder and re-creating it leaves nginx holding the **old, unlinked directory** — every
  URL answers 404 while still sending `Content-Disposition: attachment` (it reads like a broken build, not a mount).
  `up -d` answers "Container … Running" and changes nothing; it takes
  `docker compose -f docker-compose.base44.yml up -d --force-recreate downloads`.
- Safe habit: build **in place** (`mv` the new artifact over the handed-out name) and delete only electron-builder's
  byproducts (`win-unpacked/`, `.icon-ico/`, `*.blockmap`, `latest.yml`, `builder-debug.yml`), so the mount never goes
  stale. Remember `env -u VITE_BASE44_PREVIEW_MODE npm run build -- --base=./` for the bundle.
- **The 2026-10-30 rebuild** (source `a419844`): `release/HIKER-Factory-ERP-windows-setup.exe` — the fresh NSIS x64
  build, `88,113,433` bytes; `release/HIKER-Factory-ERP-source.zip` — `git archive --format=zip
  --prefix=HIKER-Factory-ERP/` of `HEAD`, `12,383,928` bytes, 743 entries, one top-level folder. The APK beside them
  was **not** rebuilt in this pass (copied back from `android/app/build/outputs/apk/debug/app-debug.apk`, 11,786,987
  bytes) — rebuild it before handing that link out.

## The bill is never handed to the browser's print engine (this branch)

- **The report:** printing a bill from a customer's own invoice list on a phone gave a three-page "Save as PDF"
  whose letterhead was several times its size and whose table started on a later sheet. Cause: `InvoiceDetailDialog`
  called `window.print()` in a browser, and a **phone** browser does not lay a page out at paper width — it lays the
  phone layout out and stretches that onto the paper, so the 360px sheet was blown up ~2.4× and ran over three
  sheets. The `@page { size: … }` rule `fitPrintPage()` injects cannot help there, because the page it sizes is not
  what the phone renders. (The APK cannot be the path that produced three pages: its file is built from the sheet at
  A4 width with `exactPage`, which is one page by construction.)
- **`printInvoice` now always builds the file from the sheet** — `printPdfFromElement(pdfTarget(), …, { width:
  A4_PRINT_WIDTH_PX, exactPage: true, dialog: true })` on **every** shell, the APK's own call unchanged. The sheet is
  drawn at 190mm and the page cut to its height, so the PDF is the invoice view, 1:1, on one A4 page. The browser's
  print engine is not involved at all.
- **`src/lib/pdfFile.js` gained `isPhoneBrowser()`** and `printPdfBlob()` consults it for `{ dialog: true }`: a
  phone's browser cannot print a file from a page (its PDF viewer has no `print()`), so there the finished PDF is
  **saved** through `saveBlob()` and the phone's own viewer prints it; a desktop browser and the EXE still get the
  print dialog through `printBlobInBrowser()`, and Android still gets `PdfPrinterPlugin`. `printPdfFromElement()`
  passes `dialog` through. The kata's `printPdf(doc, …, { dialog: true })` shares the same rule.
- **Verified in the preview** (`/invoices` → a bill's eye → **Print / PDF**, the user's replayed session, 360px):
  the sheet rendered (`BILL NO.: 03`), the press performed, the button returned to its idle label, the file's print
  frame was handed to the browser (an `iframe` created by `printBlobInBrowser`), **0 console errors** and 0 failed
  requests. `npx eslint` on both changed files → 0 problems, `npm run build` clean. **NOT automatically verified: the
  file itself and the phone's own print/save step** — a headless browser paints no print preview and the download
  cannot be read back; press **Print / PDF** once in a phone browser (the PDF lands in Downloads, ready to print) and
  once in the APK (Android's print sheet, paper A4).
- `fitPrintPage()` stays in the dialog for a **manual** browser Ctrl+P (it still cuts the printed page to the
  sheet); nothing but that uses it for a bill now.

## One print pipeline: the printed document is the document on screen (this branch)

- **`src/lib/printDocument.js` is the only path every Print / PDF button takes.** `printElement(sheet)`
  clones the **live DOM** of the sheet the user sees into `#hiker-print-root` — a copy laid out at A4's own
  printable width (190mm) and parked off the page — and calls `window.print()`. The browser's own print engine
  then produces the paper: real text (selectable, sharp, never a screenshot), the letterhead's fills and inline
  SVG, and the `@media print` / `@page` rules in `src/index.css`. **"Save as PDF" in the print dialog is the
  PDF.** `printNode(<React sheet>)` renders a sheet that has no place on screen (the generated reports) into an
  off-page host and prints it through the same function. Inside the Android APK a WebView has no print dialog, so
  `printElement` hands the same sheet to `printPdfFromElement()` (PdfPrinterPlugin) — the device's print service.
- **The print CSS is one block in `src/index.css`.** `@page { size: A4 portrait; margin: 10mm }` is the paper;
  `html.printing-document body > *:not(#hiker-print-root)` hides the entire app (sidebar, top bar, dialog chrome,
  overlays) so only the document prints; the root carries `print-color-adjust: exact` so colours and watermarks
  survive; the invoice's own `header` / `section` blocks and the report's heading are `break-inside: avoid`, so
  the header, customer details, table, totals, kata and footer are never split (a document longer than a page
  still flows onto the next, with `thead` repeating and rows never split). **The node the print root holds has its
  buttons, inputs and `.no-print` children stripped** before printing, so no screen control reaches the paper.
- **The call sites.** `InvoiceDetailDialog`'s Print / PDF prints its `InvoicePrintView` (the dialog's own sheet);
  `PartyDetailView`'s Print Only / Print Kata print the hidden `KataPrintSheet` the page renders; `LabourDetail`'s
  two buttons print the `LabourStatementView`; every report button (`ExportButtons`, the invoice register's Print
  all, the production register's All PDFs, the invoice history and a stored day's Print / PDF) goes through
  `printReport()` in `src/lib/reportExport.js`, which renders **`src/components/print/ReportPrintSheet.jsx`** —
  letterhead, title, filters and every table (main, `extra`, `sections`) — inside a **`MemoryRouter`**, because a
  column's cell can be a `<Link>` (the register's bill number) and a `<Link>` outside a router throws
  ("Cannot destructure property 'basename'"). That was the one bug found while verifying this pipeline: the
  report sheet silently never mounted until the router wrapped it.
- **`src/lib/printPage.js` is no longer used** (nothing imports it): the page is A4 at 10mm margins now, not cut
  to a sheet's own height. `pdfBlobFromElement()` / `printPdfBlob()` in `src/lib/pdfFile.js` remain for the native
  fallback and for the WhatsApp share (`invoicePdf.jsx`), which is still a raster attachment.
- **Verified in the preview** (the user's replayed session, 360px): the bill's Print / PDF put the real
  `.invoice-print` (letterhead image, "Bill No.: 03", customer line) into `#hiker-print-root` at **718px = 190mm**
  with the app's `printing-document` class on `<html>`, no buttons in the clone, and the root cleared afterwards;
  the customer kata's Print Only put the `.print-sheet` (letterhead + balances + ledger) in at the same 718px; a
  labour statement's Print Only put the statement sheet in at 718px with 0 buttons; and the invoice register's
  PDF / Print put `.report-print` (h1 "Invoice register", 4 register rows, letterhead) in at 718px — **0 console
  errors** in every case. **NOT automatically verified: the printed page / PDF itself** — a headless browser
  paints no print preview and a download cannot be read here, so the paper is evidenced by the DOM, the computed
  widths and the print CSS; press Print / PDF once and Save as PDF to see the sheet.

## The bill prints on one whole Letter page (this branch)

- **The reported problem was the paper, and the band it left.** Printing is Letter here, but the stylesheet's
  page was A4 (`210 × 297mm`, 190mm printable width), so on a Letter printer the sheet was scaled by the
  driver and the bill — only ~147mm of its own content at paper width — sat as a band across the top of the
  sheet with blank paper under it, nothing like the reference the user sent.
- **`@page` is `size: letter portrait; margin: 10mm`** (`src/index.css`), i.e. a **195.9 × 259.4mm**
  printable box, and everything that used to be A4's 190mm now uses that width: `#hiker-print-root` (both the
  off-page layout and the `@media print` rule) and `PRINT_PAGE_WIDTH_MM` in `src/lib/printDocument.js`, so the
  screen copy and the paper copy are laid out on the same box.
- **The bill fills the page (`printElement(…, { fillPage: true })`).** `fillPrintPage()` gives the sheet
  `min-height: 258.6mm` (the printable height less 0.8mm of slack, so a rounding cannot spill the closing line
  onto a second sheet) and makes `.invoice-lines` `flex: 1 1 auto` with its table at `min-height: 100%`, so the
  ruled lines absorb the room and the totals/kata/footer sit at the foot of the page — the same rule
  `pdfBlobFromElement()`'s `fillPage` already followed for the PDF. It is opt-in: the kata, labour and report
  sheets keep their natural height. The Android print path takes the same width (`PRINT_PAGE_WIDTH_PX`).
- **Verified in the preview** (the user's replayed session, `/invoices` → an invoice → **Print / PDF**
  with `window.print` stubbed so the dialog does not open): the pipeline built the sheet at
  **195.9 × 258.6mm** with `min-height: 258.6mm`, `.invoice-lines` computing `1 1 auto` and its table
  `603.53px`, and the live stylesheet's page rule reads `@page { size: letter; margin: 10mm; }` — one sheet
  inside the 259.4mm printable height. Drawn on a mock 215.9 × 279.4mm Letter page it renders the reference:
  letterhead and contact ribbon, date/bill/customer boxes, the red heading over the ruled lines, then Subtotal ·
  GRAND TOTAL · RECEIVED · BALANCE · the KATA box · the closing line and the TOTAL CARTONS box at
  the bottom edge. `npx eslint` on both changed JS files is clean.
- **Not automatically verified:** the printer's own output (no printer here) — the page rule, the sheet size
  and the layout are the measurable parts; print one bill on Letter paper once to confirm the driver does not
  re-scale it (its paper size must be set to Letter, not A4).

## The 2026-10-31 rebuild: APK + EXE + source ZIP, and the reusable toolchain image (this branch)

- **The links handed out on 2026-10-31 serve a fresh build of `53ada08`** (Letter-paper print system), not the
  2026-10-30 files that were sitting in `release/`:
  - `release/HIKER-Factory-ERP-android-debug.apk` — **10,943,591 bytes, md5 `2f132e1b437ade7019059b85445fd7f5`**
  - `release/HIKER-Factory-ERP-windows-setup.exe` — **88,051,364 bytes, md5 `85f28762339c4c5c9ef63f24ced5330c`**
    (NSIS x64; electron-builder writes `HIKER-Factory-ERP-0.0.0-setup.exe`, renamed over the stable name)
  - `release/HIKER-Factory-ERP-source.zip` — **12,393,111 bytes, md5 `5f0f3b7155edb4c8ab1f74b18e8ca56b`**
    (`git archive --format=zip --prefix=HIKER-Factory-ERP/ HEAD`, one top-level folder)
  All three answer 200 through the `downloads` service with those exact sizes and md5s.
- **The toolchain is a cached image now, not a container layer that `up -d --build` wipes:**
  `hiker-build:latest` (5.29 GB) = `node:22-bookworm` + Temurin **21** at `/opt/jdk21` + Android SDK at
  `/opt/android-sdk` (platform-tools, platforms;android-35, build-tools;35.0.0, licenses accepted) + wine,
  wine32:i386, xvfb, xauth, zip. Its Dockerfile is throwaway (`/tmp/Dockerfile.build`); rebuild it from the same
  apt/Temurin/sdkmanager steps if the image is ever lost.
- **How a build is run:** a one-service throwaway compose file (`/tmp/build.yml`, project `hikerbuild`) with
  `image: hiker-build:latest`, `/app` bind-mounted, `/root/.gradle` and `/root/.cache/electron` on named volumes,
  and **`env_file: /app/.env.base44-defaults` + `/run/base44/app.env`** — compose, not `docker run --env-file`,
  because the managed secrets file quotes its values. Resume with
  `docker compose -p hikerbuild -f /tmp/build.yml run --rm build sh -ec '<steps>'`.
- **The packaged build needs the repo's dependencies installed first.** The host `node_modules` can lag
  `package.json` (Vite failed with `Rolldown failed to resolve import "@capacitor/app"`); start every packaging run
  with `npm install --no-audit --no-fund` from the mounted `package-lock.json`.
- **APK:** `npm install` → `env -u VITE_BASE44_PREVIEW_MODE npm run build -- --base=./` → `npx cap sync android` →
  `cd android && ./gradlew assembleDebug --no-daemon` (1 m 40 s on a cold `/root/.gradle`). The APK's
  `assets/public/assets/index-*.js` md5 matched `dist/`'s exactly (`30f04c80…`), so the archive holds this build;
  its 5 `assets/public/login-art/*.jpg` are present.
- **EXE:** `npm install --no-save electron@35.1.5 electron-builder@26.0.12` (both in one command) then
  `env -u VITE_BASE44_PREVIEW_MODE npx electron-builder --config electron-builder.yml --win nsis --x64 --publish never`;
  `win-unpacked/`, `.icon-ico/`, `*.blockmap`, `latest.yml` and `builder-debug.yml` were deleted afterwards so
  `release/` holds the three deliverables alone — never `rm -rf release` (the nginx mount goes stale, see above).
- `npm install --no-save` leaves electron/electron-builder in the host `node_modules` (not in `package.json`); that
  is the documented build-tool arrangement, not a dependency change.

## The APK's printed page is Letter, and the print service is asked for Letter (this branch)

- **The report:** the phone's "Save as PDF" sheet opened on a paper of its own (**ISO C2**) with the bill squeezed
  and squashed into it, while the browser preview printed it correctly. Two things disagreed with the paper:
  `PdfPrinterPlugin` asked the print service for **A4**, and the file the bill was drawn into was an **A4-shaped**
  page (`pdfFile.js`'s `A4_WIDTH_PT` 595.28 × `A4_HEIGHT_PT` 841.89) while the sheet was laid out at Letter's
  195.9mm width — so on a Letter sheet the sheet was shrunk 3 % and the page's proportions were not the paper's.
- **`src/lib/pdfFile.js` draws a Letter page now.** `PAGE_WIDTH_PT = 612`, `PAGE_HEIGHT_PT = 792` (8.5 × 11 in),
  `PRINT_WIDTH_PX` / `PRINT_HEIGHT_PX` are Letter's printable box (195.9 × 259.4mm → 740 / 981 px), the
  multi-page fallback is `format: "letter"`, and the 10mm margin, the 3 pt snap to a whole page, the jsPDF
  orientation rule and the `onePage` logic are unchanged (the jsPDF note's "612pt wide" replaces "595pt"). The clip
  is now 1:1: `drawWidth` 555.3pt = **195.9mm**, exactly the sheet's own width.
- **`printElement()`'s Android branch forwards `fillPage`.** The bill fills its sheet on screen through that flag
  (`fillPrintPage()`), but the native call dropped it, so the file the print service got was the compact sheet
  rather than the page the user was looking at.
- **`PdfPrinterPlugin` asks for `MediaSize.NA_LETTER`** instead of `ISO_A4` — same minimal attribute set (media size
  + colour mode only; a made-up resolution or zero margins is what makes a service fall back to its smallest
  paper). **If a device still opens on another paper, its print service is ignoring the attribute** and the paper
  has to be picked in the dropdown once.
- **Verified.** `npx eslint` on both JS files → 0 problems; the `no-undef` sweep reports only browser globals.
  The page maths was run with the container's own jsPDF over the real sheet sizes (740 × 977 natural, 740 × 980
  filled): **612 × 792 pt = 215.9 × 279.4mm** every time, sheet drawn at **195.9mm** — one Letter page, nothing
  scaled. In the preview the bill's **Print / PDF** still puts the sheet in `#hiker-print-root` at
  **195.9 × 258.6mm** under `@page { size: letter; margin: 10mm }`, 0 buttons, 0 console errors (the web/EXE path
  never touches `pdfFile.js` for a bill).
- **The APK was rebuilt** (`hiker-build:latest` + `/tmp/build.yml`, the recipe above):
  `release/HIKER-Factory-ERP-android-debug.apk`, **10,943,598 bytes, md5 `3024bcfc408d9172648382c247391d0f`** —
  `assets/capacitor.plugins.json` names app / filesystem / share, the bundle
  `assets/public/assets/index-Dvqrua7o.js` is **byte-identical to `dist/`** (md5 `c222ef378abc03d51b267084c3a0bfc0`),
  no `VITE_BASE44_PREVIEW_MODE` is baked in, two `sb_publishable_` literals, and `classes4.dex` carries
  **`NA_LETTER` (1 reference, `ISO_A4` 0)** beside the plugin.
- **NOT automatically verified: the phone's own print sheet** — no device or emulator here. Install this APK,
  open a bill → **Print / PDF**: "Paper size" must read **Letter (8.5 × 11 in)**, the whole bill must sit on one
  page at the proportions the dialog shows, and "Save as PDF" must write it; the same for a customer's **Print
  Only** / **Print Kata**.

## The bill's Print / PDF saves the file itself, on its own page (this branch)

- **The request:** the bill's **Print / PDF** opened Android's "Save as PDF" screen on an Index Card paper with the
  invoice shrunk into a corner. It now **writes and saves a PDF directly on every shell** — no print dialog, no paper
  size — the whole invoice as one high-resolution image on a page cut to the invoice's own width and height.
- **`pdfBlobFromElementOwnSize(element, { width, scale })` / `savePdfFromElementOwnSize(...)` in
  `src/lib/pdfFile.js`** are the new path. The sheet is cloned into an off-page host, laid out at `width`
  (`PRINT_WIDTH_PX`, Letter's 195.9mm — the layout it is designed for), rasterised with html2canvas at **scale 3**,
  and drawn full-bleed on a jsPDF page whose `format` is `[canvas.width / scale, canvas.height / scale]` in points
  (CSS px × 0.75). So the page **is** the sheet: nothing stretched (the page's ratio is the raster's own), nothing
  cropped, no margin, one page. The orientation still follows the page's proportions — jsPDF flips a page whose width
  exceeds its height otherwise.
- **`InvoiceDetailDialog`'s `printInvoice` calls `savePdfFromElementOwnSize(documentTarget(), \`HIKER-INV-<bill>.pdf\`,
  { width: PRINT_WIDTH_PX })`** — the sheet on screen, not a template — and `saveBlob()` delivers it: a download in
  a browser and the desktop EXE, the phone's **Downloads** folder through `DownloadSaverPlugin` in the APK. Nothing
  on that path touches `PdfPrinterPlugin`, `window.print()` or `printDocument.js` any more for a bill; every other
  sheet (kata, labour, reports) keeps the print pipeline it had.
- **Verified in the preview** (`/invoices` → a bill → **Print / PDF**, the file captured from the button's own
  `URL.createObjectURL`): `HIKER-INV-03.pdf`, 415,500 bytes, `%PDF-`, **one page**, MediaBox **555 × 416.25 pt** with
  an embedded **2220 × 1665** JPEG — the same ratio to within 0.002 %, so the bill fills the page exactly; the
  screenshot of that very image shows the full sheet, letterhead to footer, 0 console errors. `npx eslint` on both
  files is clean.
- **Not automatically verified:** the phone's own save — no device here. Press **Print / PDF** in the APK: the file
  must land in Downloads as `HIKER-INV-<bill>.pdf` with no print sheet in between.

## The bill's PDF keeps the preview's own portrait shape (this branch)

- **The report:** *"Fix Invoice PDF Aspect Ratio and Orientation — the generated invoice is stretched horizontally
  and appears too wide … keep the PDF in Portrait orientation."* Cause: `InvoiceDetailDialog`'s Print / PDF passed
  `{ width: PRINT_WIDTH_PX }` (740px, Letter's printable width) to `savePdfFromElementOwnSize()`, so the sheet was
  laid out *wider than it is tall* (740 × 586) and jsPDF built a **landscape** page — the MediaBox of the file above
  was **555 × 416.25 pt**, which is the "too wide" the user saw. The sheet's height is content-driven and does not
  grow with its width, so only the preview's own width reproduces the proportions people see.
- **`pdfBlobFromElementOwnSize()` measures the sheet now.** With no `width` it copies the element out at
  `element.getBoundingClientRect().width` (the preview's own width — never the viewport's, never a screenshot's) and
  the page takes the raster's shape as before, so the file is the sheet: same width-to-height ratio, one page, no
  paper imposed. `InvoiceDetailDialog` calls it **without** the option; `width` remains for a caller that really
  wants a fixed layout. **Trap, hit here:** replacing the `if (width)` condition with `if (sheetWidth > 0)` is not
  enough — the block body still interpolated `${width}px`, which with `width = null` wrote `"nullpx"` into the
  host, left it auto-width, and html2canvas produced a **10375 × 561** raster (a 7781pt-wide page). Both the host
  and the clone take `sheetWidth`.
- **Verified in the preview** (`/invoices` → a bill's eye → **Print / PDF** at 375px, the blob captured from the
  button's own `URL.createObjectURL`): sheet **325 × 562.11 px**, file `HIKER-INV-03.pdf`, **one page**, MediaBox
  **243.75 × 422.25 pt (85.99 × 148.96mm)** — portrait — with an embedded **975 × 1689** JPEG, i.e. the ratio of
  the preview to within **0.16 %** (pixel rounding), 0 console errors. The screenshot shows the sheet unchanged.
  `npx eslint` on both files is clean. **Not automatically verified:** the phone's own save (no device here).

## The invoice PDF is the sheet, and the sheet is always whole (this branch)

- **The report:** a bill exported from the app came out as a wide page cut just after the BALANCE bar — the
  KATA box, the thank-you line and the TOTAL CARTONS box missing — while the preview showed the whole form.
- **`src/lib/pdfFile.js` now measures the page from the sheet, not from the raster.** `pdfBlobFromElementOwnSize()`
  takes `pageWidth` / `pageHeight` from `target.getBoundingClientRect()` (the sheet's own box, × `CSS_PX_TO_PT`)
  instead of `canvas.width / scale`. The two agree exactly when the raster is whole (checked: a 328×571 sheet →
  raster 984×1713 at `scale: 3` → page `246 × 428.2 pt` either way), so the normal output did not change. The
  difference is the failure case: a raster that came back short used to shrink the page with it and draw the bill
  larger than its paper, which is how the bottom of the form fell off.
- **The raster is asked to draw the whole sheet:** `sheetCaptureOptions(target, scale)` passes html2canvas
  `width` / `height` (the sheet's box) and `windowWidth` / `windowHeight` (at least the sheet, never less than the
  window), and the offscreen host a sheet is copied into is `position: absolute` rather than `position: fixed`.
  html2canvas clones the page into a window-sized iframe, and a fixed host is the one thing that clone cannot
  scroll to; sizing the clone window to the sheet removes that class of clipping for every sheet in the app.
- **Verified in a real browser, with the app's own sources** (a throwaway page rendering `InvoicePrintView` at the
  dialog's 328 px width and calling the real `pdfBlobFromElementOwnSize()`): raster `984 × 1713` = exactly 3× the
  sheet, page `246 × 428.2 pt` (the sheet's own 1:1.74 portrait proportions), and the raster read back out of the
  PDF shows the letterhead, the ten ruled rows, the three money bars, the **KATA** box, the thank-you line, the
  **TOTAL CARTONS 5** box and the footer. `npm run lint` and `npm run build` are clean. The throwaway page was
  deleted; nothing else in the repository changed.
- **Testing note:** `/invoices` has no rows on this branch (the factory's test records were emptied), so the dialog
  can no longer be opened from the preview to produce a real file. Render the sheet from a throwaway page instead —
  and remember a browser download is not observable from the preview harness, so measure the PDF's own
  `/MediaBox` and the embedded JPEG rather than looking for the file.

## The kata/labour paper is Letter, and a worker's page wears a supplier's kata (this branch)

- **The APK's kata / labour / report print is built as the browser's own page.** `printElement()`
  (`src/lib/printDocument.js`) now passes `paper: true` to `printPdfFromElement()`, and
  `pdfBlobFromElement()` (`src/lib/pdfFile.js`) renders it with `letterPagesFromImage()`: a **Letter**
  page (612 × 792 pt), the sheet at the printable width (195.9mm → 555.3pt), 10mm of white paper round
  it and the *same* scale as the print dialog, sliced onto further Letter pages every 259.4mm. The old
  `exactPage` path cut a page to the sheet and could draw a narrow capture across the whole width, which
  is how a phone's print read as a magnified letterhead. Images and fonts are awaited before the capture
  (`whenImagesReady` + `document.fonts.ready`), which the invoice path always did and this one did not.
  **The bill is untouched**: `InvoiceDetailDialog` still uses `savePdfFromElementOwnSize()`.
- **A worker's statement is the party kata's sheet.** `LabourDetail` renders the same hidden
  `KataPrintSheet` a supplier's page does (`type="labour"`, so `KataPrintSheet` and `KataStatement` read
  "Labour kata" / "Labour statement" and the "Wage / payment" column), and both print buttons moved from
  the page header to the foot of the statement. `LabourStatementView` draws its ledger with
  `KataStatement` instead of the old notebook, fed by **`labourLedgerRows(statement)`** in
  `src/lib/labour.js` — the one reader (side, credit, debit, running balance) the screen and the paper
  share. `LabourDetail` also gained the supplier page's "Account details" panel.
- Verified in the preview (`/labour` → a card): the page renders with **no** print button in the header,
  **Print Only / Print / PDF** at the foot, `LABOUR STATEMENT` in the shared sheet, its ledger rows, and
  the hidden `.print-sheet` holding the letterhead, the period, "Labour kata" and its table; a
  supplier's page still reads `SUPPLIER STATEMENT` with its own buttons. `npm run lint` clean,
  `npm run build` clean. The APK was rebuilt (`a997540c013f1053a16699b30bd06d3c`), its bundle
  byte-identical to `dist/`.
- **NOT automatically verified: the phone's own print output** (no device/emulator here) — install the
  APK and press **Print Only** / **Print / PDF** on a worker and on a customer/supplier: the paper must
  read like the browser preview (Letter, 10mm margins, the sheet at 100%).

## A labour's stage rate is the wage, and it cannot be zero (0048, this branch)

- **The report:** a new labour added with a stage and a per-pair rate must earn correctly in Production, and
  Bilal's and Naveed's wages (recorded at Rs 0) were to be put right — "add wages rate for Naveed and Bilal too …
  recalculate all four". The four entries were the two men × 25 Oct and 31 Oct, each 1,800 pairs earning Rs 0.
- **The chain already existed and is unchanged:** a stage is a `labour_categories` row, a labour's stage is its
  `labour_category_links` row, and a wage is pairs × the rate `labour_rate_on()` finds for that
  (labour, stage, date). `StageEntryDialog` opens the rate from `listLabourRates()` for the stage's own man, and
  `post_production_stage()` snapshots it. Do not add a second source of "the rate".
- **`0048_labour_rate_guard.sql` is applied.** It adds `labour_rates_positive_check`, a BEFORE INSERT/UPDATE
  trigger that refuses `rate_per_pair <= 0` ("Enter a rate above Rs 0 per pair — a Rs 0 rate earns nothing"), so no
  path — the Labour form, `post_production_stage()`, a raw API call — can write a zero-rate wage row again; and
  `recalculate_labour_wages(p_labour_id, p_category_id)` (SECURITY DEFINER, `labour:edit`), which fills **only**
  earnings whose rate or amount is zero, from the rate in force on each earning's own `earned_date`. A wage earned
  at a real rate is never rewritten. Rollback: `0048_labour_rate_guard.rollback.sql`.
- **`saveLabourRate()` (`src/lib/labour.js`)** now refuses a non-positive rate itself and calls
  `recalculate_labour_wages` for that labour + stage after the upsert. So a man created (or given a rate) after his
  stage work was recorded gets the wage without a second correction step. The repair is best-effort: a refused RPC
  logs a warning and never undoes the saved rate.
- **The data was corrected with the owner's figures:** Bilal (Machine / Sole) and Naveed (Finishing) are on
  **Rs 12 / pair** for both existing effective dates (2026-10-25 and 2026-10-31), and their four zero earnings were
  recalculated to **1,800 × 12 = Rs 21,600 each**. All three labours now stand at **Rs 43,200 earned** (Zaheer was
  already correct); `labour_balances()` derives the cards, so nothing else needed rewriting. **No zero-rate row
  remains.**
- **Verified (2026-10-31).** SQL: the trigger rejected a 0 insert and the table held 0 zero-rate rows; the repair
  function, called as the signed-in administrator with one wage zeroed inside a rolled-back transaction, answered
  `{"updated": 1, "amount": 21600.00}` and restored 12 / 21,600. In the preview: `/labour` renders all three cards
  at `WAGES EARNED Rs 43,200` with **no** "No per-pair rate set" note, and `/labour/<Bilal>` reads
  `RATE PER PAIR Machine / Sole · Rs 12 / pair`, `+Rs 43,200` and two entries `@ 12 / pair`. A throwaway labour
  created through **New labour** with the *Machine / Sole* stage and **Rs 10 / pair** saved with its card (no rate
  note) and its page read `Machine / Sole · Rs 10 / pair`; it was then purged by exact id, so `labours` is back to
  its three. 0 console errors, 0 failed requests, `npm run lint` and `npm run build` clean.

## The production history finds a record by its article's name (this branch)

- **A stage entry stores only `article_code`** (`labour_production` has no `article_name`), so a stored day's snapshot row
  for a stage carried the code and the *worker's* name in the "Article / Item" column — searching "Scheckers" matched
  nothing. `productionDayRecords(day, { categories, articles })` now takes the article list and resolves
  `article_code → name` (case-insensitive, from `db.Article`), shows it under the code for a stage row, and the list's
  `filterBySearch` therefore matches an article's **name** as well as its code. The worker who did the stage is still
  named in the category line (`Stage 1 · Lasting · Zaheer`). `ProductionHistory.jsx` reads `db.Article` once beside its
  `RawCategory` read and passes it in.
- **Verified in the preview** (the user's replayed session, 360px): `/production/history` listed `AH+3` / `AH+1` rows
  reading `Scheckers`; `Scheckers` narrowed the register to those 6 records, `zzzz-no-article` gave "No record matches
  your filter", clearing restored all 20 rows. `npx eslint` on both files and `npm run build` are clean.
- **Every menu was swept the same way on 2026-10-31** — all 33 routes in `App.jsx` were navigated in one pass and each
  rendered its own heading with **0 console errors and 0 failed requests**: dashboard, Raw Stock (+ uppers + its
  history), Ready Shoes (+ article-wise), Articles, Production (+ history + daily), Pair Price Calculator, Purchases,
  Labour, Invoices (+ history), Sales, Customers, Suppliers, Payments, Investments, Roznamcha (+ history), Kharcha
  (+ history), Profit (+ history), Zakat (+ history), Reports, Settings, Recycle Bin, Database Center, Users.
- **The APK was rebuilt (2026-10-31 19:24 UTC):** `release/HIKER-Factory-ERP-android-debug.apk`,
  **10,945,690 bytes, md5 `2001dc9bfd2be137c1b12547341ce9cf`**, from the committed `android/` scaffold
  (`env -u VITE_BASE44_PREVIEW_MODE npm run build -- --base=./` → `npx cap sync android` →
  `JAVA_HOME=/opt/jdk21 ./gradlew assembleDebug --no-daemon`, `hiker-build:latest` + `/tmp/build.yml`, 19 s warm).
  Its `assets/public/assets/index-B8mafdNr.js` is **byte-identical to `dist/`** (md5
  `302b6d8a9dc4ff8d51bfa6b2b81837f6`), `assets/capacitor.plugins.json` names app / filesystem / share, two
  `sb_publishable_` literals with zero unsubstituted `VITE_SUPABASE_PUBLISHABLE_KEY` and no
  `VITE_BASE44_PREVIEW_MODE`, and the public download is byte-identical (md5 matches).


## The phone prints the page, and the price calculator prints its own sheet (this branch)

- **The report:** every paper button on the phone — a supplier's / customer's **Print Only** and **Print Kata**,
  the labour statement's two, `/invoices/history`'s report, and the **PDF / Print** on the raw-stock and report
  screens — printed **only the letterhead**. Cause: `printElement()` (`src/lib/printDocument.js`) handed the APK a
  raster of the sheet (`html2canvas` → JPEG → jsPDF → Android's print service), and on a device that raster came
  back **short**, so the PDF's first page held the letterhead alone. The same capture measured in this sandbox's
  Chrome is whole (`740×995` sheet → `1480×1990` canvas, ink to 98%, a two-page Letter PDF), i.e. the fault is
  specific to the WebView/print-service pair, not to the sheet, the CSS or the pagination arithmetic.
- **The fix: the phone prints the page, not a picture of it.** `printElement()` now mounts the sheet in
  `#hiker-print-root` and adds `printing-document` **before** it chooses an engine, and inside the APK it calls
  `printNativePage()` → `PdfPrinterPlugin.printPage()`, which prints the **WebView itself**
  (`webView.createPrintDocumentAdapter(title)` + `PrintManager.print` with `NA_LETTER`). Chromium lays that page out
  with this app's own print stylesheet and `@page` rule, so the phone's paper is the browser's paper — real text,
  the letterhead's fills, the browser's pagination — and "Save as PDF" is a destination there too. The jsPDF path
  stays only as the fallback for an install without `printPage`; the bill (`InvoicePrintView`) is untouched and
  still uses `savePdfFromElementOwnSize()`.
- **A native print job is written after `printElement()` returns** (the user confirms it in the print sheet), so the
  sheet is deliberately **left mounted** (`keepMounted`) when the native engine took it — `scheduleCleanup()` would
  otherwise blank the paper two seconds in. It is parked off the screen (`position: fixed; left: -20000px`) and its
  class only changes `@media print`, so nothing of it shows in the app; the next print replaces it. Do not "tidy"
  that call away.
- **The Pair Price Calculator prints on the same paper.** `src/lib/priceCalculatorPrint.js` no longer opens a popup
  and calls that window's `print()` — a WebView silently ignores it, which is why those buttons did nothing on the
  phone. It now builds `src/components/print/PriceCalculationSheet.jsx` (letterhead, title, one block per design
  with every material line, its price per pair and the design's total) and prints it through `printNode()`, so a
  **category** card's print button prints all of its designs and a **design** prints itself alone. A **Print** button
  was also added to `/pair-price-calculator/:categoryId/:designId`'s header, printing the rows as they read on that
  screen. Both callers pass `settings` (the letterhead's contacts and company name) and `await` the call.
- **Verified.** `npm run lint` → 0 problems and `npm run build` → clean. The new sheet was rendered headlessly in the
  container (Vite `ssrLoadModule` + `renderToStaticMarkup`, 14,397 chars) and read back: the design's name and
  article, both material lines, `Rs 852`, `Total cost per pair`, the letterhead's `HIKER` lockup and the note — with
  a note that `jspdf.node` throws if a `globalThis.window` shim is installed before the import (it reads
  `window.atob`); render the sheet alone, or stub `atob`/`btoa` too. The dev server serves all five changed modules.
- **The APK was rebuilt and is on the download link** — `release/HIKER-Factory-ERP-android-debug.apk`,
  **10,946,146 bytes, md5 `625c6a4184d7657a6150a8bf85ebd45f`**, built from the committed `android/` scaffold
  (`npm run build -- --base=./` → `npx cap sync android` → `JAVA_HOME=/opt/jdk21 ./gradlew assembleDebug
  --no-daemon`, 35 s). `assets/capacitor.plugins.json` names @capacitor/app, filesystem and share; the bundle inside
  (`assets/public/assets/index-DzJqTpsD.js`, md5 `1abebd622f5a9a64f5b8fbb3cd852343`) matches `dist/` **byte for
  byte**; `printPage` is in that bundle **and** in `classes4.dex`; the public download answers 200 with
  `application/vnd.android.package-archive`.
- **NOT automatically verified: the phone's own print output.** There is no device or emulator here, so the native
  page printer, Android's print sheet and its preview must be seen on the phone: press **Print Only** on a supplier's
  and a customer's kata, the labour statement's two buttons, `/invoices/history`'s **Print / PDF**, and the price
  calculator's category / design / design-page print buttons — every one must show the whole document. The web
  build's print path is unchanged (`window.print()`), and it was not re-driven behind the app-wide PIN gate.

## The EXE and the source zip, rebuilt for `9cc3c48` (2026-10-31, this branch)

- **Both deliverables were rebuilt after the print fixes** (`ba24ee5`, `9cc3c48`), because the copies on disk were
  from 16:02 — older than every `printNode` / `PdfPrinterPlugin` / `priceCalculatorPrint` change. Built in the `web`
  container with the documented recipe: `env -u VITE_BASE44_PREVIEW_MODE npm run build -- --base=./` (2.6 s,
  `dist/assets/index-ByaFCJzJ.js`, **zero** `VITE_BASE44_PREVIEW_MODE` occurrences) → `npm install --no-save electron@35.1.5
  electron-builder@26.0.12` → `xvfb-run -a npx electron-builder --config electron-builder.yml --win nsis --x64
  --publish never`. `wine`, `wine32:i386`, `wine64`, `xvfb`, `xauth` and `zip` were all still installed in the
  container, so no toolchain reinstall was needed.
- **Artifacts** (`release/`, gitignored, served by the `downloads` service on host port 8000):
  - `release/HIKER-Factory-ERP-windows-setup.exe` — **88,053,140 bytes, md5
    `630c339426f3b9714024c9189eed57f0`**, NSIS x64 (`file`: "PE32 executable … Nullsoft Installer self-extracting
    archive"), renamed over electron-builder's `HIKER-Factory-ERP-0.0.0-setup.exe`. Currency proved by extracting
    `dist/assets/index-ByaFCJzJ.js` out of `win-unpacked/resources/app.asar` with `@electron/asar`: 2,508,808 bytes,
    **md5 `5ac0a33907d8c48e6d0f9f84f4b0afc2`, identical to `dist/`**, no preview flag baked in.
  - `release/HIKER-Factory-ERP-source.zip` — **12,389,209 bytes, md5 `8e810076962d66af4731bc5cb2eb1e78`**,
    `git archive --format=zip --prefix="HIKER-Factory-ERP/" -o … HEAD` (738 files, one top-level folder, the
    `9cc3c48` tree; the `android/` scaffold and `electron/` are inside).
  - The `.blockmap`, `latest.yml`, `builder-debug.yml`, `__uninstaller-nsis-*.exe` and `win-unpacked/` electron-builder
    writes were deleted, so `release/` holds the three deliverables alone.
- `@electron/asar` is only resolvable from `/app` (it is electron-builder's dependency), so a helper script kept in
  `/tmp` needs `NODE_PATH=/app/node_modules node /tmp/…..cjs` — `require()` resolves from the script's own directory,
  not the shell's cwd.
- **NOT automatically verified: the EXE's own window and print output** — nothing here runs Windows. It was not
  launched; the check above proves the installer is well-formed and carries this branch's bundle, not that it starts.
