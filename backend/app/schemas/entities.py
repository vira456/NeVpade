"""Моделі бізнес-сутностей: автопарк, водії, рейси, завдання.

Для кожної сутності: *In — створення (POST), *Update — оновлення (PUT/PATCH, усі поля необов'язкові),
*Out — відповідь сервера.
"""
from typing import Annotated, Literal

from pydantic import AfterValidator, Field

from .common import CamelModel, IsoDate, Phone, _date

RequiredDate = Annotated[str, AfterValidator(_date)]
Money = Annotated[float, Field(ge=0, le=100_000_000)]

VehicleStatus = Literal["available", "on_trip", "repair"]
DriverStatus = Literal["available", "on_trip", "day_off"]
TripStatus = Literal["planned", "in_progress", "done", "cancelled"]
TripSource = Literal["manual", "import"]
TaskStatus = Literal["todo", "in_progress", "done"]
TaskPriority = Literal["low", "medium", "high"]


# ---------- Автопарк ----------
class VehicleIn(CamelModel):
    plate: str = Field(min_length=2, max_length=20)
    model: str = Field(min_length=1, max_length=80)
    type: str = Field(default="", max_length=60)
    capacity_t: float = Field(ge=0, le=100)
    fuel_consumption: float = Field(gt=0, le=200, description="л/100 км")
    mileage_km: int = Field(default=0, ge=0)
    next_service_km: int | None = Field(default=None, ge=0)
    insurance_until: IsoDate = None
    status: VehicleStatus = "available"


class VehicleUpdate(CamelModel):
    plate: str | None = Field(default=None, min_length=2, max_length=20)
    model: str | None = Field(default=None, min_length=1, max_length=80)
    type: str | None = Field(default=None, max_length=60)
    capacity_t: float | None = Field(default=None, ge=0, le=100)
    fuel_consumption: float | None = Field(default=None, gt=0, le=200)
    mileage_km: int | None = Field(default=None, ge=0)
    next_service_km: int | None = Field(default=None, ge=0)
    insurance_until: IsoDate = None
    status: VehicleStatus | None = None


class VehicleOut(VehicleIn):
    id: str


# ---------- Водії ----------
class DriverIn(CamelModel):
    name: str = Field(min_length=2, max_length=100)
    phone: Phone
    viber: str | None = Field(default=None, max_length=20)
    license_categories: list[str] = Field(default_factory=list, max_length=15)
    vehicle_id: str | None = None
    rate_per_km: float = Field(default=10, ge=0, le=1000)
    status: DriverStatus = "available"


class DriverUpdate(CamelModel):
    name: str | None = Field(default=None, min_length=2, max_length=100)
    phone: Phone | None = None
    viber: str | None = Field(default=None, max_length=20)
    license_categories: list[str] | None = Field(default=None, max_length=15)
    vehicle_id: str | None = None
    rate_per_km: float | None = Field(default=None, ge=0, le=1000)
    status: DriverStatus | None = None


class DriverOut(DriverIn):
    id: str
    phone: str  # у відповіді — без повторної валідації


# ---------- Рейси ----------
class Place(CamelModel):
    city: str = Field(min_length=1, max_length=80)
    address: str = Field(default="", max_length=200)
    lat: float | None = Field(default=None, ge=-90, le=90)
    lng: float | None = Field(default=None, ge=-180, le=180)


class Cargo(CamelModel):
    type: str = Field(default="", max_length=100)
    weight_t: float = Field(default=0, ge=0, le=100)
    volume_m3: float | None = Field(default=None, ge=0, le=500)


class Client(CamelModel):
    name: str = Field(default="", max_length=150)
    phone: str | None = Field(default=None, max_length=20)


class TripIn(CamelModel):
    number: str | None = Field(default=None, max_length=30, description="Якщо не вказано — генерується (TR-0001)")
    from_: Place = Field(alias="from")
    to: Place
    load_date: RequiredDate
    unload_date: IsoDate = None
    cargo: Cargo = Field(default_factory=Cargo)
    vehicle_id: str | None = None
    driver_id: str | None = None
    client: Client = Field(default_factory=Client)
    price: Money = 0
    distance_km: float = Field(default=0, ge=0, le=20_000)
    status: TripStatus = "planned"
    source: TripSource = "manual"


class TripUpdate(CamelModel):
    number: str | None = Field(default=None, max_length=30)
    from_: Place | None = Field(default=None, alias="from")
    to: Place | None = None
    load_date: IsoDate = None
    unload_date: IsoDate = None
    cargo: Cargo | None = None
    vehicle_id: str | None = None
    driver_id: str | None = None
    client: Client | None = None
    price: Money | None = None
    distance_km: float | None = Field(default=None, ge=0, le=20_000)
    status: TripStatus | None = None


class TripOut(TripIn):
    id: str
    number: str
    manager_id: str | None = None
    created_at: str | None = None
    transferred_at: str | None = None


class TransferIn(CamelModel):
    to_manager_id: str
    comment: str = Field(default="", max_length=500)


class TripImportIn(CamelModel):
    trips: list[TripIn] = Field(default_factory=list, max_length=500)


class TripImportOut(CamelModel):
    imported: int
    trips: list[TripOut]


class CalculationOut(CamelModel):
    distance_km: float
    fuel_liters: float
    fuel_cost: int
    driver_salary: int
    other_costs: int
    total_cost: int
    profit: int


# ---------- Завдання (Kanban) ----------
class TaskIn(CamelModel):
    title: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=2000)
    status: TaskStatus = "todo"
    priority: TaskPriority = "medium"
    due_date: IsoDate = None
    trip_id: str | None = None
    order: int | None = Field(default=None, ge=0)


class TaskUpdate(CamelModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    status: TaskStatus | None = None
    priority: TaskPriority | None = None
    due_date: IsoDate = None
    trip_id: str | None = None
    order: int | None = Field(default=None, ge=0)


class TaskOut(TaskIn):
    id: str
    order: int = 0
    created_at: str | None = None


class ReorderItem(CamelModel):
    id: str
    status: TaskStatus
    order: int = Field(ge=0)


class ReorderIn(CamelModel):
    items: list[ReorderItem] = Field(max_length=1000)
