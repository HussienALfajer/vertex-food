import { themeInitPath } from '@vertex-food/ui/theme';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import GlobalError from './global-error';
import { RootDocument } from './root-document';

describe('the root error screen', () => {
  it('loads theme-init.js before its body, as the layout does', () => {
    const html = renderToStaticMarkup(<GlobalError error={new Error('x')} retry={() => {}} />);
    const head = html.slice(html.indexOf('<head>'), html.indexOf('</head>'));
    expect(head).toContain(`<script src="${themeInitPath}"></script>`);
  });

  it('lets theme-init.js set the class on <html> without a hydration warning', () => {
    const root = RootDocument({ children: null }) as ReactElement<{
      suppressHydrationWarning?: boolean;
    }>;
    expect(root.type).toBe('html');
    expect(root.props.suppressHydrationWarning).toBe(true);
  });
});
