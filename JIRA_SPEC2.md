# Jira module v2 – additions (extends JIRA_SPEC.md; keep everything there working; shared contract)

Everything must stay FREE: no paid services, no new heavy deps, runs on Render free (512MB, ephemeral disk) + Neon free Postgres. Persist ALL user data in the database (no local disk). Alembic revision `0003_jira_v2` (down_revision `0002`), portable SQLite/Postgres types. Existing 62 tests must stay green; add tests in `backend/tests/test_jira2.py`.

## 1. Invitations (assign ANY person)
- Table `jira_invites`: id, project_id, email (lowercase), role, invited_by, created_at; unique(project_id,email).
- `POST /api/jira/projects/{key}/members` {email, role}: if a user exists → added immediately (as before). If NOT registered → creates a pending invite and returns `{"invited": true, "email": ..., "role": ...}` (201), NOT 404.
- `GET /api/jira/projects/{key}/invites` (admin) → list; `DELETE /api/jira/invites/{id}` (admin).
- On registration (`/api/auth/register`) with a matching email: convert all pending invites to memberships + notification. Also on login (idempotent safety net).
- Issues can be assigned to a *pending* invitee? NO — only members. But UI must make it obvious: "Invite sent; they can be assigned after they sign up".
- `GET /api/jira/people?q=` (min 2 chars) → up to 8 users (id,name,email) who share at least one jira project with the caller (for typeahead / @mentions). Never lists other users.
- Project setting `GET/PATCH .../projects/{key}` gains `board_type` (`scrum`|`kanban`, default scrum; settable on create), `enforce_workflow` (bool), `default_assignee_id` (nullable member), `archived` (bool; archived projects are read-only and hidden from default list; `GET /projects?include_archived=1`).

## 2. Issue fields added (jira_issues columns)
`start_date`, `original_estimate_min`, `remaining_estimate_min` (ints), `flagged` (bool), `archived` (bool, hidden from lists unless `include_archived=1`), `fix_version_id` (nullable), `custom_fields` (JSON dict {field_id: value}), `environment` (text). Issue JSON gains these + `component_ids[]`, `components[{id,name}]`, `fix_version:{id,name}|null`, `watchers_count`, `is_watching` (for caller), `time_spent_min` (sum of worklogs), `links[]`, `attachment_count`. All writable via PATCH/POST except computed ones. History rows for every changed field.

## 3. Issue links
Table `jira_links`: id, source_id, target_id, link_type (`blocks`|`relates`|`duplicates`|`clones`), created_by. `POST /api/jira/issues/{key}/links` {link_type, target_key} (cross-project allowed if caller is member of both; no self link; no duplicates). `DELETE /api/jira/links/{id}`. Issue detail `links[]` = [{id, direction_label ("blocks"|"is blocked by"|"relates to"|"duplicates"|"is duplicated by"|"clones"|"is cloned by"), issue:{id,key,title,status_name,status_category,type}}]. Board/list cards expose `blocked` (true if any open blocker).

## 4. Watchers & mentions
- `POST /api/jira/issues/{key}/watch`, `DELETE …/watch`, `GET …/watchers` → [{id,name}]. Creator, reporter and assignee auto-watch. Watchers get in-app notifications for comments, status changes, assignment (not their own actions).
- Mentions: comment bodies may contain `@[user:ID]` tokens (frontend inserts via typeahead). Backend notifies mentioned members (type `jira`, dedupe per comment+user) and auto-adds them as watchers. `GET comments` returns `mentions:[{id,name}]`.

## 5. Components & versions (releases)
- Components: `GET/POST /api/jira/projects/{key}/components` {name, description?, lead_id?}; `PATCH/DELETE /api/jira/components/{id}` (admin). Issues have many components (`component_ids` in POST/PATCH; join table `jira_issue_components`).
- Versions: `GET/POST /api/jira/projects/{key}/versions` {name, description?, start_date?, release_date?}; `PATCH/DELETE /api/jira/versions/{id}`; `POST /api/jira/versions/{id}/release` {move_open_to_version_id?|null}; GET returns `issue_count`, `done_count`, `released`, `released_at`. Issue field `fix_version_id`.

