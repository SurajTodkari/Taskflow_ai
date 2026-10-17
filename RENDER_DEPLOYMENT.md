# Deploying TaskFlow AI to Render

**Nothing here is claimed to be deployed until you have a live URL and have completed the verification checklist below.** Render plans and pricing change; verify current details at https://render.com/pricing and https://render.com/docs before choosing plans.

## Cost warnings (verify current pricing yourself)
- Free web services spin down after inactivity (cold start of tens of seconds). Not suitable for reliable reminders on their own.
- Free Postgres expires after a limited period (and has limits); use a paid database for real data.
- **Cron jobs are paid-only** with a minimum monthly billing. The every-minute reminder worker needs one for push/reminders/summaries to work.
- `preDeployCommand` may not be available on free web services; if not, run `alembic upgrade head` from the service Shell or add it to the build command.
- File uploads: the default disk is ephemeral and wiped on deploy/restart. Use a persistent disk (paid) or object storage (S3-compatible) for attachments.
- Static sites are free.

## Steps
1. **Source code**: Render deploys from a Git repository that you set up yourself. Make sure `.env` files are never included.
2. **Create Blueprint**: Render Dashboard > New > Blueprint > select the repo. Render reads `render.yaml` and proposes: database `taskflow-db`, web `taskflow-api`, cron `taskflow-reminders`, static `taskflow-web`.
3. **Database**: created by the Blueprint. `DATABASE_URL` is wired automatically to the API and cron job.
4. **API**: build `pip install -r requirements.txt`, pre-deploy `alembic upgrade head`, start `uvicorn app.main:app --host 0.0.0.0 --port $PORT --proxy-headers --forwarded-allow-ips="*"`, health check `/health`.
5. **Static site**: build `npm ci && npm run build`, publish `dist`, rewrite `/*` to `/index.html`.
6. **Environment variables** (prompted for `sync: false` ones):
   - API: `CORS_ORIGINS` = your static site URL (exact origin, no trailing slash), `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (`mailto:...`), optional `ANTHROPIC_API_KEY`. `SECRET_KEY` is generated.
   - Cron: same VAPID/Anthropic values and the **same `SECRET_KEY` as the API** (copy it from the API's env page).
   - Static: `VITE_API_URL` = API URL, `VITE_VAPID_PUBLIC_KEY`. Changing these requires a rebuild/redeploy.
   - Generate VAPID keys as described in README.md.
7. **Cron**: `taskflow-reminders`, schedule `* * * * *`, command `python -m app.worker`. Confirm it is on a paid plan and check its logs after a few minutes.
8. **Migrations**: run automatically via preDeployCommand. Manually: API service > Shell > `alembic upgrade head`.
9. **Test auth**: open the static URL, register, log out, log in, reload (session persists via refresh token).
10. **Test notifications**: Settings > enable notifications, allow the browser prompt, press the test notification button. Then create a task with a reminder 2 minutes ahead and watch for it (needs the cron job). On iOS, install to Home Screen first.

## Verification checklist
- [ ] `https://<api>/health` returns `{"status":"ok","db":true}`
- [ ] `https://<api>/docs` loads
- [ ] Static site loads; deep link (e.g. `/tasks`) reloads without 404
- [ ] Register/login/logout works; no CORS errors in the browser console
- [ ] Create, edit, complete, delete a task; data persists after reload
- [ ] Cron job runs every minute with no errors in logs
- [ ] Test notification appears in-app; push appears on a subscribed device
- [ ] Reminder fires at the expected time
- [ ] Attachment upload works and survives a redeploy (only with persistent disk/object storage)
- [ ] Live URL recorded here: `________` (do not claim deployment before this is filled)

## Troubleshooting
- **CORS errors**: `CORS_ORIGINS` must exactly match the site origin; redeploy the API.
- **Frontend calls localhost / wrong API**: `VITE_API_URL` was unset at build time; set it and redeploy.
- **Migrations fail**: check `DATABASE_URL` in logs; `postgres://` is normalized by the app, run `alembic upgrade head` in Shell.
- **First request very slow**: free service waking up.
- **No push**: missing VAPID keys, permission denied, expired subscription, cron not running, or iOS not installed as PWA.
- **Reminders late/missing**: cron job not running or not on a paid plan; check `SECRET_KEY`/`DATABASE_URL` set on cron.
- **Uploads vanish**: ephemeral disk; add persistent disk or object storage.
- **Database gone**: free Postgres expired; upgrade and restore.
