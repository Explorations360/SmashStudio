import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../core/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [FormsModule],
  template: `
  <div class="min-h-screen flex items-center justify-center bg-gradient-to-br from-navy-900 to-navy-950 p-4">
    <div class="bg-navy-800 border border-white/10 shadow-2xl rounded-2xl p-8 w-full max-w-sm">
      <div class="bg-white rounded-xl px-4 py-3 mb-5 flex justify-center">
        <img src="logo-explorations360.webp" alt="explorations360" class="h-9" />
      </div>
      <h1 class="text-2xl font-semibold mb-1 text-center">Smash <span class="text-brand-400">Studio</span></h1>
      <p class="text-slate-400 text-sm mb-6 text-center">Voix ElevenLabs multi-voix & assemblage MP3</p>
      <input [(ngModel)]="email" type="email" placeholder="Email"
        class="w-full border rounded-lg px-3 py-2 mb-3 focus:outline-none focus:border-brand-400" />
      <input [(ngModel)]="pass" type="password" placeholder="Mot de passe"
        class="w-full border rounded-lg px-3 py-2 mb-4 focus:outline-none focus:border-brand-400" />
      @if (error()) { <p class="text-red-400 text-sm mb-3">{{ error() }}</p> }
      <button (click)="login()" class="w-full bg-brand-500 hover:bg-brand-400 text-white font-medium rounded-lg py-2 mb-2">Se connecter</button>
      <button (click)="register()" class="w-full border rounded-lg py-2 mb-2 text-sm hover:bg-white/5">Créer un compte</button>
      <button (click)="google()" class="w-full border rounded-lg py-2 text-sm hover:bg-white/5">Continuer avec Google</button>
    </div>
  </div>`,
})
export class LoginComponent {
  private auth = inject(AuthService);
  private router = inject(Router);
  email = ''; pass = '';
  error = signal('');

  private go() { this.router.navigate(['/sounds']); }
  async login() { try { await this.auth.loginEmail(this.email, this.pass); this.go(); } catch (e: any) { this.error.set(e.message); } }
  async register() { try { await this.auth.registerEmail(this.email, this.pass); this.go(); } catch (e: any) { this.error.set(e.message); } }
  async google() { try { await this.auth.loginGoogle(); this.go(); } catch (e: any) { this.error.set(e.message); } }
}
