import { messageTemplateKeys } from '@vertex-food/contracts';
import { describe, expect, it } from 'vitest';
import { renderMessage } from './render.js';

describe('renderMessage', () => {
  it('fills the OTP code into its Arabic text', () => {
    expect(renderMessage('otp', { code: '123456' })).toBe(
      'رمز التحقق في فيرتكس فود: 123456\nصالح لمدة 5 دقائق. لا تشاركه مع أحد، ففريق فيرتكس لا يطلبه منك أبداً.',
    );
  });

  it('says an alert’s event in words, with the number’s label', () => {
    expect(renderMessage('alert', { label: 'رقم سوري', event: 'banned' })).toBe(
      'تنبيه فيرتكس فود: رقم المنصة «رقم سوري» محظور من واتساب.',
    );
  });

  it('renders every template with no placeholder left', () => {
    const params = {
      otp: { code: '000000' },
      alert: { label: 'رقم تركي', event: 'healthy_again' },
    } as Record<string, unknown>;
    for (const key of messageTemplateKeys) {
      expect(renderMessage(key, params[key] ?? {})).not.toMatch(/\{\{|\}\}/);
    }
  });

  it('refuses parameters that do not fit the template, without quoting them', () => {
    expect(() => renderMessage('otp', { code: '12' })).toThrow('The parameters of otp');
    expect(() => renderMessage('auto_reply', { extra: '+999100000001' })).toThrow(
      /^The parameters of auto_reply do not fit its schema$/,
    );
  });
});
