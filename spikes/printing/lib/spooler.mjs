// USB printers on Windows: the printer is installed as a Windows print queue (its maker's driver, or the
// built-in "Generic / Text Only" driver on the USB00x port) and the app sends the ESC/POS bytes through the
// spooler as a RAW job, bypassing the driver's rendering. winspool.drv is called through koffi (prebuilt
// FFI, no native build), which loads in Node and in Electron's main process.
import koffi from 'koffi';

let api;
function load() {
  if (api) return api;
  const lib = koffi.load('winspool.drv');
  const DOC_INFO_1 = koffi.struct('DOC_INFO_1W', { pDocName: 'str16', pOutputFile: 'str16', pDatatype: 'str16' });
  api = {
    OpenPrinterW: lib.func('bool __stdcall OpenPrinterW(str16 name, _Out_ void **handle, void *defaults)'),
    StartDocPrinterW: lib.func('uint32 __stdcall StartDocPrinterW(void *h, uint32 level, DOC_INFO_1W *info)'),
    StartPagePrinter: lib.func('bool __stdcall StartPagePrinter(void *h)'),
    WritePrinter: lib.func('bool __stdcall WritePrinter(void *h, const uint8_t *buf, uint32 len, _Out_ uint32 *written)'),
    EndPagePrinter: lib.func('bool __stdcall EndPagePrinter(void *h)'),
    EndDocPrinter: lib.func('bool __stdcall EndDocPrinter(void *h)'),
    ClosePrinter: lib.func('bool __stdcall ClosePrinter(void *h)'),
    GetLastError: koffi.load('kernel32.dll').func('uint32 __stdcall GetLastError()'),
    DOC_INFO_1,
  };
  return api;
}

export function sendSpooler(printerName, job, docName = 'Vertex Food') {
  const a = load();
  const t0 = performance.now();
  const h = [null];
  if (!a.OpenPrinterW(printerName, h, null)) throw Object.assign(new Error('open_failed'), { code: 'open_failed', win32: a.GetLastError() });
  try {
    const jobId = a.StartDocPrinterW(h[0], 1, { pDocName: docName, pOutputFile: null, pDatatype: 'RAW' });
    if (!jobId) throw Object.assign(new Error('start_failed'), { code: 'start_failed', win32: a.GetLastError() });
    a.StartPagePrinter(h[0]);
    const written = [0];
    const ok = a.WritePrinter(h[0], job, job.length, written);
    a.EndPagePrinter(h[0]);
    a.EndDocPrinter(h[0]);
    if (!ok || written[0] !== job.length) throw Object.assign(new Error('write_failed'), { code: 'write_failed', written: written[0], win32: a.GetLastError() });
    // The spooler accepted the job; it cannot say whether the paper came out (one-way, no status).
    return { jobId, bytes: job.length, ms: performance.now() - t0 };
  } finally {
    a.ClosePrinter(h[0]);
  }
}
