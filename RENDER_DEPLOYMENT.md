# Deploying TaskFlow AI to Render (free plan)

**Nothing here is claimed to be deployed until you have a live URL and have completed the verification checklist below.** Render plans and limits change; verify at https://render.com/pricing and https://render.com/docs.

## Architecture on the free plan
- **One Docker web service** (`taskflow-api`) built from the root `Dockerfile`. It builds the React frontend and serves it together with the API from the same URL, so there is no separate static site and no CORS setup.
- **Database: free external Postgres (Neon)**, not Render's. Render's own free Postgres expires after ~30 days, so it is not used.
- **No cron service.** Free plans have no cron jobs, so the reminder / summary worker runs inside the API process: when `RUN_WORKER_IN_PROCESS=1` (set in `render.yaml`; it also defaults to on whenever Render's `RENDER` env var exists) a daemon thread runs the idempotent one-shot worker every 60 seconds. It is off for local dev and tests unless you set the variable.
- Migrations run on every container start (`alembic upgrade head` in the Dockerfile `CMD`), including the Jira-style module (`0002_jira`).

## Free-tier caveats (read these)
- **Sleeps after ~15 minutes without traffic**; the first request afterwards takes tens of seconds to wake it. While the service sleeps the in-process worker is asleep too, so reminders, daily summaries and recurring-task generation are delayed until the next visit. Missed reminders fire when it wakes (they are idempotent). For reliable reminders keep the service awake (an external uptime pinger hitting `/health` every ~10 minutes) or move to a paid plan.
- **Neon free tier** has storage/compute limits and its compute pauses when idle (first query after a pause is slower). Verify current limits at https://neon.tech/pricing. Do NOT use Render's free Postgres: it expires after ~30 days.
- **Uploaded attachments are ephemeral**: the container disk is wiped on every deploy/restart/sleep-wake. Use a paid persistent disk or object storage for files you care about.
- Memory is limited (512 MB); the app keeps dependencies light and runs a single process.
- If `DATABASE_URL` is missing the app falls back to ephemeral SQLite and logs a loud error; always set `DATABASE_URL` to your Neon database.

## Steps
0. **Create the free database**: sign up at https://neon.tech (no card), create a project, copy the connection string (`postgresql://...?sslmode=require`). You will paste it as `DATABASE_URL`.
1. **Source code**: Render deploys from a Git repository you set up yourself. Make sure `.env` files are never committed.
2. **Create Blueprint**: Render Dashboard > New > Blueprint > select the repo. Render reads `render.yaml` and proposes the Docker web service `taskflow-api`.
3. **Environment variables** (prompted for `sync: false` ones; `SECRET_KEY` and `RUN_WORKER_IN_PROCESS` are set automatically):
   - **Required:** `DATABASE_URL` = your Neon connection string.
   - Optional: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (`mailto:...`) for push notifications (generate with `python backend/scripts/generate_vapid.py`), `ANTHROPIC_API_KEY` for AI features.
   - `VITE_VAPID_PUBLIC_KEY` is a Docker build arg: if you use push, add it as a build-time env var so the frontend is built with it.
4. **Deploy**: the first build takes a few minutes (it builds the frontend and installs Python deps).
5. **Test auth**: open the service URL, register, log out, log in, reload (session persists via refresh token).
6. **Test the Jira module**: open **Projects (Jira)**, create a project (e.g. key `TF`), create an issue, drag it across the board, start a sprint.
7. **Test notifications**: Settings > enable notifications, press the test notification button. Then create a task with a reminder 2 minutes ahead and keep the tab open or the service awake; the in-process worker should fire it. On iOS install to Home Screen first.

## Verification checklist
- [ ] `https://<service>/health` returns `{"status":"ok","db":true}`
- [ ] `https://<service>/docs` loads
- [ ] The UI loads at `/`; deep links (e.g. `/tasks`, `/jira`) reload without 404
- [ ] Register/login/logout works
- [ ] Create, edit, complete, delete a task; data persists after reload
- [ ] Logs show `in-process worker started (every 60s)` after boot
- [ ] Jira: create project, issue, move on board, start and complete a sprint
- [ ] Test notification appears in-app; push appears on a subscribed device (if VAPID configured)
- [ ] Reminder fires at the expected time (service awake)
- [ ] Live URL recorded here: `________` (do not claim deployment before this is filled)

## Troubleshooting
- **Blank page / 404 on `/`**: the image was built without the frontend; check the Docker build logs for the `npm run build` stage.
- **Migrations fail**: check `DATABASE_URL` in logs; `postgres://` is normalized by the app. Run `alembic upgrade head` in the service Shell.
- **First request very slow**: free service waking up.
- **No push**: missing VAPID keys, permission denied, expired subscription, or iOS not installed as a PWA.
- **Reminders late/missing**: the service was asleep (free plan). Keep it awake with an uptime pinger or upgrade.
- **Worker not running**: ensure `RUN_WORKER_IN_PROCESS=1` and look for worker errors in the logs.
- **Uploads vanish**: ephemeral disk; add persistent disk or object storage.
- **Database errors on first request**: Neon compute was paused; retry after a few seconds.
- **Cost**: everything above is free-tier; `ANTHROPIC_API_KEY` is optional and is the only thing that would incur usage charges (AI features fall back to rules without it).

## Jira module v2 notes (free tier)
- **Migration `0003_jira_v2`** runs with the normal `alembic upgrade head` on deploy (invites, links, watchers, components, versions, worklogs, attachments, filters, workflow, custom fields).
- **Attachments are stored in the database** (`jira_attachments.data`), so they survive Render's ephemeral disk. Limits: 2 MB per file, 10 files per issue, extension allow-list. On Neon free (0.5 GB) 250 maxed-out attachments would fill the database; delete old attachments or watch usage in the Neon console. Attachment bytes are never loaded by list queries.
- **Optional email** (off unless `SMTP_HOST` is set), via any SMTP provider with a free tier: `SMTP_HOST`, `SMTP_PORT` (default 587), `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`, `SMTP_TLS` (default 1; port 465 uses implicit TLS). Plain-text mails are sent from a daemon thread for: project invites (also to not-yet-registered addresses), assignment, and @mentions. Failures are logged and never affect requests. Users can opt out with `jira_email_notifications` in `/api/settings`.
- Search uses a built-in JQL-lite parser compiled to parameterised SQLAlchemy queries (no extra dependencies, works on SQLite and Postgres).
