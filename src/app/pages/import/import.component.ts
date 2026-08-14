import { Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { SoundsService } from '../../core/sounds.service';
import { AuthService } from '../../core/auth.service';
import { ToastService } from '../../core/toast.service';
import { Settings, DEFAULT_SETTINGS, Segment, segmentId } from '../../core/models';

interface ImportRow { voiceLabel: string; text: string; pause: number | null; matchedVoiceId: string; matchedLabel: string; }
interface ImportFile { name: string; title: string; rows: ImportRow[]; skipUnassigned: boolean; }

@Component({
  selector: 'app-import',
  standalone: true,
  imports: [FormsModule],
  template: `
  <h1 class="text-xl font-bold mb-1">Importer des CSV</h1>
  <p class="text-sm text-slate-400 mb-4 max-w-3xl">
    Un fichier CSV = un son. Colonnes attendues : <code class="text-xs bg-navy-800 px-1 rounded">Ordre;Voix;Texte</code>
    (+ <code class="text-xs bg-navy-800 px-1 rounded">Pause</code> optionnelle). Les voix sont associées à la
    palette des Réglages par leur libellé (ex. « Voix femme principale »).
  </p>

  <div class="flex flex-wrap items-center gap-3 mb-4">
    <input type="file" accept=".csv" multiple (change)="onFiles($event)"
      class="text-sm file:bg-brand-500 file:text-white file:border-0 file:rounded-lg file:px-3 file:py-1.5 file:mr-3" />
    <label class="text-sm flex items-center gap-2">Projet cible
      <select [(ngModel)]="targetProjectId" title="Les sons importés seront rangés dans ce projet"
        class="border rounded-lg px-2 py-1.5 bg-navy-800">
        <option value="">— sans projet —</option>
        @for (p of svc.projects(); track p.id) { <option [value]="p.id">{{ p.name }}</option> }
      </select>
    </label>
  </div>

  @if (paletteEmpty()) {
    <p class="text-sm text-amber-400 mb-4">⚠ Aucune voix configurée dans la palette (Réglages) : les segments seront importés sans voix assignée.</p>
  }

  @for (f of files(); track f.name; let fi = $index) {
    <div class="bg-navy-800 border border-white/10 rounded-2xl shadow-xl p-4 mb-3">
      <div class="flex flex-wrap items-center gap-3 mb-2">
        <label class="text-sm flex-1 min-w-64">Titre du son
          <input [(ngModel)]="f.title" class="w-full border rounded px-2 py-1 mt-1" />
        </label>
        <span class="text-xs text-slate-400">{{ f.rows.length }} segment(s)</span>
        @if (unassignedCount(f)) {
          <label class="text-xs flex items-center gap-1.5 text-amber-300" title="Les segments sans voix sont en général les intertitres du document — décoche pour les importer quand même (voix à choisir ensuite)">
            <input type="checkbox" [(ngModel)]="f.skipUnassigned" class="accent-brand-500" />
            ignorer les {{ unassignedCount(f) }} segment(s) sans voix (intertitres)
          </label>
        }
        @if (unmatchedCount(f)) {
          <span class="text-xs text-red-400" title="Libellés de voix absents de la palette des Réglages — voix à choisir après import">
            {{ unmatchedCount(f) }} voix non reconnue(s)
          </span>
        }
        <button (click)="removeFile(fi)" title="Retirer ce fichier de l'import" class="text-red-400 border border-red-300 px-2 py-0.5 rounded text-xs">✕</button>
      </div>
      <div class="max-h-56 overflow-auto border border-white/10 rounded-lg">
        <table class="w-full text-xs">
          <tbody>
            @for (r of f.rows; track $index; let i = $index) {
              <tr class="border-t border-white/5 odd:bg-white/[0.02]" [class.opacity-40]="f.skipUnassigned && !r.voiceLabel">
                <td class="px-2 py-1.5 text-slate-500 w-8">{{ i + 1 }}</td>
                <td class="px-2 py-1.5 whitespace-nowrap w-44">
                  @if (r.matchedVoiceId) { <span class="text-emerald-300">{{ r.matchedLabel }}</span> }
                  @else if (r.voiceLabel) { <span class="text-red-400" [title]="'« ' + r.voiceLabel + ' » absent de la palette'">{{ r.voiceLabel }} ?</span> }
                  @else { <span class="text-slate-500 italic">sans voix</span> }
                </td>
                <td class="px-2 py-1.5 text-slate-300"><span class="line-clamp-2">{{ r.text }}</span></td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    </div>
  }

  @if (files().length) {
    <div class="flex items-center gap-3 mt-4">
      <button (click)="importAll()" [disabled]="importing()"
        class="bg-brand-500 hover:bg-brand-400 text-white px-4 py-2 rounded-lg disabled:opacity-40">
        {{ importing() ? 'Import en cours…' : 'Créer ' + files().length + ' son(s)' }}
      </button>
      @if (message()) { <span class="text-sm text-slate-300">{{ message() }}</span> }
    </div>
  }`,
})
export class ImportComponent implements OnInit {
  svc = inject(SoundsService);
  private auth = inject(AuthService);
  targetProjectId = '';
  private toast = inject(ToastService);
  private router = inject(Router);

  files = signal<ImportFile[]>([]);
  importing = signal(false);
  message = signal('');
  private settings: Settings = { ...DEFAULT_SETTINGS };

  async ngOnInit() { this.settings = await this.svc.getSettings(); }
  paletteEmpty() { return !(this.settings.voices ?? []).some((v) => v.voiceId); }

  unassignedCount(f: ImportFile) { return f.rows.filter((r) => !r.voiceLabel).length; }
  unmatchedCount(f: ImportFile) { return f.rows.filter((r) => r.voiceLabel && !r.matchedVoiceId).length; }
  removeFile(i: number) { this.files.update((fs) => fs.filter((_, idx) => idx !== i)); }

  private norm(s: string) {
    return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]+/g, ' ').trim();
  }
  private matchVoice(label: string): { voiceId: string; label: string } | null {
    if (!label) return null;
    const n = this.norm(label);
    const slots = (this.settings.voices ?? []).filter((v) => v.voiceId);
    return slots
      .map((v) => ({ v, score: this.norm(v.label) === n ? 2 : (this.norm(v.label).includes(n) || n.includes(this.norm(v.label)) ? 1 : 0) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((x) => ({ voiceId: x.v.voiceId, label: x.v.label }))[0] ?? null;
  }

  async onFiles(ev: Event) {
    const input = ev.target as HTMLInputElement;
    for (const file of Array.from(input.files ?? [])) {
      const text = await file.text();
      const rows = this.parseCsv(text);
      if (!rows.length) { this.toast.error('❌ ' + file.name + ' : CSV vide ou illisible'); continue; }
      // repère les colonnes depuis l'en-tête
      const header = rows[0].map((h) => this.norm(h));
      const col = (name: string) => header.findIndex((h) => h.startsWith(name));
      const cVoice = col('voix'), cText = col('texte'), cPause = col('pause');
      if (cVoice < 0 || cText < 0) { this.toast.error('❌ ' + file.name + ' : colonnes Voix/Texte introuvables'); continue; }
      const parsed: ImportRow[] = rows.slice(1)
        .filter((r) => (r[cText] ?? '').trim())
        .map((r) => {
          const voiceLabel = (r[cVoice] ?? '').trim();
          const m = this.matchVoice(voiceLabel);
          const pause = cPause >= 0 && r[cPause]?.trim() ? Number(String(r[cPause]).replace(',', '.')) : null;
          return { voiceLabel, text: r[cText].trim(), pause: isFinite(pause as number) ? pause : null,
            matchedVoiceId: m?.voiceId ?? '', matchedLabel: m?.label ?? '' };
        });
      const title = file.name.replace(/\.csv$/i, '');
      this.files.update((fs) => [...fs.filter((x) => x.name !== file.name),
        { name: file.name, title, rows: parsed, skipUnassigned: true }]);
    }
    input.value = '';
  }

  // parseur CSV minimal : champs entre guillemets (avec "" et retours à la ligne), séparateur ; ou ,
  private parseCsv(text: string): string[][] {
    text = text.replace(/^﻿/, '');
    const firstLine = text.slice(0, text.indexOf('\n') >>> 0);
    const sep = (firstLine.match(/;/g)?.length ?? 0) >= (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';
    const rows: string[][] = [];
    let row: string[] = [], field = '', inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else inQuotes = false;
        } else field += c;
      } else if (c === '"') inQuotes = true;
      else if (c === sep) { row.push(field); field = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(field); field = '';
        if (row.some((f) => f.trim())) rows.push(row);
        row = [];
      } else field += c;
    }
    row.push(field);
    if (row.some((f) => f.trim())) rows.push(row);
    return rows;
  }

  async importAll() {
    this.importing.set(true);
    let created = 0;
    try {
      const baseOrder = this.svc.sounds().length;
      for (const [i, f] of this.files().entries()) {
        const rows = f.rows.filter((r) => !(f.skipUnassigned && !r.voiceLabel));
        if (!rows.length) continue;
        const segments: Segment[] = rows.map((r) => ({
          id: segmentId(),
          voiceId: r.matchedVoiceId,
          // garde le libellé d'origine si la voix n'est pas reconnue (visible dans l'éditeur)
          voiceName: r.matchedLabel || r.voiceLabel,
          textV3: r.text,
          textPlain: r.text.replace(/\[[^\]]*\]/g, '').replace(/\s+/g, ' ').trim(),
          silenceAfter: r.pause,
          status: 'not_generated' as const,
        }));
        await this.svc.create({
          ownerUid: this.auth.uid ?? '', title: f.title, order: baseOrder + i + 1,
          projectId: this.targetProjectId || null,
          segments, assemblyStatus: 'none',
        });
        created++;
      }
      this.toast.success('📥 ' + created + ' son(s) importé(s).');
      this.router.navigate(['/sounds']);
    } catch (e: any) {
      this.toast.error('❌ Import : ' + (e.message || e));
      this.message.set('Import interrompu après ' + created + ' son(s).');
    } finally { this.importing.set(false); }
  }
}
