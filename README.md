# Taskflow_ai

Personal task planner (FastAPI + React) with a Jira-style projects module (boards, backlog, sprints, issues,
members, comments, notifications) under `/api/jira`.

## Run locally
- Backend: `cd backend && pip install -r requirements.txt && alembic upgrade head && uvicorn app.main:app --reload`
- Tests: `cd backend && python -m pytest`
- Frontend: `cd frontend && npm ci && npm run dev`
- Reminder worker: `python -m app.worker` (one-shot, run it every minute), or set `RUN_WORKER_IN_PROCESS=1` to
  run it in a background thread of the API (default on Render, off elsewhere and in tests).

## Deploy on Render (free plan)
`render.yaml` defines one Docker web service (API + built frontend) and one free Postgres; the worker runs
inside the API process because free plans have no cron jobs. See [RENDER_DEPLOYMENT.md](RENDER_DEPLOYMENT.md)
for steps and free-tier caveats (sleeps after 15 min idle, free Postgres expires after ~30 days, ephemeral uploads).

## Jira module v2 (backend)
Adds invitations (pending invites auto-accepted on sign-up/login), issue links, watchers and `@[user:ID]` mentions, components, versions/releases, time tracking, DB-stored attachments, JQL-lite search with saved filters (`GET /api/jira/search?jql=`), workflow transitions and WIP limits, kanban projects, custom fields, roadmap/reports/activity/dashboard, bulk edit, clone, move between projects and CSV import/export. Optional SMTP email is configured through `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`, `SMTP_TLS` (see `RENDER_DEPLOYMENT.md`). Tests: `backend/tests/test_jira2.py`.
