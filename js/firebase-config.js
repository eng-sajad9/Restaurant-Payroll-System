/**
 * firebase-config.js
 * Firebase initialization with offline-first optimizations.
 */

const firebaseConfig = {
    apiKey: "AIzaSyCWUUrBMGpQ6KPirJFJ6okCp348YAbE5K8",
    authDomain: "maing-rust.firebaseapp.com",
    databaseURL: "https://maing-rust-default-rtdb.firebaseio.com",
    projectId: "maing-rust",
    storageBucket: "maing-rust.firebasestorage.app",
    messagingSenderId: "11823919696",
    appId: "1:11823919696:web:cdc0cb9dfe3928c3be5755",
    measurementId: "G-QS2TNT6V78"
};

// Initialize the Firebase app
firebase.initializeApp(firebaseConfig);

// ── Firestore settings MUST be set BEFORE any other Firestore calls ──
// CACHE_SIZE_UNLIMITED → Firestore will never evict cached data from IndexedDB
firebase.firestore().settings({
    cacheSizeBytes: firebase.firestore.CACHE_SIZE_UNLIMITED
});

// Enable Offline Persistence (stores data in IndexedDB so app works offline)
// synchronizeTabs: true allows all open tabs to share the same offline cache
firebase.firestore().enablePersistence({ synchronizeTabs: true }).catch((err) => {
    if (err.code === 'failed-precondition') {
        console.warn('[Firebase] Persistence: multiple tabs open, only the first tab has persistence.');
    } else if (err.code === 'unimplemented') {
        console.warn('[Firebase] Persistence not supported by this browser.');
    }
});

// Firestore instance — shared across all modules
const db = firebase.firestore();
