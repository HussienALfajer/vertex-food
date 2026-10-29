import { caDownloadUrl } from '@vertex-food/contracts';
import { Button, Callout } from '@vertex-food/ui';
import { DownloadIcon, ShieldCheckIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { QrCode } from '../components/qr-code';
import { Screen } from '../components/page-shell';
import { navigate } from '../router';

const steps = ['open', 'download', 'install', 'compare', 'pair'] as const;

/** A SHA-256 fingerprint as Android's certificate details show it: `AB:CD:…`. */
export function displayFingerprint(fingerprint: string): string {
  return (fingerprint.toUpperCase().match(/.{2}/g) ?? []).join(':');
}

/**
 * Screen 6, `/` before pairing: how to install the branch CA certificate on Android Chrome (rule
 * 37), with the download from the hub's plain-HTTP port, which answers only while pairing is
 * open. The fingerprint to compare comes from the PC's pairing screen, or from the pairing that
 * just ended.
 */
export function InstallScreen({
  ended,
  fingerprint,
}: {
  /** The pairing was revoked or expired: say so above the steps. */
  ended: boolean;
  fingerprint: string | null;
}) {
  const { t } = useTranslation('hubClients');
  const download = caDownloadUrl(window.location.hostname);
  return (
    <Screen heading={t('install.heading')} description={t('install.description')}>
      {ended && <Callout tone="warning" title={t('pair.ended')} />}
      <ol className="flex list-decimal flex-col gap-2 ps-6 text-base">
        {steps.map((step) => (
          <li key={step}>{t(`install.steps.${step}`)}</li>
        ))}
      </ol>
      <div className="flex flex-col items-center gap-4 rounded-lg border border-border p-4 sm:flex-row sm:items-start">
        <QrCode value={download} label={t('install.qrLabel')} className="size-40 shrink-0" />
        <div className="flex min-w-0 flex-col gap-3">
          <Button variant="outline" render={<a href={download} />}>
            <DownloadIcon aria-hidden />
            {t('install.download')}
          </Button>
          <p className="text-sm text-muted-foreground">{t('install.downloadHint')}</p>
          <div className="flex flex-col gap-1">
            <p className="flex items-center gap-2 text-sm font-medium">
              <ShieldCheckIcon aria-hidden className="size-4" />
              {t('install.fingerprint')}
            </p>
            {fingerprint ? (
              <p dir="ltr" className="text-sm break-all text-start" data-testid="fingerprint">
                {displayFingerprint(fingerprint)}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">{t('install.fingerprintOnPc')}</p>
            )}
          </div>
        </div>
      </div>
      <Button onClick={() => navigate('/pair')}>{t('install.next')}</Button>
    </Screen>
  );
}
