import type { Db } from '../db/types';
import { deliverFile, type DeliverKind } from './deliver';
import { jpegToPdf } from './pdf';
import { buildReceiptModel } from './receiptModel';
import { renderReceipt } from './renderReceipt';
import { canvasToBlob as toBlob, createBrowserCanvas, ensureFonts } from './browser';

export type ExportFormat = 'png' | 'pdf' | 'whatsapp';

/** Renders the invoice receipt and delivers it as PNG, PDF, or to WhatsApp (PNG). Works offline. */
export async function exportReceipt(db: Db, invoiceId: number, format: ExportFormat): Promise<{ kind: DeliverKind; filename: string }> {
  const model = await buildReceiptModel(db, invoiceId);
  await ensureFonts();
  const canvas = renderReceipt(model, createBrowserCanvas, 2);
  if (format === 'pdf') {
    const jpeg = new Uint8Array(await (await toBlob(canvas, 'image/jpeg', 0.95)).arrayBuffer());
    const filename = `${model.filename}.pdf`;
    const blob = new Blob([jpegToPdf(jpeg, canvas.width, canvas.height) as BlobPart], { type: 'application/pdf' });
    return { kind: await deliverFile(blob, filename, { mode: 'save', title: model.shareText }), filename };
  }
  const filename = `${model.filename}.png`;
  const blob = await toBlob(canvas, 'image/png');
  return { kind: await deliverFile(blob, filename, { mode: format === 'whatsapp' ? 'whatsapp' : 'save', title: model.shareText, text: model.shareText, phone: model.phone }), filename };
}
