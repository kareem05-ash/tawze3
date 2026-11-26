import type { ReceiptModel } from './receiptModel';
import { ar } from '../i18n/ar';

/**
 * Draws the receipt with the Canvas 2D API so the BROWSER's text engine does the Arabic shaping and bidi
 * (PDF libraries without a shaper get Arabic wrong). The same drawing code runs in tests via @napi-rs/canvas.
 */
export const RECEIPT_WIDTH = 720;
const W = RECEIPT_WIDTH, M = 32, R = W - M, L = M, CW = W - 2 * M;
const C = { ink: '#0f172a', muted: '#64748b', accent: '#0f766e', tint: '#ecfdf5', head: '#f1f5f9', line: '#e2e8f0', danger: '#b91c1c', ok: '#15803d' };
const FONT = 'Cairo, "Noto Naskh Arabic", Tahoma, Arial, sans-serif';
const COLS = [{ w: 270, align: 'right' as const }, { w: 110, align: 'center' as const }, { w: 130, align: 'center' as const }, { w: 146, align: 'center' as const }];

type Ctx = CanvasRenderingContext2D;
type Align = 'left' | 'right' | 'center';

function wrap(ctx: Ctx, text: string, maxW: number): string[] {
  const words = text.split(/\s+/).filter(Boolean); const out: string[] = []; let cur = '';
  for (const w of words) { const t = cur ? `${cur} ${w}` : w; if (cur && ctx.measureText(t).width > maxW) { out.push(cur); cur = w; } else cur = t; }
  if (cur) out.push(cur);
  return out.length ? out : [''];
}

