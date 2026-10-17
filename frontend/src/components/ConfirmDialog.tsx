import Modal from './Modal';
import Spinner from './ui/Spinner';

interface Props { open: boolean; title: string; message: string; confirmLabel?: string; busy?: boolean; onConfirm: () => void; onCancel: () => void }
export default function ConfirmDialog({ open, title, message, confirmLabel = 'Delete', busy, onConfirm, onCancel }: Props) {
  return (
    <Modal open={open} onClose={onCancel} title={title}
      footer={<><button className="btn-ghost" onClick={onCancel}>Cancel</button><button className="btn-danger" disabled={busy} onClick={onConfirm}>{busy && <Spinner size={14} />}{busy ? 'Working...' : confirmLabel}</button></>}>
      <p className="text-sm text-fg-muted">{message}</p>
    </Modal>
  );
}
