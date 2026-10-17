import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { jiraApi } from '../../lib/jiraApi';
import { useToast } from '../../components/Toast';

export function useProject(key: string | undefined) {
  return useQuery({ queryKey: ['jira', 'project', key], queryFn: () => jiraApi.getProject(key as string), enabled: !!key });
}

/** Invalidate every cached Jira query (board, issues, project, sprints...). */
export function useRefreshJira() {
  const qc = useQueryClient();
  return useCallback(() => qc.invalidateQueries({ queryKey: ['jira'] }), [qc]);
}

export function useErrToast() {
  const toast = useToast();
  return useCallback((e: unknown, fallback = 'Something went wrong') => toast(e instanceof Error ? e.message : fallback, 'error'), [toast]);
}

/** Normalizes either {k: n} or [{key,count}] into pairs. */
export function toPairs(m: Record<string, number> | { key: string; count: number }[] | undefined | null): [string, number][] {
  if (!m) return [];
  if (Array.isArray(m)) return m.map((x) => [x.key, x.count]);
  return Object.entries(m);
}
