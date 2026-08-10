import { Component, effect, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { SoundsService } from '../../core/sounds.service';
import { ApiService, ElevenVoice } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { ConfirmService } from '../../core/confirm.service';
import { ToastService } from '../../core/toast.service';
import { Sound, Segment, Settings, DEFAULT_SETTINGS, blankSegment } from '../../core/models';

@Component({
  selector: 'app-sound-edit',
  standalone: true,
  imports: [FormsModule],
  template: `
  <div class="max-w-4xl">
    <div class="flex items-center gap-3 mb-4">
      <h1 class="text-xl font-bold">{{ isNew ? 'Nouveau son' : 'Éditer « ' + (model.title || 'sans titre') + ' »' }}</h1>
      @if (model.assemblyStatus === 'stale') {
        <span class="text-xs bg-amber-400/20 text-amber-300 px-2 py-0.5 rounded-full"
          title="Un segment a été régénéré depuis le dernier assemblage">MP3 final à réassembler</span>
      }
    </div>

    <div class="grid grid-cols-4 gap-3 bg-navy-800 border border-white/10 p-5 rounded-2xl shadow-xl mb-4">
      <label class="text-sm col-span-3">Titre
        <input [(ngModel)]="model.title" class="w-full border rounded px-2 py-1 mt-1" placeholder="1. Intro — Le Gouessant Infos 146" />
      </label>
      <label class="text-sm">Ordre
        <input [(ngModel)]="model.order" type="number" class="w-full border rounded px-2 py-1 mt-1" />
      </label>
    </div>

    @for (seg of model.segments; track seg.id; let i = $index) {
      <div class="bg-navy-800 border border-white/10 rounded-2xl shadow-xl p-4 mb-3">
        <div class="flex flex-wrap items-center gap-2 mb-2">
          <span class="font-mono text-xs font-semibold bg-navy-700 text-brand-300 px-2 py-0.5 rounded-md">{{ i + 1 }}</span>
          <select [ngModel]="seg.voiceId" (ngModelChange)="setVoice(seg, $event)"
            title="Voix ElevenLabs qui lit ce segment" class="text-sm border rounded px-2 py-1 min-w-52"
            [class.border-amber-400]="!seg.voiceId">
            <option value="">— choisir une voix —</option>
            @if (palette().length) {
              <optgroup label="Palette (Réglages)">
                @for (v of palette(); track v.voiceId + v.label) { <option [value]="v.voiceId">{{ v.label }}</option> }
              </optgroup>
            }
            @if (voices().length) {
              <optgroup label="Toutes les voix du compte">
                @for (v of voices(); track v.voiceId) { <option [value]="v.voiceId">{{ v.name }}{{ v.category === 'premade' ? ' (usine)' : '' }}</option> }
              </optgroup>
            }
          </select>
          <span class="px-2 py-0.5 rounded text-xs" [class]="statusClass(seg)">{{ statusLabel(seg) }}</span>

          <span class="ml-auto flex items-center gap-1.5">
            @if (seg.audioUrl && seg.status === 'generated') {
              <button (click)="togglePreview(seg)" class="text-xs bg-navy-700 hover:bg-navy-600 text-white px-2.5 py-1 rounded-full"
                [title]="previewId() === seg.id ? 'Arrêter l\\'écoute' : 'Écouter ce segment'">{{ previewId() === seg.id ? '⏹' : '▶' }}</button>
            }
            <button (click)="genOne(seg)" [disabled]="genBusy().has(seg.id) || !seg.voiceId || !seg.textV3.trim()"
              [title]="seg.status === 'generated' ? 'Régénérer la voix de ce segment (remplace l\\'audio)' : 'Générer la voix de ce segment'"
              class="text-xs bg-brand-500 hover:bg-brand-400 text-white px-2 py-1 rounded disabled:opacity-40">
              {{ genBusy().has(seg.id) ? '…' : '🎙 ' + (seg.status === 'generated' ? 'Régénérer' : 'Générer') }}
            </button>
            <button (click)="move(i, -1)" [disabled]="i === 0" title="Monter ce segment" class="text-xs border px-1.5 py-1 rounded disabled:opacity-30">↑</button>
            <button (click)="move(i, 1)" [disabled]="i === model.segments.length - 1" title="Descendre ce segment" class="text-xs border px-1.5 py-1 rounded disabled:opacity-30">↓</button>
            <button (click)="removeSegment(i)" title="Retirer ce segment du son" class="text-xs text-red-400 border border-red-300 px-1.5 py-1 rounded">✕</button>
          </span>
        </div>

        <textarea #txt [(ngModel)]="seg.textV3" rows="3" (ngModelChange)="touch(seg)"
          class="w-full border rounded px-2 py-1 text-sm" placeholder="Texte lu par cette voix (balises [pause], [chaleureux]… acceptées)"></textarea>

        <div class="flex flex-wrap items-center gap-2 mt-1.5">
          <button (click)="retag(seg)" [disabled]="tagBusy().has(seg.id) || !seg.textV3.trim()"
            title="L'IA insère les balises audio ElevenLabs v3 (les mots ne changent pas)"
            class="text-xs bg-white/10 hover:bg-white/20 px-2 py-1 rounded disabled:opacity-40">
            {{ tagBusy().has(seg.id) ? '✨ Balisage…' : '✨ Baliser (IA)' }}
          </button>
          <button (click)="split(i, txt)" [disabled]="!seg.textV3.trim()"
            title="Sélectionne une portion du texte puis clique ici : la sélection devient un nouveau segment juste en dessous (même voix, modifiable). Sans sélection, coupe à la position du curseur."
            class="text-xs bg-white/10 hover:bg-white/20 px-2 py-1 rounded disabled:opacity-40">✂ Scinder</button>
          <label class="text-xs text-slate-400 flex items-center gap-1.5">Pause après (s)
            <input [(ngModel)]="seg.silenceAfter" type="number" step="0.1" min="0" max="10"
              [placeholder]="'global : ' + settings.segmentGap"
              title="Silence inséré après ce segment lors de l'assemblage — vide = réglage global"
              class="border rounded px-1.5 py-0.5 w-24" />
          </label>
          <span class="text-xs text-slate-500 ml-auto">{{ seg.textV3.length }} car.</span>
        </div>
      </div>
    } @empty {
      <p class="text-sm text-slate-400 bg-navy-800 border border-white/10 rounded-2xl p-6 text-center mb-3">
        Aucun segment. Ajoute un premier segment et choisis sa voix.
      </p>
    }

    <div class="flex flex-wrap gap-2 mb-6">
      <button (click)="addSegment()" title="Ajouter un segment à la suite" class="border px-3 py-1.5 rounded-lg text-sm hover:bg-white/10">+ Ajouter un segment</button>
      @if (palette().length) {
        @for (v of palette(); track v.voiceId + v.label) {
          <button (click)="addSegment(v.voiceId)" [title]="'Ajouter un segment lu par ' + v.label"
            class="border border-white/20 px-3 py-1.5 rounded-lg text-xs text-slate-300 hover:bg-white/10">+ {{ v.label }}</button>
        }
      }
    </div>

    <div class="flex flex-wrap gap-2 items-center">
      <button (click)="save()" [disabled]="saving()" title="Enregistrer le son" class="bg-brand-500 hover:bg-brand-400 text-white px-4 py-2 rounded-lg disabled:opacity-40">
        {{ saving() ? 'Enregistrement…' : 'Enregistrer' }}
      </button>
      <button (click)="generateAll()" [disabled]="bulkBusy() || !model.segments.length"
        title="Enregistre puis génère la voix de tous les segments non générés"
        class="bg-brand-500/80 hover:bg-brand-400 text-white px-4 py-2 rounded-lg disabled:opacity-40">
        {{ bulkBusy() ? bulkLabel() : '🎙 Tout générer' }}
      </button>
      <button (click)="assemble()" [disabled]="bulkBusy() || !allGenerated()"
        [title]="allGenerated() ? 'Assembler tous les segments en un seul MP3' : 'Génère d\\'abord tous les segments'"
        class="bg-indigo-500 hover:bg-indigo-400 text-white px-4 py-2 rounded-lg disabled:opacity-40">🔗 Assembler le MP3</button>
      @if (!isNew) { <button (click)="remove()" title="Supprime le son et tous ses audios stockés" class="text-red-400 border border-red-300 px-4 py-2 rounded-lg">Supprimer</button> }
      <button (click)="back()" title="Revenir à la liste" class="border px-4 py-2 rounded-lg">Retour</button>
      @if (message()) { <span class="text-sm text-slate-300">{{ message() }}</span> }
    </div>
  </div>`,
})
export class SoundEditComponent implements OnInit, OnDestroy {
  private svc = inject(SoundsService);
  private api = inject(ApiService);
  private auth = inject(AuthService);
  private confirmDlg = inject(ConfirmService);
  private toast = inject(ToastService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  isNew = true;
  model: Sound = this.blank();
  settings: Settings = { ...DEFAULT_SETTINGS };
  voices = signal<ElevenVoice[]>([]);
  saving = signal(false);
  message = signal('');
  genBusy = signal<Set<string>>(new Set());
  tagBusy = signal<Set<string>>(new Set());
  bulkBusy = signal(false);
  bulkLabel = signal('');
  // mémorise (texte|voix) au chargement pour invalider le statut si ça change
  private baseline = new Map<string, string>();

  private blank(): Sound {
    return {
      ownerUid: this.auth.uid ?? '', title: '', order: (this.svc.sounds().length + 1),
      segments: [], assemblyStatus: 'none',
    };
  }
  private syncFromStore = effect(() => {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id || this.model.id) return;
    const found = this.svc.sounds().find((s) => s.id === id);
    if (found) {
      // copie profonde : l'édition ne doit pas muter le store temps réel
      this.model = { ...found, segments: found.segments.map((x) => ({ ...x })) };
      this.model.segments.forEach((x) => this.baseline.set(x.id, x.textV3 + '|' + x.voiceId));
    }
  });

  async ngOnInit() {
    if (this.route.snapshot.paramMap.get('id')) this.isNew = false;
    this.settings = await this.svc.getSettings();
    try { this.voices.set(await this.api.listVoices()); }
    catch (e: any) { this.message.set('Liste des voix indisponible : ' + (e.message || e)); }
  }

  palette() { return (this.settings.voices ?? []).filter((v) => v.voiceId); }

  setVoice(seg: Segment, voiceId: string) {
    seg.voiceId = voiceId;
    const slot = this.palette().find((v) => v.voiceId === voiceId);
    seg.voiceName = slot?.label ?? this.voices().find((v) => v.voiceId === voiceId)?.name ?? '';
    this.touch(seg);
  }
  // texte ou voix modifiés après génération → l'audio existant est obsolète
  touch(seg: Segment) {
    if (seg.status === 'generated' && this.baseline.get(seg.id) !== seg.textV3 + '|' + seg.voiceId) {
      seg.status = 'not_generated';
    }
  }

  addSegment(voiceId?: string) {
    const slot = voiceId
      ? this.palette().find((v) => v.voiceId === voiceId)
      // sans voix précisée : alterne en reprenant la palette dans l'ordre
      : this.palette()[this.model.segments.length % Math.max(this.palette().length, 1)];
    this.model.segments = [...this.model.segments, blankSegment(slot)];
  }
  removeSegment(i: number) { this.model.segments = this.model.segments.filter((_, idx) => idx !== i); }

  // scinde le segment : la sélection du textarea devient un nouveau segment juste
  // en dessous ; le texte situé après la sélection forme un 3e segment (ordre préservé)
  split(i: number, ta: HTMLTextAreaElement) {
    const seg = this.model.segments[i];
    const value = ta.value;
    let a = ta.selectionStart ?? 0, b = ta.selectionEnd ?? 0;
    if (a > b) [a, b] = [b, a];
    if (a === b) b = value.length; // pas de sélection → coupe au curseur
    const parts = [value.slice(0, a), value.slice(a, b), value.slice(b)]
      .map((t) => t.trim()).filter((t) => t);
    if (parts.length < 2) { this.toast.error('Sélectionne une portion du texte (ou place le curseur au point de coupe).'); return; }

    seg.textV3 = parts[0];
    this.touch(seg);
    const extras: Segment[] = parts.slice(1).map((t) => ({
      ...blankSegment(), voiceId: seg.voiceId, voiceName: seg.voiceName, textV3: t,
    }));
    this.model.segments = [
      ...this.model.segments.slice(0, i + 1), ...extras, ...this.model.segments.slice(i + 1),
    ];
  }
  move(i: number, delta: number) {
    const j = i + delta;
    if (j < 0 || j >= this.model.segments.length) return;
    const arr = [...this.model.segments];
    [arr[i], arr[j]] = [arr[j], arr[i]];
    this.model.segments = arr;
  }

  statusLabel(s: Segment) { return ({ not_generated: 'non généré', generating: 'en cours…', generated: 'généré', error: 'erreur' } as const)[s.status]; }
  statusClass(s: Segment) {
    return { not_generated: 'bg-white/10 text-slate-300', generating: 'bg-amber-400/20 text-amber-300',
      generated: 'bg-emerald-400/20 text-emerald-300', error: 'bg-red-400/20 text-red-300' }[s.status];
  }
  allGenerated() { return this.model.segments.length > 0 && this.model.segments.every((s) => s.status === 'generated'); }

  private stripTags(t: string) { return t.replace(/\[[^\]]*\]/g, '').replace(/\s+/g, ' ').trim(); }

  /** Enregistre le son ; retourne l'id (crée le doc si nouveau). */
  private async persist(): Promise<string> {
    this.model.segments.forEach((s) => {
      s.textPlain = this.stripTags(s.textV3);
      s.chars = s.textPlain.length;
    });
    if (this.isNew) {
      const ref = await this.svc.create(this.model);
      this.model.id = ref.id;
      this.isNew = false;
      this.router.navigate(['/sounds', ref.id], { replaceUrl: true });
    } else if (this.model.id) {
      const { id, ...data } = this.model;
      await this.svc.update(id, data);
    }
    this.model.segments.forEach((x) => this.baseline.set(x.id, x.textV3 + '|' + x.voiceId));
    return this.model.id!;
  }

  async save() {
    this.saving.set(true);
    try { await this.persist(); this.toast.success('💾 Son enregistré.'); }
    catch (e: any) { this.toast.error('❌ ' + (e.message || e)); }
    finally { this.saving.set(false); }
  }

  private markGen(id: string, on: boolean) {
    const s = new Set(this.genBusy()); on ? s.add(id) : s.delete(id); this.genBusy.set(s);
  }

  // reporte dans le modèle local ce que la fonction a réellement écrit côté serveur
  private applyGenerated(seg: Segment, res: { url?: string; path?: string; generatedAt?: number }) {
    seg.status = 'generated';
    seg.audioUrl = res.url ?? seg.audioUrl ?? null;
    seg.audioPath = res.path ?? seg.audioPath ?? null;
    seg.generatedAt = res.generatedAt ?? Date.now();
    this.baseline.set(seg.id, seg.textV3 + '|' + seg.voiceId);
  }

  async genOne(seg: Segment) {
    this.markGen(seg.id, true);
    try {
      const soundId = await this.persist();
      seg.status = 'generating';
      const res = await this.api.generateSegment(soundId, seg.id);
      this.applyGenerated(seg, res);
    } catch (e: any) {
      seg.status = 'error';
      this.toast.error('❌ Segment : ' + (e.message || e));
    } finally { this.markGen(seg.id, false); }
  }

  async generateAll() {
    this.bulkBusy.set(true);
    try {
      const soundId = await this.persist();
      const todo = this.model.segments.filter((s) => s.status !== 'generated' && s.voiceId && s.textV3.trim());
      if (!todo.length) { this.message.set('Tous les segments sont déjà générés.'); return; }
      for (const [i, seg] of todo.entries()) {
        this.bulkLabel.set(`🎙 ${i + 1}/${todo.length}…`);
        seg.status = 'generating';
        const res = await this.api.generateSegment(soundId, seg.id);
        this.applyGenerated(seg, res);
      }
      this.toast.success(`🎙 ${todo.length} segment(s) généré(s).`);
    } catch (e: any) { this.toast.error('❌ ' + (e.message || e)); }
    finally { this.bulkBusy.set(false); this.bulkLabel.set(''); }
  }

  async assemble() {
    this.bulkBusy.set(true); this.bulkLabel.set('🔗 Assemblage…');
    try {
      const soundId = await this.persist();
      const res = await this.api.assembleSound(soundId);
      this.model.assemblyStatus = 'done';
      this.toast.success(`🔗 MP3 assemblé : ${Math.floor(res.durationSec / 60)}:${String(res.durationSec % 60).padStart(2, '0')} · ${res.sizeMb} Mo`, res.url);
    } catch (e: any) {
      this.model.assemblyStatus = 'error';
      this.toast.error('❌ Assemblage : ' + (e.message || e));
    } finally { this.bulkBusy.set(false); this.bulkLabel.set(''); }
  }

  async retag(seg: Segment) {
    const source = this.stripTags(seg.textV3);
    if (!source) return;
    const s = new Set(this.tagBusy()); s.add(seg.id); this.tagBusy.set(s);
    try {
      seg.textV3 = await this.api.tagText(source, {
        dynamism: this.settings.tagDynamism, maxTags: this.settings.tagMaxTags,
      });
      this.touch(seg);
    }
    catch (e: any) { this.toast.error('❌ Balisage : ' + (e.message || e)); }
    finally { const n = new Set(this.tagBusy()); n.delete(seg.id); this.tagBusy.set(n); }
  }

  // pré-écoute d'un segment
  previewId = signal('');
  private previewAudio?: HTMLAudioElement;
  togglePreview(seg: Segment) {
    if (this.previewId() === seg.id) { this.stopPreview(); return; }
    this.stopPreview();
    if (!seg.audioUrl) return;
    const a = new Audio(seg.audioUrl);
    this.previewAudio = a;
    this.previewId.set(seg.id);
    a.onended = () => this.stopPreview();
    a.play().catch(() => this.stopPreview());
  }
  private stopPreview() {
    this.previewAudio?.pause();
    if (this.previewAudio) this.previewAudio.src = '';
    this.previewAudio = undefined;
    this.previewId.set('');
  }

  async remove() {
    if (!this.model.id) return;
    const ok = await this.confirmDlg.ask({
      title: 'Supprimer « ' + (this.model.title || 'ce son') + ' » ?',
      message: 'Le son, ses segments audio et son MP3 final seront supprimés définitivement.',
      confirmLabel: 'Supprimer', danger: true,
    });
    if (!ok) return;
    // supprime d'abord les fichiers stockés (best effort), puis le document
    try { await this.api.resetSound(this.model.id); } catch { /* le doc part quand même */ }
    await this.svc.remove(this.model.id);
    this.back();
  }
  back() { this.router.navigate(['/sounds']); }
  ngOnDestroy() { this.stopPreview(); }
}
