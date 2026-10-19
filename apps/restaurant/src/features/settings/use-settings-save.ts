import { useMutation } from '@tanstack/react-query';
import { toast } from '@vertex-food/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../../lib/api';
import { useErrorText } from '../../lib/error-text';
import { useSetupCache } from '../tenancy/queries';
import type { Notice } from './save-actions';

/**
 * The save of a settings form (S01): `save` sends the draft against the record it started from;
 * a `CONFLICT` (rule 16) runs `reload`, which shows the current record, and says so; any other
 * refusal shows its Arabic text; success shows a toast.
 */
export function useSettingsSave<T>({
  save,
  reload,
}: {
  save: () => Promise<T>;
  reload: () => Promise<unknown>;
}) {
  const { t } = useTranslation('restaurant');
  const errorText = useErrorText();
  const cache = useSetupCache();
  const [notice, setNotice] = useState<Notice>();
  const mutation = useMutation({
    mutationFn: save,
    onMutate: () => setNotice(undefined),
    onSuccess: () => {
      toast.add({ title: t('states.saved'), type: 'success' });
    },
    onError: async (error) => {
      if (error instanceof ApiError && error.code === 'CONFLICT') {
        try {
          await reload();
          setNotice({ tone: 'warning', text: t('states.conflictReloaded') });
          return;
        } catch {
          // Shown below as the conflict's own text.
        }
      }
      setNotice({ tone: 'danger', text: errorText(error) });
      void cache.refused(error);
    },
  });
  return {
    run: () => mutation.mutate(),
    busy: mutation.isPending,
    notice,
    clearNotice: () => setNotice(undefined),
  };
}
