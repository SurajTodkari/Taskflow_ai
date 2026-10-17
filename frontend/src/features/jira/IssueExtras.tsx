import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Eye, EyeOff, Paperclip, Plus, Trash2, X } from 'lucide-react';
import Modal from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { useAuth } from '../../lib/auth';
import { jiraApi, saveBlob } from '../../lib/jiraApi';
import { fmtMinutes, type Attachment, type CustomField, type IssueDetail, type JiraComment, type JiraProjectDetail, type PersonRef } from '../../lib/jiraTypes';
import { useErrToast, useRefreshJira } from './hooks';
import { StatusPill, TypeIcon, canEdit, issuePath } from './ui';

/* ---------- mentions ---------- */
export interface MentionPick { id: number; name: string }

export function encodeMentions(body: string, picks: MentionPick[]): string {
  let out = body;
  // longest names first so "Ann Lee" wins over "Ann"
  [...picks].sort((a, b) => b.name.length - a.name.length).forEach((p) => { out = out.split(`@${p.name}`).join(`@[user:${p.id}]`); });
  return out;
}
export function decodeMentions(body: string, mentions?: { id: number; name: string }[]): ReactNode[] {
  const parts = body.split(/(@\[user:\d+\])/g);
  return parts.map((s, i) => {
    const m = /^@\[user:(\d+)\]$/.exec(s);
    if (!m) return s;
    const name = mentions?.find((x) => x.id === Number(m[1]))?.name ?? `user ${m[1]}`;
    return <span key={i} className="rounded bg-accent-soft px-1 font-medium text-accent">@{name}</span>;
  });
}

