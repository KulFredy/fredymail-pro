/**
 * Gizli anahtar kasası (Faz 5).
 * Mac: macOS Anahtar Zinciri (`security` aracı, hizmet adı "icerik-fabrikasi").
 * Diğer sistemler (bulut, test): FABRIKA_HOME/gizli.json, yalnız sahibi okuyabilir (600).
 * Anahtarlar tarayıcıya, proje dosyasına, GitHub'a ve loglara gitmez; arayüz yalnız “bağlı · son 4 hane” görür.
 */
import { existsSync } from 'node:fs';
import { chmod, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { run } from '../media/proc';

export type SecretKind = 'anahtarlik' | 'dosya';
export interface Secrets {
  kind: SecretKind;
  get(name: string): Promise<string | null>;
  set(name: string, value: string): Promise<void>;
  remove(name: string): Promise<void>;
}

const SERVICE = 'icerik-fabrikasi';

class KeychainSecrets implements Secrets {
  kind = 'anahtarlik' as const;
  async get(name: string) {
    const r = await run('/usr/bin/security', ['find-generic-password', '-s', SERVICE, '-a', name, '-w']);
    return r.code === 0 ? r.stdout.replace(/\n$/, '') || null : null;
  }
  async set(name: string, value: string) {
    // -U: varsa güncelle. Not: değer kısa bir an süreç argümanında görünür (security aracının sınırı).
    const r = await run('/usr/bin/security', ['add-generic-password', '-U', '-s', SERVICE, '-a', name, '-l', `İçerik Fabrikası: ${name}`, '-w', value]);
    if (r.code !== 0) throw new Error('Anahtar Zinciri\'ne yazılamadı');
  }
  async remove(name: string) {
    await run('/usr/bin/security', ['delete-generic-password', '-s', SERVICE, '-a', name]);
  }
}

class FileSecrets implements Secrets {
  kind = 'dosya' as const;
  constructor(private file: string) {}
  private async read(): Promise<Record<string, string>> {
    try {
      return JSON.parse(await readFile(this.file, 'utf8'));
    } catch {
      return {};
    }
  }
  private async write(d: Record<string, string>) {
    await writeFile(this.file, JSON.stringify(d, null, 2), { mode: 0o600 });
    await chmod(this.file, 0o600).catch(() => undefined);
  }
  async get(name: string) {
    return (await this.read())[name] ?? null;
  }
  async set(name: string, value: string) {
    const d = await this.read();
    d[name] = value;
    await this.write(d);
  }
  async remove(name: string) {
    const d = await this.read();
    delete d[name];
    await this.write(d);
  }
}

export const createSecrets = (home: string): Secrets => {
  if (process.platform === 'darwin' && existsSync('/usr/bin/security') && !process.env.FABRIKA_SECRETS_FILE) return new KeychainSecrets();
  return new FileSecrets(process.env.FABRIKA_SECRETS_FILE ?? path.join(home, 'gizli.json'));
};

/** Gösterim için: “…a1b2” (anahtarın kendisi asla) */
export const maskKey = (v: string | null) => (v ? `…${v.slice(-4)}` : null);
