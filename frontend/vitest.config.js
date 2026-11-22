// Автотести (npm test). Окремо від vite.config.js, щоб збірка сторінок не впливала на тести.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom', // localStorage, window, document — як у браузері
    include: ['tests/**/*.test.js'],
    setupFiles: ['tests/setup.js'],
    // тести працюють у режимі моків і без штучної затримки мережі
    env: { VITE_USE_MOCK: 'true', VITE_MOCK_DELAY: '0' },
  },
});
