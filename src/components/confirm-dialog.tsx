import { ModalDialog } from "./modal-dialog";

interface ConfirmDialogProps {
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmLabel?: string;
  loading?: boolean;
}

export function ConfirmDialog({
  title,
  message,
  onConfirm,
  onCancel,
  confirmLabel = "Delete",
  loading = false,
}: ConfirmDialogProps) {
  return (
    <ModalDialog
      title={title}
      titleClassName="mb-2"
      width="sm"
      busy={loading}
      onClose={onCancel}
      footer={{
        confirmLabel,
        busyLabel: "Deleting...",
        confirmDanger: true,
        onConfirm,
      }}
    >
      <p className="text-sm text-foreground/60">{message}</p>
    </ModalDialog>
  );
}
