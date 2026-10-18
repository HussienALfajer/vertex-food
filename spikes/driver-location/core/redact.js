// Logs carry ids and counts only (ADR 0006, 0016). The spike scans every log line it produced for anything that
// looks like a coordinate or a phone number; a hit fails the run.

const COORD = /-?\d{1,3}\.\d{4,}/;
const PHONE = /\+?\d[\d\s-]{7,}\d/;
const ISO = /\d{4}-\d{2}-\d{2}T[\d:.]+Z/g;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

export function sensitiveIn(line) {
  const s = String(line).replace(ISO, '<time>').replace(UUID, '<id>');
  if (COORD.test(s)) return 'coordinate';
  if (PHONE.test(s)) return 'phone';
  return null;
}
