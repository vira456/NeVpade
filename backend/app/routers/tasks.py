"""Розділ 5 контракту: завдання Kanban /tasks. Кожен менеджер бачить лише власну дошку."""
from datetime import datetime
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Response, status
from pymongo import ReturnDocument, UpdateOne
from pymongo.asynchronous.database import AsyncDatabase

from ..deps import current_user, db
from ..errors import ApiError, not_found
from ..schemas.entities import ReorderIn, TaskIn, TaskOut, TaskUpdate
from ..services.crud import ensure_ref
from ..utils import drop_nulls, is_oid, now, oid, public

router = APIRouter(prefix="/tasks", tags=["Завдання (Kanban)"])

KYIV = ZoneInfo("Europe/Kyiv")


def _mine(user: dict) -> dict:
    return {"ownerId": user["_id"]}


def task_out(doc: dict) -> dict:
    return public(doc, "ownerId", "updatedAt")


@router.get("", response_model=list[TaskOut])
async def list_tasks(user: dict = Depends(current_user), database: AsyncDatabase = Depends(db)):
    cursor = database.tasks.find(_mine(user)).sort([("status", 1), ("order", 1), ("_id", 1)])
    return [task_out(doc) async for doc in cursor]


@router.post("", response_model=TaskOut, status_code=status.HTTP_201_CREATED)
async def create_task(body: TaskIn, user: dict = Depends(current_user), database: AsyncDatabase = Depends(db)):
    data = body.model_dump(by_alias=True)
    if data.get("dueDate") and data["dueDate"] < datetime.now(KYIV).date().isoformat():
        raise ApiError(422, "Термін виконання не може бути в минулому", "validation_error")
    await ensure_ref(database, user, "trips", data.get("tripId"), "Рейс")
    if data.get("order") is None:  # нова картка — в кінець колонки
        data["order"] = await database.tasks.count_documents({**_mine(user), "status": data["status"]})
    doc = {**data, **_mine(user), "companyId": user["companyId"], "createdAt": now()}
    result = await database.tasks.insert_one(doc)
    doc["_id"] = result.inserted_id
    return task_out(doc)


# /reorder оголошено ДО /{task_id}, інакше «reorder» сприймався б як id
@router.put("/reorder", status_code=status.HTTP_204_NO_CONTENT)
async def reorder_tasks(body: ReorderIn, user: dict = Depends(current_user), database: AsyncDatabase = Depends(db)):
    """Після перетягування карток: нові статуси й порядок одним запитом."""
    ops = [
        UpdateOne({"_id": oid(item.id), **_mine(user)}, {"$set": {"status": item.status, "order": item.order, "updatedAt": now()}})
        for item in body.items
        if is_oid(item.id)
    ]
    if ops:
        await database.tasks.bulk_write(ops, ordered=False)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


async def _update(task_id: str, body: TaskUpdate, user: dict, database: AsyncDatabase) -> dict:
    # null можна передати лише для дати й прив'язки до рейсу; title/status/priority/order — ігноруємо
    data = drop_nulls(body.model_dump(by_alias=True, exclude_unset=True), frozenset({"dueDate", "tripId"}))
    if "tripId" in data:
        await ensure_ref(database, user, "trips", data["tripId"], "Рейс")
    doc = await database.tasks.find_one_and_update(
        {"_id": oid(task_id, "Завдання"), **_mine(user)},
        {"$set": {**data, "updatedAt": now()}},
        return_document=ReturnDocument.AFTER,
    )
    if doc is None:
        raise not_found("Завдання")
    return task_out(doc)


@router.put("/{task_id}", response_model=TaskOut)
async def update_task(task_id: str, body: TaskUpdate, user: dict = Depends(current_user), database: AsyncDatabase = Depends(db)):
    return await _update(task_id, body, user, database)


@router.patch("/{task_id}", response_model=TaskOut)
async def patch_task(task_id: str, body: TaskUpdate, user: dict = Depends(current_user), database: AsyncDatabase = Depends(db)):
    return await _update(task_id, body, user, database)


@router.delete("/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_task(task_id: str, user: dict = Depends(current_user), database: AsyncDatabase = Depends(db)):
    result = await database.tasks.delete_one({"_id": oid(task_id, "Завдання"), **_mine(user)})
    if result.deleted_count == 0:
        raise not_found("Завдання")
    return Response(status_code=status.HTTP_204_NO_CONTENT)
