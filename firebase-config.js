/**
 * firebase-config.js
 * Firebase initialization.
 * !! REPLACE the placeholder values below with your own Firebase project credentials !!
 * Get them from: https://console.firebase.google.com â†’ Project Settings â†’ Your apps
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

// Enable Offline Persistence
firebase.firestore().enablePersistence().catch((err) => {
    if (err.code == 'failed-precondition') {
        console.warn('Persistence failed: Multiple tabs open');
    } else if (err.code == 'unimplemented') {
        console.warn('Persistence is not supported by this browser');
    }
});

// Firestore instance â€” shared across all modules
const db = firebase.firestore();

