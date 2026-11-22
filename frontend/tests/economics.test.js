// Собівартість і прибуток рейсу — одна формула для рейсу, аналітики й профілю
import { describe, it, expect } from 'vitest';
import { tripCosts, FUEL_PRICE, OTHER_PER_TRIP } from '../src/js/utils/economics.js';

describe('tripCosts', () => {
  it('рахує витрати за статтями з даних машини й водія', () => {
    const trip = { distanceKm: 500, price: 40000 };
    const c = tripCosts(trip, { fuelConsumption: 30 }, { ratePerKm: 12 });

    expect(c.fuelLiters).toBe(150); // 500 км × 30 л / 100
    expect(c.fuel).toBe(150 * FUEL_PRICE);
    expect(c.salary).toBe(6000); // 500 км × 12 грн
    expect(c.repair).toBe(1100); // 500 × 2,2
    expect(c.tolls).toBe(550); // 500 × 1,1
    expect(c.other).toBe(OTHER_PER_TRIP);
    expect(c.total).toBe(c.fuel + c.salary + c.repair + c.tolls + c.other);
    expect(c.profit).toBe(40000 - c.total);
  });

  it('без машини й водія бере середні значення (32 л/100 км, 10 грн/км)', () => {
    const c = tripCosts({ distanceKm: 100, price: 0 });
    expect(c.fuelLiters).toBe(32);
    expect(c.salary).toBe(1000);
  });

  it('рейс без кілометрів не має витрат, а прибуток дорівнює ціні', () => {
    const c = tripCosts({ distanceKm: 0, price: 5000 });
    expect(c.total).toBe(0);
    expect(c.profit).toBe(5000);
  });

  it('збитковий рейс має від’ємний прибуток', () => {
    expect(tripCosts({ distanceKm: 1000, price: 1000 }).profit).toBeLessThan(0);
  });
});
