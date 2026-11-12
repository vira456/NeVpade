"""Модульні тести бізнес-логіки (без бази даних). Запуск з папки backend: python -m pytest"""
import json
from datetime import date
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.schemas.auth import RegisterIn
from app.schemas.entities import DriverIn, TaskIn, TripIn, TripOut, VehicleIn, VehicleOut
from app.services.analytics import Analytics, buckets, period_range, previous_range
from app.services.calc import calculate, expense_breakdown
from app.services.documents import sniff_mime
from app.utils import drop_nulls, normalize_name, normalize_phone

SEED = json.loads((Path(__file__).parent.parent / "app" / "seed_data.json").read_text(encoding="utf-8"))
VEHICLE = {"fuelConsumption": 32}
DRIVER = {"ratePerKm": 10}
TRIP = {"distanceKm": 240, "price": 24000, "loadDate": "2026-11-15", "status": "planned"}


# ---------- Розрахунок рейсу ----------
def test_calculate_matches_formula():
    c = calculate(TRIP, VEHICLE, DRIVER, fuel_price=56)
    assert c["fuelLiters"] == 76.8
    assert c["fuelCost"] == 4301
    assert c["driverSalary"] == 2400
    assert c["otherCosts"] == 840
    assert c["totalCost"] == 4301 + 2400 + 840
    assert c["profit"] == 24000 - c["totalCost"]


def test_calculate_without_vehicle_and_driver_uses_defaults():
    c = calculate(TRIP, None, None, fuel_price=50)
    assert c["fuelLiters"] == 76.8 and c["driverSalary"] == 2400


def test_expense_breakdown_sums_to_total():
    parts = expense_breakdown(TRIP, VEHICLE, DRIVER, 56)
    assert sum(parts.values()) == pytest.approx(calculate(TRIP, VEHICLE, DRIVER, 56)["totalCost"], abs=2)


# ---------- Періоди аналітики ----------
def test_week_range_starts_on_monday():
    start, end = period_range("week", date(2026, 11, 11))  # середа
    assert start == date(2026, 11, 9) and end == date(2026, 11, 15)


def test_previous_month_and_year():
    assert previous_range("month", date(2026, 1, 20)) == (date(2025, 12, 1), date(2025, 12, 31))
    assert previous_range("year", date(2026, 5, 1)) == (date(2025, 1, 1), date(2025, 12, 31))


def test_month_buckets_cover_whole_month():
    parts = buckets("month", date(2026, 11, 11))
    assert [b.label for b in parts] == ["1–7 лист.", "8–14 лист.", "15–21 лист.", "22–30 лист."]
    assert parts[-1].end == date(2026, 11, 30)


def test_year_buckets_until_current_month():
    labels = [b.label for b in buckets("year", date(2026, 11, 11))]
    assert labels[0] == "Січ" and labels[-1] == "Лис" and len(labels) == 11


def test_analytics_on_seed_data():
    vehicles = {v["id"]: v for v in SEED["vehicles"]}
    drivers = {d["id"]: d for d in SEED["drivers"]}
    a = Analytics(SEED["trips"], vehicles, drivers, 56, date(2026, 11, 11))
    s = a.summary("month")
    assert s["tripsCount"] == len([t for t in SEED["trips"] if t["loadDate"].startswith("2026-11")])
    assert s["profit"] == s["income"] - s["expenses"]
    chart = a.income("month")
    assert sum(chart["income"]) == s["income"]
    assert sum(a.expenses("month").values()) == pytest.approx(s["expenses"], abs=len(SEED["trips"]) * 2)
    top = a.drivers_stats("month")
    assert top == sorted(top, key=lambda r: r["income"], reverse=True)


def test_cancelled_trips_are_ignored():
    a = Analytics([{**TRIP, "status": "cancelled"}], {}, {}, 56, date(2026, 11, 11))
    assert a.summary("month")["tripsCount"] == 0


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
