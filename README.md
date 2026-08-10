# 🔊 Smash Studio

Application interne pour produire les **versions audio multi-voix** (type magazine
« Le Gouessant Infos ») : chaque **son** est une suite de **segments**, chaque segment
est lu par une **voix ElevenLabs** différente (voix femme principale, voix homme
secondaire…), puis le tout est **assemblé en un seul fichier MP3**.

Projet frère de FarmLab Studio (même socle, même charte), **sans la partie vidéo HeyGen**.

**Socle technique**
- **Angular 22** (standalone + signals) + **Tailwind CSS v4**
- **Firebase** : Authentication, Firestore (base), Storage (audios)
- **Cloud Functions** (Node 22) : proxy sécurisé vers ElevenLabs et Claude — **les clés API ne quittent jamais le serveur** ; assemblage MP3 via ffmpeg

---

## Architecture (pourquoi un backend ?)

L'app Angular n'appelle **jamais** ElevenLabs directement : une clé API dans le
navigateur serait volable par n'importe qui. À la place, l'app appelle des
**Cloud Functions** qui détiennent les clés sous forme de **secrets Firebase**.

```
Angular (navigateur)  ──httpsCallable──►  Cloud Functions  ──►  ElevenLabs / Claude
        │                                       │ (ffmpeg : assemblage MP3)
        └───────── Firestore / Storage ◄────────┘
```

**Fonctions déployées**
| Fonction | Rôle |
|---|---|
| `listVoices` | liste les voix du compte ElevenLabs (palette des réglages) |
| `generateSegment` | TTS ElevenLabs d'un segment → `audio/sounds/{soundId}/{segmentId}.mp3` |
| `assembleSound` | concatène tous les segments (+ pauses) en un seul `final.mp3` |
| `resetSound` | supprime les audios stockés et remet les statuts à zéro |
| `syncPronunciation` | pousse les règles de prononciation dans un dictionnaire ElevenLabs |
| `tagText` | balisage audio ElevenLabs v3 d'un texte via Claude |
| `getUsage` | consommation ElevenLabs + coût Claude du mois |

**Modèle de données (Firestore)**
- `sounds/{id}` : `{ title, order, segments: [{ id, voiceId, voiceName, textV3, textPlain, silenceAfter, status, audioUrl… }], assemblyStatus, finalUrl… }`
- `settings/global` : modèle ElevenLabs, palette de voix (rôles), pauses/silences, balisage IA, prononciation
- `users/{uid}` : rôles (admin / editor / user) + approbation

---

## Prérequis

- Node.js 20+
- `npm i -g firebase-tools` puis `firebase login`
- Un **nouveau** projet Firebase (distinct de farmlab-studio) avec le **plan Blaze**
  (obligatoire pour que les Functions appellent des API externes)

## 1. Installer

```bash
npm install
cd functions && npm install && cd ..
```

## 2. Configurer Firebase

1. Console Firebase → crée un projet (ex. `smash-studio`) → active
   **Authentication** (Email/Password + Google), **Firestore**, **Storage**.
2. Récupère la config Web (Paramètres du projet → Tes applications → Config SDK)
   et colle-la dans `src/environments/environment.ts`.
3. Relie le dossier au projet : `firebase use --add` (ou ajuste `.firebaserc`).
4. Accorde `roles/iam.serviceAccountTokenCreator` au compte de service des
   Functions (nécessaire aux URL signées — comme sur FarmLab).

## 3. Enregistrer les clés API (secrets)

```bash
firebase functions:secrets:set ELEVENLABS_API_KEY   # colle ta clé ElevenLabs
firebase functions:secrets:set ANTHROPIC_API_KEY    # colle ta clé Anthropic (balisage IA)
```

(En local avec l'émulateur : fichier `functions/.env` — voir `.env.example`.)

## 4. Déployer

```bash
npm run deploy          # tout : hosting + functions + rules
npm run deploy:functions
npm run deploy:rules
```

## 5. Développer en local

```bash
npm start               # http://localhost:5210 (les functions appelées sont celles déployées)
```

---

## Utilisation

1. **Réglages** → définis la **palette de voix** (rôles → voix ElevenLabs du compte),
   le modèle, les pauses par défaut, et synchronise les **prononciations** si besoin.
2. **Sons → + Nouveau son** → ajoute des **segments** (un bouton par rôle de la palette),
   colle les textes, ajuste les pauses.
3. **🎙 Tout générer** → chaque segment est généré par sa voix.
4. **🔗 Assembler le MP3** → un seul fichier `final.mp3`, à écouter ou télécharger
   depuis la liste des sons.

Notes :
- Modifier le texte ou la voix d'un segment déjà généré le repasse en « non généré ».
- Régénérer un segment après assemblage marque le son « à réassembler ».
- Premier compte : `immersion.tools@gmail.com` = admin bootstrap (voir
  `firestore.rules` et `users.service.ts`) ; les autres comptes doivent être approuvés
  dans **Comptes**.