function paint(ctx: Ctx, m: ReceiptModel, draw: boolean): number {
  let y = 28;
  const set = (weight: number, size: number, color: string, align: Align) => { ctx.font = `${weight} ${size}px ${FONT}`; ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'middle'; (ctx as unknown as { direction: string }).direction = 'rtl'; };
  const text = (s: string, x: number, yy: number, weight: number, size: number, color: string, align: Align) => { set(weight, size, color, align); if (draw) ctx.fillText(s, x, yy); };
  const hline = (yy: number) => { if (draw) { ctx.strokeStyle = C.line; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(L, yy); ctx.lineTo(R, yy); ctx.stroke(); } };
  const fill = (color: string, yy: number, h: number) => { if (draw) { ctx.fillStyle = color; ctx.fillRect(L, yy, CW, h); } };
  const kv = (label: string, value: string, o: { size?: number; weight?: number; color?: string; h?: number } = {}) => {
    const h = o.h ?? 34; text(label, R - 8, y + h / 2, 400, 15, C.muted, 'right'); text(value, L + 8, y + h / 2, o.weight ?? 600, o.size ?? 16, o.color ?? C.ink, 'left'); y += h;
  };

  // header
  text(m.business, W / 2, y + 16, 700, 26, C.ink, 'center'); y += 40;
  text(`${m.typeLabel} · ${m.ref}`, W / 2, y + 12, 600, 16, C.accent, 'center'); y += 34;
  hline(y); y += 8;
  kv(m.partyLabel, m.partyName); kv(ar.common.date, m.date);
  if (m.externalRef) kv(ar.invoice.extRef, m.externalRef);
  y += 6;

  // table header
  fill(C.head, y, 36);
  let x = R; COLS.forEach((c, i) => { const label = [ar.common.product, ar.common.qty, ar.common.price, ar.common.total][i]!; text(label, c.align === 'right' ? x - 8 : x - c.w / 2, y + 18, 600, 14, C.muted, c.align); x -= c.w; });
  y += 36;

  // rows
  for (const l of m.lines) {
    set(600, 15, C.ink, 'right');
    const nameLines = wrap(ctx, l.name, COLS[0]!.w - 16);
    const rowH = Math.max(nameLines.length * 22 + (l.discount ? 20 : 0), 44) + 14;
    const mid = y + rowH / 2; let cx = R;
    nameLines.forEach((ln, i) => text(ln, cx - 8, y + 18 + i * 22, 600, 15, C.ink, 'right'));
    if (l.discount) text(l.discount, cx - 8, y + 18 + nameLines.length * 22 + 2, 400, 12, C.danger, 'right');
    cx -= COLS[0]!.w; text(l.qty, cx - COLS[1]!.w / 2, mid - 9, 600, 15, C.ink, 'center'); text(l.unit, cx - COLS[1]!.w / 2, mid + 11, 400, 12, C.muted, 'center');
    cx -= COLS[1]!.w; text(l.price, cx - COLS[2]!.w / 2, mid, 400, 14, C.ink, 'center');
    cx -= COLS[2]!.w; text(l.total, cx - COLS[3]!.w / 2, mid, 700, 15, C.ink, 'center');
    y += rowH; hline(y);
  }
  y += 10;

  // totals
  kv(ar.invoice.subtotal, m.subtotal);
  if (m.invoiceDiscount) kv(ar.invoice.invoiceDiscount, m.invoiceDiscount, { color: C.danger });
  fill(C.tint, y, 50); text(ar.common.total, R - 8, y + 25, 700, 18, C.accent, 'right'); text(m.total, L + 8, y + 25, 700, 22, C.accent, 'left'); y += 54;
  if (m.returned) kv(ar.invoice.returned, m.returned, { color: C.danger });
  kv(ar.invoice.paid, m.paid);
  kv(ar.invoice.remaining, m.outstanding, { weight: 700, size: 18, color: m.outstandingPositive ? C.danger : C.ok });
  if (m.credit) kv(ar.invoice.credit, m.credit);

  if (m.account) {
    y += 6; hline(y); y += 8;
    kv(ar.receipt.accountBalance, m.account.tone === 'settled' ? m.account.label : m.account.amount, { color: m.account.tone === 'owes' ? C.danger : m.account.tone === 'we' ? C.ok : C.ink });
    if (m.account.tone !== 'settled') { text(m.account.label, L + 8, y + 2, 400, 13, C.muted, 'left'); y += 22; }
  }
  if (m.notes) {
    y += 10; set(400, 14, C.muted, 'right');
    text(ar.common.notes, R - 8, y + 10, 600, 14, C.muted, 'right'); y += 24;
    for (const ln of wrap(ctx, m.notes, CW - 16)) { text(ln, R - 8, y + 10, 400, 14, C.ink, 'right'); y += 22; }
  }
  y += 14; hline(y); y += 24;
  text(ar.receipt.thanks, W / 2, y, 400, 14, C.muted, 'center'); y += 36;
  return y;
}

export interface CanvasLike { getContext(type: '2d'): unknown }
/** `create(w,h)` makes a canvas: document.createElement('canvas') in the browser, createCanvas() from @napi-rs/canvas in tests. */
export const MAX_PIXELS = 12_000_000; // keeps very long invoices under mobile WebView canvas limits
export function renderReceipt<T extends CanvasLike>(model: ReceiptModel, create: (w: number, h: number) => T, scale = 2): T {
  const probe = create(W, 10);
  const height = Math.ceil(paint(probe.getContext('2d') as Ctx, model, false));
  scale = Math.max(1, Math.min(scale, Math.sqrt(MAX_PIXELS / (W * height))));
  const canvas = create(Math.round(W * scale), Math.round(height * scale));
  const ctx = canvas.getContext('2d') as Ctx;
  ctx.scale(scale, scale);
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, height);
  paint(ctx, model, true);
  if (model.cancelled) {
    ctx.save(); ctx.translate(W / 2, height / 2); ctx.rotate(-0.5);
    ctx.font = `700 110px ${FONT}`; ctx.fillStyle = 'rgba(185,28,28,0.18)'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(ar.invoice.cancelled, 0, 0); ctx.restore();
  }
  return canvas;
}
