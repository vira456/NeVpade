// Сценарії через API в демо-режимі: ті самі правила має виконувати сервер (docs/api-contract.md)
import { describe, it, expect } from 'vitest';
import { login } from '../src/js/api/auth.js';
import { getTrips, createTrip, updateTrip } from '../src/js/api/trips.js';
import { getVehicles, createVehicle, deleteVehicle } from '../src/js/api/vehicles.js';
import { getClients, deleteClient } from '../src/js/api/clients.js';
import { signIn } from './setup.js';

const MANAGER = { id: 'usr_01', name: 'Федорова Віра Дмитрівна', email: 'v.fedorova@nevpade.ua', role: 'manager', companyId: 'cmp_01', phoneVerified: true };

describe('вхід', () => {
  it('менеджер входить з паролем і кодом компанії', async () => {
    const user = await login('v.fedorova@nevpade.ua', 'Manager2026', { role: 'manager', companyCode: 'NVP-4821' });
    expect(user).toMatchObject({ id: 'usr_01', role: 'manager' });
    expect(localStorage.getItem('token')).toBeTruthy();
  });

  it('невірний код компанії — 401 invalid_company_code', async () => {
    await expect(login('v.fedorova@nevpade.ua', 'Manager2026', { role: 'manager', companyCode: 'NVP-0000' })).rejects.toMatchObject({ status: 401, code: 'invalid_company_code' });
  });

  it('невірний пароль не підказує, чи існує акаунт', async () => {
    await expect(login('v.fedorova@nevpade.ua', 'wrong1234', { role: 'manager', companyCode: 'NVP-4821' })).rejects.toMatchObject({ code: 'invalid_credentials' });
  });

  it('5 невдалих спроб — пауза (429)', async () => {
    for (let i = 0; i < 5; i++) await login('v.fedorova@nevpade.ua', 'wrong1234', { companyCode: 'NVP-4821' }).catch(() => {});
    await expect(login('v.fedorova@nevpade.ua', 'Manager2026', { companyCode: 'NVP-4821' })).rejects.toMatchObject({ status: 429, code: 'too_many_attempts' });
  });

  it('власник входить без коду компанії', async () => {
    const user = await login('a.kovalchuk@nevpade.ua', 'Manager2026', { role: 'owner' });
    expect(user.role).toBe('owner');
  });
});

describe('рейси', () => {
  it('новий рейс отримує наступний номер, статус «Заплановано» й термін оплати', async () => {
    signIn(MANAGER);
    const before = await getTrips();
    const last = Math.max(...before.map((t) => Number(t.number.replace(/\D/g, ''))));
    const trip = await createTrip({ from: { city: 'Київ' }, to: { city: 'Львів' }, loadDate: '2026-12-01', unloadDate: '2026-12-02', price: 20000, distanceKm: 540 });

    expect(trip.number).toBe(`TR-${String(last + 1).padStart(4, '0')}`);
    expect(trip.status).toBe('planned');
    expect(trip.managerId).toBe('usr_01');
    expect(trip.payment.dueDate).toBe('2026-12-16'); // розвантаження + 14 днів
    expect(await getTrips()).toHaveLength(before.length + 1);
  });

  it('чужий рейс менеджер змінити не може (403)', async () => {
    signIn(MANAGER);
    const foreign = (await getTrips()).find((t) => t.managerId !== 'usr_01');
    await expect(updateTrip(foreign.id, { price: 1 })).rejects.toMatchObject({ status: 403 });
  });

  it('зміни ціни записуються в історію рейсу', async () => {
    signIn(MANAGER);
    const mine = (await getTrips()).find((t) => t.managerId === 'usr_01');
    const updated = await updateTrip(mine.id, { price: (mine.price || 0) + 1000 });
    expect(updated.history.at(-1)).toMatchObject({ action: 'updated', changes: [{ field: 'price' }] });
  });
});

describe('автопарк і клієнти', () => {
  it('номер машини унікальний без урахування пробілів і регістру', async () => {
    signIn(MANAGER);
    const [first] = await getVehicles();
    const plate = first.plate.toLowerCase().replace(/\s/g, '');
    await expect(createVehicle({ plate, model: 'Test' })).rejects.toMatchObject({ status: 409, code: 'plate_taken' });
  });

  it('машину в активному рейсі видалити не можна', async () => {
    signIn(MANAGER);
    const active = (await getTrips()).find((t) => t.status === 'in_progress' && t.vehicleId);
    await expect(deleteVehicle(active.vehicleId)).rejects.toMatchObject({ status: 409, code: 'vehicle_busy' });
  });

  it('клієнта з рейсами видалити не можна', async () => {
    signIn(MANAGER);
    const trips = await getTrips();
    const client = (await getClients()).find((c) => trips.some((t) => t.clientId === c.id));
    await expect(deleteClient(client.id)).rejects.toMatchObject({ status: 409, code: 'client_has_trips' });
  });
});
