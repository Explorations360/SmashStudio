import { Component, computed, ElementRef, inject, OnDestroy, signal, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { SoundsService } from '../../core/sounds.service';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { ConfirmService } from '../../core/confirm.service';
import { ToastService } from '../../core/toast.service';
import { Sound, Project } from '../../core/models';

@Component({
  selector: 'app-sounds',
  standalone: true,
  imports: [RouterLink, FormsModule],
  template: `
  <div class="flex flex-wrap items-center gap-3 mb-4">
    <h1 class="text-xl font-bold">Sons ({{ visible().length }})</h1>

    <span class="flex items-center gap-1.5">
      <select [ngModel]="projectFilter()" (ngModelChange)="setProjectFilter($event)"
        title="Projet (podcast) affiché" class="text-sm border rounded-lg px-2 py-1.5 bg-navy-800">
        <option value="all">📁 Tous les projets</option>
        <option value="none">Sans projet</option>
        @for (p of projects(); track p.id) { <option [value]="p.id">{{ p.name }} ({{ countIn(p.id!) }})</option> }
      </select>
      @if (auth.canEdit()) {
        <button (click)="startNewProject()" title="Créer un projet (podcast)" class="text-sm border rounded-lg px-2 py-1.5 hover:bg-white/10">➕ Projet</button>
        @if (currentProject(); as cp) {
          <button (click)="startRename(cp)" title="Renommer ce projet" class="text-sm border rounded-lg px-2 py-1.5 hover:bg-white/10">✎</button>
          <button (click)="deleteProject(cp)" title="Supprimer ce projet (les sons sont conservés et repassent « sans projet »)"
            class="text-sm text-red-400 border border-red-300 rounded-lg px-2 py-1.5 hover:bg-red-500/10">🗑</button>
        }
      }
    </span>

    @if (editingProject() !== null) {
      <span class="flex items-center gap-1.5">
        <input [(ngModel)]="projectNameDraft" (keydown.enter)="confirmProjectEdit()" (keydown.escape)="cancelProjectEdit()"
          placeholder="Nom du projet (ex. Le Gouessant Infos 146)" class="text-sm border rounded-lg px-2 py-1.5 w-64" autofocus />
        <button (click)="confirmProjectEdit()" class="text-sm bg-brand-500 hover:bg-brand-400 text-white rounded-lg px-3 py-1.5">OK</button>
        <button (click)="cancelProjectEdit()" class="text-sm text-slate-400 hover:text-white">annuler</button>
      </span>
    }

    @if (auth.canEdit()) {
      <a routerLink="/sounds/new" [queryParams]="newSoundParams()" title="Créer un nouveau son dans le projet affiché"
        class="ml-auto bg-brand-500 hover:bg-brand-400 text-white px-3 py-1.5 rounded-lg text-sm">+ Nouveau son</a>
    }
  </div>

  @if (currentProject(); as cp) {
    <div class="bg-navy-800 border border-white/10 rounded-2xl shadow-xl p-4 mb-4">
      <div class="flex flex-wrap items-center gap-3">
        <span class="text-sm text-slate-300 shrink-0">🎵 Jingle d'intro de chapitre</span>
        @if (cp.introUrl) {
          <span class="text-xs text-slate-400 truncate max-w-[220px]" [title]="cp.introName">{{ cp.introName }} · {{ cp.introDurationSec }} s</span>
          <audio [src]="cp.introUrl" controls class="h-9 flex-1 min-w-56"></audio>
          <label class="text-xs text-slate-400 flex items-center gap-1.5">Pause après (s)
            <input [ngModel]="cp.introGap" (ngModelChange)="setIntroGap(cp, $event)" type="number" step="0.1" min="0" max="10"
              [placeholder]="'global'" title="Silence entre le jingle et le premier segment — vide = pause entre segments des Réglages"
              class="border rounded px-1.5 py-0.5 w-20" />
          </label>
          @if (auth.canEdit()) {
            <button (click)="pickIntro(cp)" [disabled]="introBusy()" class="text-xs border rounded px-2 py-1 hover:bg-white/10 disabled:opacity-40"
              title="Remplacer le jingle">{{ introBusy() ? '…' : 'Remplacer' }}</button>
            <button (click)="removeIntro(cp)" [disabled]="introBusy()" class="text-xs text-red-400 border border-red-300 rounded px-2 py-1 disabled:opacity-40"
              title="Retirer le jingle de ce projet">✕</button>
          }
        } @else {
          <span class="text-xs text-slate-400">Aucun jingle pour « {{ cp.name }} ».</span>
          @if (auth.canEdit()) {
            <button (click)="pickIntro(cp)" [disabled]="introBusy()" class="text-xs bg-brand-500 hover:bg-brand-400 text-white rounded px-2 py-1 disabled:opacity-40"
              title="Choisir un fichier audio (mp3, wav, m4a…) — max 8 Mo">{{ introBusy() ? 'Envoi…' : '⬆ Ajouter un jingle' }}</button>
          }
        }
      </div>
      <p class="text-xs text-slate-500 mt-2">Le jingle s'ajoute en tête des sons dont la case « Jingle d'intro » est cochée (dans l'éditeur du son).</p>

      <div class="flex flex-wrap items-center gap-3 mt-4 pt-4 border-t border-white/10">
        <span class="text-sm text-slate-300 shrink-0">🖼 Image des MP4</span>
        @if (cp.imageUrl) {
          <img [src]="cp.imageUrl" class="h-12 rounded border border-white/10 object-cover" />
          <span class="text-xs text-slate-400 truncate max-w-[220px]" [title]="cp.imageName">{{ cp.imageName }}</span>
          @if (auth.canEdit()) {
            <button (click)="pickImage(cp)" [disabled]="imageBusy()" class="text-xs border rounded px-2 py-1 hover:bg-white/10 disabled:opacity-40"
              title="Remplacer l'image du projet">{{ imageBusy() ? '…' : 'Remplacer' }}</button>
            <button (click)="removeImage(cp)" [disabled]="imageBusy()" class="text-xs text-red-400 border border-red-300 rounded px-2 py-1 disabled:opacity-40"
              title="Retirer l'image du projet">✕</button>
          }
        } @else {
          <span class="text-xs text-slate-400">Aucune image pour « {{ cp.name }} ».</span>
          @if (auth.canEdit()) {
            <button (click)="pickImage(cp)" [disabled]="imageBusy()" class="text-xs bg-brand-500 hover:bg-brand-400 text-white rounded px-2 py-1 disabled:opacity-40"
              title="Choisir une image (jpg, png, webp) — max 7 Mo">{{ imageBusy() ? 'Envoi…' : '⬆ Ajouter une image' }}</button>
          }
        }
        <span class="text-xs text-slate-500">Image par défaut des MP4 du projet — surchargeable son par son.</span>
      </div>

      <input #introInput type="file" accept="audio/*" class="hidden" (change)="uploadIntro($event)" />
      <input #imageInput type="file" accept="image/jpeg,image/png,image/webp" class="hidden" (change)="uploadImage($event)" />
    </div>
  }

  <div class="overflow-x-auto bg-navy-800 border border-white/10 rounded-2xl shadow-xl">
    <table class="w-full text-sm">
      <thead class="bg-navy-900/80 text-left sticky top-0 backdrop-blur">
        <tr class="text-xs uppercase tracking-wider text-slate-400">
          <th class="px-3 py-3">Titre</th><th class="px-3 py-3">Segments</th><th class="px-3 py-3">Voix</th>
          <th class="px-3 py-3">MP3 final</th><th class="px-3 py-3">Actions</th>
        </tr>
      </thead>
      <tbody>
        @for (s of visible(); track s.id) {
          <tr class="border-t border-white/5 odd:bg-white/[0.02] hover:bg-white/5 transition-colors">
            <td class="px-3 py-2.5 max-w-[320px]">
              <a [routerLink]="['/sounds', s.id]" class="font-medium hover:text-brand-300 block truncate" [title]="s.title">{{ s.title || '(sans titre)' }}</a>
              @if (projectFilter() === 'all' && projectName(s.projectId)) {
                <span class="text-xs text-slate-500">📁 {{ projectName(s.projectId) }}</span>
              }
            </td>
            <td class="px-3 py-2.5 whitespace-nowrap">
              <span class="px-2 py-0.5 rounded text-xs"
                [class]="genCount(s) === s.segments.length && s.segments.length ? 'bg-emerald-400/20 text-emerald-300' : 'bg-white/10 text-slate-300'">
                {{ genCount(s) }} / {{ s.segments.length }} générés
              </span>
              @if (errCount(s)) { <span class="ml-1 px-2 py-0.5 rounded text-xs bg-red-400/20 text-red-300">{{ errCount(s) }} err.</span> }
            </td>
            <td class="px-3 py-2.5 max-w-[220px]">
              <span class="block truncate text-xs text-slate-400" [title]="voiceNames(s)">{{ voiceNames(s) || '—' }}</span>
            </td>
            <td class="px-3 py-2.5 whitespace-nowrap">
              @if (s.assemblyStatus === 'done' || s.assemblyStatus === 'stale') {
                @if (s.finalUrl) {
                  <button (click)="openPlayer(s)" title="Écouter le MP3 assemblé" class="text-xs bg-navy-700 hover:bg-navy-600 text-white pl-2 pr-3 py-1 rounded-full inline-flex items-center gap-1.5">
                    <span>▶</span><span>{{ fmt(s.finalDurationSec ?? 0) }}</span>
                  </button>
                  <button (click)="download(s)" [disabled]="downloading().has(s.id!)"
                    class="text-xs border rounded px-1.5 py-0.5 ml-1 hover:bg-white/10 disabled:opacity-40"
                    title="Télécharger le MP3">{{ downloading().has(s.id!) ? '…' : '⬇' }}</button>
                }
                @if (s.assemblyStatus === 'stale') {
                  <span class="block text-xs text-amber-400 mt-0.5" title="Un segment a été régénéré depuis le dernier assemblage">{{ s.finalVersion ? 'v' + s.finalVersion + ' · ' : '' }}à réassembler</span>
                } @else if (s.assembledAt) {
                  <span class="block text-xs text-slate-400 mt-0.5">{{ s.finalVersion ? 'v' + s.finalVersion + ' · ' : '' }}{{ fmtDate(s.assembledAt) }} · {{ s.finalSizeMb }} Mo</span>
                }
              }
              @else if (s.assemblyStatus === 'assembling') { <span class="text-amber-400">assemblage…</span> }
              @else if (s.assemblyStatus === 'error') { <span class="text-red-400">erreur</span> }
              @else { <span class="text-slate-400">—</span> }
            </td>
            <td class="px-3 py-2.5 whitespace-nowrap">
              @if (auth.canEdit()) {
                <button (click)="generateAll(s)" [disabled]="busy().has(s.id!) || !s.segments.length"
                  title="Générer la voix ElevenLabs de tous les segments non générés"
                  class="text-xs bg-brand-500 text-white px-2 py-1 rounded disabled:opacity-40">🎙 Générer</button>
                <button (click)="assemble(s)" [disabled]="busy().has(s.id!) || genCount(s) !== s.segments.length || !s.segments.length"
                  [title]="genCount(s) !== s.segments.length ? 'Génère d\\'abord tous les segments' : 'Assembler tous les segments en un seul MP3'"
                  class="text-xs bg-indigo-500 text-white px-2 py-1 rounded disabled:opacity-40">🔗 Assembler</button>
                <a [routerLink]="['/sounds', s.id]" title="Modifier le son (segments, voix, textes)" class="text-xs border px-2 py-1 rounded">✎</a>
                @if (genCount(s) || s.finalUrl) {
                  <button (click)="reset(s)" [disabled]="busy().has(s.id!)"
                    class="text-xs text-red-400 border border-red-300 px-2 py-1 rounded disabled:opacity-40"
                    title="Supprimer tous les audios générés (segments + MP3 final) et remettre les statuts à zéro">↺</button>
                }
              } @else { <span class="text-slate-400 text-xs">lecture seule</span> }
            </td>
          </tr>
        } @empty {
          <tr><td colspan="5" class="px-3 py-8 text-center text-slate-400">
            Aucun son dans cette vue. @if (auth.canEdit()) { Crée le premier avec « + Nouveau son » (ou change de projet). }
          </td></tr>
        }
      </tbody>
    </table>
  </div>
  @if (message()) { <p class="mt-3 text-sm text-slate-300">{{ message() }}</p> }

  @if (playerSound(); as ps) {
    <div class="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" (click)="closePlayer()">
      <div class="bg-navy-800 rounded-2xl p-6 w-full max-w-md shadow-2xl" (click)="$event.stopPropagation()">
        <div class="flex items-start justify-between mb-1">
          <div>
            <p class="font-bold text-slate-100">🔊 {{ ps.title }}</p>
            <p class="text-xs text-slate-400">{{ ps.segments.length }} segment(s) · {{ ps.finalSizeMb }} Mo</p>
          </div>
          <button (click)="closePlayer()" title="Fermer le lecteur" class="text-slate-400 hover:text-white text-xl leading-none">✕</button>
        </div>

        <input type="range" min="0" [max]="playerDur()" step="0.1" [value]="playerCur()"
          (input)="seek(+$any($event.target).value)" class="w-full accent-brand-500 mt-4" />
        <div class="flex justify-between text-xs text-slate-400 mb-4">
          <span>{{ fmt(playerCur()) }}</span><span>{{ fmt(playerDur()) }}</span>
        </div>

        <div class="flex items-center justify-center gap-3">
          <button (click)="skip(-10)" class="border rounded-full px-3 py-2 text-sm hover:bg-white/10" title="Reculer de 10 s">⏪ 10s</button>
          <button (click)="togglePlay()" class="bg-brand-500 hover:bg-brand-400 text-white rounded-full w-14 h-14 text-xl"
            [title]="playerPlaying() ? 'Pause' : 'Lecture'">{{ playerPlaying() ? '⏸' : '▶' }}</button>
          <button (click)="stopPlayer()" class="border rounded-full px-4 py-2 text-sm hover:bg-white/10" title="Stop (retour au début)">⏹</button>
          <button (click)="skip(10)" class="border rounded-full px-3 py-2 text-sm hover:bg-white/10" title="Avancer de 10 s">10s ⏩</button>
        </div>
      </div>
    </div>
  }
  `,
})
export class SoundsComponent implements OnDestroy {
  private svc = inject(SoundsService);
  private api = inject(ApiService);
  private confirmDlg = inject(ConfirmService);
  private toast = inject(ToastService);
  auth = inject(AuthService);
  busy = signal<Set<string>>(new Set());
  message = signal('');

  sounds = this.svc.sounds;
  projects = this.svc.projects;

  // --- projets ---
  projectFilter = signal<string>(localStorage.getItem('smash.projectFilter') ?? 'all'); // 'all' | 'none' | projectId
  setProjectFilter(v: string) { this.projectFilter.set(v); localStorage.setItem('smash.projectFilter', v); }
  visible = computed(() => {
    const f = this.projectFilter();
    if (f === 'all') return this.sounds();
    if (f === 'none') return this.sounds().filter((s) => !s.projectId);
    return this.sounds().filter((s) => s.projectId === f);
  });
  countIn(projectId: string) { return this.sounds().filter((s) => s.projectId === projectId).length; }
  currentProject() { return this.projects().find((p) => p.id === this.projectFilter()) ?? null; }
  projectName(id?: string | null) { return this.projects().find((p) => p.id === id)?.name ?? ''; }
  newSoundParams() { return this.currentProject() ? { project: this.projectFilter() } : {}; }

  // création / renommage inline d'un projet
  editingProject = signal<'new' | string | null>(null); // 'new' | projectId en cours de renommage
  projectNameDraft = '';
  startNewProject() { this.editingProject.set('new'); this.projectNameDraft = ''; }
  startRename(p: Project) { this.editingProject.set(p.id!); this.projectNameDraft = p.name; }
  cancelProjectEdit() { this.editingProject.set(null); }
  async confirmProjectEdit() {
    const name = this.projectNameDraft.trim();
    const mode = this.editingProject();
    if (!name || mode === null) return;
    try {
      if (mode === 'new') {
        const ref = await this.svc.createProject(name);
        this.setProjectFilter(ref.id);
        this.toast.success('📁 Projet « ' + name + ' » créé.');
      } else {
        await this.svc.renameProject(mode, name);
      }
      this.editingProject.set(null);
    } catch (e: any) { this.toast.error('❌ ' + (e.message || e)); }
  }
  async deleteProject(p: Project) {
    const n = this.countIn(p.id!);
    const ok = await this.confirmDlg.ask({
      title: 'Supprimer le projet « ' + p.name + ' » ?',
      message: n
        ? 'Ses ' + n + ' son(s) ne seront PAS supprimés : ils repasseront dans « Sans projet ».'
        : 'Ce projet est vide.',
      confirmLabel: 'Supprimer', danger: true,
    });
    if (!ok) return;
    try {
      await this.svc.removeProject(p.id!);
      this.setProjectFilter('all');
      this.toast.success('🗑 Projet « ' + p.name + ' » supprimé' + (n ? ' — sons conservés dans « Sans projet ».' : '.'));
    } catch (e: any) { this.toast.error('❌ ' + (e.message || e)); }
  }

  // --- jingle d'intro du projet ---
  @ViewChild('introInput') introInput?: ElementRef<HTMLInputElement>;
  introBusy = signal(false);
  private introTarget: Project | null = null;

  pickIntro(p: Project) { this.introTarget = p; this.introInput?.nativeElement.click(); }
  async uploadIntro(ev: Event) {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    const p = this.introTarget;
    input.value = '';
    if (!file || !p?.id) return;
    if (file.size > 8 * 1024 * 1024) { this.toast.error('❌ Fichier trop lourd (max 8 Mo)'); return; }
    this.introBusy.set(true);
    try {
      const res = await this.api.setProjectIntro(p.id, file);
      this.toast.success(`🎵 Jingle « ${res.name} » ajouté (${res.durationSec} s) au projet « ${p.name} ».`);
    } catch (e: any) { this.toast.error('❌ Jingle : ' + (e.message || e)); }
    finally { this.introBusy.set(false); }
  }
  async removeIntro(p: Project) {
    const ok = await this.confirmDlg.ask({
      title: 'Retirer le jingle de « ' + p.name + ' » ?',
      message: 'Le fichier sera supprimé. Les sons qui l\'utilisent devront être réassemblés.',
      confirmLabel: 'Retirer', danger: true,
    });
    if (!ok || !p.id) return;
    this.introBusy.set(true);
    try { await this.api.setProjectIntro(p.id); this.toast.success('🎵 Jingle retiré.'); }
    catch (e: any) { this.toast.error('❌ ' + (e.message || e)); }
    finally { this.introBusy.set(false); }
  }
  // --- image du projet (défaut des MP4) ---
  @ViewChild('imageInput') imageInput?: ElementRef<HTMLInputElement>;
  imageBusy = signal(false);
  private imageTarget: Project | null = null;

  pickImage(p: Project) { this.imageTarget = p; this.imageInput?.nativeElement.click(); }
  async uploadImage(ev: Event) {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    const p = this.imageTarget;
    input.value = '';
    if (!file || !p?.id) return;
    if (file.size > 7 * 1024 * 1024) { this.toast.error('❌ Image trop lourde (max 7 Mo)'); return; }
    this.imageBusy.set(true);
    try {
      await this.api.setImage('project', p.id, file);
      this.toast.success(`🖼 Image ajoutée au projet « ${p.name} ».`);
    } catch (e: any) { this.toast.error('❌ Image : ' + (e.message || e)); }
    finally { this.imageBusy.set(false); }
  }
  async removeImage(p: Project) {
    if (!p.id) return;
    this.imageBusy.set(true);
    try { await this.api.setImage('project', p.id); this.toast.success('🖼 Image retirée.'); }
    catch (e: any) { this.toast.error('❌ ' + (e.message || e)); }
    finally { this.imageBusy.set(false); }
  }

  async setIntroGap(p: Project, v: any) {
    if (!p.id) return;
    const n = v === '' || v === null ? null : Number(v);
    try { await this.svc.updateProject(p.id, { introGap: isFinite(n as number) ? n : null }); }
    catch (e: any) { this.toast.error('❌ ' + (e.message || e)); }
  }

  genCount(s: Sound) { return s.segments.filter((x) => x.status === 'generated').length; }
  errCount(s: Sound) { return s.segments.filter((x) => x.status === 'error').length; }
  voiceNames(s: Sound) { return [...new Set(s.segments.map((x) => x.voiceName).filter(Boolean))].join(', '); }

  private mark(id: string, on: boolean) {
    const s = new Set(this.busy()); on ? s.add(id) : s.delete(id); this.busy.set(s);
  }

  // génère séquentiellement tous les segments non générés (les statuts se suivent en direct via Firestore)
  async generateAll(s: Sound) {
    if (!s.id) return;
    const todo = s.segments.filter((x) => x.status !== 'generated' && (x.textV3 || x.textPlain));
    if (!todo.length) { this.message.set('Tous les segments sont déjà générés.'); return; }
    this.mark(s.id, true);
    let ok = 0;
    try {
      for (const [i, seg] of todo.entries()) {
        this.message.set(`Génération « ${s.title} » — segment ${i + 1}/${todo.length} (${seg.voiceName || seg.voiceId})…`);
        await this.api.generateSegment(s.id, seg.id);
        ok++;
      }
      this.toast.success(`🎙 ${ok} segment(s) généré(s) pour « ${s.title} »`);
      this.message.set('');
    } catch (e: any) {
      this.toast.error(`❌ ${s.title} : ${e.message || e} (${ok}/${todo.length} générés)`);
      this.message.set('');
    } finally { this.mark(s.id, false); }
  }

  async assemble(s: Sound) {
    if (!s.id) return;
    this.mark(s.id, true); this.message.set('Assemblage de « ' + s.title + ' »…');
    try {
      const res = await this.api.assembleSound(s.id);
      this.toast.success(`🔗 « ${s.title} » assemblé : ${this.fmt(res.durationSec)} · ${res.sizeMb} Mo`, res.url);
      this.message.set('');
    } catch (e: any) {
      this.toast.error('❌ Assemblage : ' + (e.message || e));
      this.message.set('');
    } finally { this.mark(s.id, false); }
  }

  async reset(s: Sound) {
    if (!s.id) return;
    const ok = await this.confirmDlg.ask({
      title: 'Réinitialiser « ' + s.title + ' » ?',
      message: 'Tous les audios générés (segments et MP3 final) seront supprimés définitivement. Les textes sont conservés. Il faudra régénérer (crédits consommés à nouveau).',
      confirmLabel: 'Réinitialiser', danger: true,
    });
    if (!ok) return;
    this.mark(s.id, true);
    try { await this.api.resetSound(s.id, 'all'); this.toast.success('↺ « ' + s.title + ' » réinitialisé.'); }
    catch (e: any) { this.toast.error('❌ ' + (e.message || e)); }
    finally { this.mark(s.id, false); }
  }

  // téléchargement avec un nom de fichier propre
  downloading = signal<Set<string>>(new Set());
  async download(s: Sound) {
    if (!s.id || !s.finalUrl) return;
    this.downloading.update((set) => new Set(set).add(s.id!));
    try {
      const resp = await fetch(s.finalUrl);
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const blob = await resp.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = (s.title || s.id).replace(/[\\/:*?"<>|]+/g, '-')
        + (s.finalVersion ? ' - v' + s.finalVersion : '') + '.mp3';
      a.click();
      URL.revokeObjectURL(a.href);
    } catch {
      window.open(s.finalUrl, '_blank');
    } finally {
      this.downloading.update((set) => { const n = new Set(set); n.delete(s.id!); return n; });
    }
  }

  // lecteur en overlay
  playerSound = signal<Sound | null>(null);
  playerPlaying = signal(false);
  playerCur = signal(0);
  playerDur = signal(0);
  private audio?: HTMLAudioElement;

  openPlayer(s: Sound) {
    this.closePlayer();
    this.playerSound.set(s);
    this.playerDur.set(s.finalDurationSec ?? 0);
    const a = new Audio(s.finalUrl!);
    this.audio = a;
    a.onloadedmetadata = () => { if (isFinite(a.duration)) this.playerDur.set(a.duration); };
    a.ontimeupdate = () => this.playerCur.set(a.currentTime);
    a.onplay = () => this.playerPlaying.set(true);
    a.onpause = () => this.playerPlaying.set(false);
    a.onended = () => { this.playerPlaying.set(false); this.playerCur.set(0); };
    a.play().catch(() => this.playerPlaying.set(false));
  }
  closePlayer() {
    this.audio?.pause();
    if (this.audio) this.audio.src = '';
    this.audio = undefined;
    this.playerSound.set(null);
    this.playerPlaying.set(false);
    this.playerCur.set(0);
    this.playerDur.set(0);
  }
  togglePlay() { if (!this.audio) return; this.audio.paused ? this.audio.play() : this.audio.pause(); }
  stopPlayer() { if (!this.audio) return; this.audio.pause(); this.audio.currentTime = 0; this.playerCur.set(0); }
  skip(delta: number) {
    if (!this.audio) return;
    this.audio.currentTime = Math.min(Math.max(0, this.audio.currentTime + delta), this.playerDur() || this.audio.duration || 0);
  }
  seek(t: number) { if (this.audio) this.audio.currentTime = t; }
  fmt(sec: number) {
    const s = Math.round(sec || 0);
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }
  fmtDate(ts: number) {
    return new Date(ts).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  }
  ngOnDestroy() { this.closePlayer(); }
}
