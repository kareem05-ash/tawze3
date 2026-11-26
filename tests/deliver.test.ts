// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { deliverFile } from '../src/export/deliver';

const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });
afterEach(() => { vi.restoreAllMocks(); delete (navigator as unknown as Record<string, unknown>).share; delete (navigator as unknown as Record<string, unknown>).canShare; });
const stubUrl = () => { (URL as unknown as Record<string, unknown>).createObjectURL = vi.fn(() => 'blob:x'); (URL as unknown as Record<string, unknown>).revokeObjectURL = vi.fn(); };

describe('deliverFile (browser)', () => {
  it('uses the share sheet for WhatsApp when the browser can share files', async () => {
    const share = vi.fn(async () => {}); Object.assign(navigator, { share, canShare: () => true });
    expect(await deliverFile(blob, 'S-000001.png', { mode: 'whatsapp', title: 't', text: 'x' })).toBe('shared');
    expect(share).toHaveBeenCalledOnce();
    const arg = (share.mock.calls[0] as unknown as [{ files: File[] }])[0]; expect(arg.files[0]?.name).toBe('S-000001.png'); expect(arg.files[0]?.type).toBe('image/png');
  });
  it('reports cancel without error', async () => {
    Object.assign(navigator, { share: vi.fn(async () => { throw new DOMException('x', 'AbortError'); }), canShare: () => true });
    expect(await deliverFile(blob, 'a.png', { mode: 'whatsapp', title: 't' })).toBe('cancelled');
  });
  it('falls back to download + the customer chat link (normalized number) when file sharing is unavailable', async () => {
    stubUrl(); const open = vi.spyOn(window, 'open').mockImplementation(() => null); const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    expect(await deliverFile(blob, 'a.png', { mode: 'whatsapp', title: 't', text: 'فاتورة', phone: '01012345678' })).toBe('whatsapp-opened');
    expect(click).toHaveBeenCalled(); expect(open.mock.calls[0]?.[0]).toBe(`https://wa.me/201012345678?text=${encodeURIComponent('فاتورة')}`);
  });
  it('opens the WhatsApp contact picker when the party has no phone', async () => {
    stubUrl(); const open = vi.spyOn(window, 'open').mockImplementation(() => null); vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    await deliverFile(blob, 'a.png', { mode: 'whatsapp', title: 't', text: 'x' });
    expect(String(open.mock.calls[0]?.[0])).toMatch(/^https:\/\/wa\.me\/\?text=/);
  });
  it('save mode downloads the file', async () => {
    stubUrl(); const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    expect(await deliverFile(blob, 'a.pdf', { mode: 'save', title: 't' })).toBe('downloaded'); expect(click).toHaveBeenCalled();
  });
});
