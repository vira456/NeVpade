// Кабінет власника → Менеджери: показники кожного, звільнення, код компанії
import { renderLayout } from '../../utils/layout.js';
import { getTeamStats } from '../../api/analytics.js';
import { getCompany, getMembers, removeMember, regenerateInvite, getJoinRequests, approveJoinRequest, rejectJoinRequest } from '../../api/company.js';
import { money, escapeHtml, plural } from '../../utils/format.js';
import { avatar } from '../../utils/people.js';
import { icons } from '../../utils/icons.js';
import { copyText } from '../../utils/viber.js';
import { showToast } from '../../utils/toast.js';
import { confirmDialog } from '../../utils/confirm.js';
import { setFieldError, clearErrors, showAlert, withLoading } from '../../utils/validation.js';
import { locale, t } from '../../i18n/index.js';
import { setOwnerBadge } from '../../utils/layout.js';
import { $, bindPeriod } from './common.js';

const PERIODS = {
  month: { trips: 'Рейсів за місяць', income: 'Дохід за місяць' },
  year: { trips: 'Рейсів за рік', income: 'Дохід за рік' },
};
let period = 'month';
let managers = [];
let requests = [];
let stats = null;

const tripsWord = (n) => t(plural(n, ['{n} рейс', '{n} рейси', '{n} рейсів']), { n });

function render() {
  const byId = new Map((stats?.managers ?? []).map((x) => [String(x.managerId), x]));
  const maxIncome = Math.max(1, ...managers.map((m) => byId.get(m.id)?.income ?? 0));
  const rows = [...managers].sort((a, b) => (byId.get(b.id)?.income ?? 0) - (byId.get(a.id)?.income ?? 0));
  const online = managers.filter((m) => m.online).length;
  $('teamSummary').textContent = t(plural(managers.length, ['{n} менеджер · {m} зараз у мережі', '{n} менеджери · {m} зараз у мережі', '{n} менеджерів · {m} зараз у мережі']), { n: managers.length, m: online });
  $('thTrips').textContent = t(PERIODS[period].trips);
  $('thIncome').textContent = t(PERIODS[period].income);

  $('teamBody').innerHTML = rows.length
    ? rows
        .map((m) => {
          const s = byId.get(m.id) ?? {};
          const share = Math.round(((s.income ?? 0) / maxIncome) * 100);
          return `<tr>
          <td>
            <a class="owner-person" href="/pages/member.html?id=${encodeURIComponent(m.id)}">
              ${avatar(m, { size: 36 })}
              <span><span class="owner-person__name" data-no-i18n>${escapeHtml(m.name)}</span>
              <span class="sub">${escapeHtml(m.position ?? '')}</span></span>
            </a>
          </td>
          <td class="num">${s.activeTrips ?? 0}</td>
          <td class="num">${s.tripsCount ?? 0}</td>
          <td>
            <div class="owner-income"><span class="owner-income__value">${money(s.income ?? 0)}</span>
              <span class="owner-income__bar" aria-hidden="true"><span style="width:${share}%"></span></span></div>
          </td>
          <td class="num">${s.paidOnTime == null ? '—' : `${s.paidOnTime} %`}</td>
          <td class="num">${s.overdueCount ? `<span class="owner-debt">${money(s.overdueAmount)}</span><span class="sub">${tripsWord(s.overdueCount)}</span>` : '—'}</td>
          <td class="owner-table__actions">
            <button class="icon-btn" type="button" data-remove="${escapeHtml(m.id)}" title="${escapeHtml(t('Прибрати з компанії'))}" aria-label="${escapeHtml(t('Прибрати з компанії: {name}', { name: m.name }))}">${icons.trash}</button>
          </td>
        </tr>`;
        })
        .join('')
    : `<tr><td colspan="7"><div class="empty"><p class="empty__title">${t('Менеджерів ще немає')}</p><p>${t('Дайте їм код компанії — він вище.')}</p></div></td></tr>`;
}

