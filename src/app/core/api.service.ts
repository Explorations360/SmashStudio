import { Injectable } from '@angular/core';
import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase';

/** Encode un fichier en base64 (transport via callable). */
async function toBase64(file: File): Promise<string> {
  const buf = new Uint8Array(await file.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 8192) bin += String.fromCharCode(...buf.subarray(i, i + 8192));
  return btoa(bin);
}

export interface ElevenVoice { voiceId: string; name: string; category: string; }
export interface Usage {
  eleven: { tier?: string; used?: number; limit?: number; resetAt?: number | null; error?: string };
  claude: { month?: string; calls?: number; inputTokens?: number; outputTokens?: number; estCostUsd?: number; error?: string };
}

@Injectable({ providedIn: 'root' })
export class ApiService {
  // Consommation / crédits restants ElevenLabs + Claude
  async getUsage(): Promise<Usage> {
    const res = await httpsCallable(functions, 'getUsage')({});
    return res.data as Usage;
  }
  // Liste les voix du compte ElevenLabs (clé API côté serveur)
  async listVoices(): Promise<ElevenVoice[]> {
    const res = await httpsCallable(functions, 'listVoices')({});
    return (res.data as any)?.voices ?? [];
  }
  // Génère la voix ElevenLabs d'un segment (backend sécurisé)
  async generateSegment(soundId: string, segmentId: string): Promise<{ url: string; path: string; generatedAt: number }> {
    const res = await httpsCallable(functions, 'generateSegment', { timeout: 120_000 })({ soundId, segmentId });
    return res.data as any;
  }
  // Assemble les segments du son en un seul MP3 — peut durer plusieurs minutes.
  // segmentIds fourni → assemblage d'essai de ce sous-ensemble (le MP3 final n'est pas touché).
  async assembleSound(soundId: string, segmentIds?: string[]): Promise<{ url: string; count: number; sizeMb: number; durationSec: number; version?: number }> {
    const call = httpsCallable(functions, 'assembleSound', { timeout: 300_000 });
    const res = await call({ soundId, ...(segmentIds?.length ? { segmentIds } : {}) });
    return res.data as any;
  }
  // Définit (ou retire, sans fichier) le jingle d'intro d'un projet
  async setProjectIntro(projectId: string, file?: File): Promise<{ url?: string; name?: string; durationSec?: number; removed?: boolean }> {
    const payload: any = { projectId };
    if (file) { payload.dataBase64 = await toBase64(file); payload.name = file.name; }
    const res = await httpsCallable(functions, 'setProjectIntro', { timeout: 120_000 })(payload);
    return res.data as any;
  }
  // Définit (ou retire, sans fichier) l'image d'un projet ou d'un son
  async setImage(scope: 'project' | 'sound', id: string, file?: File): Promise<{ url?: string; name?: string; removed?: boolean }> {
    const payload: any = { scope, id };
    if (file) { payload.dataBase64 = await toBase64(file); payload.name = file.name; }
    const res = await httpsCallable(functions, 'setImage', { timeout: 120_000 })(payload);
    return res.data as any;
  }
  // Génère le MP4 (image fixe + MP3 assemblé) — peut durer plusieurs minutes
  async generateVideo(soundId: string): Promise<{ url: string; sizeMb: number; width: number; height: number; version: number }> {
    const call = httpsCallable(functions, 'generateVideo', { timeout: 540_000 });
    const res = await call({ soundId });
    return res.data as any;
  }
  // Réinitialise un son ('all' = segments + final, 'final' = fichier assemblé seul)
  resetSound(soundId: string, scope: 'all' | 'final' = 'all') {
    return httpsCallable(functions, 'resetSound')({ soundId, scope });
  }
  // Rebalise un texte avec les balises audio ElevenLabs v3 (via Claude, clé API côté serveur)
  async tagText(text: string, opts?: { dynamism?: string; maxTags?: number | null }): Promise<string> {
    const payload: any = { text };
    if (opts?.dynamism) payload.dynamism = opts.dynamism;
    if (opts?.maxTags) payload.maxTags = opts.maxTags;
    const res = await httpsCallable(functions, 'tagText')(payload);
    return (res.data as any)?.tagged ?? '';
  }
  // Synchronise les règles de prononciation vers le dictionnaire ElevenLabs
  async syncPronunciation(): Promise<{ dictId: string; versionId: string; count: number }> {
    const res = await httpsCallable(functions, 'syncPronunciation')({});
    return res.data as any;
  }
}
