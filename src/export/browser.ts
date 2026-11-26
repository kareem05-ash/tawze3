export async function ensureFonts() {
  const fonts = (document as Document & { fonts?: FontFaceSet }).fonts; // canvas text needs the bundled Cairo files loaded first
  if (!fonts) return;
  await Promise.all(['400', '600', '700'].map(w => fonts.load(`${w} 16px Cairo`, 'ابجد هوز 123 abc')));
}
export const createBrowserCanvas = (w: number, h: number) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
export const canvasToBlob = (c: HTMLCanvasElement, type: string, q?: number) =>
  new Promise<Blob>((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('canvas export failed'))), type, q));
