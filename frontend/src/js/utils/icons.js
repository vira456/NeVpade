// Прості лінійні іконки (24×24, колір — currentColor)
const svg = (body) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const icons = {
  analytics: svg('<path d="M4 20V11M10 20V5M16 20v-6M21 20H3"/>'),
  trips: svg('<circle cx="6" cy="18" r="2.2"/><circle cx="18" cy="6" r="2.2"/><path d="M8 18h6.5a3.5 3.5 0 0 0 0-7h-5a3.5 3.5 0 0 1 0-7H16"/>'),
  map: svg('<path d="M3 6.5 9 4l6 2.5L21 4v13.5L15 20l-6-2.5L3 20z"/><path d="M9 4v13.5M15 6.5V20"/>'),
  fleet: svg('<path d="M2 6h12v10H2zM14 9.5h4l3 3.5v3h-7z"/><circle cx="6" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/>'),
  tasks: svg('<rect x="3" y="4" width="5" height="16" rx="1"/><rect x="10" y="4" width="5" height="11" rx="1"/><rect x="17" y="4" width="4" height="7" rx="1"/>'),
  profile: svg('<circle cx="12" cy="8" r="4"/><path d="M4 21c.6-4 3.8-6 8-6s7.4 2 8 6"/>'),
  logout: svg('<path d="M14 4h5v16h-5M10 8l-4 4 4 4M6 12h10"/>'),
  pin: svg('<path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>'),
  send: svg('<path d="M21 3 10 14M21 3l-7 18-4-7-7-4z"/>'),
  copy: svg('<rect x="8" y="8" width="12" height="12" rx="1.5"/><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8"/>'),
  phone: svg('<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1z"/>'),
  close: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
  arrowUp: svg('<path d="M12 19V5M6 11l6-6 6 6"/>'),
  arrowDown: svg('<path d="M12 5v14M6 13l6 6 6-6"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
  print: svg('<path d="M7 9V4h10v5M7 17H5a1 1 0 0 1-1-1v-5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v5a1 1 0 0 1-1 1h-2"/><path d="M7 14h10v6H7z"/>'),
  bell: svg('<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20a2 2 0 0 0 4 0"/>'),
  users: svg('<circle cx="9" cy="8" r="3.5"/><path d="M3 19c.7-3.4 3-5 6-5s5.3 1.6 6 5"/><path d="M15.5 4.6a3.5 3.5 0 0 1 0 6.8M17.5 14.3c1.8.7 3 2.2 3.5 4.7"/>'),
  calendar: svg('<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>'),
  building: svg('<path d="M5 20V5a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v15M15 9h3a1 1 0 0 1 1 1v10M3 20h18"/><path d="M8 8h3M8 12h3M8 16h3"/>'),
  doc: svg('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>'),
  download: svg('<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>'),
  edit: svg('<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>'),
  trash: svg('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'),
  wrench: svg('<path d="M14.5 6.5a4 4 0 0 0 5 5L12 19a2.1 2.1 0 0 1-3-3l7.5-7.5z"/><path d="M14.5 6.5 17 4l3 3-2.5 2.5"/>'),
  sun: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
  moon: svg('<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/>'),
  monitor: svg('<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>'),
  menu: svg('<path d="M4 7h16M4 12h16M4 17h16"/>'),
  chevronLeft: svg('<path d="M15 6l-6 6 6 6"/>'),
  team: svg('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.5-3.5 3-5.5 6.5-5.5s6 2 6.5 5.5"/><circle cx="17" cy="9" r="2.5"/><path d="M16.5 14.6c2.6.2 4.4 2 4.9 4.9"/>'),
  chat: svg('<path d="M4 5h16v11H9l-5 4z"/><path d="M8 9h8M8 12.5h5"/>'),
  transfer: svg('<path d="M4 8h13l-3-3M20 16H7l3 3"/>'),
  shield: svg('<path d="M12 3 5 6v5c0 4.5 3 8.3 7 10 4-1.7 7-5.5 7-10V6z"/>'),
};

// Логотип: маршрут від А до Б на сигнальному бурштині
export const logoMark = `<svg class="logo-mark" width="28" height="28" viewBox="0 0 28 28" aria-hidden="true">
  <rect width="28" height="28" rx="8" style="fill:var(--accent)"/>
  <circle cx="8.5" cy="19.5" r="3" style="fill:var(--on-accent)"/>
  <circle cx="19.5" cy="8.5" r="2.6" fill="none" style="stroke:var(--on-accent)" stroke-width="2"/>
  <path d="M11 17l5.6-5.6" style="stroke:var(--on-accent)" stroke-width="2" stroke-dasharray="2.4 2.2" stroke-linecap="round"/>
</svg>`;
