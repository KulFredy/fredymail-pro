/**
 * Marka kayıtları (Faz 6): ~/İçerik Fabrikası/markalar.json. Projeler markanın yalnız kimliğini ve
 * adlarını tutar; marka silinse de proje açılır.
 */
import { readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { BrandSchema, ProductSchema, type Brand } from '../core/brand';
import { patchOf } from '../core/ops';
import { newId } from './store';

export const BrandInput = BrandSchema.omit({ id: true, createdAt: true, updatedAt: true, products: true }).extend({
  products: z.array(ProductSchema.omit({ id: true }).extend({ id: z.string().optional() })).default([]),
});
export const BrandPatch = patchOf(BrandSchema.omit({ id: true, createdAt: true, updatedAt: true, products: true })).and(
  z.object({ products: z.array(ProductSchema.omit({ id: true }).extend({ id: z.string().optional() })).optional() }),
);

export class Brands {
  private file: string;
  private chain = Promise.resolve();
  constructor(home: string) {
    this.file = path.join(home, 'markalar.json');
  }
  async list(): Promise<Brand[]> {
    try {
      const raw = JSON.parse(await readFile(this.file, 'utf8')) as unknown[];
      return raw.flatMap((r) => {
        const p = BrandSchema.safeParse(r);
        return p.success ? [p.data] : [];
      });
    } catch {
      return [];
    }
  }
  async get(id: string) {
    return (await this.list()).find((b) => b.id === id) ?? null;
  }
  private save(list: Brand[]) {
    const tmp = `${this.file}.${process.pid}.tmp`;
    return writeFile(tmp, JSON.stringify(list, null, 2)).then(() => rename(tmp, this.file));
  }
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.chain.then(fn, fn);
    this.chain = p.then(
      () => undefined,
      () => undefined,
    );
    return p;
  }
  private withIds = (products: { id?: string; name: string; notes?: string }[]) => products.map((p) => ProductSchema.parse({ ...p, id: p.id || `u_${newId()}` }));

  create(input: z.input<typeof BrandInput>) {
    return this.serial(async () => {
      const b = BrandInput.parse(input);
      const now = new Date().toISOString();
      const brand = BrandSchema.parse({ ...b, id: `b_${newId()}`, createdAt: now, updatedAt: now, products: this.withIds(b.products) });
      const list = await this.list();
      if (list.some((x) => x.name.toLocaleLowerCase('tr-TR') === brand.name.toLocaleLowerCase('tr-TR'))) throw Object.assign(new Error(`“${brand.name}” adında bir marka zaten var`), { statusCode: 409 });
      await this.save([...list, brand]);
      return brand;
    });
  }
  update(id: string, patch: z.input<typeof BrandPatch>) {
    return this.serial(async () => {
      const list = await this.list();
      const i = list.findIndex((b) => b.id === id);
      if (i < 0) throw Object.assign(new Error('Marka bulunamadı'), { statusCode: 404 });
      const p = BrandPatch.parse(patch);
      const next = BrandSchema.parse({ ...list[i], ...p, products: p.products ? this.withIds(p.products) : list[i].products, updatedAt: new Date().toISOString() });
      list[i] = next;
      await this.save(list);
      return next;
    });
  }
  remove(id: string) {
    return this.serial(async () => {
      const list = await this.list();
      await this.save(list.filter((b) => b.id !== id));
    });
  }
}
