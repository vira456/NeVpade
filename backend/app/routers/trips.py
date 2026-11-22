"""Розділ 2 контракту: рейси /trips (+ оплата, розрахунок, передача колезі, імпорт)."""
from typing import Literal

from fastapi import APIRouter, Depends, Query, Response, status
from pymongo import ReturnDocument
from pymongo.asynchronous.database import AsyncDatabase

from ..deps import company_filter, current_user, db, manager_user
from ..errors import ApiError, invalid, not_found
from ..schemas.entities import (
    CalculationOut,
    PaymentIn,
    TransferIn,
    TripImportIn,
    TripImportOut,
    TripIn,
    TripOut,
    TripUpdate,
)
from ..services import trips as svc
from ..services.calc import calculate
from ..services.crud import ensure_ref, find_ref, get_company_doc
from ..services.documents import delete_owner_documents
from ..services.fuel import fuel_price_for
from ..utils import drop_nulls, now, public, regex_escape

router = APIRouter(prefix="/trips", tags=["Рейси"])

_NULLABLE = frozenset({"unloadDate", "vehicleId", "driverId", "clientId"})


def trip_out(doc: dict) -> dict:
    return public(doc, "createdBy", "updatedAt", "transferredFrom")


async def _get_trip(database: AsyncDatabase, user: dict, trip_id: str) -> dict:
    return await get_company_doc(database, user, "trips", trip_id, "Рейс")


def _check_can_edit(user: dict, trip: dict) -> None:
    """Змінювати, видаляти й передавати рейс може лише його відповідальний менеджер (власник — лише переглядає)."""
    if trip.get("managerId") != str(user["_id"]):
        raise ApiError(403, "Змінювати можна лише свої рейси", "not_owner")


async def _prepare(database: AsyncDatabase, user: dict, data: dict, old: dict | None = None) -> None:
    """Спільні перевірки POST і PUT: посилання на машину/водія/клієнта, стан машини, термін оплати."""
    if "vehicleId" in data:
        await ensure_ref(database, user, "vehicles", data["vehicleId"], "Автомобіль")
        if old is None or data["vehicleId"] != old.get("vehicleId"):
            await svc.check_vehicle_available(database, user, data["vehicleId"])
    if "driverId" in data:
        await ensure_ref(database, user, "drivers", data["driverId"], "Водія")
    client = await svc.apply_client(database, user, data) if "clientId" in data else None

    merged = {**(old or {}), **data}
    payment = {**(old or {}).get("payment", {}), **(data.get("payment") or {})}
    if not payment.get("dueDate"):
        if client is None and merged.get("clientId"):
            client = await find_ref(database, user, "clients", merged["clientId"], {"paymentDays": 1})
        payment["dueDate"] = svc.default_due_date(merged, client)
    if payment["dueDate"] < merged["loadDate"]:
        raise invalid("Термін оплати не може бути раніше дати завантаження")
    data["payment"] = {"dueDate": payment["dueDate"], "paidAt": payment.get("paidAt")}


async def _insert(database: AsyncDatabase, user: dict, data: dict) -> dict:
    me = str(user["_id"])
    if not data.get("number"):
        data["number"] = await svc.next_trip_number(database, user["companyId"])
    action = "imported" if data.get("source") == "import" else "created"
    doc = {**data, "companyId": user["companyId"], "managerId": me, "createdAt": now(), "createdBy": user["_id"],
           "transferredAt": None, "history": [svc.history_entry(me, action)]}
    result = await database.trips.insert_one(doc)
    doc["_id"] = result.inserted_id
    await svc.sync_resources(database, user, None, doc)
    return doc


# ---------- CRUD ----------
@router.get("", response_model=list[TripOut])
async def list_trips(
    status_: Literal["planned", "in_progress", "done", "cancelled"] | None = Query(None, alias="status"),
    search: str | None = Query(None, max_length=100),
    mine: bool = False,
    user: dict = Depends(current_user),
    database: AsyncDatabase = Depends(db),
):
    query: dict = company_filter(user)
    if status_:
        query["status"] = status_
    if mine:
        query["managerId"] = str(user["_id"])
    if search and search.strip():
        rx = {"$regex": regex_escape(search), "$options": "i"}
        query["$or"] = [{"number": rx}, {"from.city": rx}, {"to.city": rx}, {"client.name": rx}, {"cargo.type": rx}]
    cursor = database.trips.find(query).sort([("loadDate", -1), ("_id", -1)])
    return [trip_out(doc) async for doc in cursor]


@router.get("/{trip_id}", response_model=TripOut)
async def get_trip(trip_id: str, user: dict = Depends(current_user), database: AsyncDatabase = Depends(db)):
    return trip_out(await _get_trip(database, user, trip_id))


@router.post("", response_model=TripOut, status_code=status.HTTP_201_CREATED)
async def create_trip(body: TripIn, user: dict = Depends(manager_user), database: AsyncDatabase = Depends(db)):
    data = body.model_dump(by_alias=True)
    await _prepare(database, user, data)
    return trip_out(await _insert(database, user, data))


