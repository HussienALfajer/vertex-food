// Turns a queued job (what to print, where, how) into printer bytes. The product renders from the hub's
// local database at send time; the spike renders from the fixtures.
import { codePageJob } from './codepage.mjs';
import { PAPER, kitchenDoc, receiptDoc } from './documents.mjs';
import { imageJob } from './escpos.mjs';
import { kitchenTicket, receiptOrder, restaurant } from './fixtures.mjs';
import { prepareLogo, syntheticLogoPng } from './logo.mjs';
import { renderCanvas } from './render-canvas.mjs';

// ESC t number assumed for PC864 (Epson's table); clones number their tables differently (Q8).
export const PC864_TABLE = 37;

let logoPng;
const logos = new Map();
export async function logoFor(paper) {
  logoPng ??= await syntheticLogoPng();
  if (!logos.has(paper)) logos.set(paper, await prepareLogo(logoPng, Math.round(PAPER[paper].dots * 0.6)));
  return logos.get(paper);
}

export function docFor(job, { reprint = false } = {}) {
  return job.kind === 'receipt'
    ? receiptDoc(restaurant, job.data ?? receiptOrder, job.paper, { reprint })
    : kitchenDoc(job.data ?? kitchenTicket, job.paper, { reprint });
}

export async function renderJob(job, { reprint = false, kick = false } = {}) {
  const doc = docFor(job, { reprint });
  const logo = job.kind === 'receipt' ? await logoFor(job.paper) : undefined;
  if (job.path === 'codepage') return codePageJob(doc, job.paper, { logo, table: PC864_TABLE, kick }).bytes;
  return imageJob(await renderCanvas(doc, job.paper, { logo }), { kick });
}
