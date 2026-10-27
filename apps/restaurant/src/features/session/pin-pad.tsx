import { pinPolicy } from '@vertex-food/contracts';
import { Button, cn } from '@vertex-food/ui';
import { DeleteIcon } from 'lucide-react';
import { type KeyboardEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';

const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const;

/**
 * The six-digit PIN pad (spec S02 screens 4, 5, 7): keys of at least 64 px, laid out as a phone's
 * keypad (left to right in RTL too), and the keyboard's digits and Backspace while it has the
 * focus. The PIN is never shown, only how many digits are in; it clears once six are typed and
 * handed to `onComplete`.
 */
export function PinPad({
  label,
  onComplete,
  disabled = false,
  autoFocus = true,
}: {
  label: string;
  onComplete: (pin: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
}) {
  const { t } = useTranslation('restaurant');
  const [pin, setPin] = useState('');

  const press = (digit: string) => {
    if (disabled) return;
    const next = `${pin}${digit}`.slice(0, pinPolicy.length);
    if (next.length === pinPolicy.length) {
      setPin('');
      onComplete(next);
    } else {
      setPin(next);
    }
  };
  const erase = () => setPin((current) => current.slice(0, -1));

  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (/^\d$/.test(event.key)) {
      event.preventDefault();
      press(event.key);
    } else if (event.key === 'Backspace') {
      event.preventDefault();
      erase();
    }
  };

  const key = (digit: string) => (
    <Button
      key={digit}
      type="button"
      variant="secondary"
      className="h-16 min-w-16 text-2xl"
      disabled={disabled}
      onClick={() => press(digit)}
    >
      {digit}
    </Button>
  );

  return (
    // biome-ignore lint/a11y/useSemanticElements: a group of keys, focusable for the keyboard's digits.
    <div
      role="group"
      aria-label={label}
      data-slot="pin-pad"
      // biome-ignore lint/a11y/noNoninteractiveTabindex: the pad takes the keyboard's digits.
      tabIndex={0}
      // biome-ignore lint/a11y/noAutofocus: the PIN is the only thing to type here.
      autoFocus={autoFocus}
      onKeyDown={keyDown}
      className="flex w-full max-w-xs flex-col items-center gap-4 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <p className="text-sm font-medium text-foreground">{label}</p>
      <div className="flex gap-3" aria-live="polite">
        <span className="sr-only">{t('pin.entered', { count: pin.length })}</span>
        {Array.from({ length: pinPolicy.length }, (_, index) => (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: the dots are positions.
            key={index}
            aria-hidden
            className={cn(
              'size-3.5 rounded-full border-2 border-primary',
              index < pin.length && 'bg-primary',
            )}
          />
        ))}
      </div>
      <div dir="ltr" className="grid w-full grid-cols-3 gap-3">
        {keys.map(key)}
        <span aria-hidden />
        {key('0')}
        <Button
          type="button"
          variant="ghost"
          className="h-16 min-w-16"
          disabled={disabled || pin.length === 0}
          onClick={erase}
          aria-label={t('pin.delete')}
        >
          <DeleteIcon aria-hidden className="size-6" />
        </Button>
      </div>
    </div>
  );
}
