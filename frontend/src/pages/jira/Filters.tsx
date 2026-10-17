import { useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Download, HelpCircle, Play, Save, Trash2, Upload } from 'lucide-react';
import EmptyState from '../../components/EmptyState';
import ErrorBanner from '../../components/ErrorBanner';
import Modal from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { Popover } from '../../components/ui/Popover';
import { jiraApi, saveBlob } from '../../lib/jiraApi';
import type { SavedFilter } from '../../lib/jiraTypes';
import { useProjectCtx } from '../../features/jira/ctx';
import { IssueTable } from '../../features/jira/IssueTable';
import { useErrToast, useRefreshJira } from '../../features/jira/hooks';
import { canEdit } from '../../features/jira/ui';

const FIELDS = ['project', 'key', 'type', 'status', 'statusCategory', 'assignee', 'reporter', 'priority', 'label', 'sprint', 'component', 'fixVersion', 'parent', 'epic', 'created', 'updated', 'resolved', 'due', 'text', 'flagged', 'blocked'];
const EXAMPLES = ['assignee = currentUser() AND statusCategory != done', 'type = bug AND priority in (high, highest) ORDER BY created DESC', 'due < now() AND statusCategory != done', 'text ~ "login" AND updated >= -7d', 'sprint in openSprints() AND flagged = true'];
const PAGE = 50;

function ImportDialog({ projectKey, onClose }: { projectKey: string; onClose: () => void }) {
  const refresh = useRefreshJira();
  const errToast = useErrToast();
  const [file, setFile] = useState<File | null>(null);
  const m = useMutation({ mutationFn: () => jiraApi.importCsv(projectKey, file as File), onSuccess: () => refresh(), onError: (e) => errToast(e, 'Import failed') });
  return (
    <Modal open onClose={onClose} title="Import issues from CSV" footer={<><button className="btn-ghost" onClick={onClose}>{m.data ? 'Close' : 'Cancel'}</button>{!m.data && <button className="btn-primary" disabled={!file || m.isPending} onClick={() => m.mutate()}>{m.isPending ? 'Importing...' : 'Import'}</button>}</>}>
      <p className="mb-3 text-sm text-fg-muted">Columns: <code>type,title,description,priority,assignee_email,labels,story_points,due_date,status</code>. Up to 500 rows.</p>
      <label className="label" htmlFor="imp-f">CSV file</label>
      <input id="imp-f" type="file" accept=".csv,text/csv" className="input" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      {m.data && <div className="mt-3 space-y-1 text-sm" role="status"><p className="font-medium text-success">{m.data.created} issue(s) created.</p>
        {(m.data.errors ?? []).length > 0 && <ul className="max-h-40 overflow-auto text-danger">{(m.data.errors ?? []).map((er, i) => <li key={i}>Row {er.row}: {er.detail}</li>)}</ul>}</div>}
    </Modal>
  );
}

