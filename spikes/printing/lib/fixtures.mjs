// Synthetic receipt and kitchen ticket data (no real restaurant, customer or phone data).
// Amounts are integer minor units with a currency (ADR 0014); SYP uses exponent 2 until Q11 is answered.

export const restaurant = {
  name: 'مطعم الشام التجريبي',
  branch: 'فرع اعزاز — السوق',
};

export const receiptOrder = {
  number: 1042,
  table: '3',
  channel: 'dine_in',
  cashier: 'كاشير 1',
  openedAt: '2026-10-18 14:32',
  currency: 'SYP',
  lines: [
    { name: 'شاورما دجاج عربي', qty: 2, unit: 2_500_000 },
    { name: 'وجبة فلافل مع خبز ولبن وسلطة جانبية كبيرة', qty: 1, unit: 1_800_000 },
    { name: 'Pepsi 330ml', qty: 3, unit: 500_000 },
    { name: 'كنافة نابلسية بالجبنة', qty: 1, unit: 3_000_000, note: 'بدون فستق، extra قطر' },
    { name: 'بطاطا مقلية كبيرة', qty: 2, unit: 1_200_000 },
    { name: 'Türk çayı (شاي تركي)', qty: 2, unit: 300_000 },
  ],
  service: { label: 'خدمة 5%', rateBp: 500 },
  payment: { method: 'cash', tendered: 20_000_000 },
  usdRate: { perUsdMinor: 1_300_000, at: '2026-10-18' },
};

export const kitchenTicket = {
  orderNumber: 1042,
  station: 'المشاوي',
  table: '3',
  channel: 'dine_in',
  waiter: 'نادل 2',
  sentAt: '14:33',
  kind: 'new', // new | addition | reprint
  lines: [
    { qty: 2, name: 'شاورما دجاج عربي', note: 'بدون ثوم، extra حار' },
    { qty: 1, name: 'وجبة فلافل مع خبز ولبن وسلطة جانبية كبيرة' },
    { qty: 2, name: 'بطاطا مقلية كبيرة' },
  ],
};
