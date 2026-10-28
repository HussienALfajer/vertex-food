import {
  Button,
  Dialog,
  DialogActions,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@vertex-food/ui';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

/** A confirmation before an action that cannot simply be taken back (it ends sessions, stops sending). */
export function ConfirmDialog({
  trigger,
  title,
  description,
  confirm,
  onConfirm,
}: {
  trigger: ReactNode;
  title: string;
  description: string;
  confirm: string;
  onConfirm: () => void;
}) {
  const { t } = useTranslation('console');
  return (
    <Dialog>
      {trigger}
      <DialogContent>
        <div className="flex flex-col gap-1">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </div>
        <DialogActions>
          <DialogClose render={<Button type="button" variant="destructive" />} onClick={onConfirm}>
            {confirm}
          </DialogClose>
          <DialogClose render={<Button type="button" variant="outline" />}>
            {t('confirm.back')}
          </DialogClose>
        </DialogActions>
      </DialogContent>
    </Dialog>
  );
}
