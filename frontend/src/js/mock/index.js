// Демо-режим (VITE_USE_MOCK=true): «сервер», що живе в браузері.
// api/client.js вантажить цей модуль лише в режимі моків і передає його у функцію mock кожного запиту:
//   request('/trips', { mock: (m) => m.trips.list() })
// Дані — у localStorage (mock/store.js) та IndexedDB (файли документів), початкові — JSON у цій папці.
export * as store from './store.js';
export * as auth from './auth.js';
export * as company from './company.js';
export * as profile from './profile.js';
export * as trips from './trips.js';
export * as vehicles from './vehicles.js';
export * as drivers from './drivers.js';
export * as clients from './clients.js';
export * as tasks from './tasks.js';
export * as chat from './chat.js';
export * as documents from './documents.js';
