// Receipt and kitchen ticket as a renderer-independent document: a list of blocks.
// Blocks: { t: 'logo' } · { t: 'text', text, size, bold, align } · { t: 'row', start, end, size, bold }
//         { t: 'rule', dashed } · { t: 'feed', dots } · { t: 'banner', text, size } (inverted)
// 'start' is the right side in RTL, 'end' the left side. All digits are Latin.

export const PAPER = {
  58: { dots: 384, cols: 32, body: 22, small: 19, big: 30, huge: 38 },
  80: { dots: 576, cols: 48, body: 25, small: 21, big: 34, huge: 46 },
};

const group = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
// SYP shows whole pounds; USD shows cents. Minor units in, text out; never a float in the money path.
export function money(minor, currency) {
  if (!Number.isSafeInteger(minor)) throw new Error('money must be integer minor units');
  if (currency === 'SYP') return `${group(Math.trunc(minor / 100))} ل.س`;
  return `$${group(Math.trunc(minor / 100))}.${String(minor % 100).padStart(2, '0')}`;
}

const CHANNEL = { dine_in: 'صالة', takeaway: 'سفري', delivery: 'توصيل' };
const KIND = { new: 'طلب جديد', addition: 'إضافة على الطلب', reprint: 'نسخة معادة' };

export function receiptDoc(restaurant, order, paper, { reprint = false } = {}) {
  const p = PAPER[paper];
  const subtotal = order.lines.reduce((s, l) => s + l.qty * l.unit, 0);
  // Integer basis-point arithmetic, rounded half up to a whole pound (spike rule only).
  const service = Math.floor((subtotal * order.service.rateBp + 5_000 * 100) / (10_000 * 100)) * 100;
  const total = subtotal + service;
  const usdCents = Math.floor((total * 100 + order.usdRate.perUsdMinor / 2) / order.usdRate.perUsdMinor);
  const blocks = [
    { t: 'logo' },
    { t: 'text', text: restaurant.name, size: p.big, bold: true, align: 'center' },
    { t: 'text', text: restaurant.branch, size: p.small, align: 'center' },
    { t: 'feed', dots: 8 },
  ];
  if (reprint) blocks.push({ t: 'banner', text: 'نسخة معادة', size: p.body });
  blocks.push(
    { t: 'row', start: `فاتورة رقم ${order.number}`, end: order.openedAt, size: p.small },
    { t: 'row', start: `${CHANNEL[order.channel]} — طاولة ${order.table}`, end: order.cashier, size: p.small },
    { t: 'rule' },
  );
  for (const l of order.lines) {
    blocks.push({ t: 'row', start: `${l.qty} × ${l.name}`, end: money(l.qty * l.unit, order.currency), size: p.body, bold: true });
    if (l.note) blocks.push({ t: 'text', text: `  ${l.note}`, size: p.small, align: 'start' });
  }
  blocks.push(
    { t: 'rule', dashed: true },
    { t: 'row', start: 'المجموع الفرعي', end: money(subtotal, order.currency), size: p.body },
    { t: 'row', start: order.service.label, end: money(service, order.currency), size: p.body },
    { t: 'row', start: 'الإجمالي', end: money(total, order.currency), size: p.big, bold: true },
    { t: 'row', start: `بالدولار (السعر ${group(order.usdRate.perUsdMinor / 100)})`, end: money(usdCents, 'USD'), size: p.small },
    { t: 'rule', dashed: true },
    { t: 'row', start: 'نقداً', end: money(order.payment.tendered, order.currency), size: p.body },
    { t: 'row', start: 'الباقي', end: money(order.payment.tendered - total, order.currency), size: p.body, bold: true },
    { t: 'feed', dots: 12 },
    { t: 'text', text: 'شكراً لزيارتكم', size: p.body, bold: true, align: 'center' },
    { t: 'text', text: 'Powered by Vertex Food', size: p.small, align: 'center' },
  );
  return { blocks, totals: { subtotal, service, total, usdCents } };
}

export function kitchenDoc(ticket, paper, { reprint = false } = {}) {
  const p = PAPER[paper];
  const kind = reprint ? 'reprint' : ticket.kind;
  const blocks = [
    { t: 'banner', text: `${ticket.station} — ${KIND[kind]}`, size: p.big },
    { t: 'row', start: `طلب ${ticket.orderNumber}`, end: ticket.sentAt, size: p.huge, bold: true },
    { t: 'row', start: `${CHANNEL[ticket.channel]} — طاولة ${ticket.table}`, end: ticket.waiter, size: p.body },
    { t: 'rule' },
  ];
  for (const l of ticket.lines) {
    blocks.push({ t: 'text', text: `${l.qty} × ${l.name}`, size: p.big, bold: true, align: 'start' });
    if (l.note) blocks.push({ t: 'text', text: `ملاحظة: ${l.note}`, size: p.body, align: 'start' });
  }
  blocks.push({ t: 'rule' });
  return { blocks };
}
