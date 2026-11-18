"""Модульні тести бізнес-логіки (без бази даних). Запуск з папки backend: python -m pytest"""
import json
from datetime import date
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.schemas.auth import RegisterIn
from app.schemas.entities import ClientIn, DriverIn, TaskIn, TripIn, TripOut, VehicleIn, VehicleOut
from app.services.analytics import Analytics, buckets, period_range, previous_range
from app.services.calc import calculate, expense_breakdown
from app.services.documents import sniff_mime
from app.services.trips import changes_history, default_due_date
from app.utils import drop_nulls, normalize_name, normalize_phone

SEED = json.loads((Path(__file__).parent.parent / "app" / "seed_data.json").read_text(encoding="utf-8"))
VEHICLE = {"fuelConsumption": 32}
DRIVER = {"ratePerKm": 10}
TRIP = {"distanceKm": 240, "price": 24000, "loadDate": "2026-11-15", "status": "planned"}


# ---------- Розрахунок рейсу (формула як у frontend/src/js/utils/economics.js) ----------
def test_calculate_matches_formula():
    c = calculate(TRIP, VEHICLE, DRIVER, fuel_price=56)
    assert c["fuelLiters"] == 76.8
    assert c["fuelCost"] == 4301
    assert c["driverSalary"] == 2400
    assert c["otherCosts"] == 528 + 264 + 350  # ремонт 2,2 грн/км + дороги 1,1 грн/км + 350 грн на рейс
    assert c["totalCost"] == 4301 + 2400 + 1142
    assert c["profit"] == 24000 - c["totalCost"]


def test_calculate_without_vehicle_and_driver_uses_defaults():
    c = calculate(TRIP, None, None, fuel_price=50)
    assert c["fuelLiters"] == 76.8 and c["driverSalary"] == 2400


def test_expense_breakdown_sums_to_total():
    parts = expense_breakdown(TRIP, VEHICLE, DRIVER, 56)
    total = sum(parts[k] for k in ("fuel", "salary", "repair", "tolls", "other"))
    assert total == calculate(TRIP, VEHICLE, DRIVER, 56)["totalCost"]


# ---------- Періоди аналітики ----------
def test_week_range_starts_on_monday():
    start, end = period_range("week", date(2026, 11, 11))  # середа
    assert start == date(2026, 11, 9) and end == date(2026, 11, 15)


def test_previous_is_same_segment():
    """1–20 січня порівнюємо з 1–20 грудня, а не з цілим груднем."""
    assert previous_range("month", date(2026, 1, 20)) == (date(2025, 12, 1), date(2025, 12, 20))
    assert previous_range("month", date(2026, 3, 31)) == (date(2026, 2, 1), date(2026, 2, 28))
    assert previous_range("year", date(2026, 5, 1)) == (date(2025, 1, 1), date(2025, 5, 1))
    assert previous_range("week", date(2026, 11, 11)) == (date(2026, 11, 2), date(2026, 11, 4))


def test_month_buckets_by_seven_days():
    parts = buckets("month", date(2026, 11, 11))
    assert [b.label for b in parts] == ["1–7 лист.", "8–14 лист.", "15–21 лист.", "22–28 лист.", "29–30 лист."]
    assert parts[-1].end == date(2026, 11, 30)


def test_year_chart_has_twelve_months_future_is_null():
    a = Analytics([{**TRIP, "status": "done", "loadDate": "2026-03-10"}], {}, {}, 56, date(2026, 11, 11))
    chart = a.income("year")
    assert chart["labels"][0] == "Січ" and len(chart["labels"]) == 12
    assert chart["income"][2] == 24000 and chart["income"][0] == 0 and chart["income"][11] is None


