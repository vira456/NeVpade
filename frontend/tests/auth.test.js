// Ролі, код компанії й маршрут після входу (куди вести користувача)
import { describe, it, expect } from 'vitest';
import { formatCompanyCode, isCompanyCode, roleOf, homeFor, nextPageFor, signupIncomplete, OWNER_HOME, MANAGER_HOME, PENDING_PAGE } from '../src/js/api/auth.js';

describe('код компанії', () => {
  it('сам ставить великі літери й дефіс', () => {
    expect(formatCompanyCode('nvp4821')).toBe('NVP-4821');
    expect(formatCompanyCode(' nvp-48 21 ')).toBe('NVP-4821');
    expect(formatCompanyCode('nv')).toBe('NV');
  });

  it('приймає лише формат NVP-1234', () => {
    expect(isCompanyCode('NVP-4821')).toBe(true);
    expect(isCompanyCode('NVP-482')).toBe(false);
    expect(isCompanyCode('nvp-4821')).toBe(false);
    expect(isCompanyCode('OWN-4821')).toBe(true); // будь-які три літери: формат, а не конкретна компанія
  });
});

describe('ролі', () => {
  it('без ролі користувач — менеджер', () => {
    expect(roleOf({ id: 'x' })).toBe('manager');
    expect(roleOf(null)).toBe('manager');
  });

  it('власник і менеджер мають різні головні сторінки', () => {
    expect(homeFor({ role: 'owner' })).toBe(OWNER_HOME);
    expect(homeFor({ role: 'manager' })).toBe(MANAGER_HOME);
  });
});

describe('nextPageFor — крок реєстрації або робочий простір', () => {
  const done = { email: 'v@n.ua', role: 'manager', companyId: 'cmp_01', phone: '+380671234567', phoneVerified: true, memberStatus: 'active' };

  it('без входу — на сторінку входу', () => {
    expect(nextPageFor(null)).toBe('/pages/login.html');
  });

  it('без компанії — «Завершіть реєстрацію»', () => {
    expect(nextPageFor({ ...done, companyId: null })).toBe('/pages/onboarding.html');
  });

  it('телефон не підтверджено — на SMS-код (з номером або без)', () => {
    expect(nextPageFor({ ...done, phoneVerified: false })).toBe('/pages/verify-phone.html?mode=social&email=v%40n.ua');
    expect(nextPageFor({ ...done, phone: null, phoneVerified: false })).toBe('/pages/verify-phone.html?mode=add&email=v%40n.ua');
  });

  it('заявка до власника ще чекає або відхилена — сторінка очікування', () => {
    expect(nextPageFor({ ...done, memberStatus: 'pending' })).toBe(PENDING_PAGE);
    expect(nextPageFor({ ...done, memberStatus: 'rejected' })).toBe(PENDING_PAGE);
  });

  it('усе підтверджено — робочий простір за роллю', () => {
    expect(nextPageFor(done)).toBe(MANAGER_HOME);
    expect(nextPageFor({ ...done, role: 'owner', memberStatus: undefined })).toBe(OWNER_HOME);
    expect(signupIncomplete(done)).toBe(false);
    expect(signupIncomplete({ ...done, memberStatus: 'pending' })).toBe(true);
  });
});
