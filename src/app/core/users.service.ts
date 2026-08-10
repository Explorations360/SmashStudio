import { Injectable, signal } from '@angular/core';
import {
  collection, doc, getDoc, onSnapshot, orderBy, query, setDoc, updateDoc,
} from 'firebase/firestore';
import { User } from 'firebase/auth';
import { db } from './firebase';
import { UserProfile, UserRole } from './models';

// Emails promus admin approuvé à la création de leur profil (bootstrap du premier admin).
// Doit rester synchronisé avec firestore.rules.
const BOOTSTRAP_ADMINS = ['immersion.tools@gmail.com'];

@Injectable({ providedIn: 'root' })
export class UsersService {
  readonly all = signal<UserProfile[]>([]);
  private unsubAll?: () => void;

  async ensureProfile(u: User): Promise<void> {
    const ref = doc(db, 'users', u.uid);
    const snap = await getDoc(ref);
    if (snap.exists()) return;
    const email = (u.email ?? '').toLowerCase();
    const isBootstrapAdmin = BOOTSTRAP_ADMINS.includes(email);
    await setDoc(ref, {
      email,
      role: isBootstrapAdmin ? 'admin' : 'user',
      approved: isBootstrapAdmin,
      createdAt: Date.now(),
    });
  }

  watchProfile(uid: string, cb: (p: UserProfile | null) => void) {
    return onSnapshot(doc(db, 'users', uid), (s) => {
      cb(s.exists() ? ({ uid, ...(s.data() as Omit<UserProfile, 'uid'>) }) : null);
    });
  }

  listenAll() {
    this.unsubAll?.();
    const q = query(collection(db, 'users'), orderBy('createdAt', 'asc'));
    this.unsubAll = onSnapshot(q, (snap) => {
      this.all.set(snap.docs.map((d) => ({ uid: d.id, ...(d.data() as Omit<UserProfile, 'uid'>) })));
    });
  }
  stopAll() { this.unsubAll?.(); this.unsubAll = undefined; this.all.set([]); }

  setRole(uid: string, role: UserRole) { return updateDoc(doc(db, 'users', uid), { role }); }
  setApproved(uid: string, approved: boolean) { return updateDoc(doc(db, 'users', uid), { approved }); }
}
