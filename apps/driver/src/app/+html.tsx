import { defaultLanguage, textDirection } from '@vertex-food/i18n';
import { ScrollViewStyleReset, useServerDocumentContext } from 'expo-router/html';
import type { ReactNode } from 'react';

/**
 * The HTML document of the web export, which exists only for the E2E screenshots (ADR 0003). Expo
 * SDK 58 renders it as a stream: the bundle's scripts and styles arrive as `headNodes` and
 * `bodyNodes`, which the document must place itself.
 */
export default function Root({ children }: { children: ReactNode }) {
  const { htmlAttributes, bodyAttributes, headNodes, bodyNodes } = useServerDocumentContext();
  return (
    <html {...htmlAttributes} lang={defaultLanguage} dir={textDirection}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />
        <ScrollViewStyleReset />
        {headNodes}
      </head>
      <body {...bodyAttributes}>
        {children}
        {bodyNodes}
      </body>
    </html>
  );
}
