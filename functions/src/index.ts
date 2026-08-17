import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { logger } from 'firebase-functions/v2';
import * as admin from 'firebase-admin';
import Anthropic from '@anthropic-ai/sdk';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as nodePath from 'path';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ffmpegPath: string = require('ffmpeg-static');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ffprobePath: string = require('ffprobe-static').path;

admin.initializeApp();
const db = admin.firestore();
const bucket = admin.storage().bucket();

const ELEVENLABS_API_KEY = defineSecret('ELEVENLABS_API_KEY');
const ANTHROPIC_API_KEY = defineSecret('ANTHROPIC_API_KEY');
const REGION = 'europe-west1';

/** Espace de travail partagé : l'accès se joue sur le rôle, pas sur la propriété du son. */
async function assertEditor(uid: string) {
  const u = await db.collection('users').doc(uid).get();
  const p = u.data() as any;
  if (!u.exists || p?.approved !== true || (p?.role !== 'admin' && p?.role !== 'editor')) {
    logger.warn('assertEditor: refusé', { uid, profileExists: u.exists, role: p?.role, approved: p?.approved });
    throw new HttpsError('permission-denied', 'Compte éditeur approuvé requis');
  }
  logger.info('assertEditor: ok', { uid, role: p.role });
}
async function loadSound(soundId: string) {
  const snap = await db.collection('sounds').doc(soundId).get();
  if (!snap.exists) {
    logger.warn('loadSound: son introuvable', { soundId });
    throw new HttpsError('not-found', 'Son introuvable');
  }
  const sound = snap.data() as any;
  logger.info('loadSound: ok', { soundId, title: sound.title, segments: (sound.segments ?? []).length, assemblyStatus: sound.assemblyStatus });
  return { ref: snap.ref, sound };
}
async function loadSettings() {
  const s = await db.collection('settings').doc('global').get();
  if (!s.exists) {
    logger.warn('loadSettings: aucun doc réglages');
    throw new HttpsError('failed-precondition', 'Réglages manquants (page Réglages)');
  }
  const st = s.data() as any;
  logger.info('loadSettings: ok', { modelId: st.modelId, voices: (st.voices ?? []).length });
  return st;
}

/** Consommation / crédits restants ElevenLabs (pour la page réglages). */
export const getUsage = onCall(
  { region: REGION, secrets: [ELEVENLABS_API_KEY], timeoutSeconds: 30 },
  async (req) => {
    const uid = req.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Connexion requise');
    await assertEditor(uid);

    const [eleven, claude] = await Promise.all([
      // ElevenLabs : abonnement + caractères
      fetch('https://api.elevenlabs.io/v1/user/subscription', { headers: { 'xi-api-key': ELEVENLABS_API_KEY.value() } })
        .then(async (r) => {
          const j: any = await r.json().catch(() => null);
          if (!r.ok) { logger.error('getUsage: ElevenLabs en erreur', { status: r.status, body: JSON.stringify(j).slice(0, 300) }); return { error: 'HTTP ' + r.status }; }
          return {
            tier: j.tier ?? '',
            used: j.character_count ?? 0,
            limit: j.character_limit ?? 0,
            resetAt: j.next_character_count_reset_unix ? j.next_character_count_reset_unix * 1000 : null,
          };
        })
        .catch((e: any) => ({ error: String(e?.message || e) })),
      // Claude : consommation comptée par nos soins (le solde de crédits n'est pas exposé par l'API)
      (async () => {
        const month = new Date().toISOString().slice(0, 7);
        const s = await db.collection('stats').doc('claude-' + month).get();
        const d = (s.data() ?? {}) as any;
        const inputTokens = d.inputTokens ?? 0;
        const outputTokens = d.outputTokens ?? 0;
        // tarifs Claude Opus 4.8 : 5 $/M tokens en entrée, 25 $/M en sortie
        const estCostUsd = (inputTokens * 5 + outputTokens * 25) / 1_000_000;
        return { month, calls: d.calls ?? 0, inputTokens, outputTokens, estCostUsd };
      })().catch((e: any) => ({ error: String(e?.message || e) })),
    ]);

    logger.info('getUsage: ok', { eleven, claude });
    return { eleven, claude };
  }
);

/** 0) Liste les voix disponibles sur le compte ElevenLabs (pour la palette des réglages). */
export const listVoices = onCall(
  { region: REGION, secrets: [ELEVENLABS_API_KEY], timeoutSeconds: 30 },
  async (req) => {
    const uid = req.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Connexion requise');
    await assertEditor(uid);

    const resp = await fetch('https://api.elevenlabs.io/v1/voices', {
      headers: { 'xi-api-key': ELEVENLABS_API_KEY.value() },
    });
    if (!resp.ok) {
      const body = (await resp.text()).slice(0, 500);
      logger.error('listVoices: ElevenLabs en erreur', { status: resp.status, body });
      throw new HttpsError('internal', 'ElevenLabs: ' + resp.status + ' ' + body.slice(0, 300));
    }
    const json: any = await resp.json();
    // voix créées (cloned/generated/professional) d'abord, voix d'usine (premade) ensuite
    const voices = (json?.voices ?? [])
      .map((v: any) => ({ voiceId: v.voice_id, name: v.name, category: v.category ?? '' }))
      .sort((a: any, b: any) =>
        (a.category === 'premade' ? 1 : 0) - (b.category === 'premade' ? 1 : 0) || a.name.localeCompare(b.name));
    logger.info('listVoices: ok', { count: voices.length });
    return { voices };
  }
);

