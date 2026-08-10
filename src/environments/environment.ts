// ⚠️ Remplace ces valeurs par la config du projet Firebase "smash-studio"
// (Console Firebase → Paramètres du projet → Tes applications → Config SDK).
// Le projet Firebase est distinct de celui de FarmLab Studio : il doit être créé
// (voir README, section Installation).
export const environment = {
  production: false,
  firebase: {
    apiKey: "REMPLACE_MOI",
    authDomain: "smash-studio.firebaseapp.com",
    projectId: "smash-studio",
    storageBucket: "smash-studio.firebasestorage.app",
    messagingSenderId: "REMPLACE_MOI",
    appId: "REMPLACE_MOI"
  },
  // Région des Cloud Functions (doit correspondre à celle déployée)
  functionsRegion: 'europe-west1',
};
