"""Моделі бізнес-сутностей: автопарк, водії, рейси, завдання, документи.

Для кожної сутності: *In — створення (POST, сувора валідація), *Update — оновлення (PUT/PATCH, усі поля
необов'язкові), *Out — відповідь сервера (м'яка: старі записи в базі не повинні «ламати» видачу).
"""
from typing import Annotated, Literal

from pydantic import AfterValidator, BeforeValidator, Field, field_validator, model_validator

from .common import CamelModel, Email, IsoDate, OptionalPhone, Phone, _date

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
TRIP_DOC_TYPES = ("ttn", "cmr", "act", "invoice", "request", "loading_photo", "unloading_photo", "other")


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


class Payment(CamelModel):
    """Оплата рейсу: коли клієнт має заплатити і коли заплатив (null — ще ні)."""

    due_date: IsoDate = None
    paid_at: IsoDate = None


class PaymentIn(CamelModel):
    """PATCH /trips/{id}/payment — { paidAt: 'YYYY-MM-DD' } або { paidAt: null }."""

    paid_at: IsoDate = None


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
    client_id: str | None = None
    client: Client = Field(default_factory=Client)
    price: Money = 0
    payment: Payment = Field(default_factory=Payment)
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
        if self.payment.due_date and self.payment.due_date < self.load_date:
            raise ValueError("Термін оплати не може бути раніше дати завантаження")
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
    client_id: str | None = None
    client: Client | None = None
    price: float | None = Field(default=None, gt=0, le=100_000_000)
    payment: Payment | None = None
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
    history: list[dict] = Field(default_factory=list)


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


# ---------- Клієнти ----------
def _edrpou(value: str | None) -> str | None:
    if value is None or not str(value).strip():
        return None
    digits = "".join(ch for ch in str(value) if ch.isdigit())
    if len(digits) not in (8, 10):
        raise ValueError("ЄДРПОУ — 8 цифр (юрособа) або ІПН ФОП — 10 цифр")
    return digits


Edrpou = Annotated[str | None, BeforeValidator(_edrpou)]
OptionalEmail = Annotated[Email | None, BeforeValidator(lambda v: None if v is None or not str(v).strip() else v)]


class ClientIn(CamelModel):
    name: str = Field(min_length=2, max_length=150)
    edrpou: Edrpou = None
    contact_name: Text(100) = ""
    phone: str | None = Field(default=None, max_length=30)
    email: OptionalEmail = None
    city: Text(80) = ""
    payment_days: int = Field(default=14, ge=0, le=120, description="Відстрочка оплати, днів")
    notes: Text(1000) = ""


class ClientUpdate(CamelModel):
    name: str | None = Field(default=None, min_length=2, max_length=150)
    edrpou: Edrpou = None
    contact_name: str | None = Field(default=None, max_length=100)
    phone: str | None = Field(default=None, max_length=30)
    email: OptionalEmail = None
    city: str | None = Field(default=None, max_length=80)
    payment_days: int | None = Field(default=None, ge=0, le=120)
    notes: str | None = Field(default=None, max_length=1000)


class ClientOut(CamelModel):
    id: str
    name: str
    edrpou: str | None = None
    contact_name: str | None = ""
    phone: str | None = None
    email: str | None = None
    city: str | None = ""
    payment_days: int = 14
    notes: str | None = ""
    created_at: str | None = None


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


# ---------- Повідомлення замовнику у Viber ----------
class SharedDocumentOut(CamelModel):
    owner: Literal["driver", "vehicle"]
    type: str
    label: str  # «Посвідчення водія», «Техпаспорт» …
    name: str
    valid_until: str | None = None


class ClientMessageOut(CamelModel):
    """POST /trips/{id}/client-message: усе, щоб відкрити Viber з готовим повідомленням замовнику."""

    phone: str | None  # номер замовника +380…; null — у клієнта не вказано телефон
    text: str  # перше повідомлення: вантаж, водій, машина, посилання на документи
    share_url: str  # публічна сторінка з документами водія й машини (діє 7 днів)
    expires_at: str
    viber_url: str | None  # viber://chat?number=…&draft=… — чат із замовником з набраним текстом
    forward_url: str  # viber://forward?text=… — якщо номера немає: Viber запропонує обрати контакт
    documents: list[SharedDocumentOut]  # що побачить замовник
    warnings: list[str]  # що варто виправити перед надсиланням (немає номера, прострочені документи…)
