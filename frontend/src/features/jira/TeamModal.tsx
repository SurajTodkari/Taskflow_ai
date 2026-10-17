import Modal from '../../components/Modal';
import type { JiraProjectDetail } from '../../lib/jiraTypes';
import { UserDot, isAdmin } from './ui';
import { InviteForm } from './SettingsExtra';

/** Quick "Team" dialog: see who is in the project and invite/add anyone by email (admins). */
export default function TeamModal({ project, open, onClose }: { project: JiraProjectDetail; open: boolean; onClose: () => void }) {
  const admin = isAdmin(project.my_role);
  return (
    <Modal open={open} onClose={onClose} title={`Team – ${project.key}`}>
      <ul className="mb-3 divide-y divide-line rounded-xl border border-line">
        {project.members.map((m) => (
          <li key={m.user_id} className="flex items-center gap-3 px-3 py-2">
            <UserDot user={m} size={28} />
            <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{m.name}</p><p className="truncate text-xs text-fg-muted">{m.email}</p></div>
            <span className="chip">{m.role}</span>
          </li>))}
      </ul>
      {admin ? <InviteForm project={project} />
        : <p className="text-sm text-fg-muted">Only project admins can add people. Ask an admin of {project.key}.</p>}
      <p className="mt-3 text-caption text-fg-muted">Anyone you add can be assigned issues. If the email is not registered yet, an invite is created and they join automatically after signing up.</p>
    </Modal>
  );
}
