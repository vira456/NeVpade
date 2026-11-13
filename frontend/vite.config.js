import { defineConfig } from 'vite';
import { resolve } from 'path';
import { readFileSync } from 'fs';

// Спільний <head> (шрифт, тема, мова) зберігається в одному файлі
// й підставляється в кожну сторінку замість <!-- nevpade:head -->
const nevpadeHead = () => ({
  name: 'nevpade-head',
  // order: 'pre' — вставляємо ДО обробки Vite, щоб він зібрав <link> на SCSS у готовий CSS
  transformIndexHtml: {
    order: 'pre',
    handler(html) {
      const head = readFileSync(resolve(__dirname, 'src/partials/head.html'), 'utf8');
      return html.replace(/[ \t]*<!-- nevpade:head -->\r?\n?/, () => head); // \r — якщо git зберіг файли з CRLF
    },
  },
});

const dellaProxy = {
  target: 'https://della.ua',
  changeOrigin: true,
  rewrite: (path) => path.replace(/^\/della/, ''),
  headers: { 'Accept-Language': 'uk-UA,uk;q=0.9', Referer: 'https://della.ua/' },
};

// Кілька HTML-сторінок (multi-page app)
export default defineConfig({
  plugins: [nevpadeHead()],
  // Сторінки біржі Della: браузер не може читати чужий сайт напряму (CORS),
  // тому під час розробки Vite сам запитує della.ua і віддає HTML фронту.
  // У робочій версії це робить бекенд: GET /api/import/della?path=… (див. docs/api-contract.md)
  server: { proxy: { '/della': dellaProxy } },
  preview: { proxy: { '/della': dellaProxy } },
  css: {
    preprocessorOptions: {
      scss: { api: 'modern-compiler' }, // прибирає попередження legacy-js-api
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'), // лендинг
        dashboard: resolve(__dirname, 'pages/dashboard.html'),
        login: resolve(__dirname, 'pages/login.html'),
        register: resolve(__dirname, 'pages/register.html'),
        verifyEmail: resolve(__dirname, 'pages/verify-email.html'),
        verifyPhone: resolve(__dirname, 'pages/verify-phone.html'),
        forgotPassword: resolve(__dirname, 'pages/forgot-password.html'),
        trips: resolve(__dirname, 'pages/trips.html'),
        map: resolve(__dirname, 'pages/map.html'),
        fleet: resolve(__dirname, 'pages/fleet.html'),
        kanban: resolve(__dirname, 'pages/kanban.html'),
        profile: resolve(__dirname, 'pages/profile.html'),
        team: resolve(__dirname, 'pages/team.html'),
        chat: resolve(__dirname, 'pages/chat.html'),
        clients: resolve(__dirname, 'pages/clients.html'),
        schedule: resolve(__dirname, 'pages/schedule.html'),
        notFound: resolve(__dirname, '404.html'),
      },
    },
  },
});
