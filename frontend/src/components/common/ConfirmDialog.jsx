import { useState } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';

/**
 * ConfirmDialog — replaces all native confirm() calls.
 * Controlled or uncontrolled usage:
 *   <ConfirmDialog title="Delete product?" description="…" confirmLabel="Delete" onConfirm={fn} trigger={<Button/>} />
 */
export function ConfirmDialog({
  title = 'Are you sure?',
  description = 'This action cannot be undone.',
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = true,
  onConfirm,
  trigger,
  open,
  onOpenChange,
}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isOpen = open ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;

  return (
    <AlertDialog open={isOpen} onOpenChange={setOpen}>
      {trigger ? <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger> : null}
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction
            className={destructive ? 'bg-destructive text-destructive-foreground hover:brightness-90' : undefined}
            onClick={(e) => {
              e.preventDefault();
              setOpen(false);
              onConfirm?.();
            }}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function DeleteButton({ onConfirm, title, description, ...props }) {
  return (
    <ConfirmDialog
      title={title ?? 'Delete this item?'}
      description={description ?? 'This action cannot be undone.'}
      confirmLabel="Delete"
      onConfirm={onConfirm}
      trigger={<Button variant="destructive" size="sm" {...props} />}
    />
  );
}
