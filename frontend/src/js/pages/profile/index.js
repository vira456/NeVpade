// Сторінка «Профіль менеджера» — точка входу
import { renderLayout, renderSidebarUser } from '../../utils/layout.js';
import { isMockMode } from '../../api/client.js';
import { getProfile, getSettings, MOCK_PASSWORD } from '../../api/profile.js';
import { showToast } from '../../utils/toast.js';
import { initTabs } from './tabs.js';
import { renderHeader, initAvatar, initOnlineStatus } from './header.js';
import { initPersonal, renderKpi, setSavedProfile } from './personal.js';
import { initNotifications } from './notifications.js';
import { initSecurity } from './security.js';

renderLayout();

let profile = null;

async function init() {
  initTabs(document.getElementById('profileTabs'));
  initOnlineStatus();
  initSecurity();

  if (isMockMode) {
    document.querySelectorAll('[data-mock-only]').forEach((el) => (el.hidden = false));
    document.getElementById('mockPassword').textContent = MOCK_PASSWORD;
  }

  // статистика вантажиться паралельно з профілем
  renderKpi().catch(() => showToast('Не вдалося завантажити статистику', 'error'));
  try {
    const [p, settings] = await Promise.all([getProfile(), getSettings()]);
    profile = p;
    renderSidebarUser(); // ім'я та фото в меню — з профілю

    renderHeader(profile);
    initAvatar(
      () => profile,
      (updated) => {
        profile = updated;
        setSavedProfile(updated);
      }
    );
    initPersonal(profile, (updated) => {
      profile = updated;
      renderHeader(updated);
    });
    await initNotifications(settings);
  } catch (err) {
    showToast(`Не вдалося завантажити профіль: ${err.message}`, 'error', 0);
  } finally {
    document.querySelector('.profile').classList.remove('is-loading');
  }
}

init();
