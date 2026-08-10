import { Injectable, signal } from '@angular/core';

export interface ConfirmOptions {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean; // action destructive → bouton rouge
}

interface ConfirmState extends Required<ConfirmOptions> {}

/** Boîte de dialogue de confirmation stylée (remplace confirm() natif). */
@Injectable({ providedIn: 'root' })
export class ConfirmService {
  readonly state = signal<ConfirmState | null>(null);
  private resolver?: (v: boolean) => void;

  ask(opts: ConfirmOptions): Promise<boolean> {
    this.close(false); // une éventuelle demande en attente est annulée
    this.state.set({
      title: opts.title ?? 'Confirmation',
      message: opts.message,
      confirmLabel: opts.confirmLabel ?? 'Confirmer',
      cancelLabel: opts.cancelLabel ?? 'Annuler',
      danger: opts.danger ?? false,
    });
    return new Promise((res) => (this.resolver = res));
  }

  close(result: boolean) {
    if (!this.state()) return;
    this.state.set(null);
    this.resolver?.(result);
    this.resolver = undefined;
  }
}
