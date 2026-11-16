// Визначення браузера та ОС за navigator.userAgent (для блоку «Активна сесія»)
export function detectBrowser(ua = navigator.userAgent) {
  const rules = [
    [/Edg\/([\d.]+)/, 'Microsoft Edge'],
    [/OPR\/([\d.]+)/, 'Opera'],
    [/Firefox\/([\d.]+)/, 'Firefox'],
    [/Chrome\/([\d.]+)/, 'Google Chrome'],
    [/Version\/([\d.]+).*Safari/, 'Safari'],
  ];
  for (const [re, name] of rules) {
    const m = ua.match(re);
    if (m) return `${name} ${m[1].split('.')[0]}`;
  }
  return 'Невідомий браузер';
}

export function detectOS(ua = navigator.userAgent) {
  if (/Windows NT 10/.test(ua)) return 'Windows 10/11';
  if (/Windows/.test(ua)) return 'Windows';
  if (/Android ([\d.]+)/.test(ua)) return `Android ${ua.match(/Android ([\d.]+)/)[1]}`;
  if (/iPhone|iPad/.test(ua)) return 'iOS';
  if (/Mac OS X/.test(ua)) return 'macOS';
  if (/Linux/.test(ua)) return 'Linux';
  return 'Невідома ОС';
}

export const deviceType = (ua = navigator.userAgent) => (/Mobi|Android|iPhone/.test(ua) ? 'Мобільний' : 'Комп’ютер');

// «2 год 15 хв»
export function formatDuration(ms) {
  const min = Math.max(0, Math.floor(ms / 60000));
  const h = Math.floor(min / 60);
  const d = Math.floor(h / 24);
  if (d) return `${d} д ${h % 24} год`;
  if (h) return `${h} год ${min % 60} хв`;
  return `${min} хв`;
}
