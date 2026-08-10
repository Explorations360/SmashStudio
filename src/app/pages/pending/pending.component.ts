import { Component, effect, inject } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../core/auth.service';

@Component({
  selector: 'app-pending',
  standalone: true,
  template: `
  <div class="min-h-screen flex items-center justify-center">
    <div class="bg-navy-800 shadow-xl rounded-2xl p-8 w-full max-w-md text-center">
      <h1 class="text-2xl font-bold mb-2">⏳ Compte en attente</h1>
      <p class="text-slate-300 text-sm mb-1">{{ auth.user()?.email }}</p>
      <p class="text-slate-400 text-sm mb-6">
        Votre compte doit être approuvé par un administrateur avant de pouvoir accéder aux données.
        Cette page se mettra à jour automatiquement dès l'approbation.
      </p>
      <button (click)="logout()" class="border rounded-lg px-4 py-2 text-sm">Se déconnecter</button>
    </div>
  </div>`,
})
export class PendingComponent {
  auth = inject(AuthService);
  private router = inject(Router);

  private redirect = effect(() => {
    if (this.auth.ready() && !this.auth.user()) this.router.navigate(['/login']);
    else if (this.auth.isApproved()) this.router.navigate(['/sounds']);
  });

  async logout() { await this.auth.logout(); this.router.navigate(['/login']); }
}
