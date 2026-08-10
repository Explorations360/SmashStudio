import { Component, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { UsersService } from '../../core/users.service';
import { AuthService } from '../../core/auth.service';
import { UserProfile, UserRole } from '../../core/models';

@Component({
  selector: 'app-accounts',
  standalone: true,
  template: `
  <div class="flex items-center gap-3 mb-4">
    <h1 class="text-xl font-bold">Comptes ({{ users.all().length }})</h1>
    @if (pendingCount() > 0) {
      <span class="bg-amber-400/20 text-amber-300 text-xs px-2 py-0.5 rounded-full">{{ pendingCount() }} en attente</span>
    }
  </div>

  <div class="overflow-x-auto bg-navy-800 rounded-xl shadow">
    <table class="w-full text-sm">
      <thead class="bg-navy-900/70 text-left">
        <tr>
          <th class="p-2">Email</th><th class="p-2">Rôle</th><th class="p-2">Statut</th>
          <th class="p-2">Créé le</th><th class="p-2">Actions</th>
        </tr>
      </thead>
      <tbody>
        @for (u of users.all(); track u.uid) {
          <tr class="border-t" [class.bg-amber-400/10]="!u.approved">
            <td class="p-2 font-semibold text-slate-200">
              {{ u.email }}
              @if (u.uid === auth.uid) { <span class="text-xs text-slate-400">(moi)</span> }
            </td>
            <td class="p-2">
              <select [value]="u.role" (change)="setRole(u, $any($event.target).value)"
                [disabled]="u.uid === auth.uid"
                [title]="u.uid === auth.uid ? 'On ne peut pas changer son propre rôle' : 'Changer le rôle de ce compte'"
                class="border rounded px-2 py-1 disabled:opacity-50">
                <option value="admin">Admin</option>
                <option value="editor">Éditeur</option>
                <option value="user">Utilisateur</option>
              </select>
            </td>
            <td class="p-2">
              @if (u.approved) { <span class="px-2 py-0.5 rounded text-xs bg-emerald-400/20 text-emerald-300">Approuvé</span> }
              @else { <span class="px-2 py-0.5 rounded text-xs bg-amber-400/20 text-amber-300">En attente</span> }
            </td>
            <td class="p-2 text-slate-400">{{ formatDate(u.createdAt) }}</td>
            <td class="p-2 whitespace-nowrap">
              @if (!u.approved) {
                <button (click)="approve(u, true)" title="Autoriser ce compte à accéder aux données" class="text-xs bg-brand-500 text-white px-2 py-1 rounded">✓ Approuver</button>
              } @else if (u.uid !== auth.uid) {
                <button (click)="approve(u, false)" title="Retirer l'accès aux données (le compte repasse en attente)" class="text-xs text-red-400 border border-red-300 px-2 py-1 rounded">Révoquer</button>
              }
            </td>
          </tr>
        }
      </tbody>
    </table>
  </div>
  <p class="mt-3 text-xs text-slate-400">
    Admin : gestion des comptes + édition · Éditeur : création, import, génération voix/vidéo · Utilisateur : lecture seule.
  </p>
  @if (message()) { <p class="mt-2 text-sm text-red-400">{{ message() }}</p> }
  `,
})
export class AccountsComponent implements OnInit, OnDestroy {
  users = inject(UsersService);
  auth = inject(AuthService);
  message = signal('');

  pendingCount = () => this.users.all().filter((u) => !u.approved).length;

  ngOnInit() { this.users.listenAll(); }
  ngOnDestroy() { this.users.stopAll(); }

  async setRole(u: UserProfile, role: UserRole) {
    try { await this.users.setRole(u.uid, role); }
    catch (e: any) { this.message.set('❌ ' + e.message); }
  }
  async approve(u: UserProfile, approved: boolean) {
    try { await this.users.setApproved(u.uid, approved); }
    catch (e: any) { this.message.set('❌ ' + e.message); }
  }
  formatDate(ts: number) { return ts ? new Date(ts).toLocaleDateString() : '—'; }
}
