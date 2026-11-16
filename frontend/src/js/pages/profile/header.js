// Шапка профілю: аватар (завантаження з прев'ю), ПІБ, посада, статус «В мережі»
import { updateAvatar } from '../../api/profile.js';
import { initials, renderSidebarUser } from '../../utils/layout.js';
import { showToast } from '../../utils/toast.js';

const MAX_FILE_MB = 5;
const AVATAR_SIZE = 256; // px — фото зменшується, щоб не займати багато місця
const TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

const els = {
  avatar: document.getElementById('avatar'),
  avatarImg: document.getElementById('avatarImg'),
  avatarInitials: document.getElementById('avatarInitials'),
  fileInput: document.getElementById('avatarInput'),
  removeBtn: document.getElementById('avatarRemove'),
  name: document.getElementById('profileName'),
  position: document.getElementById('profilePosition'),
  status: document.getElementById('profileStatus'),
};

function showAvatar(url, name) {
  els.avatarImg.hidden = !url;
  els.avatarInitials.hidden = Boolean(url);
  if (url) els.avatarImg.src = url;
  els.avatarInitials.textContent = initials(name);
  els.removeBtn.hidden = !url;
}

export function renderHeader(profile) {
  els.name.textContent = profile.fullName;
  els.position.textContent = profile.position;
  showAvatar(profile.avatarUrl, profile.fullName);
}

// Читає файл і повертає квадратне JPEG-зображення 256×256 (обрізка по центру)
function resizeImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Не вдалося прочитати файл'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Файл пошкоджений або не є зображенням'));
      img.onload = () => {
        const side = Math.min(img.width, img.height);
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = AVATAR_SIZE;
        canvas
          .getContext('2d')
          .drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function validateFile(file) {
  if (!TYPES.includes(file.type)) return 'Оберіть зображення у форматі JPG, PNG, WEBP або GIF';
  if (file.size > MAX_FILE_MB * 1024 * 1024) return `Файл завеликий: максимум ${MAX_FILE_MB} МБ`;
  return '';
}

async function handleFile(file, getProfile) {
  if (!file) return;
  const error = validateFile(file);
  if (error) return showToast(error, 'error');

  const previous = getProfile();
  try {
    const dataUrl = await resizeImage(file);
    showAvatar(dataUrl, previous.fullName); // миттєве прев'ю
    els.avatar.classList.add('is-loading');
    const profile = await updateAvatar(dataUrl);
    renderSidebarUser();
    showToast('Фото профілю оновлено');
    return profile;
  } catch (err) {
    showAvatar(previous.avatarUrl, previous.fullName); // повертаємо як було
    showToast(err.message, 'error');
  } finally {
    els.avatar.classList.remove('is-loading');
    els.fileInput.value = '';
  }
}

/**
 * @param {() => object} getProfile поточний профіль
 * @param {(profile) => void} onUpdate викликається після збереження фото
 */
export function initAvatar(getProfile, onUpdate) {
  const apply = async (file) => {
    const profile = await handleFile(file, getProfile);
    if (profile) onUpdate(profile);
  };

  els.fileInput.addEventListener('change', () => apply(els.fileInput.files[0]));

  // Перетягування файлу на аватар
  ['dragenter', 'dragover'].forEach((ev) =>
    els.avatar.addEventListener(ev, (e) => {
      e.preventDefault();
      els.avatar.classList.add('is-dragover');
    })
  );
  ['dragleave', 'drop'].forEach((ev) => els.avatar.addEventListener(ev, () => els.avatar.classList.remove('is-dragover')));
  els.avatar.addEventListener('drop', (e) => {
    e.preventDefault();
    apply(e.dataTransfer.files[0]);
  });

  els.removeBtn.addEventListener('click', async () => {
    try {
      const profile = await updateAvatar(null);
      showAvatar(null, profile.fullName);
      renderSidebarUser();
      onUpdate(profile);
      showToast('Фото видалено', 'info');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}

// Статус «В мережі» реагує на реальне підключення до інтернету
export function initOnlineStatus() {
  const update = () => {
    const online = navigator.onLine;
    els.status.classList.toggle('is-offline', !online);
    els.status.querySelector('.status__text').textContent = online ? 'В мережі' : 'Не в мережі';
  };
  window.addEventListener('online', update);
  window.addEventListener('offline', update);
  update();
}
