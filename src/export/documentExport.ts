import type { Db } from '../db/types';
import { deliverFile, type DeliverKind } from './deliver';
import { buildReportDoc, buildStatementDoc } from './docModels';
import { canvasToBlob, createBrowserCanvas, ensureFonts } from './browser';
import { jpegsToPdf } from './pdf';
import { renderDocument, type DocModel } from './renderDocument';

async function deliverDoc(model: DocModel, mode: 'save' | 'whatsapp'): Promise<{ kind: DeliverKind; filename: string }> {
  await ensureFonts();
  const canvases = renderDocument(model, createBrowserCanvas, 2);
  const pages = await Promise.all(canvases.map(async c => ({ jpeg: new Uint8Array(await (await canvasToBlob(c, 'image/jpeg', 0.95)).arrayBuffer()), w: c.width, h: c.height })));
  const filename = `${model.filename}.pdf`;
  const blob = new Blob([jpegsToPdf(pages) as BlobPart], { type: 'application/pdf' });
  return { kind: await deliverFile(blob, filename, { mode, title: model.shareText, text: model.shareText, phone: model.phone }), filename };
}
export const exportReportPdf = async (db: Db, from: string, to: string, mode: 'save' | 'whatsapp' = 'save') => deliverDoc(await buildReportDoc(db, from, to), mode);
export const exportStatementPdf = async (db: Db, partyId: number, from: string, to: string, mode: 'save' | 'whatsapp' = 'save') => deliverDoc(await buildStatementDoc(db, partyId, from, to), mode);
