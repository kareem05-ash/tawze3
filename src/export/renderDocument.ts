import { ar } from '../i18n/ar';

/**
 * Generic paginated A4 document (reports, account statements). Drawn with Canvas 2D so the browser shapes the Arabic.
 * Tables break between rows and repeat their header on the next page.
 */
export type Tone = 'normal' | 'good' | 'bad' | 'muted';
export interface KvRow { label: string; value: string; tone?: Tone; strong?: boolean }
export type Block =
  | { kind: 'heading'; text: string }
  | { kind: 'kv'; rows: KvRow[] }
  | { kind: 'table'; head: string[]; widths: number[]; rows: string[][]; empty?: string }
  | { kind: 'note'; text: string; tone?: Tone };
export interface DocModel { business: string; title: string; subtitle?: string; blocks: Block[]; filename: string; phone: string | null; shareText: string }

export const PAGE_W = 720, PAGE_H = 1018;
const M = 32, R = PAGE_W - M, L = M, CW = PAGE_W - 2 * M, TOP = 28, BOTTOM = PAGE_H - 44;
const FONT = 'Cairo, "Noto Naskh Arabic", Tahoma, Arial, sans-serif';
const C = { ink: '#0f172a', muted: '#64748b', accent: '#0f766e', tint: '#ecfdf5', head: '#f1f5f9', line: '#e2e8f0', bad: '#b91c1c', good: '#15803d' };
const toneColor = (t?: Tone) => (t === 'bad' ? C.bad : t === 'good' ? C.good : t === 'muted' ? C.muted : C.ink);

type Ctx = CanvasRenderingContext2D;
type Align = 'left' | 'right' | 'center';
interface Item { h: number; draw: (ctx: Ctx, y: number) => void; keepWithNext?: boolean; tableHeader?: Item }

function setFont(ctx: Ctx, weight: number, size: number, color: string, align: Align) {
  ctx.font = `${weight} ${size}px ${FONT}`; ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'middle'; (ctx as unknown as { direction: string }).direction = 'rtl';
}
function wrap(ctx: Ctx, text: string, maxW: number, weight = 400, size = 14): string[] {
  setFont(ctx, weight, size, C.ink, 'right');
  const out: string[] = []; let cur = '';
  for (const w of text.split(/\s+/).filter(Boolean)) { const t = cur ? `${cur} ${w}` : w; if (cur && ctx.measureText(t).width > maxW) { out.push(cur); cur = w; } else cur = t; }
  if (cur) out.push(cur);
  return out.length ? out : [''];
}
const txt = (ctx: Ctx, s: string, x: number, y: number, weight: number, size: number, color: string, align: Align) => { setFont(ctx, weight, size, color, align); ctx.fillText(s, x, y); };

