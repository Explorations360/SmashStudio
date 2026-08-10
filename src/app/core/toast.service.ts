import { Injectable, signal } from '@angular/core';

const TOAST_MS = 8_000;

/** Petites notifications en bas à droite (succès / erreur), affichées par le shell. */
@Injectable({ providedIn: 'root' })
export class ToastService {
  readonly toasts = signal<{ id: number; text: string; error: boolean; url?: string }[]>([]);
  private nextId = 1;

  show(text: string, opts?: { error?: boolean; url?: string }) {
    const id = this.nextId++;
    this.toasts.update((t) => [...t, { id, text, error: !!opts?.error, url: opts?.url }]);
    setTimeout(() => this.dismiss(id), TOAST_MS);
  }
  success(text: string, url?: string) { this.show(text, { url }); }
  error(text: string) { this.show(text, { error: true }); }
  dismiss(id: number) { this.toasts.update((t) => t.filter((x) => x.id !== id)); }
}
