// Фура (вигляд збоку) для анімацій завантаження. Колір — currentColor.
// Колеса й дим мають класи, які анімує _motion.scss.
const wheel = (cx) => `
  <g class="truck__wheel" style="transform-origin:${cx}px 52px">
    <circle cx="${cx}" cy="52" r="7" class="truck__tyre"/>
    <circle cx="${cx}" cy="52" r="2.6" class="truck__hub"/>
    <path d="M${cx} 46.5v3M${cx} 54.5v3M${cx - 5.5} 52h3M${cx + 2.5} 52h3" class="truck__spokes"/>
  </g>`;

export const truckSvg = `
<svg class="truck" viewBox="0 0 132 64" aria-hidden="true">
  <g class="truck__smoke">
    <circle cx="74" cy="6" r="3"/><circle cx="68" cy="3" r="2.2"/><circle cx="63" cy="1" r="1.6"/>
  </g>
  <g class="truck__body">
    <!-- причіп -->
    <rect x="4" y="12" width="80" height="34" rx="4" class="truck__trailer"/>
    <path d="M12 22h64M12 30h64M12 38h64" class="truck__stripes"/>
    <!-- кабіна -->
    <path d="M88 22h20l12 12v12a2 2 0 0 1-2 2H88z" class="truck__cab"/>
    <path d="M93 26h13l8 8H93z" class="truck__window"/>
    <rect x="80" y="8" width="3" height="12" rx="1.5" class="truck__pipe"/>
    <rect x="118" y="40" width="5" height="4" rx="1" class="truck__light"/>
    <rect x="2" y="44" width="122" height="4" rx="2" class="truck__chassis"/>
  </g>
  ${wheel(20)}${wheel(36)}${wheel(98)}${wheel(112)}
</svg>`;

// Мініатюра для кнопок
export const miniTruck = `
<svg class="mini-truck" viewBox="0 0 24 16" aria-hidden="true">
  <g class="mini-truck__body">
    <rect x="1" y="2" width="13" height="9" rx="1.5"/>
    <path d="M15 5h4l3 3v3h-7z"/>
  </g>
  <circle class="mini-truck__wheel" cx="5" cy="12.5" r="2"/>
  <circle class="mini-truck__wheel" cx="18" cy="12.5" r="2"/>
</svg>`;

// Фура на дорозі з підписом
export const truckLoader = (label = 'Завантаження…') => `
  <div class="truck-loader" role="status" aria-live="polite">
    <div class="truck-loader__scene">
      ${truckSvg}
      <div class="truck-loader__road" aria-hidden="true"></div>
    </div>
    <p class="truck-loader__label">${label}</p>
  </div>`;