def test_analytics_on_seed_data():
    vehicles = {v["id"]: v for v in SEED["vehicles"]}
    drivers = {d["id"]: d for d in SEED["drivers"]}
    a = Analytics(SEED["trips"], vehicles, drivers, 56, date(2026, 11, 11))
    s = a.summary("month")
    counted = [t for t in SEED["trips"] if t["loadDate"].startswith("2026-11") and t["status"] in ("done", "in_progress")]
    assert s["tripsCount"] == len(counted)
    assert s["profit"] == s["income"] - s["expenses"]
    chart = a.income("month")
    assert sum(x or 0 for x in chart["income"]) == s["income"]
    assert sum(a.expenses("month").values()) == s["expenses"]
    top = a.drivers_stats("month")
    assert top == sorted(top, key=lambda r: r["income"], reverse=True)


@pytest.mark.parametrize("status", ["cancelled", "planned"])
def test_cancelled_and_planned_trips_are_ignored(status):
    a = Analytics([{**TRIP, "status": status}], {}, {}, 56, date(2026, 11, 11))
    assert a.summary("month")["tripsCount"] == 0


# ---------- Рейси: оплата та історія ----------
def test_default_due_date_uses_client_payment_days():
    trip = {"loadDate": "2026-11-15", "unloadDate": "2026-11-16"}
    assert default_due_date(trip, {"paymentDays": 30}) == "2026-12-16"
    assert default_due_date({"loadDate": "2026-11-15"}, None) == "2026-11-29"  # 14 днів за замовчуванням
    assert default_due_date(trip, {"paymentDays": 0}) == "2026-11-16"


def test_changes_history():
    old = {"status": "planned", "price": 20000, "from": {"city": "Київ"}, "to": {"city": "Львів"}, "payment": {"paidAt": None}}
    new = {**old, "status": "in_progress", "price": 22000, "to": {"city": "Одеса"}, "payment": {"paidAt": "2026-11-20"}}
    actions = {h["action"]: h for h in changes_history("u1", old, new)}
    assert actions["status"]["to"] == "in_progress"
    fields = {c["field"] for c in actions["updated"]["changes"]}
    assert fields == {"price", "route"}
    assert "paid" in actions
    assert changes_history("u1", old, dict(old)) == []


def test_trip_payment_not_before_load_date():
    base = {"from": {"city": "Київ"}, "to": {"city": "Львів"}, "loadDate": "2026-11-15",
            "cargo": {"type": "Меблі", "weightT": 5}, "distanceKm": 540, "price": 20000}
    with pytest.raises(ValidationError):
        TripIn.model_validate({**base, "payment": {"dueDate": "2026-11-01"}})
    assert TripIn.model_validate({**base, "payment": {"dueDate": "2026-11-30"}}).payment.due_date == "2026-11-30"


# ---------- Клієнти ----------
@pytest.mark.parametrize("raw,ok", [("38214567", "38214567"), ("3821 4567", "38214567"), ("1234567890", "1234567890"), ("", None)])
def test_client_edrpou(raw, ok):
    assert ClientIn.model_validate({"name": "ТОВ Тест", "edrpou": raw}).edrpou == ok


def test_client_edrpou_invalid():
    with pytest.raises(ValidationError):
        ClientIn.model_validate({"name": "ТОВ Тест", "edrpou": "12345"})


# ---------- Валідація ----------
@pytest.mark.parametrize("raw", ["+380671234567", "380671234567", "0671234567", "067 123-45-67", "80671234567"])
def test_normalize_phone(raw):
    assert normalize_phone(raw) == "+380671234567"


def test_normalize_phone_rejects_foreign():
    with pytest.raises(ValueError):
        normalize_phone("+48123456789")


def test_password_policy():
    base = {"name": "Віра Федорова", "email": "V@Example.com", "phone": "0671234567"}
    with pytest.raises(ValidationError):
        RegisterIn.model_validate({**base, "password": "short1"})
    with pytest.raises(ValidationError):
        RegisterIn.model_validate({**base, "password": "onlyletters"})
    ok = RegisterIn.model_validate({**base, "password": "secret123"})
    assert ok.email == "v@example.com" and ok.phone == "+380671234567"


