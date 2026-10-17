# Jira-style module – shared contract (backend + frontend must follow exactly)

New, independent domain next to the existing personal planner (do NOT modify/break existing tables, routes or tests).
All routes under `/api/jira`, Bearer JWT (existing `get_current_user`). Tests run on SQLite, prod on Postgres (portable types only).

## Data model (new tables, alembic revision `0002_jira`, down_revision `0001`)
- `jira_projects`: id, key (str 2-10, A-Z0-9, unique, uppercase), name, description, lead_id→users, issue_seq (int, last issued number), created_at, updated_at.
- `jira_members`: id, project_id, user_id, role (`admin`|`member`|`viewer`), unique(project_id,user_id). Creator = admin.
- `jira_columns` (workflow statuses, ordered): id, project_id, name, category (`todo`|`in_progress`|`done`), position. Defaults on project create: "To Do"(todo), "In Progress"(in_progress), "In Review"(in_progress), "Done"(done).
- `jira_sprints`: id, project_id, name, goal, state (`planned`|`active`|`closed`), start_date, end_date, completed_at. Only ONE active sprint per project.
- `jira_issues`: id, project_id, number (per-project, from issue_seq), type (`epic`|`story`|`task`|`bug`|`subtask`), title(200), description(text), column_id→jira_columns, priority (`highest`|`high`|`medium`|`low`|`lowest`, default medium), assignee_id (nullable), reporter_id, parent_id (nullable self FK: epic for story/task/bug, or parent for subtask), sprint_id (nullable → backlog), story_points (int nullable), labels (JSON list[str]), due_date, rank (float, ordering inside column/backlog, lower first), resolved_at, created_at, updated_at. Display key = `{project.key}-{number}`; unique(project_id, number).
- `jira_comments`: id, issue_id, user_id, body, created_at, updated_at.
- `jira_history`: id, issue_id, user_id, field, old_value, new_value (strings), created_at.

## Permissions
viewer: read only. member: create/edit issues, comment, move. admin: also project settings, members, columns, sprints delete, project delete. Non-members get 404 for the project. Only members can be assignee. A user may not remove/demote the last admin (409).

## Endpoints (JSON)
Projects
- `GET /api/jira/projects` → [{id,key,name,description,lead:{id,name},my_role,member_count,issue_count,open_issue_count,active_sprint:{id,name}|null}]
- `POST /api/jira/projects` {key,name,description?} → project (409 if key taken, 422 invalid key)
- `GET /api/jira/projects/{key}` → project + `columns[]`, `members[]` ({user_id,name,email,role}), `sprints[]`
- `PATCH /api/jira/projects/{key}` {name?,description?,lead_id?} (admin); `DELETE` (admin) → 204
- Members (admin): `POST /api/jira/projects/{key}/members` {email,role} (404 "No user with that email" if unregistered; 409 if already member); `PATCH /api/jira/projects/{key}/members/{user_id}` {role}; `DELETE …/members/{user_id}` (unassigns their issues). A member can DELETE themselves (leave).
- Columns (admin): `POST /api/jira/projects/{key}/columns` {name,category}; `PATCH /api/jira/columns/{id}` {name?,category?,position?}; `DELETE /api/jira/columns/{id}?move_to=<column_id>` (409 if issues exist and move_to missing; cannot delete last column).

Issues
- Issue JSON: `{id,key,number,project_key,type,title,description,column_id,status_name,status_category,priority,assignee:{id,name}|null,reporter:{id,name},parent:{id,key,title,type}|null,sprint_id,story_points,labels[],due_date,rank,resolved_at,created_at,updated_at,subtask_count,subtasks_done,comment_count}`; detail GET adds `subtasks[]` (list items w/o nesting) and `epic_children_count`.
- `GET /api/jira/projects/{key}/issues?q&type&status_category&column_id&assignee (user id | "me" | "unassigned")&priority&label&sprint_id (id | "backlog" | "active")&parent_id&sort=(rank|created|updated|priority|due)&order&limit(≤200,default 100)&offset` → list, header `X-Total-Count`. `q` matches title/description/key (case-insens; "TF-12" form works).
- `POST /api/jira/projects/{key}/issues` {type,title,description?,column_id?(default first column),priority?,assignee_id?,parent_id?,sprint_id?,story_points?,labels?,due_date?} → issue (201). Validate: subtask requires parent (non-subtask, non-epic); epic cannot have parent; parent same project; sprint not closed; assignee is member. rank = max rank in target +1000.
- `GET /api/jira/issues/{key}` (e.g. `TF-12`; key unique globally via project key) → detail. `PATCH /api/jira/issues/{key}` any writable field above (write history rows per changed field; moving into a `done`-category column sets resolved_at, out of it clears). `DELETE` (member+, 204; deleting epic detaches children; deleting parent deletes subtasks).
- `POST /api/jira/issues/{key}/move` {column_id, before_issue_id?|after_issue_id?} (board drag-drop; recompute rank between neighbours, renumber column if gaps collapse).
- `POST /api/jira/issues/{key}/rank` {sprint_id|null, before_issue_id?|after_issue_id?} (backlog drag-drop between sprint/backlog).
- Comments: `GET/POST /api/jira/issues/{key}/comments` {body}; `PATCH/DELETE /api/jira/comments/{id}` (author or admin). `@email` or `@Name` mentions are NOT required; but notify assignee+reporter on comment (not the author).
- History: `GET /api/jira/issues/{key}/history` → [{id,user:{id,name},field,old_value,new_value,created_at}].
- Notifications: reuse existing `Notification` model/`services.notifications` (dedupe key `jira:assigned:<issue_id>:<user_id>:<ts>` style so repeats are allowed): notify on assignment to someone else, on comment (assignee/reporter), on added to project. type=`jira`, data={issue_key}.

