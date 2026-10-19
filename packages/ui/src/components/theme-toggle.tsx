'use client';

import { MoonIcon, SunIcon } from 'lucide-react';
import { useTheme } from '../theme/use-theme';
import { Button } from './button';
import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip';

/**
 * Switches between the light and dark themes (Vertex Hub's toggle): one icon button, a moon in
 * light and a sun in dark, named by what it switches to. Labels come in as props.
 */
function ThemeToggle({
  labels,
  className,
}: {
  labels: { toDark: string; toLight: string };
  className?: string;
}) {
  const { theme, toggle } = useTheme();
  const label = theme === 'dark' ? labels.toLight : labels.toDark;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            data-slot="theme-toggle"
            variant="ghost"
            size="icon"
            className={className}
            onClick={toggle}
            aria-label={label}
          />
        }
      >
        {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export { ThemeToggle };
