import { Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet, Router } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { SoundsService } from '../core/sounds.service';
import { ToastService } from '../core/toast.service';
import { ConfirmDialogComponent } from '../core/confirm-dialog.component';

@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, RouterOutlet, ConfirmDialogComponent],
  template: `
  <div class="min-h-screen flex flex-col">
    <header class="bg-navy-900 border-b border-white/10 text-white px-6 py-3 flex items-center gap-6">
      <span class="flex items-center gap-3">
        <span class="bg-white rounded-lg px-2 py-1 inline-flex items-center"><img src="logo-explorations360.webp" alt="explorations360" class="h-6" /></span>
        <span class="font-semibold text-lg tracking-wide">Smash <span class="text-brand-400">Studio</span></span>
      </span>
      <nav class="flex gap-4 text-sm">
        <a routerLink="/sounds" routerLinkActive="text-brand-400" class="hover:text-brand-300">Sons</a>
        @if (auth.canEdit()) {
          <a routerLink="/settings" routerLinkActive="text-brand-400" class="hover:text-brand-300">Réglages</a>
        }
        @if (auth.isAdmin()) {
          <a routerLink="/accounts" routerLinkActive="text-brand-400" class="hover:text-brand-300">Comptes</a>
        }
      </nav>
      <span class="ml-auto text-sm text-slate-300">
        {{ auth.user()?.email }}
        <span class="ml-1 text-xs bg-white/10 px-2 py-0.5 rounded-full">{{ roleLabel() }}</span>
      </span>
      <button (click)="logout()" title="Se déconnecter de Smash Studio" class="text-sm bg-white/10 hover:bg-white/20 px-3 py-1 rounded-lg">Déconnexion</button>
    </header>
    <main class="flex-1 p-6 max-w-7xl mx-auto w-full"><router-outlet></router-outlet></main>

    <app-confirm-dialog />

    <div class="fixed bottom-4 right-4 z-50 flex flex-col gap-2 items-end">
      @for (t of toast.toasts(); track t.id) {
        <div class="shadow-xl rounded-xl px-4 py-3 text-sm flex items-center gap-3 text-white"
          [class.bg-emerald-700]="!t.error" [class.bg-red-700]="t.error">
          <span>{{ t.text }}</span>
          @if (t.url) { <a [href]="t.url" target="_blank" class="underline font-semibold shrink-0">écouter</a> }
          <button (click)="toast.dismiss(t.id)" class="text-white/70 hover:text-white leading-none">✕</button>
        </div>
      }
    </div>
  </div>`,
})
export class ShellComponent {
  auth = inject(AuthService);
  sounds = inject(SoundsService);
  toast = inject(ToastService);
  private router = inject(Router);
  constructor() {
    // le guard "approved" garantit qu'on arrive ici approuvé → accès lecture aux sons
    this.sounds.listen();
  }
  roleLabel() {
    return ({ admin: 'Admin', editor: 'Éditeur', user: 'Utilisateur' } as const)[this.auth.profile()?.role ?? 'user'];
  }
  async logout() { this.sounds.stop(); await this.auth.logout(); this.router.navigate(['/login']); }
}