export function MentionTextarea({ id, value, onChange, picks, onPick, rows = 2, placeholder, ariaLabel }: {
  id?: string; value: string; onChange: (v: string) => void; picks: MentionPick[]; onPick: (p: MentionPick) => void; rows?: number; placeholder?: string; ariaLabel?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<PersonRef[]>([]);
  useEffect(() => {
    if (q.length < 2) { setResults([]); return; }
    let live = true;
    const t = setTimeout(() => { jiraApi.people(q).then((r) => { if (live) setResults(r); }).catch(() => { if (live) setResults([]); }); }, 200);
    return () => { live = false; clearTimeout(t); };
  }, [q]);
  const detect = (v: string, caret: number) => {
    const m = /(?:^|\s)@([\w.-]*)$/.exec(v.slice(0, caret));
    setQ(m ? m[1] : '');
  };
  const choose = (p: PersonRef) => {
    const el = ref.current;
    const caret = el?.selectionStart ?? value.length;
    const before = value.slice(0, caret).replace(/@([\w.-]*)$/, `@${p.name} `);
    onChange(before + value.slice(caret));
    onPick({ id: p.id, name: p.name });
    setQ(''); setResults([]);
    requestAnimationFrame(() => el?.focus());
  };
  void picks;
  return (
    <div className="relative">
      <textarea ref={ref} id={id} aria-label={ariaLabel} className="input" rows={rows} placeholder={placeholder} value={value}
        onChange={(e) => { onChange(e.target.value); detect(e.target.value, e.target.selectionStart); }}
        onKeyDown={(e) => { if (e.key === 'Escape' && results.length) { e.stopPropagation(); setResults([]); setQ(''); } }} />
      {results.length > 0 && (
        <ul role="listbox" aria-label="Mention suggestions" className="absolute left-0 z-20 mt-1 max-h-48 w-64 overflow-auto rounded-xl border border-line bg-surface p-1 shadow-pop">
          {results.map((p) => <li key={p.id}><button type="button" role="option" aria-selected={false} className="block w-full rounded-lg px-2 py-1.5 text-left text-sm hover:bg-surface-2" onMouseDown={(e) => e.preventDefault()} onClick={() => choose(p)}>{p.name}{p.email && <span className="ml-2 text-xs text-fg-muted">{p.email}</span>}</button></li>)}
        </ul>)}
    </div>
  );
}

/* ---------- watchers ---------- */
export function WatchBox({ issue }: { issue: IssueDetail }) {
  const refresh = useRefreshJira();
  const errToast = useErrToast();
  const [open, setOpen] = useState(false);
  const list = useQuery({ queryKey: ['jira', 'watchers', issue.key], queryFn: () => jiraApi.watchers(issue.key), enabled: open });
  const toggle = useMutation({
    mutationFn: () => (issue.is_watching ? jiraApi.unwatch(issue.key) : jiraApi.watch(issue.key)),
    onSuccess: () => refresh(), onError: (e) => errToast(e, 'Could not update watch'),
  });
  return (
    <div>
      <div className="flex items-center gap-2">
        <button type="button" className="btn-ghost !py-1 text-xs" aria-pressed={!!issue.is_watching} disabled={toggle.isPending} onClick={() => toggle.mutate()}>
          {issue.is_watching ? <><EyeOff size={13} />Unwatch</> : <><Eye size={13} />Watch</>}</button>
        <button type="button" className="text-xs text-fg-muted hover:text-fg hover:underline" aria-expanded={open} onClick={() => setOpen(!open)}>{issue.watchers_count ?? 0} watcher{issue.watchers_count === 1 ? '' : 's'}</button>
      </div>
      {open && <ul className="mt-1 space-y-0.5 text-xs text-fg-muted">{list.isLoading ? <li>Loading...</li> : (list.data ?? []).map((w) => <li key={w.id}>{w.name}</li>)}</ul>}
    </div>
  );
}

/* ---------- links ---------- */
const LINK_TYPES = [['blocks', 'blocks'], ['relates', 'relates to'], ['duplicates', 'duplicates'], ['clones', 'clones']] as const;

export function LinksSection({ issue, editable }: { issue: IssueDetail; editable: boolean }) {
  const refresh = useRefreshJira();
  const errToast = useErrToast();
  const [type, setType] = useState<string>('relates');
  const [text, setText] = useState('');
  const [hits, setHits] = useState<{ key: string; title: string }[]>([]);
  useEffect(() => {
    const t = text.trim();
    if (t.length < 2) { setHits([]); return; }
    let live = true;
    const h = setTimeout(() => {
      jiraApi.search(/^[A-Za-z][A-Za-z0-9]*-\d+$/.test(t) ? `key = "${t.toUpperCase()}"` : `text ~ "${t.replace(/"/g, '')}"`, 6)
        .then((r) => { if (live) setHits(r.items.filter((i) => i.key !== issue.key)); }).catch(() => { if (live) setHits([]); });
    }, 250);
    return () => { live = false; clearTimeout(h); };
  }, [text, issue.key]);
  const add = useMutation({
    mutationFn: (target_key: string) => jiraApi.addLink(issue.key, { link_type: type, target_key }),
    onSuccess: () => { refresh(); setText(''); setHits([]); }, onError: (e) => errToast(e, 'Could not add link'),
  });
  const rm = useMutation({ mutationFn: (id: number) => jiraApi.deleteLink(id), onSuccess: () => refresh(), onError: (e) => errToast(e, 'Could not remove link') });
  const links = issue.links ?? [];
  return (
    <section aria-label="Linked issues">
      <h3 className="mb-2 text-sm font-semibold">Linked issues {links.length > 0 && <span className="font-normal text-fg-muted">({links.length})</span>}</h3>
      {links.length === 0 && <p className="text-xs text-fg-muted">No links.</p>}
      <ul className="space-y-1">
        {links.map((l) => (
          <li key={l.id} className="flex items-center gap-2 rounded-lg border border-line px-2.5 py-1.5 text-sm">
            <span className="w-24 shrink-0 text-xs text-fg-muted">{l.direction_label}</span>
            <TypeIcon type={l.issue.type} />
            <Link className="min-w-0 flex-1 truncate hover:text-accent" to={issuePath({ project_key: l.issue.key.split('-')[0], key: l.issue.key })}><span className="mr-1.5 text-xs text-fg-muted">{l.issue.key}</span>{l.issue.title}</Link>
            <StatusPill name={l.issue.status_name} category={l.issue.status_category} />
            {editable && <button className="icon-btn" aria-label={`Remove link to ${l.issue.key}`} onClick={() => rm.mutate(l.id)}><X size={14} /></button>}
          </li>))}
      </ul>
      {editable && (
        <div className="relative mt-2 flex flex-wrap gap-2">
          <select aria-label="Link type" className="input !w-auto !py-1.5" value={type} onChange={(e) => setType(e.target.value)}>{LINK_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          <input aria-label="Find issue to link" className="input min-w-40 flex-1 !py-1.5" placeholder="Search issue by key or text" value={text} onChange={(e) => setText(e.target.value)} />
          {hits.length > 0 && <ul className="absolute left-0 top-full z-20 mt-1 max-h-52 w-full overflow-auto rounded-xl border border-line bg-surface p-1 shadow-pop">
            {hits.map((h) => <li key={h.key}><button type="button" className="block w-full truncate rounded-lg px-2 py-1.5 text-left text-sm hover:bg-surface-2" onClick={() => add.mutate(h.key)}><span className="mr-2 text-xs text-fg-muted">{h.key}</span>{h.title}</button></li>)}</ul>}
        </div>)}
    </section>
  );
}

/* ---------- worklogs ---------- */
export function parseDuration(s: string): number | null {
  const t = s.trim().toLowerCase();
  if (!t) return null;
  if (/^\d+$/.test(t)) return Number(t);
  let total = 0, any = false;
  for (const m of t.matchAll(/(\d+(?:\.\d+)?)\s*([wdhm])/g)) {
    any = true;
    const n = Number(m[1]);
    total += m[2] === 'w' ? n * 2400 : m[2] === 'd' ? n * 480 : m[2] === 'h' ? n * 60 : n;
  }
  return any ? Math.round(total) : null;
}

export function TimeSection({ issue, editable, onEstimate }: { issue: IssueDetail; editable: boolean; onEstimate: (b: { original_estimate_min?: number | null; remaining_estimate_min?: number | null }) => void }) {
  const { user } = useAuth();
  const refresh = useRefreshJira();
  const errToast = useErrToast();
  const [open, setOpen] = useState(false);
  const logs = useQuery({ queryKey: ['jira', 'worklogs', issue.key], queryFn: () => jiraApi.worklogs(issue.key) });
  const rm = useMutation({ mutationFn: (id: number) => jiraApi.deleteWorklog(id), onSuccess: () => refresh(), onError: (e) => errToast(e, 'Could not delete worklog') });
  const spent = issue.time_spent_min ?? 0;
  const orig = issue.original_estimate_min ?? 0;
  const rem = issue.remaining_estimate_min ?? 0;
  const total = spent + rem || orig;
  const pct = total > 0 ? Math.min(100, Math.round((spent / total) * 100)) : 0;
  const [o, setO] = useState(issue.original_estimate_min ? fmtMinutes(issue.original_estimate_min) : '');
  const [r, setR] = useState(issue.remaining_estimate_min ? fmtMinutes(issue.remaining_estimate_min) : '');
  return (
    <section aria-label="Time tracking">
      <h3 className="mb-2 flex items-center justify-between text-sm font-semibold">Time tracking{editable && <button className="btn-ghost !py-1 text-xs" onClick={() => setOpen(true)}><Plus size={13} />Log work</button>}</h3>
      <div className="mb-1 h-1.5 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Time spent"><div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} /></div>
      <p className="text-xs text-fg-muted">Original {fmtMinutes(orig)} · Spent {fmtMinutes(spent)} · Remaining {fmtMinutes(rem)}</p>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <div><label className="label" htmlFor="te-o">Original estimate</label><input id="te-o" className="input !py-1.5" placeholder="e.g. 2h 30m" disabled={!editable} value={o} onChange={(e) => setO(e.target.value)}
          onBlur={() => { const v = parseDuration(o); if (o.trim() && v === null) { setO(fmtMinutes(issue.original_estimate_min)); return; } if ((v ?? null) !== (issue.original_estimate_min ?? null)) onEstimate({ original_estimate_min: v }); }} /></div>
        <div><label className="label" htmlFor="te-r">Remaining</label><input id="te-r" className="input !py-1.5" placeholder="e.g. 1h" disabled={!editable} value={r} onChange={(e) => setR(e.target.value)}
          onBlur={() => { const v = parseDuration(r); if (r.trim() && v === null) { setR(fmtMinutes(issue.remaining_estimate_min)); return; } if ((v ?? null) !== (issue.remaining_estimate_min ?? null)) onEstimate({ remaining_estimate_min: v }); }} /></div>
      </div>
      <ul className="mt-2 space-y-1 text-sm">
        {(logs.data ?? []).map((w) => {
          const mins = w.minutes ?? Math.round((w.seconds ?? 0) / 60);
          const mine = w.user?.id === Number(user?.id) || w.user_id === Number(user?.id);
          return <li key={w.id} className="flex items-center gap-2 rounded-lg border border-line px-2.5 py-1.5">
            <span className="font-medium">{fmtMinutes(mins)}</span><span className="min-w-0 flex-1 truncate text-xs text-fg-muted">{w.user?.name ?? ''}{w.comment ? ` · ${w.comment}` : ''}{w.started_at ? ` · ${new Date(w.started_at).toLocaleDateString()}` : ''}</span>
            {editable && mine && <button className="icon-btn" aria-label="Delete worklog" onClick={() => rm.mutate(w.id)}><Trash2 size={13} /></button>}</li>;
        })}
      </ul>
      {open && <LogWorkDialog issueKey={issue.key} onClose={() => setOpen(false)} />}
    </section>
  );
}

function LogWorkDialog({ issueKey, onClose }: { issueKey: string; onClose: () => void }) {
  const refresh = useRefreshJira();
  const errToast = useErrToast();
  const toast = useToast();
  const [time, setTime] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [comment, setComment] = useState('');
  const [err, setErr] = useState('');
  const m = useMutation({
    mutationFn: (minutes: number) => jiraApi.addWorklog(issueKey, { minutes, started_at: date ? `${date}T09:00:00` : undefined, comment: comment.trim() || undefined }),
    onSuccess: () => { refresh(); toast('Work logged'); onClose(); }, onError: (e) => errToast(e, 'Could not log work'),
  });
  return (
    <Modal open onClose={onClose} title="Log work" footer={<><button className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={m.isPending} onClick={() => { const v = parseDuration(time); if (!v || v <= 0) { setErr('Enter a time like 1h 30m, 45m or 2d'); return; } m.mutate(v); }}>Log</button></>}>
      <div className="space-y-3">
        <div><label className="label" htmlFor="lw-t">Time spent</label><input id="lw-t" className="input" placeholder="1h 30m" value={time} onChange={(e) => { setTime(e.target.value); setErr(''); }} />{err && <p className="mt-1 text-xs text-danger" role="alert">{err}</p>}<p className="mt-1 text-caption text-fg-muted">Use w, d (8h), h and m.</p></div>
        <div><label className="label" htmlFor="lw-d">Date</label><input id="lw-d" type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        <div><label className="label" htmlFor="lw-c">Comment</label><input id="lw-c" className="input" value={comment} onChange={(e) => setComment(e.target.value)} /></div>
      </div>
    </Modal>
  );
}

/* ---------- attachments ---------- */
const IMG = /\.(png|jpe?g|gif|webp)$/i;
const fmtSize = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

function Thumb({ a }: { a: Attachment }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    let u = '';
    let live = true;
    jiraApi.attachmentBlob(a.id, true).then((b) => { if (live) { u = URL.createObjectURL(b); setUrl(u); } }).catch(() => undefined);
    return () => { live = false; if (u) URL.revokeObjectURL(u); };
  }, [a.id]);
  return url ? <img src={url} alt={a.filename} className="h-10 w-10 rounded object-cover" /> : <Paperclip size={16} aria-hidden />;
}

