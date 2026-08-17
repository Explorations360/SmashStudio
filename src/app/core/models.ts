export type UserRole = 'admin' | 'editor' | 'user';

export interface UserProfile {
  uid: string;
  email: string;
  role: UserRole;
  approved: boolean;
  createdAt: number;
}

export type SegmentStatus = 'not_generated' | 'generating' | 'generated' | 'error';
// 'stale' = un segment a été régénéré après le dernier assemblage → à réassembler
export type AssemblyStatus = 'none' | 'assembling' | 'done' | 'error' | 'stale';

/** Un passage lu par UNE voix ElevenLabs, à l'intérieur d'un son. */
export interface Segment {
  id: string;              // identifiant local, stable pour le fichier Storage
  voiceId: string;         // voix ElevenLabs de ce segment
  voiceName: string;       // libellé affiché (ex. "Voix femme principale")
  textV3: string;          // texte avec balises ElevenLabs v3
  textPlain: string;       // texte sans balises
  silenceAfter?: number | null; // pause après ce segment en s (vide = réglage global)
  status: SegmentStatus;
  audioUrl?: string | null;
  audioPath?: string | null;
  chars?: number;
  generatedAt?: number | null;
}

/** Un projet (podcast) regroupe une liste de sons. */
export interface Project {
  id?: string;
  name: string;            // ex: "Le Gouessant Infos 146"
  // jingle d'intro de chapitre, ajoutable en tête des sons du projet
  introUrl?: string;
  introPath?: string;
  introName?: string;      // nom du fichier d'origine
  introDurationSec?: number;
  introGap?: number | null; // pause après le jingle (vide = pause entre segments des Réglages)
  // image par défaut des MP4 du projet (surchargeable son par son)
  imageUrl?: string;
  imagePath?: string;
  imageName?: string;
  createdAt: number;
  updatedAt?: number;
}

export type VideoStatus = 'none' | 'generating' | 'done' | 'error' | 'stale';

/** Un son final = une suite ordonnée de segments assemblés en un seul MP3. */
export interface Sound {
  id?: string;             // id Firestore
  ownerUid: string;
  projectId?: string | null; // projet auquel le son appartient (null = sans projet)
  title: string;           // ex: "1. Intro — Le Gouessant Infos 146"
  order: number;
  useIntro?: boolean;      // ajouter le jingle d'intro du projet en tête de l'assemblage
  silenceBefore?: number | null; // blanc au début du MP3 assemblé, en s (vide = réglage global)
  silenceAfter?: number | null;  // blanc à la fin du MP3 assemblé, en s (vide = réglage global)
  segments: Segment[];

  assemblyStatus: AssemblyStatus;
  finalUrl?: string;       // MP3 assemblé (URL signée)
  finalPath?: string;      // chemin Storage
  finalDurationSec?: number;
  finalSizeMb?: number;
  finalVersion?: number;   // n° de version, incrémenté à chaque assemblage complet
  assembledAt?: number;
  previewPath?: string;    // dernier assemblage d'essai (sous-ensemble de segments)

  // image propre au son (sinon celle du projet) et MP4 image fixe + MP3
  imageUrl?: string;
  imagePath?: string;
  imageName?: string;
  videoStatus?: VideoStatus;
  videoUrl?: string;
  videoPath?: string;
  videoSizeMb?: number;
  videoVersion?: number;             // n° de version du MP4, incrémenté à chaque génération
  videoFinalVersion?: number | null; // version du MP3 utilisée pour ce MP4
  videoAt?: number;

  updatedAt?: number;
}

/** Une entrée de la palette de voix partagée (réglages). */
export interface VoiceSlot {
  label: string;    // ex: "Voix femme principale"
  voiceId: string;  // voix ElevenLabs associée
  voiceName: string;
}

export interface Settings {
  modelId: string;         // ex: "eleven_multilingual_v2" ou "eleven_v3"
  stability: number;
  similarityBoost: number;
  style: number;
  voices: VoiceSlot[];     // palette de voix proposée dans l'éditeur de segments
  trimEndDb: number;          // seuil (dB) sous lequel la fin d'un segment généré (souffle, respiration) est coupée ; 0 = désactivé
  segmentGap: number;         // pause par défaut entre deux segments, en secondes (0 à 10)
  audioSilenceBefore: number; // silence au début du fichier final, en secondes (0 à 10)
  audioSilenceAfter: number;  // silence à la fin du fichier final, en secondes (0 à 10)
  // Vidéo (MP4 = image fixe + MP3 assemblé)
  videoWidth: number;
  videoHeight: number;
  videoBitrate: number;      // débit vidéo en kb/s
  videoAudioBitrate: number; // débit audio du MP4 en kb/s
  videoFps: number;
  // Balisage IA (Claude)
  tagDynamism: 'sobre' | 'modere' | 'expressif';
  tagMaxTags: number;      // nombre max de balises par segment
  tagInstructions: string; // consignes libres supplémentaires
  // Prononciation (dictionnaire ElevenLabs)
  pronunciationRules: PronunciationRule[];
  pronDictId: string;        // id du dictionnaire ElevenLabs (géré par syncPronunciation)
  pronDictVersionId: string; // version appliquée aux générations
  pronSyncedAt?: number;     // date de dernière synchronisation
}

export interface PronunciationRule {
  word: string;   // texte à remplacer (sensible à la casse)
  alias: string;  // graphie phonétique simple (ex. "Copèrle")
  ipa?: string;   // prononciation IPA exacte (prioritaire si renseignée, modèles v3/flash_v2)
}

export const DEFAULT_SETTINGS: Settings = {
  modelId: 'eleven_multilingual_v2',
  stability: 0.4,
  similarityBoost: 0.75,
  style: 0.3,
  voices: [
    { label: 'Voix femme principale', voiceId: '', voiceName: '' },
    { label: 'Voix femme secondaire', voiceId: '', voiceName: '' },
    { label: 'Voix homme principale', voiceId: '', voiceName: '' },
    { label: 'Voix homme secondaire', voiceId: '', voiceName: '' },
  ],
  trimEndDb: -35,
  segmentGap: 0.4,
  audioSilenceBefore: 0,
  audioSilenceAfter: 0,
  videoWidth: 1920,
  videoHeight: 1080,
  videoBitrate: 8000,
  videoAudioBitrate: 192,
  videoFps: 25,
  tagDynamism: 'modere',
  tagMaxTags: 3,
  tagInstructions: '',
  pronunciationRules: [],
  pronDictId: '',
  pronDictVersionId: '',
};

/** Petit identifiant local pour les segments (stable côté Storage). */
export function segmentId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function blankSegment(slot?: VoiceSlot): Segment {
  return {
    id: segmentId(),
    voiceId: slot?.voiceId ?? '',
    voiceName: slot?.label ?? '',
    textV3: '',
    textPlain: '',
    status: 'not_generated',
  };
}