## 6. Time tracking
Table `jira_worklogs`: id, issue_id, user_id, seconds, started_at, comment. `GET/POST /api/jira/issues/{key}/worklogs` {minutes, started_at?, comment?} (member+); `PATCH/DELETE /api/jira/worklogs/{id}` (author/admin). POST reduces `remaining_estimate_min` by minutes (min 0) if set. `GET /api/jira/projects/{key}/time-report?from&to` → [{user,minutes,issues}].

## 7. Attachments (stored IN the DB so they survive Render's ephemeral disk)
Table `jira_attachments`: id, issue_id, user_id, filename, content_type, size, data (LargeBinary), created_at. Limits: 2 MB/file, 10 per issue, extension allow-list (png jpg jpeg gif webp pdf txt md csv json docx xlsx pptx zip). `POST /api/jira/issues/{key}/attachments` multipart; `GET /api/jira/attachments/{id}` (download, `Content-Disposition: attachment`, `nosniff`; images allowed `?inline=1` only for png/jpg/gif/webp); `DELETE /api/jira/attachments/{id}` (uploader/admin). List in issue detail `attachments[{id,filename,size,content_type,user,created_at}]`. Never load `data` in list queries (defer).

## 8. Search (JQL-lite) + saved filters
- `GET /api/jira/search?jql=&limit&offset&include_archived` (across all projects the caller belongs to; also `GET /projects/{key}/issues?jql=`) → issues + `X-Total-Count`. Implement a safe hand-written parser (NO eval, NO raw SQL): `field op value` joined by `AND`/`OR` with parentheses, optional `ORDER BY field [ASC|DESC]`. Fields: project, key, type, status, statusCategory, assignee, reporter, priority, label, sprint, component, fixVersion, parent/epic, created, updated, resolved, due, text, flagged, blocked. Operators: `= != ~ !~ < <= > >= in not in is empty is not empty`. Functions: `currentUser()`, `now()`, `startOfDay()`, `-7d`/`-2w` relative dates, `openSprints()`. Invalid JQL → 422 with human message and position.
- Saved filters: table `jira_filters` (id, owner_id, name, jql, shared bool, project_id nullable). `GET/POST /api/jira/filters`, `PATCH/DELETE /api/jira/filters/{id}` (owner). `GET` returns own + shared-in-my-projects.

## 9. Workflow, WIP, kanban
- Column gains `wip_limit` (int|null). Board response includes `wip_limit` and `over_wip` per column (warn only; never block).
- `enforce_workflow`: table `jira_transitions` (project_id, from_column_id, to_column_id). `GET/PUT /api/jira/projects/{key}/workflow` {transitions:[{from,to}]} (admin). When `enforce_workflow` is true, move/PATCH to a column requires a transition (or same column) else 409 listing allowed targets. Issue JSON gains `allowed_column_ids[]` (all columns when not enforced).
- Kanban projects (`board_type=kanban`): sprints endpoints return 409; issues ignore sprint_id; board shows all non-archived issues.

## 10. Custom fields
Table `jira_custom_fields`: id, project_id, name, field_type (`text`|`number`|`select`|`date`|`checkbox`), options JSON (for select), required bool, position. `GET/POST /api/jira/projects/{key}/custom-fields`, `PATCH/DELETE /api/jira/custom-fields/{id}` (admin). Issue `custom_fields` validated against definitions (type-checked; required enforced on create).

## 11. Roadmap, reports, dashboards, activity
- `GET /api/jira/projects/{key}/roadmap` → epics [{issue, start_date, due_date, children_total, children_done, percent, version}] sorted by start.
- `GET /api/jira/projects/{key}/reports/velocity?n=8` → closed sprints [{sprint, committed_points, completed_points}] + average; `…/reports/created-vs-resolved?days=30`; `…/reports/resolution-time` → {avg_days, median_days, by_type[]}; `…/reports/workload` → [{user, open_issues, open_points, remaining_minutes}]; `…/reports/cfd?days=30` → daily counts per column built from history (approximate is OK; document it).
- `GET /api/jira/projects/{key}/activity?limit` and `GET /api/jira/activity?limit` (all my projects) → merged feed from history + comments + created issues: [{type, user, issue:{key,title}, text, created_at}].
- `GET /api/jira/dashboard` → {assigned_to_me_open, due_soon[], recently_updated[], my_projects[], watching[], worklog_minutes_week}.

