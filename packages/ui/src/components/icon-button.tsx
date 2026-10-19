import type { ComponentProps } from 'react';
import { Button } from './button';
import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip';

type IconButtonProps = Omit<ComponentProps<typeof Button>, 'aria-label'> & {
  /** The accessible name, shown in a tooltip on hover and keyboard focus (never a `title`). */
  label: string;
};

/**
 * A button that shows only an icon. It never submits a form it sits in. `render` turns it into a
 * link (call, WhatsApp); as the `render` of a `DropdownMenuTrigger` it opens a menu.
 */
function IconButton({
  label,
  variant = 'ghost',
  size = 'icon-sm',
  children,
  ...props
}: IconButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            data-slot="icon-button"
            type={props.render ? undefined : 'button'}
            variant={variant}
            size={size}
            aria-label={label}
            {...props}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export { IconButton };
