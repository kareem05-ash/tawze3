import { Capacitor } from '@capacitor/core';
import { waChatUrl, waDigits } from './phone';

export type DeliverKind = 'shared' | 'downloaded' | 'whatsapp-opened' | 'cancelled';
export interface DeliverOptions { mode: 'save' | 'whatsapp'; title: string; text?: string; phone?: string | null }

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
const toBase64 = (blob: Blob) => new Promise<string>((res, rej) => {
  const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] ?? ''); r.onerror = () => rej(r.error); r.readAsDataURL(blob);
});

/**
 * Android app: writes the file to the app cache and opens the system share sheet (WhatsApp, Drive, Files, ...). WhatsApp then asks which
 *   contact/group to send to. Apps cannot pre-select a WhatsApp contact for an image, so choosing the contact happens inside WhatsApp.
 * Browser: share sheet when the browser supports file sharing; otherwise downloads the file and (WhatsApp mode) opens a WhatsApp chat/contact picker.
 */
export async function deliverFile(blob: Blob, filename: string, o: DeliverOptions): Promise<DeliverKind> {
  if (Capacitor.isNativePlatform()) {
    const [{ Filesystem, Directory }, { Share }] = await Promise.all([import('@capacitor/filesystem'), import('@capacitor/share')]);
    await Filesystem.writeFile({ path: filename, data: await toBase64(blob), directory: Directory.Cache });
    const { uri } = await Filesystem.getUri({ path: filename, directory: Directory.Cache });
    try { await Share.share({ title: o.title, text: o.text, files: [uri], dialogTitle: o.title }); return 'shared'; }
    catch (e) { if (/cancel/i.test(String(e))) return 'cancelled'; throw e; }
  }
  const file = new File([blob], filename, { type: blob.type });
  if (o.mode === 'whatsapp') {
    if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: o.title, text: o.text }); return 'shared'; }
      catch (e) { if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled'; /* fall through to download + link */ }
    }
    downloadBlob(blob, filename);
    window.open(waChatUrl(waDigits(o.phone), o.text), '_blank', 'noopener');
    return 'whatsapp-opened';
  }
  downloadBlob(blob, filename);
  return 'downloaded';
}
