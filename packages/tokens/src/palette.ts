/*
 * The Vertex palette (brand/identity.md §2). Vertex Green is green-800 and Vertex Sand is gold-400;
 * the test pins every value to the identity's tables.
 */

export const palette = {
  white: '#ffffff',
  green: {
    50: '#e8fcf8',
    100: '#dbf3ee',
    200: '#c2e1da',
    300: '#a0c7bf',
    400: '#77aaa1',
    500: '#4e8e83',
    600: '#307369',
    700: '#235b52',
    800: '#004139',
    900: '#0b2d28',
    950: '#031b17',
  },
  gold: {
    50: '#fcf7e7',
    100: '#f3edda',
    200: '#e1d9c1',
    300: '#c8bd9e',
    400: '#b9a87a',
    500: '#907f4f',
    600: '#766434',
    700: '#5d4e27',
    800: '#433819',
    900: '#2e260e',
    950: '#1b1505',
  },
  neutral: {
    50: '#f4f8f7',
    100: '#e7efed',
    200: '#d4dbd9',
    300: '#b8bfbe',
    400: '#99a09f',
    500: '#7b8280',
    600: '#616866',
    700: '#4b5150',
    800: '#353b39',
    900: '#222827',
    950: '#121716',
  },
  // Status scales: deliberately distinct from the brand colors.
  success: { 50: '#e5ffe9', 100: '#d4f8da', 500: '#3c9555', 600: '#167a3a', 700: '#09602b' },
  warning: { 50: '#fff5ee', 100: '#fee8d8', 500: '#bb6814', 600: '#97520a', 700: '#783f04' },
  danger: { 50: '#fff4f2', 100: '#fee7e3', 500: '#d54a43', 600: '#b62926', 700: '#921b1a' },
  info: { 50: '#f0f8ff', 100: '#deeffe', 500: '#3786c3', 600: '#116ba7', 700: '#055485' },
} as const;

export type Palette = typeof palette;