/** 1) Génère l'audio ElevenLabs d'UN segment du son, le stocke, met à jour le segment. */
export const generateSegment = onCall(
  { region: REGION, secrets: [ELEVENLABS_API_KEY], timeoutSeconds: 120 },
  async (req) => {
    logger.info('generateSegment: appel', { uid: req.auth?.uid, data: req.data });
    const uid = req.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Connexion requise');
    await assertEditor(uid);
    const soundId = req.data?.soundId as string;
    const segmentId = req.data?.segmentId as string;
    if (!soundId || !segmentId) throw new HttpsError('invalid-argument', 'soundId/segmentId manquant');
    const { ref, sound } = await loadSound(soundId);
    const st = await loadSettings();

    const segments: any[] = sound.segments ?? [];
    const seg = segments.find((s) => s.id === segmentId);
    if (!seg) throw new HttpsError('not-found', 'Segment introuvable dans ce son');
    if (!seg.voiceId) throw new HttpsError('failed-precondition', 'Aucune voix choisie pour ce segment');
    const text = seg.textV3 || seg.textPlain;
    if (!text) throw new HttpsError('failed-precondition', 'Segment sans texte');

    // met à jour le statut du segment dans le tableau (lecture-modification-écriture)
    const patchSegment = async (patch: any) => {
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const segs: any[] = (snap.data()?.segments ?? []).map((s: any) =>
          s.id === segmentId ? { ...s, ...patch } : s);
        tx.update(ref, { segments: segs, updatedAt: Date.now() });
      });
    };

    await patchSegment({ status: 'generating' });
    try {
      logger.info('generateSegment: appel ElevenLabs', { soundId, segmentId, voiceId: seg.voiceId, modelId: st.modelId || 'eleven_multilingual_v2', textLength: text.length });
      const resp = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${seg.voiceId}`, {
        method: 'POST',
        headers: { 'xi-api-key': ELEVENLABS_API_KEY.value(), 'Content-Type': 'application/json', 'Accept': 'audio/mpeg' },
        body: JSON.stringify({
          text,
          model_id: st.modelId || 'eleven_multilingual_v2',
          voice_settings: { stability: st.stability ?? 0.4, similarity_boost: st.similarityBoost ?? 0.75, style: st.style ?? 0.3, use_speaker_boost: true },
          output_format: 'mp3_44100_128',
          // dictionnaire de prononciation partagé (synchronisé via syncPronunciation)
          ...(st.pronDictId && st.pronDictVersionId ? {
            pronunciation_dictionary_locators: [{ pronunciation_dictionary_id: st.pronDictId, version_id: st.pronDictVersionId }],
          } : {}),
        }),
      });
      if (!resp.ok) {
        const body = (await resp.text()).slice(0, 500);
        logger.error('generateSegment: ElevenLabs en erreur', { soundId, segmentId, status: resp.status, body });
        throw new HttpsError('internal', 'ElevenLabs: ' + resp.status + ' ' + body.slice(0, 300));
      }
      let buf = Buffer.from(await resp.arrayBuffer());
      logger.info('generateSegment: audio reçu', { soundId, segmentId, bytes: buf.length });

      // ElevenLabs laisse parfois un souffle (respiration) en fin de segment :
      // on le coupe dès la génération, ainsi le fichier source est propre pour tous les assemblages
      const trimRaw = st.trimEndDb;
      const trimEndDb = (trimRaw === undefined || trimRaw === null || trimRaw === '') ? -35 : Number(trimRaw);
      if (isFinite(trimEndDb) && trimEndDb < 0) {
        buf = await trimTrailingBreath(buf, Math.min(Math.max(trimEndDb, -60), -20), { soundId, segmentId });
      }

      // nom versionné : l'URL change à chaque génération, sinon le navigateur
      // ressert l'ancien audio depuis son cache (même chemin → même URL signée)
      const generatedAt = Date.now();
      const path = `audio/sounds/${soundId}/${segmentId}-${generatedAt}.mp3`;
      const file = bucket.file(path);
      await file.save(buf, { metadata: { contentType: 'audio/mpeg' } });
      // nécessite roles/iam.serviceAccountTokenCreator sur le compte de service de la fonction (signBlob)
      const [url] = await file.getSignedUrl({ action: 'read', expires: '2491-01-01' });
      if (seg.audioPath && seg.audioPath !== path) {
        try { await bucket.file(seg.audioPath).delete(); }
        catch (e: any) { logger.warn('generateSegment: ancien fichier non supprimé — ' + String(e?.message || e), { soundId, segmentId }); }
      }
      // un segment régénéré rend l'assemblage existant obsolète
      await patchSegment({ status: 'generated', audioUrl: url, audioPath: path, chars: text.length, generatedAt });
      if (sound.assemblyStatus === 'done') await ref.update({ assemblyStatus: 'stale', updatedAt: Date.now() });
      logger.info('generateSegment: terminé', { soundId, segmentId, path });
      return { ok: true, url, path, generatedAt };
    } catch (e: any) {
      logger.error('generateSegment: échec — ' + String(e?.message || e), { soundId, segmentId, code: e?.code, stack: e?.stack });
      await patchSegment({ status: 'error' });
      throw e instanceof HttpsError ? e : new HttpsError('internal', String(e?.message || e));
    }
  }
);

/** 1bis) Téléverse (ou retire) le jingle d'intro de chapitre d'un projet. */
export const setProjectIntro = onCall(
  { region: REGION, timeoutSeconds: 120, memory: '512MiB' },
  async (req) => {
    const uid = req.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Connexion requise');
    await assertEditor(uid);
    const projectId = req.data?.projectId as string;
    if (!projectId) throw new HttpsError('invalid-argument', 'projectId manquant');
    const pref = db.collection('projects').doc(projectId);
    const psnap = await pref.get();
    if (!psnap.exists) throw new HttpsError('not-found', 'Projet introuvable');
    const project = psnap.data() as any;

    const del = admin.firestore.FieldValue.delete();
    const removeOld = async () => {
      if (!project.introPath) return;
      try { await bucket.file(project.introPath).delete(); }
      catch (e: any) { logger.warn('setProjectIntro: ancien jingle non supprimé — ' + String(e?.message || e), { projectId }); }
    };

    // sans dataBase64 → suppression du jingle
    const dataBase64 = req.data?.dataBase64 as string | undefined;
    if (!dataBase64) {
      await removeOld();
      await pref.update({ introUrl: del, introPath: del, introName: del, introDurationSec: del, updatedAt: Date.now() });
      logger.info('setProjectIntro: jingle retiré', { projectId });
      return { ok: true, removed: true };
    }

    const name = String(req.data?.name ?? 'intro.mp3').slice(0, 120);
    const buf = Buffer.from(dataBase64, 'base64');
    if (!buf.length) throw new HttpsError('invalid-argument', 'Fichier vide');
    if (buf.length > 8 * 1024 * 1024) throw new HttpsError('invalid-argument', 'Fichier trop lourd (max 8 Mo)');

    const tmp = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'intro-'));
    try {
      // ré-encodage systématique : garantit un MP3 44,1 kHz stéréo concaténable avec les segments
      const inF = nodePath.join(tmp, 'in.bin');
      const outF = nodePath.join(tmp, 'intro.mp3');
      fs.writeFileSync(inF, buf);
      try {
        await runFfmpeg(['-y', '-i', inF, '-ac', '2', '-ar', '44100', '-c:a', 'libmp3lame', '-b:a', '128k', outF]);
      } catch (e: any) {
        logger.error('setProjectIntro: ffmpeg a refusé le fichier — ' + String(e?.message || e), { projectId, name });
        throw new HttpsError('invalid-argument', 'Fichier audio illisible (formats acceptés : mp3, wav, m4a, aac, ogg)');
      }
      let durationSec = 0;
      try { durationSec = Math.round(parseFloat(await runFfprobe(['-show_entries', 'format=duration', '-of', 'csv=p=0', outF])) * 10) / 10; }
      catch { /* facultatif */ }

      await removeOld();
      const path = `audio/projects/${projectId}/intro-${Date.now()}.mp3`;
      await bucket.upload(outF, { destination: path, metadata: { contentType: 'audio/mpeg' } });
      const [url] = await bucket.file(path).getSignedUrl({ action: 'read', expires: '2491-01-01' });
      await pref.update({ introUrl: url, introPath: path, introName: name, introDurationSec: durationSec, updatedAt: Date.now() });
      logger.info('setProjectIntro: ok', { projectId, name, path, durationSec });
      return { ok: true, url, name, durationSec };
    } finally {
      try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* tmp éphémère */ }
    }
  }
);

/** 1ter) Téléverse (ou retire) l'image d'un projet (par défaut) ou d'un son (surcharge). */
export const setImage = onCall(
  { region: REGION, timeoutSeconds: 120, memory: '512MiB' },
  async (req) => {
    const uid = req.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Connexion requise');
    await assertEditor(uid);
    const scope = req.data?.scope as string; // 'project' | 'sound'
    const id = req.data?.id as string;
    if (!['project', 'sound'].includes(scope) || !id) throw new HttpsError('invalid-argument', 'scope/id manquant');

    const ref = db.collection(scope === 'project' ? 'projects' : 'sounds').doc(id);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError('not-found', (scope === 'project' ? 'Projet' : 'Son') + ' introuvable');
    const cur = snap.data() as any;

    const del = admin.firestore.FieldValue.delete();
    const removeOld = async () => {
      if (!cur.imagePath) return;
      try { await bucket.file(cur.imagePath).delete(); }
      catch (e: any) { logger.warn('setImage: ancienne image non supprimée — ' + String(e?.message || e), { scope, id }); }
    };

    const dataBase64 = req.data?.dataBase64 as string | undefined;
    if (!dataBase64) {
      await removeOld();
      await ref.update({ imageUrl: del, imagePath: del, imageName: del, updatedAt: Date.now() });
      logger.info('setImage: image retirée', { scope, id });
      return { ok: true, removed: true };
    }

    const name = String(req.data?.name ?? 'image.jpg').slice(0, 120);
    const buf = Buffer.from(dataBase64, 'base64');
    if (!buf.length) throw new HttpsError('invalid-argument', 'Fichier vide');
    if (buf.length > 7 * 1024 * 1024) throw new HttpsError('invalid-argument', 'Image trop lourde (max 7 Mo)');
    const ext = (name.match(/\.(jpe?g|png|webp)$/i)?.[1] ?? 'jpg').toLowerCase();

    await removeOld();
    const path = `images/${scope}s/${id}/image-${Date.now()}.${ext}`;
    const file = bucket.file(path);
    await file.save(buf, { metadata: { contentType: ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg' } });
    const [url] = await file.getSignedUrl({ action: 'read', expires: '2491-01-01' });
    await ref.update({ imageUrl: url, imagePath: path, imageName: name, updatedAt: Date.now() });
    logger.info('setImage: ok', { scope, id, path });
    return { ok: true, url, name };
  }
);

/** 2bis) Génère un MP4 : image fixe (son ou projet) + MP3 assemblé du son. */
// /tmp est un disque en RAM sur Cloud Run : le MP4 produit y réside entièrement
// (≈ 1 Go pour 15 min à 8 Mb/s). D'où la mémoire large et une seule requête par
// instance — sinon deux encodages simultanés font exploser la limite.
export const generateVideo = onCall(
  { region: REGION, timeoutSeconds: 1800, memory: '4GiB', cpu: 4, concurrency: 1 },
  async (req) => {
    logger.info('generateVideo: appel', { uid: req.auth?.uid, data: req.data });
    const uid = req.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Connexion requise');
    await assertEditor(uid);
    const soundId = req.data?.soundId as string;
    if (!soundId) throw new HttpsError('invalid-argument', 'soundId manquant');
    const { ref, sound } = await loadSound(soundId);
    if (!sound.finalPath) throw new HttpsError('failed-precondition', 'Assemble d\'abord le MP3 de ce son');

    // image : celle du son si définie, sinon celle du projet
    let imagePath: string | undefined = sound.imagePath;
    if (!imagePath && sound.projectId) {
      const p = (await db.collection('projects').doc(sound.projectId).get()).data() as any;
      imagePath = p?.imagePath;
    }
    if (!imagePath) throw new HttpsError('failed-precondition', 'Aucune image : ajoute-en une sur le son ou sur son projet');

    let st: any = {};
    try { st = await loadSettings(); } catch { /* défauts */ }
    const w = Math.min(Math.max(Number(st.videoWidth) || 1920, 160), 3840);
    const h = Math.min(Math.max(Number(st.videoHeight) || 1080, 160), 2160);
    const vBitrate = Math.min(Math.max(Number(st.videoBitrate) || 8000, 500), 50000); // kb/s
    const aBitrate = Math.min(Math.max(Number(st.videoAudioBitrate) || 192, 64), 320); // kb/s
    const fps = Math.min(Math.max(Number(st.videoFps) || 25, 1), 60);

    // le MP3 référencé peut avoir disparu (fiche désynchronisée) → on retombe sur
    // le dernier final-*.mp3 du dossier et on répare la fiche au passage
    let finalPath: string = sound.finalPath;
    const [exists] = await bucket.file(finalPath).exists();
    if (!exists) {
      const [files] = await bucket.getFiles({ prefix: `audio/sounds/${soundId}/final-` });
      const latest = files.map((f) => f.name).sort().pop();
      if (!latest) throw new HttpsError('failed-precondition', 'MP3 assemblé introuvable — relance « Assembler le MP3 »');
      logger.warn('generateVideo: finalPath obsolète, repli sur le dernier assemblage', { soundId, was: finalPath, now: latest });
      const [freshUrl] = await bucket.file(latest).getSignedUrl({ action: 'read', expires: '2491-01-01' });
      await ref.update({ finalPath: latest, finalUrl: freshUrl, updatedAt: Date.now() });
      finalPath = latest;
    }

    await ref.update({ videoStatus: 'generating', updatedAt: Date.now() });
    const tmp = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'vid-'));
    try {
      const img = nodePath.join(tmp, 'image' + nodePath.extname(imagePath));
      const audio = nodePath.join(tmp, 'audio.mp3');
      const out = nodePath.join(tmp, 'video.mp4');
      await bucket.file(imagePath).download({ destination: img });
      await bucket.file(finalPath).download({ destination: audio });

      logger.info('generateVideo: encodage', { soundId, w, h, fps, vBitrate, aBitrate, durationSec: sound.finalDurationSec ?? null });
      // Image fixe : toutes les trames sont identiques, donc « ultrafast » ne coûte
      // aucune qualité mais évite le dépassement du délai sur les sons longs.
      // Qualité pilotée par CRF, le débit réglé servant de plafond : viser un débit
      // constant produirait des centaines de Mo de bits inutiles.
      await runFfmpeg(['-y', '-loop', '1', '-framerate', String(fps), '-i', img, '-i', audio,
        '-vf', `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,format=yuv420p`,
        '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'stillimage', '-threads', '4',
        '-crf', '20', '-maxrate', vBitrate + 'k', '-bufsize', (vBitrate * 2) + 'k',
        '-g', String(fps * 10),
        '-c:a', 'aac', '-b:a', aBitrate + 'k',
        '-shortest', '-movflags', '+faststart', out]);

      // libère la RAM des sources (/tmp = tmpfs) avant l'envoi
      for (const f of [img, audio]) { try { fs.rmSync(f, { force: true }); } catch { /* déjà parti */ } }
      logger.info('generateVideo: encodage terminé', { soundId, bytes: fs.statSync(out).size });

      const destPath = `video/sounds/${soundId}/video-${Date.now()}.mp4`;
      await bucket.upload(out, { destination: destPath, metadata: { contentType: 'video/mp4' } });
      // purge les anciens MP4 du son
      try {
        const [olds] = await bucket.getFiles({ prefix: `video/sounds/${soundId}/video-` });
        for (const f of olds) if (f.name !== destPath) await f.delete().catch(() => { /* déjà parti */ });
      } catch (e: any) { logger.warn('generateVideo: purge des anciens MP4 échouée — ' + String(e?.message || e), { soundId }); }
      const [url] = await bucket.file(destPath).getSignedUrl({ action: 'read', expires: '2491-01-01' });
      const sizeMb = Math.round(fs.statSync(out).size / 1024 / 1024 * 10) / 10;
      // version propre au MP4, incrémentée à chaque génération
      const videoVersion = (Number(sound.videoVersion) || 0) + 1;
      await ref.update({
        videoStatus: 'done', videoUrl: url, videoPath: destPath, videoSizeMb: sizeMb,
        videoVersion, videoFinalVersion: sound.finalVersion ?? null,
        videoAt: Date.now(), updatedAt: Date.now(),
      });
      logger.info('generateVideo: ok', { soundId, destPath, sizeMb, videoVersion });
      return { ok: true, url, sizeMb, width: w, height: h, version: videoVersion };
    } catch (e: any) {
      logger.error('generateVideo: échec — ' + String(e?.message || e), { soundId, stack: e?.stack });
      await ref.update({ videoStatus: 'error', updatedAt: Date.now() });
      throw e instanceof HttpsError ? e : new HttpsError('internal', String(e?.message || e));
    } finally {
      try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* tmp éphémère */ }
    }
  }
);

/** 2) Assemble les segments d'un son (dans l'ordre) en UN SEUL fichier MP3. */
export const assembleSound = onCall(
  { region: REGION, secrets: [], timeoutSeconds: 300, memory: '2GiB', concurrency: 1 },
  async (req) => {
    logger.info('assembleSound: appel', { uid: req.auth?.uid, data: req.data });
    const uid = req.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Connexion requise');
    await assertEditor(uid);
    const soundId = req.data?.soundId as string;
    if (!soundId) throw new HttpsError('invalid-argument', 'soundId manquant');
    const { ref, sound } = await loadSound(soundId);
    let st: any = {};
    try { st = await loadSettings(); } catch { /* défauts */ }

    // segmentIds fourni → assemblage d'essai d'un sous-ensemble (n'affecte pas le MP3 final)
    const requestedIds: string[] = Array.isArray(req.data?.segmentIds) ? req.data.segmentIds : [];
    const isPreview = requestedIds.length > 0;
    let segments: any[] = (sound.segments ?? []).filter((s: any) => (s.textV3 || s.textPlain));
    if (isPreview) segments = segments.filter((s: any) => requestedIds.includes(s.id));
    if (!segments.length) throw new HttpsError('failed-precondition', 'Aucun segment dans ce son');
    if (segments.length > 200) throw new HttpsError('invalid-argument', 'Trop de segments (max 200)');
    const missing = segments.filter((s: any) => !s.audioPath || s.status !== 'generated');
    if (missing.length) {
      throw new HttpsError('failed-precondition',
        'Segment(s) sans audio généré : ' + missing.map((s: any, i: number) => s.voiceName || ('#' + (i + 1))).join(', '));
    }

    const clampSil = (v: unknown, fallback: number) => {
      const n = Number(v);
      const eff = (v === null || v === undefined || v === '' || !isFinite(n)) ? fallback : n;
      return Math.min(Math.max(eff, 0), 10);
    };
    const gapDefault = clampSil(st.segmentGap, 0.4); // pause par défaut entre deux segments
    // blancs d'ouverture / clôture : réglage du son, sinon valeur globale
    const silBefore = clampSil(sound.silenceBefore, clampSil(st.audioSilenceBefore, 0));
    const silAfter = clampSil(sound.silenceAfter, clampSil(st.audioSilenceAfter, 0));

    // jingle d'intro du projet, si le son l'a activé (jamais sur un essai de sélection)
    let intro: { path: string; gap: number } | null = null;
    if (!isPreview && sound.useIntro && sound.projectId) {
      const psnap = await db.collection('projects').doc(sound.projectId).get();
      const p = psnap.data() as any;
      if (p?.introPath) intro = { path: p.introPath, gap: clampSil(p.introGap, gapDefault) };
      else logger.warn('assembleSound: intro demandée mais le projet n\'a pas de jingle', { soundId, projectId: sound.projectId });
    }

    if (!isPreview) await ref.update({ assemblyStatus: 'assembling', updatedAt: Date.now() });
    const tmp = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'smash-'));
    try {
      // télécharge le jingle (en tête) puis chaque segment
      const files: string[] = [];
      const gaps: number[] = []; // pause après chaque fichier
      if (intro) {
        const dest = nodePath.join(tmp, 'intro.mp3');
        await bucket.file(intro.path).download({ destination: dest });
        files.push(dest);
        gaps.push(intro.gap);
      }
      for (const [i, seg] of segments.entries()) {
        const dest = nodePath.join(tmp, `seg${String(i).padStart(3, '0')}.mp3`);
        await bucket.file(seg.audioPath).download({ destination: dest });
        files.push(dest);
        gaps.push(i < segments.length - 1 ? clampSil(seg.silenceAfter, gapDefault) : silAfter);
      }

      // concat via filter_complex : pause (apad) après chaque segment sauf le dernier,
      // silence d'ouverture (adelay) sur le premier, silence de clôture sur le dernier
      logger.info('assembleSound: pauses appliquées', {
        soundId, gapDefault, silBefore, silAfter, intro: intro ? { gap: intro.gap } : null, gaps,
      });
      const out = nodePath.join(tmp, 'final.mp3');
      const inputs = files.flatMap((f) => ['-i', f]);
      let fl = '';
      const labels: string[] = [];
      for (let i = 0; i < files.length; i++) {
        const filters: string[] = ['aformat=sample_rates=44100:channel_layouts=stereo'];
        if (i === 0 && silBefore > 0) filters.push(`adelay=delays=${Math.round(silBefore * 1000)}:all=1`);
        if (gaps[i] > 0) filters.push(`apad=pad_dur=${gaps[i]}`);
        fl += `[${i}:a]${filters.join(',')}[a${i}];`;
        labels.push(`[a${i}]`);
      }
      fl += labels.join('') + `concat=n=${files.length}:v=0:a=1[out]`;
      await runFfmpeg(['-y', ...inputs, '-filter_complex', fl, '-map', '[out]',
        '-c:a', 'libmp3lame', '-b:a', '128k', out]);

      // nom versionné (cf. generateSegment) : URL nouvelle à chaque assemblage
      const destPath = `audio/sounds/${soundId}/${isPreview ? 'preview' : 'final'}-${Date.now()}.mp3`;
      await bucket.upload(out, { destination: destPath, metadata: { contentType: 'audio/mpeg' } });
      const [url] = await bucket.file(destPath).getSignedUrl({ action: 'read', expires: '2491-01-01' });
      // purge tous les anciens fichiers du même type (plus fiable que suivre l'ancien
      // chemin de la fiche, qui peut être périmé) — le nouveau est conservé
      try {
        const [olds] = await bucket.getFiles({ prefix: `audio/sounds/${soundId}/${isPreview ? 'preview' : 'final'}-` });
        for (const f of olds) if (f.name !== destPath) await f.delete().catch(() => { /* déjà parti */ });
      } catch (e: any) { logger.warn('assembleSound: purge des anciens fichiers échouée — ' + String(e?.message || e), { soundId }); }
      const sizeMb = Math.round(fs.statSync(out).size / 1024 / 1024 * 10) / 10;
      let durationSec = 0;
      try { durationSec = Math.round(parseFloat(await runFfprobe(['-show_entries', 'format=duration', '-of', 'csv=p=0', out]))); }
      catch (e: any) { logger.warn('assembleSound: durée non mesurée — ' + String(e?.message || e)); }

      // numéro de version incrémenté à chaque assemblage complet (intégré au nom de téléchargement)
      const version = isPreview ? undefined : (Number(sound.finalVersion) || 0) + 1;
      await ref.update(isPreview
        ? { previewPath: destPath, updatedAt: Date.now() }
        : {
          assemblyStatus: 'done', finalUrl: url, finalPath: destPath,
          finalDurationSec: durationSec, finalSizeMb: sizeMb, assembledAt: Date.now(),
          finalVersion: version,
          // le MP4 existant ne correspond plus à ce nouvel assemblage
          ...(sound.videoStatus === 'done' ? { videoStatus: 'stale' } : {}),
          updatedAt: Date.now(),
        });
      logger.info('assembleSound: ok', { soundId, isPreview, version: version ?? null, count: files.length, sizeMb, durationSec, destPath });
      return { ok: true, url, count: files.length, sizeMb, durationSec, version };
    } catch (e: any) {
      logger.error('assembleSound: échec — ' + String(e?.message || e), { soundId, stack: e?.stack });
      if (!isPreview) await ref.update({ assemblyStatus: 'error', updatedAt: Date.now() });
      throw e instanceof HttpsError ? e : new HttpsError('internal', String(e?.message || e));
    } finally {
      try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* tmp éphémère */ }
    }
  }
);

/** 3) Réinitialise un son : supprime les fichiers stockés et remet les statuts à zéro. */
export const resetSound = onCall(
  { region: REGION, timeoutSeconds: 60 },
  async (req) => {
    logger.info('resetSound: appel', { uid: req.auth?.uid, data: req.data });
    const uid = req.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Connexion requise');
    await assertEditor(uid);
    const soundId = req.data?.soundId as string;
    if (!soundId) throw new HttpsError('invalid-argument', 'soundId manquant');
    const scope = (req.data?.scope as string) || 'all'; // 'all' | 'final'
    if (!['all', 'final'].includes(scope)) throw new HttpsError('invalid-argument', 'scope invalide');
    const { ref, sound } = await loadSound(soundId);

    if (scope === 'all') {
      // supprime tout le dossier du son (segments + final + orphelins de segments supprimés) et la vidéo
      for (const prefix of [`audio/sounds/${soundId}/`, `video/sounds/${soundId}/`]) {
        try {
          await bucket.deleteFiles({ prefix });
          logger.info('resetSound: dossier supprimé', { soundId, prefix });
        } catch (e: any) { logger.warn('resetSound: suppression dossier échouée — ' + String(e?.message || e), { soundId, prefix }); }
      }
    } else if (sound.finalPath) {
      try { await bucket.file(sound.finalPath).delete(); logger.info('resetSound: final supprimé', { soundId }); }
      catch (e: any) { logger.warn('resetSound: suppression final échouée — ' + String(e?.message || e), { soundId }); }
    }

    const del = admin.firestore.FieldValue.delete();
    const segments = (sound.segments ?? []).map((s: any) => scope === 'all'
      ? { ...s, status: 'not_generated', audioUrl: null, audioPath: null, generatedAt: null }
      : s);
    await ref.update({
      ...(scope === 'all' ? { segments } : {}),
      assemblyStatus: 'none', finalUrl: del, finalPath: del,
      finalDurationSec: del, finalSizeMb: del, assembledAt: del,
      ...(scope === 'all' ? { videoStatus: del, videoUrl: del, videoPath: del, videoSizeMb: del, videoAt: del, videoVersion: del, videoFinalVersion: del } : {}),
      updatedAt: Date.now(),
    });
    logger.info('resetSound: ok', { soundId, scope });
    return { ok: true, scope };
  }
);

/** 4) Synchronise les règles de prononciation des réglages vers un dictionnaire ElevenLabs. */
export const syncPronunciation = onCall(
  { region: REGION, secrets: [ELEVENLABS_API_KEY], timeoutSeconds: 60 },
  async (req) => {
    logger.info('syncPronunciation: appel', { uid: req.auth?.uid });
    const uid = req.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Connexion requise');
    await assertEditor(uid);

    const sref = db.collection('settings').doc('global');
    const sdoc = await sref.get();
    const st = (sdoc.data() ?? {}) as any;
    const rules = ((st.pronunciationRules ?? []) as any[])
      .filter((r) => r?.word && (r?.alias || r?.ipa));
    if (!rules.length) throw new HttpsError('failed-precondition', 'Aucune règle de prononciation renseignée');

    // IPA prioritaire (précis, modèles v3/flash_v2), sinon alias (tous modèles)
    const elevenRules = rules.map((r) =>
      r.ipa
        ? { string_to_replace: r.word, type: 'phoneme', phoneme: r.ipa, alphabet: 'ipa' }
        : { string_to_replace: r.word, type: 'alias', alias: r.alias });

    const headers = { 'xi-api-key': ELEVENLABS_API_KEY.value(), 'Content-Type': 'application/json' };
    let dictId = (st.pronDictId as string) || '';
    let versionId = '';

    if (!dictId) {
      const resp = await fetch('https://api.elevenlabs.io/v1/pronunciation-dictionaries/add-from-rules', {
        method: 'POST', headers, body: JSON.stringify({ name: 'smash-studio', rules: elevenRules }),
      });
      const j: any = await resp.json().catch(() => null);
      if (!resp.ok) {
        logger.error('syncPronunciation: création refusée', { status: resp.status, response: JSON.stringify(j).slice(0, 500) });
        throw new HttpsError('internal', 'ElevenLabs: ' + JSON.stringify(j?.detail ?? j).slice(0, 300));
      }
      dictId = String(j?.id ?? '');
      versionId = String(j?.version_id ?? j?.versionId ?? '');
    } else {
      // reconciliation : retire les règles de la synchro précédente, ajoute les actuelles
      const prevWords: string[] = (st.pronSyncedWords ?? []) as string[];
      if (prevWords.length) {
        const rresp = await fetch(`https://api.elevenlabs.io/v1/pronunciation-dictionaries/${dictId}/remove-rules`, {
          method: 'POST', headers, body: JSON.stringify({ rule_strings: prevWords }),
        });
        if (!rresp.ok) logger.warn('syncPronunciation: remove-rules refusé', { status: rresp.status, body: (await rresp.text()).slice(0, 300) });
      }
      const aresp = await fetch(`https://api.elevenlabs.io/v1/pronunciation-dictionaries/${dictId}/add-rules`, {
        method: 'POST', headers, body: JSON.stringify({ rules: elevenRules }),
      });
      const aj: any = await aresp.json().catch(() => null);
      if (!aresp.ok) {
        logger.error('syncPronunciation: add-rules refusé', { status: aresp.status, response: JSON.stringify(aj).slice(0, 500) });
        throw new HttpsError('internal', 'ElevenLabs: ' + JSON.stringify(aj?.detail ?? aj).slice(0, 300));
      }
      versionId = String(aj?.version_id ?? aj?.versionId ?? '');
    }

    if (!dictId || !versionId) throw new HttpsError('internal', 'Réponse ElevenLabs sans id/version de dictionnaire');
    await sref.set({
      pronDictId: dictId,
      pronDictVersionId: versionId,
      pronSyncedWords: rules.map((r) => r.word),
      pronSyncedAt: Date.now(),
    }, { merge: true });
    logger.info('syncPronunciation: ok', { dictId, versionId, count: rules.length });
    return { dictId, versionId, count: rules.length };
  }
);

