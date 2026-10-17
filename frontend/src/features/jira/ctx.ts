import { createContext, useContext } from 'react';
import type { JiraProjectDetail } from '../../lib/jiraTypes';
import type { CreateDefaults } from './dialogs';

export interface ProjectCtxValue {
  project: JiraProjectDetail;
  openIssue: (key: string) => void;
  newIssue: (defaults?: CreateDefaults) => void;
}
export const ProjectCtx = createContext<ProjectCtxValue | null>(null);
export function useProjectCtx(): ProjectCtxValue {
  const c = useContext(ProjectCtx);
  if (!c) throw new Error('useProjectCtx outside project layout');
  return c;
}
