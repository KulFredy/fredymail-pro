/**
 * Eski projeler açılır mı? `tests/fixtures/eski-ev` gerçek eski kodla üretildi:
 * Faz 1 (80209d5) bir Hızlı Edit projesi, ardından Faz 2 (3a0071f) aynı klasörde dış sesli bir Stüdyo projesi.
 * Yeniden üretmek için: scripts/eski-proje-uret.ts
 */
import { cp, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Store } from '../src/server/store';

const FIX = path.join(__dirname, 'fixtures', 'eski-ev');
let home: string;
let store: Store;

beforeAll(async () => {
  home = await mkdtemp(path.join(os.tmpdir(), 'eski-ev-'));
  await cp(FIX, home, { recursive: true });
  store = new Store(home);
  await store.init();
});
afterAll(async () => rm(home, { recursive: true, force: true }));

describe('eski projeler', () => {
  it('kütüphane ve iki proje okunur, son proje hatırlanır', async () => {
    expect(store.library.size).toBe(3);
    const list = await store.listProjects();
    expect(list.map((p) => p.name).sort()).toEqual(['Eski Faz 1 projesi', 'Eski Faz 2 projesi']);
    expect(store.state.lastProjectId).toBe(list.find((p) => p.name === 'Eski Faz 2 projesi')!.id);
  });

  it('Faz 1 projesi: kırpma, renk, kadraj, altyazı düzeltmesi ve son adım korunur', async () => {
    const id = (await store.listProjects()).find((p) => p.name === 'Eski Faz 1 projesi')!.id;
    const p = await store.getProject(id);
    expect(p.clips).toHaveLength(2);
    expect(p.clips[0].out).toBe(2);
    expect(p.look.preset).toBe('sicak');
    expect(Object.values(p.captions.edits)).toContain('BUGÜN');
    expect(p.ui.step).toBe('altyazi');
    const story = p.outputs.find((o) => o.format === 'story')!;
    expect(story.framing[p.clips[0].id].x).toBeCloseTo(0.4);
    // Faz 2 alanları varsayılanla gelir
    expect(p.voice).toEqual([]);
    expect(p.overlays).toEqual([]);
  });

  it('Faz 2 projesi: kaydedilmiş dış ses, yazı ve klip sesi korunur; düzenlenebilir ve geri alınabilir', async () => {
    const id = (await store.listProjects()).find((p) => p.name === 'Eski Faz 2 projesi')!.id;
    const p = await store.getProject(id);
    expect(p.voice).toHaveLength(1);
    expect(store.library.get(p.voice[0].assetId)?.role).toBe('voiceover');
    expect(p.texts[0].text).toBe('Hafta sonu');
    expect(p.clips[0].gainDb).toBe(-12);
    const st = await store.applyOps(id, [{ type: 'clip.trim', clipId: p.clips[0].id, in: 0.2, out: 5 }]);
    expect(st.project.clips[0].in).toBe(0.2);
    const u = await store.undo(id);
    expect(u.project.clips[0].in).toBe(0);
  });
});
