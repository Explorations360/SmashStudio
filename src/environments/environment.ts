// ⚠️ Remplace ces valeurs par la config du projet Firebase "smash-studio"
// (Console Firebase → Paramètres du projet → Tes applications → Config SDK).
// Le projet Firebase est distinct de celui de FarmLab Studio : il doit être créé
// (voir README, section Installation).
export const environment = {
  production: false,
  firebase: {
   apiKey: "AIzaSyBvgMuToAvkHquVR755L6hkEcSKZIWFUTk",
  authDomain: "smash-studio-b9bc8.firebaseapp.com",
  projectId: "smash-studio-b9bc8",
  storageBucket: "smash-studio-b9bc8.firebasestorage.app",
  messagingSenderId: "855550837389",
  appId: "1:855550837389:web:ff173bedbc2152ef6cd8c4"
  },
  // Région des Cloud Functions (doit correspondre à celle déployée)
  functionsRegion: 'europe-west1',
};