function layout(m: DocModel, measure: Ctx): Item[] {
  const items: Item[] = [];
  items.push({ h: 44, draw: (c, y) => txt(c, m.business, PAGE_W / 2, y + 22, 700, 26, C.ink, 'center') });
  items.push({ h: 34, draw: (c, y) => txt(c, m.title, PAGE_W / 2, y + 16, 600, 18, C.accent, 'center') });
  if (m.subtitle) items.push({ h: 30, draw: (c, y) => txt(c, m.subtitle!, PAGE_W / 2, y + 14, 400, 14, C.muted, 'center') });
  items.push({ h: 16, draw: (c, y) => { c.strokeStyle = C.line; c.beginPath(); c.moveTo(L, y + 8); c.lineTo(R, y + 8); c.stroke(); } });
  for (const b of m.blocks) {
    if (b.kind === 'heading') items.push({ h: 44, keepWithNext: true, draw: (c, y) => { c.fillStyle = C.head; c.fillRect(L, y + 8, CW, 32); txt(c, b.text, R - 10, y + 24, 700, 16, C.accent, 'right'); } });
    else if (b.kind === 'kv') for (const r of b.rows) {
      const lines = wrap(measure, r.value, CW * 0.5, r.strong ? 700 : 600, r.strong ? 17 : 15); const h = Math.max(34, lines.length * 24 + 10);
      items.push({ h, draw: (c, y) => { txt(c, r.label, R - 8, y + h / 2, 400, 15, C.muted, 'right'); lines.forEach((ln, i) => txt(c, ln, L + 8, y + h / 2 + (i - (lines.length - 1) / 2) * 24, r.strong ? 700 : 600, r.strong ? 17 : 15, toneColor(r.tone), 'left')); } });
    } else if (b.kind === 'note') {
      const lines = wrap(measure, b.text, CW - 16, 400, 13);
      items.push({ h: lines.length * 20 + 12, draw: (c, y) => lines.forEach((ln, i) => txt(c, ln, R - 8, y + 12 + i * 20, 400, 13, b.tone === 'bad' ? C.bad : C.muted, 'right')) });
    } else {
      const widths = b.widths; const x0: number[] = []; { let x = R; for (const w of widths) { x0.push(x); x -= w; } }
      const cellX = (i: number) => (i === 0 ? x0[i]! - 8 : x0[i]! - widths[i]! / 2); const cellAlign = (i: number): Align => (i === 0 ? 'right' : 'center');
      const header: Item = { h: 34, draw: (c, y) => { c.fillStyle = C.head; c.fillRect(L, y, CW, 34); b.head.forEach((t, i) => txt(c, t, cellX(i), y + 17, 600, 13, C.muted, cellAlign(i))); } };
      items.push({ ...header, keepWithNext: true });
      if (b.rows.length === 0) items.push({ h: 36, draw: (c, y) => txt(c, b.empty ?? ar.reports.none, PAGE_W / 2, y + 18, 400, 14, C.muted, 'center') });
      for (const row of b.rows) {
        const cells = row.map((t, i) => wrap(measure, t, widths[i]! - 14, i === 0 ? 600 : 400, 14)); const n = Math.max(...cells.map(c => c.length)); const h = n * 22 + 14;
        items.push({ h, tableHeader: header, draw: (c, y) => { cells.forEach((ls, i) => ls.forEach((ln, k) => txt(c, ln, cellX(i), y + 7 + 11 + k * 22 + (n - ls.length) * 11, i === 0 ? 600 : 400, 14, C.ink, cellAlign(i)))); c.strokeStyle = C.line; c.beginPath(); c.moveTo(L, y + h); c.lineTo(R, y + h); c.stroke(); } });
      }
      items.push({ h: 10, draw: () => {} });
    }
  }
  return items;
}

/** Packs items into pages; keeps headings with the table that follows; repeats table headers on new pages. */
function paginate(items: Item[]): { item: Item; y: number }[][] {
  const pages: { item: Item; y: number }[][] = [[]]; let y = TOP;
  const newPage = () => { pages.push([]); y = TOP; };
  items.forEach((it, i) => {
    const next = items[i + 1]; const need = it.h + (it.keepWithNext && next ? Math.min(next.h, 60) + (next.keepWithNext ? 40 : 0) : 0);
    if (y + need > BOTTOM && y > TOP + 1) {
      newPage();
      if (it.tableHeader) { pages.at(-1)!.push({ item: it.tableHeader, y }); y += it.tableHeader.h; }
    }
    pages.at(-1)!.push({ item: it, y }); y += it.h;
  });
  return pages;
}

export interface CanvasLike { getContext(type: '2d'): unknown }
export function renderDocument<T extends CanvasLike>(model: DocModel, create: (w: number, h: number) => T, scale = 2): T[] {
  const measure = create(PAGE_W, 10).getContext('2d') as Ctx;
  const pages = paginate(layout(model, measure));
  return pages.map((page, idx) => {
    const canvas = create(PAGE_W * scale, PAGE_H * scale); const ctx = canvas.getContext('2d') as Ctx;
    ctx.scale(scale, scale); ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, PAGE_W, PAGE_H);
    for (const p of page) p.item.draw(ctx, p.y);
    const foot = `${ar.reports.page} ${(idx + 1).toLocaleString('ar-EG')} ${ar.reports.of} ${pages.length.toLocaleString('ar-EG')}`;
    txt(ctx, foot, PAGE_W / 2, PAGE_H - 22, 400, 12, C.muted, 'center');
    return canvas;
  });
}