export function AttachmentsSection({ issue, editable }: { issue: IssueDetail; editable: boolean }) {
  const refresh = useRefreshJira();
  const errToast = useErrToast();
  const toast = useToast();
  const [drag, setDrag] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const up = useMutation({
    mutationFn: async (files: File[]) => { for (const f of files) await jiraApi.uploadAttachment(issue.key, f); },
    onSuccess: () => { refresh(); toast('Uploaded'); }, onError: (e) => { refresh(); errToast(e, 'Upload failed'); },
  });
  const rm = useMutation({ mutationFn: (id: number) => jiraApi.deleteAttachment(id), onSuccess: () => refresh(), onError: (e) => errToast(e, 'Could not delete attachment') });
  const dl = async (a: Attachment) => { try { saveBlob(await jiraApi.attachmentBlob(a.id), a.filename); } catch (e) { errToast(e, 'Download failed'); } };
  const list = issue.attachments ?? [];
  return (
    <section aria-label="Attachments">
      <h3 className="mb-2 text-sm font-semibold">Attachments {list.length > 0 && <span className="font-normal text-fg-muted">({list.length})</span>}</h3>
      <ul className="space-y-1">
        {list.map((a) => (
          <li key={a.id} className="flex items-center gap-2 rounded-lg border border-line px-2.5 py-1.5 text-sm">
            {IMG.test(a.filename) ? <Thumb a={a} /> : <Paperclip size={16} aria-hidden />}
            <button className="min-w-0 flex-1 truncate text-left hover:text-accent hover:underline" onClick={() => dl(a)}>{a.filename}</button>
            <span className="text-xs text-fg-muted">{fmtSize(a.size)}</span>
            {editable && <button className="icon-btn" aria-label={`Delete ${a.filename}`} onClick={() => rm.mutate(a.id)}><Trash2 size={13} /></button>}
          </li>))}
      </ul>
      {editable && (
        <div className={`mt-2 rounded-xl border border-dashed px-3 py-3 text-center text-xs text-fg-muted ${drag ? 'border-accent bg-accent-soft' : 'border-line'}`}
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); const fs = Array.from(e.dataTransfer.files); if (fs.length) up.mutate(fs); }}>
          Drop files here or <button type="button" className="text-accent hover:underline" onClick={() => fileRef.current?.click()}>browse</button> (max 2 MB, 10 per issue)
          <input ref={fileRef} type="file" multiple className="sr-only" aria-label="Upload attachment" onChange={(e) => { const fs = Array.from(e.target.files ?? []); if (fs.length) up.mutate(fs); e.target.value = ''; }} />
          {up.isPending && <p className="mt-1">Uploading...</p>}
        </div>)}
    </section>
  );
}