def test_register_join_requires_code():
    base = {"name": "Віра Федорова", "email": "v@e.ua", "phone": "0671234567", "password": "secret123"}
    with pytest.raises(ValidationError):
        RegisterIn.model_validate({**base, "company": {"mode": "join"}})
    r = RegisterIn.model_validate({**base, "company": {"mode": "join", "code": "nvp-4821"}})
    assert r.company.code == "NVP-4821"


def test_frontend_mocks_match_schemas():
    """Мокові дані фронтенду відповідають моделям бекенду — тобто контракт дотримано."""
    for v in SEED["vehicles"]:
        VehicleIn.model_validate(v)
    for d in SEED["drivers"]:
        DriverIn.model_validate(d)
    for t in SEED["trips"]:
        dumped = TripOut.model_validate(t).model_dump(by_alias=True)
        assert dumped["from"]["city"] == t["from"]["city"] and dumped["loadDate"] == t["loadDate"]
    for t in SEED["tasks"]:
        TaskIn.model_validate(t)
    for c in SEED["clients"]:
        ClientIn.model_validate(c)


def test_trip_requires_valid_date():
    t = {**SEED["trips"][0], "loadDate": "15.11.2026"}
    with pytest.raises(ValidationError):
        TripIn.model_validate(t)


def test_drop_nulls_keeps_only_nullable_fields():
    data = {"loadDate": None, "status": None, "vehicleId": None, "price": 0}
    assert drop_nulls(data, frozenset({"vehicleId"})) == {"vehicleId": None, "price": 0}


def test_phone_must_be_mobile_operator():
    with pytest.raises(ValueError):
        normalize_phone("+380441234567")  # київський стаціонарний


@pytest.mark.parametrize("raw,ok", [("Олена Коваль", True), ("олена  коваль-петренко ", True), ("Д'Артаньян Ґудзь", True),
                                    ("Олена", False), ("Олена Коваль2", False), ("О Коваль", False)])
def test_register_name_two_words(raw, ok):
    if ok:
        assert normalize_name(raw, min_words=2, max_words=2, max_len=60).count(" ") == 1
    else:
        with pytest.raises(ValueError):
            normalize_name(raw, min_words=2, max_words=2, max_len=60)


def test_trip_requires_price_weight_distance():
    base = {"from": {"city": "Київ"}, "to": {"city": "Львів"}, "loadDate": "2026-11-15",
            "cargo": {"type": "Меблі", "weightT": 5}, "distanceKm": 540, "price": 20000}
    TripIn.model_validate(base)
    for broken in ({"price": 0}, {"distanceKm": 0}, {"cargo": {"type": "", "weightT": 5}}, {"cargo": {"type": "Меблі", "weightT": 0}}):
        with pytest.raises(ValidationError):
            TripIn.model_validate({**base, **broken})
    # Della: адреса може прийти null, а клієнт — без імені
    TripIn.model_validate({**base, "from": {"city": "Київ", "address": None}, "client": {"name": None, "phone": ""},
                           "notes": "Тент, оплата б/г", "source": "import",
                           "importedFrom": {"platform": "della", "url": None}})


def test_driver_categories_and_empty_viber():
    d = DriverIn.model_validate({"name": "Петро Іваненко", "phone": "0501112233", "viber": "", "licenseCategories": ["ce", "C"]})
    assert d.viber is None and d.license_categories == ["CE", "C"]
    with pytest.raises(ValidationError):
        DriverIn.model_validate({"name": "Петро Іваненко", "phone": "0501112233", "licenseCategories": ["Z"]})


def test_vehicle_out_accepts_new_statuses():
    v = VehicleOut.model_validate({"id": "1", "plate": "ВХ 1234 АК", "model": "DAF", "status": "unloaded"})
    assert v.model_dump(by_alias=True)["statusUpdatedAt"] is None


def test_sniff_mime_by_content():
    assert sniff_mime(b"\xff\xd8\xff\xe0rest") == "image/jpeg"
    assert sniff_mime(b"%PDF-1.7") == "application/pdf"
    assert sniff_mime(b"RIFF\x00\x00\x00\x00WEBPVP8 ") == "image/webp"
    assert sniff_mime(b"<html>") is None