/** Comptabilise la consommation Claude du mois (affichée dans les réglages). */
async function trackClaudeUsage(usage: Anthropic.Usage) {
  try {
    const month = new Date().toISOString().slice(0, 7); // "2026-07"
    const inc = admin.firestore.FieldValue.increment;
    await db.collection('stats').doc('claude-' + month).set({
      calls: inc(1),
      inputTokens: inc(usage.input_tokens ?? 0),
      outputTokens: inc(usage.output_tokens ?? 0),
      updatedAt: Date.now(),
    }, { merge: true });
  } catch (e: any) { logger.warn('trackClaudeUsage: comptage échoué — ' + String(e?.message || e)); }
}

/** 5) Rebalise un texte : ajoute les balises audio ElevenLabs v3 via Claude. */
export const tagText = onCall(
  { region: REGION, secrets: [ANTHROPIC_API_KEY], timeoutSeconds: 120 },
  async (req) => {
    logger.info('tagText: appel', { uid: req.auth?.uid, textLength: (req.data?.text ?? '').length });
    const uid = req.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Connexion requise');
    await assertEditor(uid);
    const text = (req.data?.text as string ?? '').trim();
    if (!text) throw new HttpsError('invalid-argument', 'Texte vide');

    // réglages partagés (dynamisme, plafond, consignes), surchargeables via la requête
    let st: any = {};
    try { st = await loadSettings(); } catch { /* défauts */ }
    const dynamism = (req.data?.dynamism as string) || (st.tagDynamism as string) || 'modere';
    const maxTags = Math.min(Math.max(Number(req.data?.maxTags) || Number(st.tagMaxTags) || 3, 1), 15);
    const dynamismRule = {
      sobre: 'Registre SOBRE : uniquement des respirations et pauses naturelles ([pause], [soupire] léger). Aucune émotion marquée, aucun rire.',
      modere: 'Registre MODÉRÉ : émotions discrètes uniquement là où le propos les rend évidentes, sinon pauses et respirations. Pas de théâtralité.',
      expressif: 'Registre EXPRESSIF : interprétation vivante — varie les tons ([enthousiaste], [chaleureux], [curieux], [petit rire]…), marque les moments forts, tout en restant crédible pour un magazine audio professionnel.',
    }[dynamism] ?? 'Registre modéré.';

    const system = `Tu enrichis des textes de narration française avec les balises audio d'ElevenLabs v3 (modèle text-to-speech expressif).

Règles strictes :
- Tu ne modifies JAMAIS les mots du texte : mêmes mots, même ordre, même ponctuation. Tu ne fais qu'INSÉRER des balises entre crochets.
- Balises disponibles (exemples) : [pause], [soupire], [rit], [petit rire], [chuchote], [enthousiaste], [curieux], [pensif], [sérieux], [chaleureux], [hésite]. Tu peux utiliser d'autres balises descriptives courtes en français si le ton l'exige.
- ${dynamismRule}
- Maximum ${maxTags} balise(s) au total dans le texte. Place-les seulement là où elles améliorent réellement l'interprétation.
- Contexte : version audio d'un magazine professionnel agricole (plusieurs voix se partagent la lecture).${st.tagInstructions ? '\n- Consignes spécifiques du client : ' + st.tagInstructions : ''}
- Réponds UNIQUEMENT avec le texte balisé, sans commentaire, sans guillemets autour.`;

    logger.info('tagText: paramètres', { dynamism, maxTags, hasInstructions: !!st.tagInstructions, overrides: { dynamism: req.data?.dynamism ?? null, maxTags: req.data?.maxTags ?? null } });
    const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY.value() });
    let response: Anthropic.Message;
    try {
      response = await anthropic.messages.create({
        model: 'claude-opus-4-8',
        max_tokens: 4096,
        thinking: { type: 'adaptive' },
        system,
        messages: [{ role: 'user', content: text }],
      });
    } catch (e: any) {
      // fait remonter la vraie cause (clé invalide, crédits épuisés, modèle indisponible…)
      logger.error('tagText: erreur API Claude — ' + String(e?.message || e), { status: e?.status, type: e?.type });
      throw new HttpsError('internal', 'Claude: ' + String(e?.message || e).slice(0, 300));
    }

    if (response.stop_reason === 'refusal') {
      logger.warn('tagText: refus du modèle', { uid });
      throw new HttpsError('internal', 'Le modèle a refusé la requête');
    }
    const tagged = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();
    if (!tagged) throw new HttpsError('internal', 'Réponse vide du modèle');
    logger.info('tagText: ok', { inLength: text.length, outLength: tagged.length, usage: response.usage });

    await trackClaudeUsage(response.usage);
    return { tagged };
  }
);

