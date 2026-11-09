// Вкладка «Сповіщення та Viber»: шаблон повідомлення водію + перемикачі
import { updateSettings } from '../../api/profile.js';
import { getTrips } from '../../api/trips.js';
import { getDrivers } from '../../api/drivers.js';
import { getVehicles } from '../../api/vehicles.js';
import { showToast } from '../../utils/toast.js';
import { withLoading } from '../../utils/validation.js';
import {
  PLACEHOLDERS,
  DEFAULT_VIBER_TEMPLATE,
  tripVariables,
  fillTemplate,
  unknownPlaceholders,
  sendToViber,
} from '../../utils/viber.js';

const MAX_LENGTH = 1000;

const form = document.getElementById('viberForm');
const textarea = document.getElementById('viberTemplate');
const preview = document.getElementById('viberPreview');
const counter = document.getElementById('viberCounter');
const warning = document.getElementById('viberWarning');
const saveBtn = document.getElementById('viberSave');
const pushToggle = document.getElementById('pushToggle');
const soundToggle = document.getElementById('soundToggle');

let sampleVars = {};
let savedTemplate = '';

// ---------- Шаблон Viber ----------
function renderChips() {
  const list = document.getElementById('viberChips');
  list.innerHTML = PLACEHOLDERS.map(
    (p) => `<button class="chip" type="button" data-key="${p.key}" title="${p.label}">{${p.key}}<span>${p.label}</span></button>`
  ).join('');

  // Вставка змінної в позицію курсора
  list.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    const token = `{${chip.dataset.key}}`;
    const { selectionStart: start, selectionEnd: end, value } = textarea;
    textarea.value = value.slice(0, start) + token + value.slice(end);
    textarea.focus();
    textarea.setSelectionRange(start + token.length, start + token.length);
    updatePreview();
  });
}

function updatePreview() {
  const value = textarea.value;
  preview.textContent = value.trim() ? fillTemplate(value, sampleVars) : 'Шаблон порожній';

  counter.textContent = `${value.length} / ${MAX_LENGTH}`;
  counter.classList.toggle('is-over', value.length > MAX_LENGTH);

  const unknown = unknownPlaceholders(value);
  warning.hidden = !unknown.length;
  warning.textContent = unknown.length ? `Невідомі змінні: ${unknown.map((k) => `{${k}}`).join(', ')}` : '';

  saveBtn.disabled = value === savedTemplate;
}

function templateError(value) {
  if (!value.trim()) return 'Шаблон не може бути порожнім';
  if (value.length > MAX_LENGTH) return `Шаблон задовгий: максимум ${MAX_LENGTH} символів`;
  if (unknownPlaceholders(value).length) return 'Виправте невідомі змінні у шаблоні';
  if (!/\{ID\}/.test(value)) return 'Додайте в шаблон номер рейсу {ID}';
  return '';
}

async function loadSampleTrip() {
  // Прев'ю будується на першому рейсі з даних (моки або сервер)
  const [trips, drivers, vehicles] = await Promise.all([getTrips(), getDrivers(), getVehicles()]);
  const trip = trips[0];
  if (!trip) return;
  sampleVars = tripVariables(
    trip,
    drivers.find((d) => d.id === trip.driverId),
    vehicles.find((v) => v.id === trip.vehicleId)
  );
  document.getElementById('viberSampleLabel').textContent = `на прикладі рейсу ${trip.number}`;
}

// ---------- Перемикачі ----------
const beep = () => {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.25);
  } catch {
    /* браузер без Web Audio */
  }
};

async function askPushPermission() {
  if (!('Notification' in window)) {
    showToast('Цей браузер не підтримує push-сповіщення', 'error');
    return false;
  }
  if (Notification.permission === 'granted') return true;
  const result = await Notification.requestPermission();
  if (result !== 'granted') {
    showToast('Дозвіл на сповіщення не надано. Його можна увімкнути в налаштуваннях браузера', 'error', 5000);
    return false;
  }
  new Notification('NeVpade', { body: 'Push-сповіщення увімкнено' });
  return true;
}

function initToggle(input, key, { beforeEnable, afterEnable, labels }) {
  input.addEventListener('change', async () => {
    const enabled = input.checked;
    input.disabled = true;
    try {
      if (enabled && beforeEnable && !(await beforeEnable())) {
        input.checked = false;
        return;
      }
      await updateSettings({ [key]: enabled });
      if (enabled) afterEnable?.();
      showToast(enabled ? labels.on : labels.off, enabled ? 'success' : 'info');
    } catch (err) {
      input.checked = !enabled; // повертаємо як було
      showToast(err.message, 'error');
    } finally {
      input.disabled = false;
    }
  });
}

/**
 * @param {{ viberTemplate: string|null, pushEnabled: boolean, soundEnabled: boolean }} settings
 */
export async function initNotifications(settings) {
  savedTemplate = settings.viberTemplate || DEFAULT_VIBER_TEMPLATE;
  textarea.value = savedTemplate;
  textarea.maxLength = MAX_LENGTH + 200; // м'яке обмеження: лічильник підсвічує перевищення
  pushToggle.checked = settings.pushEnabled;
  soundToggle.checked = settings.soundEnabled;

  renderChips();
  updatePreview();
  loadSampleTrip().then(updatePreview).catch(() => {});

  textarea.addEventListener('input', updatePreview);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const error = templateError(textarea.value);
    if (error) return showToast(error, 'error');
    try {
      await withLoading(saveBtn, () => updateSettings({ viberTemplate: textarea.value }));
      savedTemplate = textarea.value;
      showToast('Шаблон Viber збережено');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      updatePreview();
    }
  });

  document.getElementById('viberDefault').addEventListener('click', () => {
    textarea.value = DEFAULT_VIBER_TEMPLATE;
    updatePreview();
    showToast('Підставлено стандартний шаблон. Натисніть «Зберегти шаблон»', 'info');
  });

  document.getElementById('viberTest').addEventListener('click', () => {
    const error = templateError(textarea.value);
    if (error) return showToast(error, 'error');
    sendToViber(fillTemplate(textarea.value, sampleVars));
  });

  initToggle(pushToggle, 'pushEnabled', {
    beforeEnable: askPushPermission,
    labels: { on: 'Push-сповіщення увімкнено', off: 'Push-сповіщення вимкнено' },
  });
  initToggle(soundToggle, 'soundEnabled', {
    afterEnable: beep,
    labels: { on: 'Звук сповіщень увімкнено', off: 'Звук сповіщень вимкнено' },
  });
}
