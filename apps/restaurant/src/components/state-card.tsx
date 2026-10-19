import { Card, PageHeader } from '@vertex-food/ui';
import type { ComponentProps, ReactNode } from 'react';

/** The card of a screen state (home, not found, error), on the page's start edge. */
export function StateCard({
  title,
  description,
  action,
  ...props
}: Omit<ComponentProps<'section'>, 'title' | 'className'> & {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <section className="max-w-2xl" {...props}>
      <Card>
        <PageHeader title={title} description={description} />
        {action && <div className="ps-4">{action}</div>}
      </Card>
    </section>
  );
}