/* ---------- custom fields ---------- */
export function CustomFieldInput({ field, value, disabled, onChange }: { field: CustomField; value: unknown; disabled?: boolean; onChange: (v: unknown) => void }) {
  const id = `cf-${field.id}`;
  const [local, setLocal] = useState(value === undefined || value === null ? '' : String(value));
  const commit = (v: unknown) => onChange(v);
  return (
    <div>
      {field.field_type === 'checkbox'
        ? <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-[rgb(var(--accent))]" disabled={disabled} checked={!!value} onChange={(e) => commit(e.target.checked)} />{field.name}</label>
        : <><label className="label" htmlFor={id}>{field.name}{field.required && ' *'}</label>
          {field.field_type === 'select'
            ? <select id={id} className="input" disabled={disabled} value={String(value ?? '')} onChange={(e) => commit(e.target.value || null)}><option value="">None</option>{(field.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}</select>
            : <input id={id} className="input" disabled={disabled} type={field.field_type === 'number' ? 'number' : field.field_type === 'date' ? 'date' : 'text'} value={local}
              onChange={(e) => { setLocal(e.target.value); if (field.field_type === 'date') commit(e.target.value || null); }}
              onBlur={() => { if (field.field_type === 'date') return; const v = field.field_type === 'number' ? (local.trim() === '' ? null : Number(local)) : (local.trim() || null); if (v !== (value ?? null)) commit(v); }} />}</>}
    </div>
  );
}

/* ---------- clone / move ---------- */
export function CloneMoveDialogs({ issue, project, mode, onClose, onDone }: { issue: IssueDetail; project: JiraProjectDetail; mode: 'clone' | 'move'; onClose: () => void; onDone: (key: string) => void }) {
  const refresh = useRefreshJira();
  const errToast = useErrToast();
  const toast = useToast();
  const projects = useQuery({ queryKey: ['jira', 'projects'], queryFn: () => jiraApi.listProjects(), enabled: mode === 'move' });
  const [subs, setSubs] = useState(true);
  const [prefix, setPrefix] = useState('CLONE - ');
  const [target, setTarget] = useState('');
  const targets = (projects.data ?? []).filter((p) => p.key !== project.key && canEdit(p.my_role));
  const m = useMutation({
    mutationFn: () => mode === 'clone' ? jiraApi.cloneIssue(issue.key, { include_subtasks: subs, title_prefix: prefix }) : jiraApi.moveProject(issue.key, { project_key: target }),
    onSuccess: (i) => { refresh(); toast(mode === 'clone' ? `Created ${i.key}` : `Moved to ${i.key}`); onDone(i.key); }, onError: (e) => errToast(e, mode === 'clone' ? 'Clone failed' : 'Move failed'),
  });
  return (
    <Modal open onClose={onClose} title={mode === 'clone' ? `Clone ${issue.key}` : `Move ${issue.key} to another project`}
      footer={<><button className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={m.isPending || (mode === 'move' && !target)} onClick={() => m.mutate()}>{mode === 'clone' ? 'Clone' : 'Move'}</button></>}>
      {mode === 'clone' ? (
        <div className="space-y-3">
          <div><label className="label" htmlFor="cl-p">Title prefix</label><input id="cl-p" className="input" value={prefix} onChange={(e) => setPrefix(e.target.value)} /></div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-[rgb(var(--accent))]" checked={subs} onChange={(e) => setSubs(e.target.checked)} />Include subtasks</label>
        </div>) : (
        <div className="space-y-3">
          <div><label className="label" htmlFor="mv-p">Target project</label>
            <select id="mv-p" className="input" value={target} onChange={(e) => setTarget(e.target.value)}><option value="">Select a project</option>{targets.map((p) => <option key={p.key} value={p.key}>{p.key} - {p.name}</option>)}</select></div>
          <p className="text-xs text-fg-muted">The issue gets a new key. Its sprint, epic, components and version are cleared.</p>
        </div>)}
    </Modal>
  );
}

export function commentAuthorOf(c: JiraComment) { return c.user ?? (c.user_name ? { id: c.user_id ?? 0, name: c.user_name } : null); }
