import { type MessageTemplateKey, messageTemplates } from '@vertex-food/contracts';
import { ar } from '@vertex-food/i18n';

const { messaging } = ar;

/**
 * The text of a message (spec S03 rule 14): the template's Arabic text in `packages/i18n` with its
 * parameters, checked again against the template's schema. An alert's `event` is said in words.
 * Throws on parameters that do not fit, naming the template only.
 */
export function renderMessage(template: MessageTemplateKey, params: unknown): string {
  const parsed = messageTemplates[template].params.safeParse(params);
  if (!parsed.success) throw new Error(`The parameters of ${template} do not fit its schema`);
  const values: Record<string, string> = { ...(parsed.data as Record<string, string>) };
  if ('event' in parsed.data) values.event = messaging.alertEvents[parsed.data.event];
  return messaging.templates[template].replace(/\{\{(\w+)\}\}/g, (_, name: string) => {
    const value = values[name];
    if (value === undefined) throw new Error(`The text of ${template} names an unknown parameter`);
    return value;
  });
}