/**
 * Coupe le souffle (respiration) que ElevenLabs laisse parfois en fin de segment.
 * Astuce ffmpeg : l'audio est renversé, silenceremove retire tout ce qui reste sous
 * le seuil (dB) au début — donc à la fin réelle — en conservant 0,1 s de queue,
 * puis un court fondu (50 ms) évite un clic de coupe, et on renverse à nouveau.
 * En cas d'échec ffmpeg ou de résultat quasi vide, l'audio d'origine est conservé.
 */
async function trimTrailingBreath(buf: Buffer, thresholdDb: number, ctx: { soundId: string; segmentId: string }): Promise<Buffer> {
  const tmp = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'trim-'));
  const inF = nodePath.join(tmp, 'in.mp3');
  const outF = nodePath.join(tmp, 'out.mp3');
  try {
    fs.writeFileSync(inF, buf);
    const filter = 'areverse,'
      + `silenceremove=start_periods=1:start_threshold=${thresholdDb}dB:start_silence=0.1,`
      + 'afade=t=in:d=0.05,areverse';
    await runFfmpeg(['-y', '-i', inF, '-af', filter, '-ac', '2', '-ar', '44100', '-c:a', 'libmp3lame', '-b:a', '128k', outF]);
    const out = fs.readFileSync(outF);
    if (out.length < 1000) {
      // segment entier sous le seuil : coupe aberrante, on garde l'original
      logger.warn('trimTrailingBreath: résultat quasi vide, audio d\'origine conservé', { ...ctx, thresholdDb, outBytes: out.length });
      return buf;
    }
    let trimmedSec = 0;
    try {
      const inDur = parseFloat(await runFfprobe(['-show_entries', 'format=duration', '-of', 'csv=p=0', inF]));
      const outDur = parseFloat(await runFfprobe(['-show_entries', 'format=duration', '-of', 'csv=p=0', outF]));
      trimmedSec = Math.round((inDur - outDur) * 100) / 100;
    } catch (e: any) { logger.warn('trimTrailingBreath: durées non mesurées — ' + String(e?.message || e), ctx); }
    logger.info('trimTrailingBreath: fin de segment nettoyée', { ...ctx, thresholdDb, trimmedSec });
    return out;
  } catch (e: any) {
    logger.warn('trimTrailingBreath: échec ffmpeg, audio d\'origine conservé — ' + String(e?.message || e), ctx);
    return buf;
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* tmp éphémère */ }
  }
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, args);
    let err = '';
    proc.stderr.on('data', (d) => { err += d.toString(); });
    proc.on('error', reject);
    proc.on('close', (code) => code === 0 ? resolve() : reject(new Error('ffmpeg (' + code + '): ' + err.slice(-800))));
  });
}

function runFfprobe(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffprobePath, ['-v', 'error', ...args]);
    let out = ''; let err = '';
    proc.stdout.on('data', (d) => { out += d.toString(); });
    proc.stderr.on('data', (d) => { err += d.toString(); });
    proc.on('error', reject);
    proc.on('close', (code) => code === 0 ? resolve(out.trim()) : reject(new Error('ffprobe: ' + (err || out).slice(-300))));
  });
}
