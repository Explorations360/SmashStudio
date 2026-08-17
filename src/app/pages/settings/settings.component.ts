import { Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SoundsService } from '../../core/sounds.service';
import { ApiService, ElevenVoice, Usage } from '../../core/api.service';
import { ToastService } from '../../core/toast.service';
import { Settings, DEFAULT_SETTINGS, VoiceSlot } from '../../core/models';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [FormsModule],
  template: `
  <h1 class="text-xl font-bold mb-4">Réglages</h1>
  <div class="grid gap-6 max-w-2xl">
    <section class="bg-navy-800 p-5 rounded-xl shadow">
      <h2 class="font-semibold mb-3">📊 Consommation</h2>
      @if (usageLoading()) {
        <p class="text-sm text-slate-400">Chargement…</p>
      } @else if (usage(); as u) {
        <div class="grid sm:grid-cols-2 gap-4 text-sm">
          <div>
            <p class="font-medium mb-1">🎙 ElevenLabs @if (u.eleven.tier) { <span class="text-xs text-slate-400">({{ u.eleven.tier }})</span> }</p>
            @if (u.eleven.error) { <p class="text-amber-400 text-xs">Indisponible : {{ u.eleven.error }}</p> }
            @else {
              <div class="h-2 bg-white/10 rounded-full overflow-hidden mb-1">
                <div class="h-full bg-emerald-500" [class.bg-amber-500]="elevenPct() > 75" [class.bg-red-500]="elevenPct() > 92"
                  [style.width.%]="elevenPct()"></div>
              </div>
              <p class="text-slate-300">{{ (u.eleven.used ?? 0).toLocaleString('fr-FR') }} / {{ (u.eleven.limit ?? 0).toLocaleString('fr-FR') }} caractères
                <span class="text-slate-400">({{ elevenPct() }} %)</span></p>
              <p class="text-xs text-slate-400">Reste {{ ((u.eleven.limit ?? 0) - (u.eleven.used ?? 0)).toLocaleString('fr-FR') }} caractères
                @if (u.eleven.resetAt) { · réinitialisé le {{ fmtDate(u.eleven.resetAt) }} }</p>
            }
          </div>
          <div>
            <p class="font-medium mb-1">✨ Claude (balisage)</p>
            @if (u.claude.error) { <p class="text-amber-400 text-xs">Indisponible : {{ u.claude.error }}</p> }
            @else {
              <p class="text-2xl font-bold text-slate-200">≈ {{ (u.claude.estCostUsd ?? 0).toFixed(2) }} $ <span class="text-sm font-normal text-slate-400">ce mois-ci</span></p>
              <p class="text-xs text-slate-400">{{ u.claude.calls ?? 0 }} balisage(s) · {{ ((u.claude.inputTokens ?? 0) + (u.claude.outputTokens ?? 0)).toLocaleString('fr-FR') }} tokens</p>
              <p class="text-xs text-slate-400">Solde de crédits : <a href="https://platform.claude.com/settings/billing" target="_blank" class="underline hover:text-slate-200">console Anthropic</a></p>
            }
          </div>
        </div>
        <button (click)="loadUsage()" title="Recharger la consommation depuis ElevenLabs" class="mt-3 text-xs border rounded px-2 py-1 hover:bg-white/10">↻ Actualiser</button>
      } @else if (usageError()) {
        <p class="text-sm text-amber-400">Consommation indisponible : {{ usageError() }}</p>
      }
    </section>

    <section class="bg-navy-800 p-5 rounded-xl shadow">
      <h2 class="font-semibold mb-1">🎭 Palette de voix</h2>
      <p class="text-xs text-slate-400 mb-3">
        Les rôles proposés dans l'éditeur de segments (ex. « Voix femme principale »). Chaque rôle pointe vers une voix ElevenLabs du compte.
      </p>
      @for (v of s.voices; track $index; let i = $index) {
        <div class="flex gap-2 mb-2 text-sm">
          <input [(ngModel)]="s.voices[i].label" placeholder="Rôle (ex. Voix femme principale)" class="border rounded px-2 py-1 flex-1" />
          @if (voices().length) {
            <select [ngModel]="s.voices[i].voiceId" (ngModelChange)="setSlotVoice(i, $event)" class="border rounded px-2 py-1 flex-1">
              <option value="">— choisir une voix —</option>
              @for (v of voices(); track v.voiceId) {
                <option [value]="v.voiceId">{{ v.name }}{{ v.category === 'premade' ? ' (voix d\\'usine)' : '' }}</option>
              }
            </select>
          } @else {
            <input [(ngModel)]="s.voices[i].voiceId" placeholder="Voice ID" class="border rounded px-2 py-1 flex-1" />
          }
          <button (click)="removeSlot(i)" title="Retirer ce rôle" class="text-red-400 border border-red-300 px-2 rounded">✕</button>
        </div>
      }
      <button (click)="addSlot()" title="Ajouter un rôle à la palette" class="text-xs border rounded px-2 py-1 hover:bg-white/10">+ Ajouter un rôle</button>
      @if (voicesError()) { <p class="text-xs text-amber-400 mt-2">Liste des voix indisponible ({{ voicesError() }}) — saisie manuelle des Voice ID.</p> }
    </section>

    <section class="bg-navy-800 p-5 rounded-xl shadow">
      <h2 class="font-semibold mb-3">🎙 ElevenLabs</h2>
      <div class="grid grid-cols-2 gap-3 text-sm">
        <label>Model ID
          <select [(ngModel)]="s.modelId" class="w-full border rounded px-2 py-1 mt-1">
            <option value="eleven_multilingual_v2">eleven_multilingual_v2</option>
            <option value="eleven_v3">eleven_v3 (si accès API)</option>
            <option value="eleven_turbo_v2_5">eleven_turbo_v2_5</option>
          </select>
        </label>
        <label>Pause entre segments (s)
          <input [(ngModel)]="s.segmentGap" type="number" step="0.1" min="0" max="10" class="w-full border rounded px-2 py-1 mt-1"
            title="Silence inséré entre deux segments lors de l'assemblage (surchargeable segment par segment)" />
        </label>
        <label>Silence au début du MP3 (s)
          <input [(ngModel)]="s.audioSilenceBefore" type="number" step="0.5" min="0" max="10" class="w-full border rounded px-2 py-1 mt-1"
            title="Silence ajouté au tout début du fichier final assemblé (0 à 10 s)" />
        </label>
        <label>Silence à la fin du MP3 (s)
          <input [(ngModel)]="s.audioSilenceAfter" type="number" step="0.5" min="0" max="10" class="w-full border rounded px-2 py-1 mt-1"
            title="Silence ajouté à la toute fin du fichier final assemblé (0 à 10 s)" />
        </label>
        <label>Coupe du souffle final (dB)
          <input [(ngModel)]="s.trimEndDb" type="number" step="1" min="-60" max="0" class="w-full border rounded px-2 py-1 mt-1"
            title="À la génération, la fin du segment est coupée tant qu'elle reste sous ce niveau : les respirations laissées par ElevenLabs disparaissent. -35 dB par défaut ; vers 0 = coupe plus agressive, vers -60 = coupe seulement le quasi-silence ; 0 = désactivé. Ne s'applique qu'aux segments (re)générés." />
        </label>
        <label>Stability <input [(ngModel)]="s.stability" type="number" step="0.05" min="0" max="1" class="w-full border rounded px-2 py-1 mt-1" /></label>
        <label>Similarity boost <input [(ngModel)]="s.similarityBoost" type="number" step="0.05" min="0" max="1" class="w-full border rounded px-2 py-1 mt-1" /></label>
        <label>Style <input [(ngModel)]="s.style" type="number" step="0.05" min="0" max="1" class="w-full border rounded px-2 py-1 mt-1" /></label>
      </div>
    </section>

    <section class="bg-navy-800 p-5 rounded-xl shadow">
      <h2 class="font-semibold mb-1">🎬 Vidéo (MP4)</h2>
      <p class="text-xs text-slate-400 mb-3">Paramètres des MP4 générés (image fixe + MP3 assemblé). L'image est cadrée dans ces dimensions, sans déformation (bandes noires si besoin).</p>
      <div class="grid grid-cols-2 gap-3 text-sm">
        <label>Largeur (px)
          <input [(ngModel)]="s.videoWidth" type="number" min="160" max="3840" step="2" class="w-full border rounded px-2 py-1 mt-1" />
        </label>
        <label>Hauteur (px)
          <input [(ngModel)]="s.videoHeight" type="number" min="160" max="2160" step="2" class="w-full border rounded px-2 py-1 mt-1" />
        </label>
        <label>Débit vidéo (kb/s)
          <input [(ngModel)]="s.videoBitrate" type="number" min="500" max="50000" step="500" class="w-full border rounded px-2 py-1 mt-1"
            title="8000 kb/s = haute qualité en 1080p. Sur une image fixe, le fichier reste léger." />
        </label>
        <label>Débit audio du MP4 (kb/s)
          <input [(ngModel)]="s.videoAudioBitrate" type="number" min="64" max="320" step="32" class="w-full border rounded px-2 py-1 mt-1" />
        </label>
        <label>Images / s
          <input [(ngModel)]="s.videoFps" type="number" min="1" max="60" class="w-full border rounded px-2 py-1 mt-1"
            title="25 convient à une image fixe ; inutile de monter plus haut." />
        </label>
      </div>
    </section>

    <section class="bg-navy-800 p-5 rounded-xl shadow">
      <h2 class="font-semibold mb-3">✨ Balisage IA (Claude)</h2>
      <div class="grid grid-cols-2 gap-3 text-sm">
        <label>Dynamisme
          <select [(ngModel)]="s.tagDynamism" class="w-full border rounded px-2 py-1 mt-1"
            title="Intensité de l'interprétation : de la simple respiration aux émotions marquées">
            <option value="sobre">Sobre — pauses et respirations uniquement</option>
            <option value="modere">Modéré — émotions discrètes là où c'est évident</option>
            <option value="expressif">Expressif — interprétation vivante et marquée</option>
          </select>
        </label>
        <label>Balises max par segment
          <input [(ngModel)]="s.tagMaxTags" type="number" min="1" max="15" class="w-full border rounded px-2 py-1 mt-1"
            title="Plafond de balises insérées dans le texte d'un segment" />
        </label>
        <label class="col-span-2">Consignes supplémentaires (optionnel)
          <textarea [(ngModel)]="s.tagInstructions" rows="2" class="w-full border rounded px-2 py-1 mt-1 text-xs"
            placeholder="ex. : jamais de rire ; marquer une pause avant chaque chiffre clé…"></textarea>
        </label>
      </div>
    </section>

    <section class="bg-navy-800 p-5 rounded-xl shadow">
      <h2 class="font-semibold mb-1">🔤 Prononciation (ElevenLabs)</h2>
      <p class="text-xs text-slate-400 mb-3">
        Corrige la prononciation des noms propres et sigles. « Alias » = graphie qui sonne juste (ex. Gouessant → Gouessan).
        « IPA » (optionnel) = prononciation phonétique exacte, prioritaire (modèle eleven_v3). Sensible à la casse.
      </p>
      @for (r of s.pronunciationRules; track $index; let i = $index) {
        <div class="flex gap-2 mb-2 text-sm">
          <input [(ngModel)]="s.pronunciationRules[i].word" placeholder="Mot (ex. Gouessant)" class="border rounded px-2 py-1 flex-1" />
          <input [(ngModel)]="s.pronunciationRules[i].alias" placeholder="Alias (ex. Gouessan)" class="border rounded px-2 py-1 flex-1" />
          <input [(ngModel)]="s.pronunciationRules[i].ipa" placeholder="IPA (ex. gwesɑ̃)" class="border rounded px-2 py-1 w-36" />
          <button (click)="removeRule(i)" title="Retirer cette règle" class="text-red-400 border border-red-300 px-2 rounded">✕</button>
        </div>
      }
      <div class="flex flex-wrap items-center gap-2 mt-2">
        <button (click)="addRule()" title="Ajouter une règle de prononciation" class="text-xs border rounded px-2 py-1 hover:bg-white/10">+ Ajouter un mot</button>
        <button (click)="syncPron()" [disabled]="pronSyncing()"
          title="Enregistre les réglages puis pousse les règles dans le dictionnaire ElevenLabs utilisé par les générations"
          class="text-xs bg-brand-500 hover:bg-brand-400 text-white px-2 py-1 rounded disabled:opacity-40">
          {{ pronSyncing() ? 'Synchronisation…' : '⇅ Enregistrer & synchroniser' }}
        </button>
        @if (pronMsg()) { <span class="text-xs" [class.text-emerald-400]="!pronError()" [class.text-red-400]="pronError()">{{ pronMsg() }}</span> }
        @else if (s.pronSyncedAt) { <span class="text-xs text-slate-400">Dernière synchro : {{ fmtDateTime(s.pronSyncedAt) }}</span> }
      </div>
    </section>

    <div><button (click)="save()" title="Enregistrer les réglages pour toute l'équipe" class="bg-brand-500 text-white px-4 py-2 rounded-lg">Enregistrer</button>
      @if (saved()) { <span class="ml-3 text-emerald-400 text-sm">✅ Enregistré</span> }</div>
    <p class="text-xs text-slate-400">Les clés API (ElevenLabs / Anthropic) ne se règlent pas ici : elles vivent côté serveur (secrets Cloud Functions). Voir le README.</p>
  </div>`,
})
export class SettingsComponent implements OnInit {
  private svc = inject(SoundsService);
  private api = inject(ApiService);
  private toast = inject(ToastService);
  s: Settings = { ...DEFAULT_SETTINGS };
  // palette telle que chargée, pour détecter les changements à l'enregistrement
  private originalVoices: VoiceSlot[] = [];
  saved = signal(false);
  voices = signal<ElevenVoice[]>([]);
  voicesLoading = signal(true);
  voicesError = signal('');

