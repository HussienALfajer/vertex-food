import {
  auditActionCatalog,
  auditActions,
  auditCategories,
  commandReasons,
  errorCodes,
  featureKeys,
  limitKeys,
  messageTemplateKeys,
  messageTemplates,
} from '@vertex-food/contracts';
import { describe, expect, it } from 'vitest';
import { ar, formatLocale } from './index.js';

function texts(value: unknown, path: string): [string, unknown][] {
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value).flatMap(([key, child]) => texts(child, `${path}.${key}`));
  }
  return [[path, value]];
}

describe('Arabic catalog', () => {
  const all = texts(ar, 'ar');

  it('holds only non-empty strings', () => {
    for (const [path, text] of all) {
      expect(typeof text, path).toBe('string');
      expect((text as string).trim(), path).not.toBe('');
    }
  });

  it('writes digits in Latin, never Arabic-Indic', () => {
    for (const [path, text] of all) {
      expect(text, path).not.toMatch(/[٠-٩۰-۹]/);
    }
  });

  it('has a text for every error code', () => {
    expect(Object.keys(ar.errors).sort()).toEqual([...errorCodes].sort());
  });

  it('names every feature, limit and command reason', () => {
    expect(Object.keys(ar.agreement.features).sort()).toEqual([...featureKeys].sort());
    expect(Object.keys(ar.agreement.limits).sort()).toEqual([...limitKeys].sort());
    expect(Object.keys(ar.sync.reasons).sort()).toEqual([...commandReasons].sort());
  });

  it('has a sentence for every audit action and a label for every shown field (spec S06 rule 1)', () => {
    expect(Object.keys(ar.audit.actions)).toEqual([...auditActions]);
    expect(Object.keys(ar.audit.categories).sort()).toEqual([...auditCategories].sort());
    const labels: Record<string, string> = ar.audit.fields;
    for (const action of auditActions) {
      for (const field of auditActionCatalog[action].detailFields) {
        expect(labels[field], `${action}: ${field}`).toBeDefined();
      }
      const placeholders = [...ar.audit.actions[action].matchAll(/\{\{(\w+)\}\}/g)].map(
        (m) => m[1],
      );
      for (const name of placeholders)
        expect(['actor', 'entity', 'branch'], action).toContain(name);
    }
  });

  it('has a WhatsApp text for every message template, naming exactly its parameters', () => {
    expect(Object.keys(ar.messaging.templates).sort()).toEqual([...messageTemplateKeys].sort());
    for (const key of messageTemplateKeys) {
      const named = [...ar.messaging.templates[key].matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]);
      expect(named.sort(), key).toEqual(Object.keys(messageTemplates[key].params.shape).sort());
    }
  });
});

describe('format locale', () => {
  it('formats numbers and dates with Latin digits', () => {
    expect(new Intl.NumberFormat(formatLocale).format(1234567)).toMatch(/^[0-9٬,.]+$/);
    const date = new Intl.DateTimeFormat(formatLocale, { dateStyle: 'short', timeZone: 'UTC' });
    expect(date.format(new Date(Date.UTC(2026, 9, 9)))).not.toMatch(/[٠-٩]/);
    expect(date.format(new Date(Date.UTC(2026, 9, 9)))).toMatch(/2026/);
  });
});