Sprints
- `GET /api/jira/projects/{key}/sprints` → [{id,name,goal,state,start_date,end_date,issue_count,points_total,points_done}]
- `POST /api/jira/projects/{key}/sprints` {name,goal?,start_date?,end_date?} (member+); `PATCH /api/jira/sprints/{id}` ; `DELETE` (admin; issues go to backlog)
- `POST /api/jira/sprints/{id}/start` {start_date?,end_date?} (409 if another active); `POST /api/jira/sprints/{id}/complete` {move_open_to: "backlog"|<sprint_id>} → closed; open (non-done) issues moved as requested.
- `GET /api/jira/sprints/{id}/report` → {committed_points,completed_points,issues_total,issues_done,burndown:[{date,remaining_points}]} (burndown from resolved_at; ideal line optional).

Board / misc
- `GET /api/jira/projects/{key}/board?sprint_id=active|<id>&assignee&label&q` → `{sprint:{…}|null, columns:[{id,name,category,position,issues:[Issue…]}]}` (active sprint by default; if none active, show whole project excluding backlog? → no: return sprint null and all non-backlog-less issues = issues with sprint_id null excluded; use `?sprint_id=all` to show every issue). Subtasks appear as cards too.
- `GET /api/jira/projects/{key}/summary` → {by_status_category, by_type, by_priority, by_assignee:[{user,count}], created_vs_resolved_14d:[{date,created,resolved}]}
- `GET /api/jira/my-issues?status_category=open|done` → assigned to me across projects.

Errors: `{"detail": "..."}` 401/403/404/409/422 as appropriate.

## Free-Render adaptation (backend)
- No cron on free plan: add env `RUN_WORKER_IN_PROCESS` (default "1" only when env `RENDER` is set, else "0"); in FastAPI lifespan start a daemon thread/asyncio task that calls the existing worker's one-shot entrypoint every 60s, wrapped in try/except, with a DB advisory-safe guard (idempotent already). Must not run in tests.
- Attachments stay as-is (ephemeral on free). Keep memory low (no heavy deps). Update `render.yaml`: remove the paid cron service, make `taskflow-api` use `runtime: docker`, `dockerfilePath: ./Dockerfile`, `dockerContext: .`, keep db + env (SECRET_KEY generateValue, DATABASE_URL fromDatabase), drop the separate static site (frontend is served by the API container), add `RUN_WORKER_IN_PROCESS=1`. Update RENDER_DEPLOYMENT.md accordingly (free-tier caveats: sleeps after 15 min idle, free Postgres expires after 30 days, ephemeral uploads).
- Optional seed: `POST /api/jira/projects` also creates one default sprint "Sprint 1" (planned).

## Frontend (existing React+Vite+TS+Tailwind app; reuse its components/design tokens/api client/react-query/toasts)
Routes (all behind auth, inside existing Layout; add sidebar section "Projects (Jira)" without removing existing items):
- `/jira` project list + create-project modal (key auto-suggested from name).
- `/jira/:key` redirects to `/jira/:key/board`. Project sub-nav tabs: **Board**, **Backlog**, **Issues**, **Summary**, **Settings**.
- Board: columns from workflow, drag-and-drop cards (use native HTML5 DnD, no new heavy deps) → `/move`; filters (search, assignee avatars, label, type); active sprint header with "Complete sprint"; quick "Create issue" in column.
- Backlog: sprint sections (active/planned) + Backlog list, drag issues between them (`/rank`), create sprint, start/complete sprint (dialogs), story-point totals per section, inline quick-create.
- Issues: filterable/searchable table (type, status, assignee, priority, labels), click opens issue detail.
- Issue detail (modal/side panel + deep link `/jira/:key/issue/:issueKey`): editable title/description, status dropdown, assignee, priority, type, sprint, story points, labels, due date, parent/epic, subtasks list (add/toggle), comments (add/edit/delete), history tab.
- Summary: simple charts using the existing chart lib (recharts) from `/summary` and sprint report burndown.
- Settings: project name/description, members (add by email, change role, remove), workflow columns (add/rename/reorder/delete), delete project (admin only; hide controls for non-admins).
- `my-issues` page `/jira/my-issues`.
Issue type/priority get distinct icon+color badges. Empty/loading/error states everywhere. No fake buttons. Add types to `src/lib/types.ts` (or new `src/lib/jiraTypes.ts`) and API methods in new `src/lib/jiraApi.ts` using the existing request helper.

## Ownership (avoid edit conflicts)
- Backend agent: `backend/**` (+ `render.yaml`, `RENDER_DEPLOYMENT.md`, `README.md`). Frontend agent: `frontend/**` only. Neither runs git; no commits. Backend must add pytest tests (`backend/tests/test_jira.py`) and keep the whole suite green; frontend must keep `npm run build` (tsc + vite) green.
