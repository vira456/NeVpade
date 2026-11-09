import { defineConfig } from 'vite';
import { resolve } from 'path';

// Кілька HTML-сторінок (multi-page app)
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        login: resolve(__dirname, 'pages/login.html'),
        trips: resolve(__dirname, 'pages/trips.html'),
        map: resolve(__dirname, 'pages/map.html'),
        fleet: resolve(__dirname, 'pages/fleet.html'),
        kanban: resolve(__dirname, 'pages/kanban.html'),
      },
    },
  },
});