## 12. Bulk, clone, move, import/export
- `POST /api/jira/projects/{key}/issues/bulk` {issue_keys[], action: "update"|"delete"|"archive"|"unarchive", patch?:{assignee_id?,priority?,column_id?,sprint_id?,labels_add?[],labels_remove?[],fix_version_id?,component_ids?}} → {updated: n, failed:[{key,detail}]} (member+, max 100).
- `POST /api/jira/issues/{key}/clone` {include_subtasks?: bool, title_prefix?} → new issue (+ `clones` link).
- `POST /api/jira/issues/{key}/move-project` {project_key, column_id?} → new key (renumber, map column by category/name, clear sprint/epic/components/version, history row; caller member+ in both).
- `GET /api/jira/projects/{key}/issues/export?format=csv` (respects `jql`); `POST /api/jira/projects/{key}/issues/import` (multipart CSV: columns type,title,description,priority,assignee_email,labels,story_points,due_date,status; max 500 rows; returns {created, errors:[{row,detail}]}).

## 13. Optional email (free via any SMTP, off by default)
Env `SMTP_HOST,SMTP_PORT,SMTP_USER,SMTP_PASSWORD,SMTP_FROM,SMTP_TLS`; when `SMTP_HOST` set, send plain-text emails (daemon thread, never block/raise) for: invited, assigned, mentioned. Users can opt out: add `jira_email_notifications` bool to UserPreferences (default true) exposed in /api/settings. Not set → in-app + web push only.

## 14. Permissions summary (unchanged roles)
viewer read-only; member everything on issues/comments/worklogs/attachments/links/filters; admin: members, invites, columns, workflow, components, versions, custom fields, sprints delete, archive/delete project. Archived project → all writes 409.

## Frontend deliverables (must expose EVERY feature above; no fake buttons)
- Members/Settings: invite by email (shows pending invites with revoke), typeahead via `/people`, board type + enforce-workflow toggle + default assignee + archive project, WIP limits, workflow transitions editor, components, versions (release flow), custom fields manager, labels view.
- Issue detail: all new fields (start date, estimates, flagged, components, fix version, environment, custom fields), links section (add/remove with issue search), watchers (watch toggle + list), worklogs (log work dialog + list + progress bar original/remaining/spent), attachments (upload/drag-drop, image preview, delete), mentions typeahead in comments, clone, move to project, archive, delete.
- Board: blocked/flagged markers, WIP indicators, kanban mode (no sprint UI, hide Backlog tab), swimlanes optional toggle by assignee/epic, bulk select mode with action bar.
- Backlog: bulk select; epics panel filter; versions panel.
- New tabs: **Roadmap**, **Releases** (versions), **Reports** (velocity, created-vs-resolved, resolution time, workload, CFD, time report), **Activity**, **Filters/Search** (JQL box with help popover + autocompletion of field names, save/share filter, results table, export CSV, import CSV dialog).
- Global: `/jira` dashboard section (Your work: assigned, watching, due soon, recent activity), global quick search (`/` key) and `c` to create issue, top-bar issue-key jump (type `TF-12` + Enter), notification links go to the issue.
- Add to existing "Assign to project" modal: invite email option.
- Accessibility, dark mode, mobile layout as before. Lazy-load the heavy Jira pages with React.lazy to keep the main bundle from growing.

## Ownership
Backend agent: `backend/**`, README/RENDER_DEPLOYMENT notes (document SMTP + free-tier DB attachment storage limits; Neon free 0.5GB). Frontend agent: `frontend/**`. No git commands by agents. Backend: full suite green + new tests; alembic upgrade/downgrade verified on fresh SQLite. Frontend: `npm run build` green.
