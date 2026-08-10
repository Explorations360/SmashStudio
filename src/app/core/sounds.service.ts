import { Injectable, signal } from '@angular/core';
import {
  collection, query, orderBy, onSnapshot, addDoc, updateDoc, deleteDoc,
  doc, setDoc, getDoc,
} from 'firebase/firestore';
import { db } from './firebase';
import { Sound, Settings, DEFAULT_SETTINGS } from './models';

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
  private unsub?: () => void;

  // espace de travail partagé : tous les comptes approuvés voient les mêmes sons
  listen() {
    this.unsub?.();
    const q = query(collection(db, 'sounds'), orderBy('order', 'asc'));
    this.unsub = onSnapshot(q, (snap) => {
      this.sounds.set(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Sound) })));
    });
  }
  stop() { this.unsub?.(); this.unsub = undefined; this.sounds.set([]); }

  create(sound: Sound) { return addDoc(collection(db, 'sounds'), stripUndefined({ ...sound, updatedAt: Date.now() })); }
  update(id: string, patch: Partial<Sound>) { return updateDoc(doc(db, 'sounds', id), stripUndefined({ ...patch, updatedAt: Date.now() })); }
  remove(id: string) { return deleteDoc(doc(db, 'sounds', id)); }

  // réglages partagés par toute l'équipe (doc unique 'global')
  async getSettings(): Promise<Settings> {
    const s = await getDoc(doc(db, 'settings', 'global'));
    return s.exists() ? { ...DEFAULT_SETTINGS, ...(s.data() as Settings) } : { ...DEFAULT_SETTINGS };
  }
  saveSettings(s: Settings) { return setDoc(doc(db, 'settings', 'global'), s, { merge: true }); }
}
