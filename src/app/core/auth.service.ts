import { computed, inject, Injectable, signal } from '@angular/core';
import {
  GoogleAuthProvider, onAuthStateChanged, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, signInWithPopup, signOut, User,
} from 'firebase/auth';
import { auth } from './firebase';
import { UsersService } from './users.service';
import { UserProfile } from './models';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private users = inject(UsersService);

  readonly user = signal<User | null>(null);
  readonly ready = signal(false);
  readonly profile = signal<UserProfile | null>(null);
  readonly profileReady = signal(false);
  private unsubProfile?: () => void;

  readonly isApproved = computed(() => this.profile()?.approved === true);
  readonly isAdmin = computed(() => this.profile()?.role === 'admin' && this.isApproved());
  readonly canEdit = computed(() => {
    const p = this.profile();
    return p?.approved === true && (p.role === 'admin' || p.role === 'editor');
  });

  constructor() {
    onAuthStateChanged(auth, async (u) => {
      this.unsubProfile?.(); this.unsubProfile = undefined;
      this.user.set(u);
      this.profile.set(null);
      this.profileReady.set(!u);
      if (u) {
        try { await this.users.ensureProfile(u); } catch (e) { console.error('ensureProfile', e); }
        this.unsubProfile = this.users.watchProfile(u.uid, (p) => {
          this.profile.set(p);
          this.profileReady.set(true);
        });
      }
      this.ready.set(true);
    });
  }
  loginEmail(email: string, pass: string) { return signInWithEmailAndPassword(auth, email, pass); }
  registerEmail(email: string, pass: string) { return createUserWithEmailAndPassword(auth, email, pass); }
  loginGoogle() { return signInWithPopup(auth, new GoogleAuthProvider()); }
  logout() { return signOut(auth); }
  get uid() { return this.user()?.uid ?? null; }
}
