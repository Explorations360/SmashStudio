import { Injectable } from '@angular/core';
import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase';

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
  generateSegment(soundId: string, segmentId: string) {
    return httpsCallable(functions, 'generateSegment', { timeout: 120_000 })({ soundId, segmentId });
  }
  // Assemble tous les segments du son en un seul MP3 — peut durer plusieurs minutes
  async assembleSound(soundId: string): Promise<{ url: string; count: number; sizeMb: number; durationSec: number }> {
    const call = httpsCallable(functions, 'assembleSound', { timeout: 300_000 });
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
