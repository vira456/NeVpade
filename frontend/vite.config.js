import { defineConfig } from 'vite';
import { resolve } from 'path';

// Кілька HTML-сторінок (multi-page app)
export default defineConfig({
  css: {
    preprocessorOptions: {
      scss: { api: 'modern-compiler' }, // прибирає попередження legacy-js-api
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        login: resolve(__dirname, 'pages/login.html'),
        register: resolve(__dirname, 'pages/register.html'),
        verifyEmail: resolve(__dirname, 'pages/verify-email.html'),
        verifyPhone: resolve(__dirname, 'pages/verify-phone.html'),
        forgotPassword: resolve(__dirname, 'pages/forgot-password.html'),
        trips: resolve(__dirname, 'pages/trips.html'),
        map: resolve(__dirname, 'pages/map.html'),
        fleet: resolve(__dirname, 'pages/fleet.html'),
        kanban: resolve(__dirname, 'pages/kanban.html'),
      },
    },
  },
});
