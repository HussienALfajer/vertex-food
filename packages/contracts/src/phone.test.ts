import { describe, expect, it } from 'vitest';
import { parsePhoneNumber, phoneNumberSchema } from './phone.js';

// Synthetic numbers only: the 900 and 500 blocks, and 000 subscriber numbers.

describe('parsePhoneNumber', () => {
  it.each([
    ['0900 000 001', '+963900000001'],
    ['+963 900 000 001', '+963900000001'],
    ['00963900000001', '+963900000001'],
    ['+963 0900 000 001', '+963900000001'],
    ['٠٩٠٠-٠٠٠-٠٠١', '+963900000001'],
    ['(0900) 000.001', '+963900000001'],
  ])('reads the Syrian mobile %s', (text, e164) => {
    expect(parsePhoneNumber(text)).toEqual({ e164, country: 'SY', kind: 'mobile' });
  });

  it.each([
    ['011 000 0001', '+963110000001'],
    ['021 000 0001', '+963210000001'],
    ['033 000 001', '+96333000001'],
  ])('reads the Syrian landline %s', (text, e164) => {
    expect(parsePhoneNumber(text)).toEqual({ e164, country: 'SY', kind: 'landline' });
  });

  it.each([
    ['0500 000 00 01', '+905000000001'],
    ['+90 500 000 00 01', '+905000000001'],
    ['0090 5000000001', '+905000000001'],
    ['۰۵۰۰۰۰۰۰۰۰۱', '+905000000001'],
  ])('reads the Turkish mobile %s', (text, e164) => {
    expect(parsePhoneNumber(text)).toEqual({ e164, country: 'TR', kind: 'mobile' });
  });

  it.each([
    ['0212 000 00 01', '+902120000001'],
    ['+90 342 000 00 01', '+903420000001'],
  ])('reads the Turkish landline %s', (text, e164) => {
    expect(parsePhoneNumber(text)).toEqual({ e164, country: 'TR', kind: 'landline' });
  });

  it.each([
    '',
    '900000001',
    '0900 000 00',
    '0900 000 0011 1',
    '+963 600 000 001',
    '059 000 001',
    '010 000 0001',
    '053 000 0001',
    '012 000 0001',
    '+90 100 000 00 01',
    '+1 202 000 0001',
    '+44 7000 000001',
    '0900 abc 001',
    '+963 900 000 001 ext 2',
  ])('refuses %j', (text) => {
    expect(parsePhoneNumber(text)).toBeUndefined();
  });
});

describe('phoneNumberSchema', () => {
  it('answers E.164 for a local form', () => {
    expect(phoneNumberSchema.parse('0900 000 001')).toBe('+963900000001');
    expect(phoneNumberSchema.parse('+905000000001')).toBe('+905000000001');
  });

  it('refuses other countries and malformed numbers', () => {
    expect(phoneNumberSchema.safeParse('+12020000001').success).toBe(false);
    expect(phoneNumberSchema.safeParse('0900').success).toBe(false);
    expect(phoneNumberSchema.safeParse(963900000001).success).toBe(false);
  });
});
