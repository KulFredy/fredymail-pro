/**
 * Komut önerisinin etkisi (Faz 3): hangi işlem, hangi klip(ler), kurguda hangi aralık, hangi kapsam.
 * Komut paneli bunu "Önizle / Uygula" öncesinde gösterir; kapsam bir çıktı oranıyla sınırlıysa belirtilir.
 */
import { FORMATS } from './formats';
import { describeOp, type OpInput } from './ops';
import type { AssetRef, Project } from './schema';
import { layoutClips } from './timeline';

export type ImpactClip = { id: string; index: number; name: string };
export type ImpactItem = {
  label: string;
  clips: ImpactClip[];
  /** Kurgu zamanında aralık; nokta işlemlerde start === end */
  range: { start: number; end: number } | null;
  /** project: tüm proje (tüm çıktılar) · output: yalnız bir çıktı · track: ayrı iz (dış ses, yazı, müzik) */
  scope: 'project' | 'output' | 'track';
  scopeLabel: string;
  /** Yan etkiler: silinecek yazı/üst iz, dış sesle çakışma */
  warnings?: string[];
};

export const outputLabel = (project: Project, outputId: string) => {
  const o = project.outputs.find((x) => x.id === outputId);
  if (!o) return 'bir çıktı';
  const f = FORMATS[o.format];
  return `${f.label} ${f.ratio}`;
};

export const describeImpact = (project: Project, assets: Record<string, AssetRef>, ops: OpInput[]): ImpactItem[] => {
  const layout = layoutClips(project);
  const clipInfo = (id: string): ImpactClip | null => {
    const i = layout.findIndex((l) => l.clip.id === id);
    if (i < 0) return null;
    return { id, index: i + 1, name: assets[layout[i].clip.assetId]?.name ?? 'klip' };
  };
  /** Aralığa değen klipler; nokta (start === end) için o andaki klip */
  const clipsIn = (start: number, end: number) =>
    layout
      .filter((l) => (start === end ? start >= l.start && start < l.end : l.end > start + 1e-6 && l.start < end - 1e-6))
      .map((l) => clipInfo(l.clip.id)!);
  const whole = { scope: 'project' as const, scopeLabel: 'Tüm proje (bütün çıktılar)' };
  const track = (name: string) => ({ scope: 'track' as const, scopeLabel: `${name} izi · bütün çıktılar` });
  const clipRange = (id: string) => {
    const l = layout.find((x) => x.clip.id === id);
    return l ? { start: l.start, end: l.end } : null;
  };

  return ops.map((op): ImpactItem => {
    const label = describeOp(op);
    switch (op.type) {
      case 'timeline.deleteRange': {
        const warnings: string[] = [];
        const inside = (t: number) => t >= op.start && t < op.end;
        for (const tx of project.texts) if (inside(tx.start)) warnings.push(`“${tx.text}” yazısı da silinir`);
        for (const o of project.overlays) if (inside(o.at)) warnings.push(`Üst izdeki ${assets[o.assetId]?.name ?? 'görüntü'} da silinir`);
        for (const v of project.voice) {
          const end = v.at + (v.out - v.in);
          if (v.at < op.end && end > op.start) warnings.push('Dış ses bu aralıkla çakışıyor; dış ses kesilmez, yerinde kalır');
        }
        return { label, clips: clipsIn(op.start, op.end), range: { start: op.start, end: op.end }, ...whole, warnings };
      }
      case 'clip.trim':
      case 'clip.update':
      case 'clip.setLook':
        return { label, clips: [clipInfo(op.clipId)].filter(Boolean) as ImpactClip[], range: clipRange(op.clipId), ...whole };
      case 'clip.split':
        return { label, clips: [clipInfo(op.clipId)].filter(Boolean) as ImpactClip[], range: { start: op.at, end: op.at }, ...whole };
      case 'clips.remove':
        return { label, clips: [clipInfo(op.clipId)].filter(Boolean) as ImpactClip[], range: clipRange(op.clipId), ...whole };
      case 'overlay.add':
        return { label, clips: clipsIn(op.at, op.at + op.duration), range: { start: op.at, end: op.at + op.duration }, ...track('Üst iz') };
      case 'text.add':
        return { label, clips: [], range: op.text.start !== undefined && op.text.end !== undefined ? { start: op.text.start, end: op.text.end } : null, ...track('Yazı') };
      case 'voice.add':
        return { label, clips: [], range: { start: op.at, end: op.at + (assets[op.assetId]?.duration ?? 0) }, ...track('Dış ses') };
      case 'music.set':
        return { label, clips: [], range: null, ...track('Müzik') };
      case 'output.setFraming':
      case 'output.setStill':
        return {
          label,
          clips: [clipInfo(op.clipId)].filter(Boolean) as ImpactClip[],
          range: clipRange(op.clipId),
          scope: 'output',
          scopeLabel: `Yalnız ${outputLabel(project, op.outputId)} çıktısı`,
        };
      case 'output.update':
      case 'output.remove':
        return { label, clips: [], range: null, scope: 'output', scopeLabel: `Yalnız ${outputLabel(project, op.outputId)} çıktısı` };
      case 'captions.set':
      case 'captions.editWord':
        return { label, clips: [], range: null, ...track('Altyazı') };
      default:
        return { label, clips: [], range: null, ...whole };
    }
  });
};
