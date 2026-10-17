import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import Modal from '../Modal';
import { jiraApi } from '../../lib/jiraApi';

export const ISSUE_KEY_RE = /^([A-Za-z][A-Za-z0-9]{1,9})-(\d+)$/;
export const goToIssue = (nav: ReturnType<typeof useNavigate>, key: string) => {
  const k = key.trim().toUpperCase();
  const m = ISSUE_KEY_RE.exec(k);
  if (m) nav(`/jira/${m[1]}/issue/${k}`);
};

/** Notification -> issue path, tolerant of unknown payload shape. */
export function notifIssuePath(n: { [k: string]: unknown; title?: string; body?: string; message?: string }): string | null {
  const direct = (n.issue_key ?? n.issueKey) as string | undefined;
  const link = (n.link ?? n.url) as string | undefined;
  if (typeof link === 'string' && link.startsWith('/jira/')) return link;
  const hay = direct ?? `${n.title ?? ''} ${n.body ?? n.message ?? ''}`;
  const isJira = !!direct || n.type === 'jira' || n.kind === 'jira';
  const m = /\b([A-Z][A-Z0-9]{1,9})-(\d+)\b/.exec(hay);
  return isJira && m ? `/jira/${m[1]}/issue/${m[0]}` : null;
}

export function JiraQuickSearch({ open, onClose }: { open: boolean; onClose: () => void }) {
  const nav = useNavigate();
  const [text, setText] = useState('');
  const [deb, setDeb] = useState('');
  useEffect(() => { const t = setTimeout(() => setDeb(text.trim()), 250); return () => clearTimeout(t); }, [text]);
  useEffect(() => { if (!open) { setText(''); setDeb(''); } }, [open]);
  const isKey = ISSUE_KEY_RE.test(deb);
  const q = useQuery({
    queryKey: ['jira', 'quick', deb],
    queryFn: () => jiraApi.search(isKey ? `key = "${deb.toUpperCase()}" OR text ~ "${deb}"` : `text ~ "${deb.replace(/"/g, '')}" ORDER BY updated DESC`, 8),
    enabled: open && deb.length >= 2, retry: false,
  });
  const go = (key: string) => { onClose(); goToIssue(nav, key); };
  return (
    <Modal open={open} onClose={onClose} title="Search issues">
      <form onSubmit={(e) => { e.preventDefault(); const t = text.trim(); if (ISSUE_KEY_RE.test(t)) go(t); else if (q.data?.items[0]) go(q.data.items[0].key); }}>
        <label className="sr-only" htmlFor="jqs">Search issues by key or text</label>
        <input id="jqs" className="input" placeholder="Search all projects, or type TF-12 and press Enter" value={text} onChange={(e) => setText(e.target.value)} autoComplete="off" />
      </form>
      <ul className="mt-3 space-y-1" aria-live="polite">
        {q.isLoading && deb.length >= 2 && <li className="text-sm text-fg-muted">Searching...</li>}
        {q.error && <li className="text-sm text-danger">{q.error instanceof Error ? q.error.message : 'Search failed'}</li>}
        {(q.data?.items ?? []).map((i) => <li key={i.id}><button type="button" className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-surface-2" onClick={() => go(i.key)}>
          <span className="text-xs font-medium text-fg-muted">{i.key}</span><span className="min-w-0 flex-1 truncate">{i.title}</span><span className="text-caption text-fg-muted">{i.status_name}</span></button></li>)}
        {q.data && q.data.items.length === 0 && <li className="text-sm text-fg-muted">No matches.</li>}
      </ul>
    </Modal>
  );
}

/** Small input in the top bar: type an issue key and press Enter. */
export function JumpToIssue() {
  const nav = useNavigate();
  const [v, setV] = useState('');
  return (
    <form className="hidden xl:block" onSubmit={(e) => { e.preventDefault(); if (ISSUE_KEY_RE.test(v.trim())) { goToIssue(nav, v); setV(''); } }}>
      <label className="sr-only" htmlFor="jump-issue">Jump to issue key</label>
      <input id="jump-issue" className="input !h-9 !w-28 !py-1 text-sm" placeholder="Jump: TF-12" value={v} onChange={(e) => setV(e.target.value)} />
    </form>
  );
}