@router.put("/{trip_id}", response_model=TripOut)
async def update_trip(trip_id: str, body: TripUpdate, user: dict = Depends(manager_user),
                      database: AsyncDatabase = Depends(db)):
    trip = await _get_trip(database, user, trip_id)
    _check_can_edit(user, trip)
    # null дозволено лише для необов'язкових полів; для решти (from, loadDate, status…) ігноруємо
    data = drop_nulls(body.model_dump(by_alias=True, exclude_unset=True), _NULLABLE)
    if not data.get("number"):
        data.pop("number", None)
    await _prepare(database, user, data, trip)
    history = svc.changes_history(str(user["_id"]), trip, {**trip, **data})
    update: dict = {"$set": {**data, "updatedAt": now()}}
    if history:
        update["$push"] = {"history": {"$each": history}}
    doc = await database.trips.find_one_and_update({"_id": trip["_id"]}, update, return_document=ReturnDocument.AFTER)
    if doc is None:
        raise not_found("Рейс")
    await svc.sync_resources(database, user, trip, doc)
    return trip_out(doc)


@router.patch("/{trip_id}/payment", response_model=TripOut)
async def set_payment(trip_id: str, body: PaymentIn, user: dict = Depends(manager_user),
                      database: AsyncDatabase = Depends(db)):
    """Позначити оплату: { paidAt: 'YYYY-MM-DD' } або { paidAt: null } — зняти позначку."""
    trip = await _get_trip(database, user, trip_id)
    _check_can_edit(user, trip)
    payment = {**(trip.get("payment") or {}), "paidAt": body.paid_at}
    update: dict = {"$set": {"payment": payment, "updatedAt": now()}}
    if bool((trip.get("payment") or {}).get("paidAt")) != bool(body.paid_at):
        update["$push"] = {"history": svc.history_entry(str(user["_id"]), "paid" if body.paid_at else "unpaid")}
    doc = await database.trips.find_one_and_update({"_id": trip["_id"]}, update, return_document=ReturnDocument.AFTER)
    if doc is None:
        raise not_found("Рейс")
    return trip_out(doc)


@router.delete("/{trip_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_trip(trip_id: str, user: dict = Depends(manager_user), database: AsyncDatabase = Depends(db)):
    trip = await _get_trip(database, user, trip_id)
    _check_can_edit(user, trip)
    await database.trips.delete_one({"_id": trip["_id"]})
    await svc.sync_resources(database, user, trip, None)
    await database.tasks.update_many({**company_filter(user), "tripId": str(trip["_id"])}, {"$set": {"tripId": None}})
    await delete_owner_documents(database, user["companyId"], "trips", str(trip["_id"]))
    await database.shares.delete_many({"tripId": trip["_id"]})  # посилання для замовника більше не відкриваються
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------- Бізнес-операції ----------
@router.post("/{trip_id}/calculate", response_model=CalculationOut)
async def calculate_trip(trip_id: str, user: dict = Depends(current_user), database: AsyncDatabase = Depends(db)):
    trip = await _get_trip(database, user, trip_id)
    vehicle = await find_ref(database, user, "vehicles", trip.get("vehicleId"))
    driver = await find_ref(database, user, "drivers", trip.get("driverId"))
    return calculate(trip, vehicle, driver, await fuel_price_for(database, user))


@router.post("/{trip_id}/transfer", response_model=TripOut)
async def transfer_trip(trip_id: str, body: TransferIn, user: dict = Depends(manager_user),
                        database: AsyncDatabase = Depends(db)):
    """Передати рейс іншому менеджеру компанії. У чат компанії додається системне повідомлення."""
    trip = await _get_trip(database, user, trip_id)
    if trip.get("managerId") != str(user["_id"]):
        raise ApiError(403, "Передати можна лише свій рейс", "not_owner")
    if body.to_manager_id == trip.get("managerId"):
        raise ApiError(400, "Рейс уже в цього менеджера", "same_manager")
    target = await find_ref(database, user, "users", body.to_manager_id, {"emailVerified": 1})
    if not (target and target.get("emailVerified")):
        raise invalid("Менеджера не знайдено у вашій компанії", "manager_not_found")
    return trip_out(await svc.transfer(database, trip, by=str(user["_id"]), to=body.to_manager_id, comment=body.comment))


@router.post("/import", response_model=TripImportOut, status_code=status.HTTP_201_CREATED)
async def import_trips(body: TripImportIn, user: dict = Depends(manager_user), database: AsyncDatabase = Depends(db)):
    """Пакетний імпорт рейсів (фронт імпортує з Della звичайним POST /trips; цей ендпоінт — для парсерів)."""
    if not body.trips:
        raise ApiError(400, "Немає рейсів для імпорту", "empty_import")
    # Спершу перевіряємо всі рейси, щоб помилка в одному не лишала в базі половину імпорту
    prepared = []
    for trip in body.trips:
        data = {**trip.model_dump(by_alias=True), "source": "import"}
        await _prepare(database, user, data)
        prepared.append(data)
    created = [trip_out(await _insert(database, user, data)) for data in prepared]
    return {"imported": len(created), "trips": created}
