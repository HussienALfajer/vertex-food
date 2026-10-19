import { Button, Callout, FormActions } from '@vertex-food/ui';
import { useTranslation } from 'react-i18next';

export type Notice = { tone: 'warning' | 'danger'; text: string };

/**
 * The actions of a settings form: Save once something changed and saving is possible (online,
 * the restaurant writable, the member allowed), Discard while there are changes, and the outcome
 * of the last save under them, so nothing above the cursor moves.
 */
export function SaveActions({
  dirty,
  canSave,
  busy,
  onDiscard,
  notice,
}: {
  dirty: boolean;
  canSave: boolean;
  busy: boolean;
  onDiscard: () => void;
  notice: Notice | undefined;
}) {
  const { t } = useTranslation('restaurant');
  if (!canSave && !notice) return null;
  return (
    <>
      {canSave && (
        <FormActions>
          <Button type="submit" loading={busy} disabled={!dirty}>
            {t('settings.save')}
          </Button>
          {dirty && (
            <Button variant="ghost" disabled={busy} onClick={onDiscard}>
              {t('settings.discard')}
            </Button>
          )}
        </FormActions>
      )}
      {notice && <Callout role="alert" tone={notice.tone} title={notice.text} />}
    </>
  );
}
