import { Component, HostListener, inject } from '@angular/core';
import { ConfirmService } from './confirm.service';

@Component({
  selector: 'app-confirm-dialog',
  standalone: true,
  template: `
  @if (svc.state(); as s) {
    <div class="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4" (click)="svc.close(false)">
      <div class="bg-navy-800 border border-white/10 rounded-2xl p-6 w-full max-w-md shadow-2xl" (click)="$event.stopPropagation()">
        <div class="flex items-start gap-3 mb-3">
          <span class="text-2xl leading-none mt-0.5">{{ s.danger ? '⚠️' : '❓' }}</span>
          <div>
            <p class="font-semibold text-slate-100">{{ s.title }}</p>
            <p class="text-sm text-slate-300 mt-1 whitespace-pre-line">{{ s.message }}</p>
          </div>
        </div>
        <div class="flex justify-end gap-2 mt-5">
          <button (click)="svc.close(false)" class="border px-4 py-2 rounded-lg text-sm hover:bg-white/10">{{ s.cancelLabel }}</button>
          <button (click)="svc.close(true)" autofocus
            class="px-4 py-2 rounded-lg text-sm font-medium text-white"
            [class.bg-red-600]="s.danger" [class.hover:bg-red-500]="s.danger"
            [class.bg-brand-500]="!s.danger" [class.hover:bg-brand-400]="!s.danger">{{ s.confirmLabel }}</button>
        </div>
      </div>
    </div>
  }`,
})
export class ConfirmDialogComponent {
  svc = inject(ConfirmService);

  @HostListener('document:keydown.escape') onEsc() { this.svc.close(false); }
  @HostListener('document:keydown.enter') onEnter() { if (this.svc.state()) this.svc.close(true); }
}