// ---------- Заявки на вступ ----------
const when = (iso) => new Date(iso).toLocaleString(locale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
function renderRequests() {
  $('joinRequests').hidden = !requests.length;
  $('joinCount').textContent = requests.length || '';
  setOwnerBadge(requests.length);
  $('joinList').innerHTML = requests
    .map(
      (r) => `
      <li class="join-request">
        ${avatar({ name: r.name }, { size: 40, dot: false })}
        <div class="join-request__who">
          <strong data-no-i18n>${escapeHtml(r.name)}</strong>
          <span class="sub" data-no-i18n>${[r.email, r.phone].filter(Boolean).map(escapeHtml).join(' · ')}</span>
          <span class="sub">${t('заявка від {date}', { date: when(r.createdAt) })}</span>
        </div>
        <div class="join-request__actions">
          <button class="btn btn--sm" type="button" data-approve="${escapeHtml(r.id)}">${t('Прийняти')}</button>
          <button class="btn btn--sm btn--ghost" type="button" data-reject="${escapeHtml(r.id)}">${t('Відхилити')}</button>
        </div>
      </li>`
    )
    .join('');
}

const fetchStats = () =>
  getTeamStats(period).catch((err) => {
    showToast(t('Не вдалося порахувати показники: {msg}', { msg: err.message }), 'error');
    return { managers: [] };
  });

async function init() {
  $('copyInvite').innerHTML = icons.copy;
  const soft = (p, fallback) => p.catch(() => fallback);
  let company;
  let members;
  [company, members, stats, requests] = await Promise.all([soft(getCompany(), null), soft(getMembers(), []), fetchStats(), soft(getJoinRequests(), [])]);
  managers = members.filter((m) => m.role !== 'owner');
  $('inviteCode').textContent = company?.inviteCode ?? '—';
  renderRequests();
  render();
}

function bindEvents() {
  $('joinList').addEventListener('click', async (e) => {
    const yes = e.target.closest('[data-approve]');
    const no = e.target.closest('[data-reject]');
    if (!yes && !no) return;
    const req = requests.find((r) => r.id === (yes ?? no).dataset[yes ? 'approve' : 'reject']);
    if (no) {
      const ok = await confirmDialog({
        title: t('Відхилити заявку {name}?', { name: req.name }),
        text: 'Людина не отримає доступу до компанії. Вона побачить відмову й зможе надіслати заявку з іншим кодом.',
        confirmText: 'Відхилити',
      });
      if (!ok) return;
    }
    const btn = yes ?? no;
    btn.disabled = true;
    try {
      if (yes) {
        const member = await approveJoinRequest(req.id);
        managers.push({ ...member, id: String(member.id ?? member._id ?? req.userId) });
        showToast(t('{name} тепер у команді', { name: req.name }));
      } else {
        await rejectJoinRequest(req.id);
        showToast(t('Заявку {name} відхилено', { name: req.name }));
      }
      requests = requests.filter((r) => r.id !== req.id);
      renderRequests();
      render();
    } catch (err) {
      btn.disabled = false;
      showToast(err.message, 'error');
    }
  });

  bindPeriod('teamPeriod', async (p) => {
    period = p;
    stats = await fetchStats();
    render();
  });

  // Прибрати менеджера: його активні рейси одразу переходять колезі, якого обирає власник
  const dialog = $('removeDialog');
  const form = $('removeForm');
  let removing = null;
  $('teamBody').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-remove]');
    if (!btn) return;
    removing = managers.find((x) => x.id === btn.dataset.remove);
    const active = stats?.managers?.find((x) => String(x.managerId) === removing.id)?.activeTrips ?? 0;
    const others = managers.filter((x) => x.id !== removing.id);
    clearErrors(form);
    $('removeTitle').textContent = t('Прибрати {name} з компанії?', { name: removing.name });
    $('removeText').textContent = active
      ? t('Доступ закриється одразу. Активні рейси ({n}) перейдуть до колеги, якого ви оберете; виконані залишаться в історії компанії.', { n: active })
      : t('Доступ закриється одразу. Виконані рейси залишаться в історії компанії.');
    $('removeTransferField').hidden = !active;
    $('removeTransferTo').innerHTML = others.length
      ? `<option value="">${t('Оберіть менеджера')}</option>` + others.map((m) => `<option value="${escapeHtml(m.id)}">${escapeHtml(m.name)}</option>`).join('')
      : `<option value="">${t('Інших менеджерів немає')}</option>`;
    form.dataset.active = String(active);
    dialog.showModal();
  });
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog || e.target.closest('[data-cancel]')) dialog.close();
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors(form);
    const active = Number(form.dataset.active);
    const transferTo = $('removeTransferTo').value;
    if (active && !transferTo) return setFieldError($('removeTransferTo'), 'Оберіть, кому передати рейси');
    try {
      const res = await withLoading($('removeSubmit'), () => removeMember(removing.id, { transferTo: transferTo || null }));
      dialog.close();
      managers = managers.filter((x) => x.id !== removing.id);
      const to = managers.find((x) => x.id === transferTo);
      showToast(
        res?.transferred && to
          ? t('{name} більше не в компанії. {to} отримав(ла) рейсів: {n}', { name: removing.name, to: to.name, n: res.transferred })
          : t('{name} більше не в компанії', { name: removing.name })
      );
      stats = await fetchStats();
      render();
    } catch (err) {
      showAlert(form, err.message);
    }
  });

  $('copyInvite').addEventListener('click', async () => {
    try {
      await copyText($('inviteCode').textContent);
      showToast('Код компанії скопійовано');
    } catch {
      showToast('Не вдалося скопіювати', 'error');
    }
  });

  $('regenInvite').addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: 'Створити новий код?',
      text: 'Старий код одразу перестане діяти — і для реєстрації, і для входу. Менеджерам, які вже в компанії, потрібно буде повідомити новий код.',
      confirmText: 'Створити код',
    });
    if (!ok) return;
    try {
      const { inviteCode } = await regenerateInvite();
      $('inviteCode').textContent = inviteCode;
      showToast('Новий код створено');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}

if (renderLayout({ access: 'owner' })) {
  bindEvents();
  init();
}
