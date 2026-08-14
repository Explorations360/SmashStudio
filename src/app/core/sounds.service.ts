import { Injectable, signal } from '@angular/core';
import {
  collection, query, orderBy, onSnapshot, addDoc, updateDoc, deleteDoc,
  doc, setDoc, getDoc, writeBatch,
} from 'firebase/firestore';
import { db } from './firebase';
import { Sound, Project, Settings, DEFAULT_SETTINGS } from './models';

// Firestore refuse `undefined` : on nettoie récursivement avant toute écriture
function stripUndefined<T>(v: T): T {
  if (Array.isArray(v)) return v.map(stripUndefined) as unknown as T;
  if (v && typeof v === 'object') {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>)
        .filter(([, x]) => x !== undefined)
        .map(([k, x]) => [k, stripUndefined(x)])
    ) as T;
  }
  return v;
}

@Injectable({ providedIn: 'root' })
export class SoundsService {
  readonly sounds = signal<Sound[]>([]);
  readonly projects = signal<Project[]>([]);
  private unsub?: () => void;
  private unsubProjects?: () => void;

  // espace de travail partagé : tous les comptes approuvés voient les mêmes sons
  listen() {
    this.unsub?.();
    const q = query(collection(db, 'sounds'), orderBy('order', 'asc'));
    this.unsub = onSnapshot(q, (snap) => {
      this.sounds.set(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Sound) })));
    });
    this.unsubProjects?.();
    const qp = query(collection(db, 'projects'), orderBy('name', 'asc'));
    this.unsubProjects = onSnapshot(qp, (snap) => {
      this.projects.set(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Project) })));
    });
  }
  stop() {
    this.unsub?.(); this.unsub = undefined; this.sounds.set([]);
    this.unsubProjects?.(); this.unsubProjects = undefined; this.projects.set([]);
  }

  // --- projets (un projet = un podcast = une liste de sons) ---
  createProject(name: string) {
    return addDoc(collection(db, 'projects'), { name: name.trim(), createdAt: Date.now(), updatedAt: Date.now() });
  }
  renameProject(id: string, name: string) {
    return updateDoc(doc(db, 'projects', id), { name: name.trim(), updatedAt: Date.now() });
  }
  updateProject(id: string, patch: Partial<Project>) {
    return updateDoc(doc(db, 'projects', id), stripUndefined({ ...patch, updatedAt: Date.now() }));
  }
  /** Supprime le projet ; ses sons sont conservés et repassent « sans projet ». */
  async removeProject(id: string) {
    const batch = writeBatch(db);
    this.sounds().filter((s) => s.projectId === id && s.id)
      .forEach((s) => batch.update(doc(db, 'sounds', s.id!), { projectId: null, updatedAt: Date.now() }));
    batch.delete(doc(db, 'projects', id));
    await batch.commit();
  }

  create(sound: Sound) { return addDoc(collection(db, 'sounds'), stripUndefined({ ...sound, updatedAt: Date.now() })); }
  update(id: string, patch: Partial<Sound>) { return updateDoc(doc(db, 'sounds', id), stripUndefined({ ...patch, updatedAt: Date.now() })); }
  remove(id: string) { return deleteDoc(doc(db, 'sounds', id)); }

  /**
   * Propage un changement de palette (Réglages) sur tous les segments qui utilisent
   * le rôle : nouvelle voix + statut remis à « non généré » si la voix a changé.
   */
  async applyVoiceSlotChanges(changes: { oldLabel: string; newLabel: string; voiceId: string; voiceChanged: boolean }[]) {
    let segs = 0, soundsTouched = 0, regen = 0;
    for (const sound of this.sounds()) {
      if (!sound.id) continue;
      let touched = false, needsRegen = false;
      const segments = sound.segments.map((s) => {
        const ch = changes.find((c) => c.oldLabel && s.voiceName === c.oldLabel);
        if (!ch || (s.voiceId === ch.voiceId && s.voiceName === ch.newLabel)) return s;
        touched = true; segs++;
        const resetStatus = ch.voiceChanged && s.status === 'generated';
        if (resetStatus) { needsRegen = true; regen++; }
        return {
          ...s, voiceId: ch.voiceId, voiceName: ch.newLabel,
          ...(resetStatus ? { status: 'not_generated' as const } : {}),
        };
      });
      if (touched) {
        soundsTouched++;
        await this.update(sound.id, {
          segments,
          ...(needsRegen && (sound.assemblyStatus === 'done') ? { assemblyStatus: 'stale' as const } : {}),
        });
      }
    }
    return { segs, soundsTouched, regen };
  }

  // réglages partagés par toute l'équipe (doc unique 'global')
  async getSettings(): Promise<Settings> {
    const s = await getDoc(doc(db, 'settings', 'global'));
    return s.exists() ? { ...DEFAULT_SETTINGS, ...(s.data() as Settings) } : { ...DEFAULT_SETTINGS };
  }
  saveSettings(s: Settings) { return setDoc(doc(db, 'settings', 'global'), s, { merge: true }); }
}