export default function Filters() {
  const { project, openIssue } = useProjectCtx();
  const toast = useToast();
  const errToast = useErrToast();
  const [jql, setJql] = useState('statusCategory != done ORDER BY updated DESC');
  const [run, setRun] = useState<string | null>('statusCategory != done ORDER BY updated DESC');
  const [page, setPage] = useState(0);
  const [saving, setSaving] = useState(false);
  const [fname, setFname] = useState('');
  const [shared, setShared] = useState(false);
  const [importing, setImporting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const editable = canEdit(project.my_role);

  const res = useQuery({ queryKey: ['jira', 'issues', project.key, 'jql', run, page], queryFn: () => jiraApi.listIssues(project.key, { jql: run ?? undefined, limit: PAGE, offset: page * PAGE }), enabled: run !== null, retry: false, placeholderData: (p) => p });
  const filters = useQuery({ queryKey: ['jira', 'filters'], queryFn: jiraApi.filters });
  const saveF = useMutation({
    mutationFn: () => jiraApi.addFilter({ name: fname.trim(), jql, shared, project_id: project.id }),
    onSuccess: () => { filters.refetch(); setSaving(false); setFname(''); toast('Filter saved'); }, onError: (e) => errToast(e, 'Could not save filter'),
  });
  const delF = useMutation({ mutationFn: (f: SavedFilter) => jiraApi.deleteFilter(f.id), onSuccess: () => filters.refetch(), onError: (e) => errToast(e, 'Could not delete filter') });

  const exec = () => { setPage(0); setRun(jql.trim()); };
  const word = /([A-Za-z]+)$/.exec(jql)?.[1] ?? '';
  const sugg = word.length >= 1 ? FIELDS.filter((f) => f.toLowerCase().startsWith(word.toLowerCase()) && f !== word).slice(0, 6) : [];
  const exportCsv = async () => { try { saveBlob(await jiraApi.exportCsv(project.key, run || undefined), `${project.key}-issues.csv`); } catch (e) { errToast(e, 'Export failed'); } };
  const total = res.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const mine = (filters.data ?? []).filter((f) => !f.project_id || f.project_id === project.id);

  return (
    <div className="space-y-4">
      <div className="card space-y-2 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="jql">JQL query</label>
          <input id="jql" ref={inputRef} className="input min-w-60 flex-1 font-mono text-sm" placeholder='e.g. assignee = currentUser() AND status != "Done"' value={jql} onChange={(e) => setJql(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') exec(); }} />
          <button className="btn-primary" onClick={exec}><Play size={15} />Search</button>
          <Popover width="w-[22rem]" trigger={(p) => <button {...p} className="icon-btn" aria-label="JQL help"><HelpCircle size={18} /></button>}>
            {() => <div className="space-y-2 p-4 text-sm">
              <p className="font-semibold">JQL-lite</p>
              <p className="text-xs text-fg-muted">field operator value, joined with AND / OR and parentheses. Optional ORDER BY field ASC|DESC.</p>
              <p className="text-xs"><strong>Fields:</strong> {FIELDS.join(', ')}</p>
              <p className="text-xs"><strong>Operators:</strong> = != ~ !~ &lt; &lt;= &gt; &gt;= in, not in, is empty, is not empty</p>
              <p className="text-xs"><strong>Functions:</strong> currentUser(), now(), startOfDay(), -7d, -2w, openSprints()</p>
              <ul className="space-y-1">{EXAMPLES.map((x) => <li key={x}><button className="w-full rounded bg-surface-2 px-2 py-1 text-left font-mono text-caption hover:bg-accent-soft" onClick={() => { setJql(x); inputRef.current?.focus(); }}>{x}</button></li>)}</ul>
            </div>}
          </Popover>
        </div>
        {sugg.length > 0 && <div className="flex flex-wrap gap-1" aria-label="Field suggestions">{sugg.map((f) => <button key={f} className="chip hover:bg-accent-soft" onClick={() => { setJql(jql.slice(0, jql.length - word.length) + f + ' '); inputRef.current?.focus(); }}>{f}</button>)}</div>}
        <div className="flex flex-wrap items-center gap-2">
          {editable && <button className="btn-ghost !py-1" onClick={() => setSaving(true)} disabled={!jql.trim()}><Save size={14} />Save filter</button>}
          <button className="btn-ghost !py-1" onClick={exportCsv}><Download size={14} />Export CSV</button>
          {editable && <button className="btn-ghost !py-1" onClick={() => setImporting(true)}><Upload size={14} />Import CSV</button>}
        </div>
      </div>

      {mine.length > 0 && <div className="flex flex-wrap items-center gap-2" aria-label="Saved filters"><span className="text-xs font-medium text-fg-muted">Saved:</span>
        {mine.map((f) => <span key={f.id} className="inline-flex items-center rounded-full border border-line text-sm">
          <button className="px-3 py-1 hover:text-accent" onClick={() => { setJql(f.jql); setPage(0); setRun(f.jql); }}>{f.name}{f.shared ? ' (shared)' : ''}</button>
          <button className="icon-btn !h-7 !w-7" aria-label={`Delete filter ${f.name}`} onClick={() => delF.mutate(f)}><Trash2 size={12} /></button></span>)}</div>}

      {res.error && <ErrorBanner error={res.error} onRetry={() => res.refetch()} />}
      {res.isLoading ? <p className="text-sm text-fg-muted" role="status">Searching...</p>
        : !res.error && (res.data?.items ?? []).length === 0 ? <EmptyState title="No issues match" hint="Adjust the query and try again." />
          : res.data && <>
            <IssueTable issues={res.data.items} onOpen={(i) => openIssue(i.key)} sprints={project.sprints} />
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-fg-muted"><span>{total} issue{total === 1 ? '' : 's'}</span>
              {pages > 1 && <span className="flex items-center gap-2"><button className="btn-ghost !py-1" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button><span>Page {page + 1} of {pages}</span><button className="btn-ghost !py-1" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>Next</button></span>}</div></>}

      <Modal open={saving} onClose={() => setSaving(false)} title="Save filter" footer={<><button className="btn-ghost" onClick={() => setSaving(false)}>Cancel</button><button className="btn-primary" disabled={!fname.trim() || saveF.isPending} onClick={() => saveF.mutate()}>Save</button></>}>
        <div className="space-y-3"><div><label className="label" htmlFor="sf-n">Name</label><input id="sf-n" className="input" value={fname} onChange={(e) => setFname(e.target.value)} /></div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-[rgb(var(--accent))]" checked={shared} onChange={(e) => setShared(e.target.checked)} />Share with project members</label></div>
      </Modal>
      {importing && <ImportDialog projectKey={project.key} onClose={() => setImporting(false)} />}
    </div>
  );
}
