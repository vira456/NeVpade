"""Моделі бізнес-сутностей: автопарк, водії, рейси, завдання, документи.

Для кожної сутності: *In — створення (POST, сувора валідація), *Update — оновлення (PUT/PATCH, усі поля
необов'язкові), *Out — відповідь сервера (м'яка: старі записи в базі не повинні «ламати» видачу).
"""
from typing import Annotated, Literal

from pydantic import AfterValidator, BeforeValidator, Field, field_validator, model_validator

from .common import CamelModel, IsoDate, OptionalPhone, Phone, _date

RequiredDate = Annotated[str, AfterValidator(_date)]
Money = Annotated[float, Field(ge=0, le=100_000_000)]
# null → "" для текстових полів, які фронт може надіслати порожніми (напр. адреса з Della)
Text = lambda max_len: Annotated[str, BeforeValidator(lambda v: "" if v is None else v), Field(max_length=max_len)]  # noqa: E731

VehicleStatus = Literal["available", "loading", "on_trip", "unloaded", "broken", "repair"]
DriverStatus = Literal["available", "on_trip", "day_off"]
TripStatus = Literal["planned", "in_progress", "done", "cancelled"]
TripSource = Literal["manual", "import"]
TaskStatus = Literal["todo", "in_progress", "done"]
TaskPriority = Literal["low", "medium", "high"]

LICENSE_CATEGORIES = ("B", "C1", "C", "CE", "D")
VEHICLE_DOC_TYPES = ("registration", "insurance", "inspection", "license", "lease", "other")
DRIVER_DOC_TYPES = ("license", "passport", "tax_id", "medical", "tachograph", "other")


def _categories(value: list[str] | None) -> list[str] | None:
    if value is None:
        return None
    result = []
    for item in value:
        cat = str(item).strip().upper()
        if cat not in LICENSE_CATEGORIES:
            raise ValueError(f"Категорія «{item}» недопустима. Можливі: {', '.join(LICENSE_CATEGORIES)}")
        if cat not in result:
            result.append(cat)
    return result


Categories = Annotated[list[str], AfterValidator(_categories), Field(max_length=len(LICENSE_CATEGORIES))]


# ---------- Автопарк ----------
class VehicleIn(CamelModel):
    plate: str = Field(min_length=2, max_length=20)
    model: str = Field(min_length=1, max_length=80)
    type: Text(60) = ""
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


class VehicleStatusIn(CamelModel):
    status: VehicleStatus


class VehicleOut(CamelModel):
    id: str
    plate: str
    model: str
    type: str | None = ""
    capacity_t: float = 0
    fuel_consumption: float = 0
    mileage_km: int = 0
    next_service_km: int | None = None
    insurance_until: str | None = None
    status: str = "available"
    status_updated_at: str | None = None


# ---------- Водії ----------
class DriverIn(CamelModel):
    name: str = Field(min_length=2, max_length=100)
    phone: Phone
    viber: OptionalPhone = None
    license_categories: Categories = Field(default_factory=list)
    vehicle_id: str | None = None
    rate_per_km: float = Field(default=10, ge=0, le=1000)
    status: DriverStatus = "available"


class DriverUpdate(CamelModel):
    name: str | None = Field(default=None, min_length=2, max_length=100)
    phone: Phone | None = None
    viber: OptionalPhone = None
    license_categories: Categories | None = None
    vehicle_id: str | None = None
    rate_per_km: float | None = Field(default=None, ge=0, le=1000)
    status: DriverStatus | None = None


class AssignVehicleIn(CamelModel):
    vehicle_id: str | None = None


class DriverOut(CamelModel):
    id: str
    name: str
    phone: str
    viber: str | None = None
    license_categories: list[str] = Field(default_factory=list)
    vehicle_id: str | None = None
    rate_per_km: float = 10
    status: str = "available"


# ---------- Рейси ----------
class Place(CamelModel):
    city: str = Field(min_length=1, max_length=80)
    address: Text(200) = ""
    lat: float | None = Field(default=None, ge=-90, le=90)
    lng: float | None = Field(default=None, ge=-180, le=180)


class Cargo(CamelModel):
    type: Text(100) = ""
    weight_t: float = Field(default=0, ge=0, le=100)
    volume_m3: float | None = Field(default=None, ge=0, le=500)


class Client(CamelModel):
    name: str | None = Field(default="", max_length=150)
    phone: str | None = Field(default=None, max_length=30)


class ImportedFrom(CamelModel):
    platform: str = Field(max_length=30)
    url: str | None = Field(default=None, max_length=500)


class TripBase(CamelModel):
    """Спільні поля рейсу без бізнес-обмежень (їх перевіряє TripIn)."""

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
    notes: Text(2000) = ""
    imported_from: ImportedFrom | None = None


class TripIn(TripBase):
    """Новий рейс: обов'язкові вантаж, вага, відстань і ціна (контракт, розділ 2)."""

    @model_validator(mode="after")
    def _required(self):
        if not self.cargo.type.strip():
            raise ValueError("Вкажіть, що веземо (тип вантажу)")
        if self.cargo.weight_t <= 0:
            raise ValueError("Вкажіть вагу вантажу в тоннах")
        if self.distance_km <= 0:
            raise ValueError("Вкажіть відстань у кілометрах")
        if self.price <= 0:
            raise ValueError("Вкажіть вартість рейсу в гривнях")
        if self.unload_date and self.unload_date < self.load_date:
            raise ValueError("Дата розвантаження не може бути раніше дати завантаження")
        return self


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
    price: float | None = Field(default=None, gt=0, le=100_000_000)
    distance_km: float | None = Field(default=None, gt=0, le=20_000)
    status: TripStatus | None = None
    notes: str | None = Field(default=None, max_length=2000)

    @field_validator("cargo")
    @classmethod
    def _cargo(cls, value: Cargo | None):
        if value is not None and (not value.type.strip() or value.weight_t <= 0):
            raise ValueError("Вкажіть тип і вагу вантажу")
        return value


class TripOut(TripBase):
    id: str
    number: str
    load_date: str
    status: str = "planned"
    source: str = "manual"
    price: float = 0
    distance_km: float = 0
    notes: str | None = ""
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
    title: str = Field(min_length=3, max_length=120)
    description: Text(1000) = ""
    status: TaskStatus = "todo"
    priority: TaskPriority = "medium"
    due_date: IsoDate = None
    trip_id: str | None = None
    order: int | None = Field(default=None, ge=0)


class TaskUpdate(CamelModel):
    title: str | None = Field(default=None, min_length=3, max_length=120)
    description: str | None = Field(default=None, max_length=1000)
    status: TaskStatus | None = None
    priority: TaskPriority | None = None
    due_date: IsoDate = None
    trip_id: str | None = None
    order: int | None = Field(default=None, ge=0)


class TaskOut(CamelModel):
    id: str
    title: str
    description: str | None = ""
    status: str = "todo"
    priority: str = "medium"
    due_date: str | None = None
    trip_id: str | None = None
    order: int = 0
    created_at: str | None = None


class ReorderItem(CamelModel):
    id: str
    status: TaskStatus
    order: int = Field(ge=0)


class ReorderIn(CamelModel):
    items: list[ReorderItem] = Field(max_length=1000)


# ---------- Документи машин і водіїв ----------
class DocumentOut(CamelModel):
    id: str
    type: str
    valid_until: str | None = None
    name: str
    mime: str
    size: int
    created_at: str | None = None
    url: str


class DocumentsSummaryItem(CamelModel):
    count: int = 0
    expiring: int = 0
    expired: int = 0