  usage = signal<Usage | null>(null);
  usageLoading = signal(true);
  usageError = signal('');

  elevenPct() {
    const e = this.usage()?.eleven;
    if (!e?.limit) return 0;
    return Math.min(100, Math.round(((e.used ?? 0) / e.limit) * 100));
  }
  fmtDate(ts: number) { return new Date(ts).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' }); }
  async loadUsage() {
    this.usageLoading.set(true); this.usageError.set('');
    try { this.usage.set(await this.api.getUsage()); }
    catch (e: any) { this.usage.set(null); this.usageError.set(e.message || String(e)); }
    finally { this.usageLoading.set(false); }
  }

  async ngOnInit() {
    this.s = await this.svc.getSettings();
    this.originalVoices = (this.s.voices ?? []).map((v) => ({ ...v }));
    this.loadUsage();
    await this.api.listVoices()
      .then((v) => this.voices.set(v))
      .catch((e: any) => this.voicesError.set(e.message || String(e)))
      .finally(() => this.voicesLoading.set(false));
  }
  async save() {
    await this.svc.saveSettings(this.s);
    // propage les changements de palette sur les segments existants
    const changes = (this.s.voices ?? [])
      .map((v, i) => {
        const before = this.originalVoices[i];
        if (!before?.label || !v.voiceId || !v.label) return null;
        const voiceChanged = before.voiceId !== v.voiceId;
        const labelChanged = before.label !== v.label;
        if (!voiceChanged && !labelChanged) return null;
        return { oldLabel: before.label, newLabel: v.label, voiceId: v.voiceId, voiceChanged };
      })
      .filter((c): c is NonNullable<typeof c> => !!c);
    if (changes.length) {
      try {
        const r = await this.svc.applyVoiceSlotChanges(changes);
        if (r.segs) {
          this.toast.success(`🔁 Palette propagée : ${r.segs} segment(s) mis à jour dans ${r.soundsTouched} son(s)`
            + (r.regen ? ` — ${r.regen} à régénérer.` : '.'));
        }
      } catch (e: any) { this.toast.error('❌ Propagation de la palette : ' + (e.message || e)); }
    }
    this.originalVoices = (this.s.voices ?? []).map((v) => ({ ...v }));
    this.saved.set(true); setTimeout(() => this.saved.set(false), 2000);
  }

  // --- palette de voix ---
  setSlotVoice(i: number, voiceId: string) {
    this.s.voices[i].voiceId = voiceId;
    this.s.voices[i].voiceName = this.voices().find((v) => v.voiceId === voiceId)?.name ?? '';
  }
  addSlot() { this.s.voices = [...(this.s.voices ?? []), { label: '', voiceId: '', voiceName: '' }]; }
  removeSlot(i: number) { this.s.voices = this.s.voices.filter((_, idx) => idx !== i); }

  // --- règles de prononciation ---
  pronSyncing = signal(false);
  pronMsg = signal('');
  pronError = signal(false);

  fmtDateTime(ts: number) { return new Date(ts).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); }
  addRule() { this.s.pronunciationRules = [...(this.s.pronunciationRules ?? []), { word: '', alias: '', ipa: '' }]; }
  removeRule(i: number) { this.s.pronunciationRules = this.s.pronunciationRules.filter((_, idx) => idx !== i); }

  // enregistre les réglages puis pousse les règles dans le dictionnaire ElevenLabs
  async syncPron() {
    this.pronSyncing.set(true); this.pronMsg.set(''); this.pronError.set(false);
    try {
      this.s.pronunciationRules = (this.s.pronunciationRules ?? []).filter((r) => r.word && (r.alias || r.ipa));
      await this.svc.saveSettings(this.s);
      const res = await this.api.syncPronunciation();
      this.s = await this.svc.getSettings(); // récupère pronDictId/version/date mis à jour côté serveur
      this.pronMsg.set('✅ ' + res.count + ' règle(s) synchronisée(s) — appliquées aux prochaines générations de voix.');
    } catch (e: any) {
      this.pronError.set(true);
      this.pronMsg.set('❌ ' + (e.message || String(e)));
    } finally { this.pronSyncing.set(false); }
  }
}
