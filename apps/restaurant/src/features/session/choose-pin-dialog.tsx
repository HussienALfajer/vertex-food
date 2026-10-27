import { isTrivialPin } from '@vertex-food/contracts';
import {
  Button,
  Callout,
  Dialog,
  DialogActions,
  DialogContent,
  DialogDescription,
  DialogTitle,
  toast,
} from '@vertex-food/ui';
import { WifiOffIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useErrorText } from '../../lib/error-text';
import { useOnline } from '../../lib/online';
import { PinPad } from './pin-pad';

/**
 * Choosing a PIN (spec S02 screen 5, rule 22): six digits typed twice on this PC, the trivial-PIN
 * rule checked here and again by the server (which also refuses the phone's last digits). Setting
 * a PIN needs a connection. `save` sends it; `onCancel` leaves (locking the PC).
 */
export function ChoosePinDialog({
  open,
  save,
  onCancel,
  cancelLabel,
}: {
  open: boolean;
  save: (pin: string) => Promise<void>;
  onCancel: () => void;
  cancelLabel: string;
}) {
  const { t } = useTranslation('restaurant');
  const errorText = useErrorText();
  const online = useOnline();
  const [first, setFirst] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const enter = async (pin: string) => {
    if (first === null) {
      if (isTrivialPin(pin)) {
        setError(t('choosePin.trivial'));
        return;
      }
      setError(null);
      setFirst(pin);
      return;
    }
    if (pin !== first) {
      setFirst(null);
      setError(t('choosePin.mismatch'));
      return;
    }
    setBusy(true);
    try {
      await save(pin);
      toast.add({ title: t('choosePin.saved'), type: 'success' });
    } catch (failure) {
      setFirst(null);
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !busy && onCancel()}>
      <DialogContent>
        <DialogTitle>{t('choosePin.title')}</DialogTitle>
        <DialogDescription>{t('choosePin.description')}</DialogDescription>
        {!online && (
          <Callout
            role="status"
            tone="warning"
            icon={<WifiOffIcon aria-hidden />}
            title={t('choosePin.offline')}
          />
        )}
        {error && <Callout role="alert" tone="danger" title={error} />}
        <div className="flex justify-center">
          <PinPad
            key={first === null ? 'first' : 'confirm'}
            label={first === null ? t('choosePin.first') : t('choosePin.confirm')}
            disabled={busy || !online}
            onComplete={(pin) => void enter(pin)}
          />
        </div>
        <DialogActions>
          <Button type="button" variant="secondary" disabled={busy} onClick={onCancel}>
            {cancelLabel}
          </Button>
        </DialogActions>
      </DialogContent>
    </Dialog>
  );
}
