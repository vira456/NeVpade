"""Розділ 4а контракту: документи машин і водіїв (копії — фото або PDF).

/{owner}/{id}/documents      — список, завантаження (multipart/form-data)
/{owner}/{id}/documents/{d}  — видалення
/{owner}/documents/summary   — лічильники для списку
/files/{docId}?token=…       — сам файл за тимчасовим підписаним посиланням (для <img> без Authorization)
"""
from datetime import datetime, timedelta
from typing import Literal
from urllib.parse import quote
from zoneinfo import ZoneInfo

from bson import Binary
from fastapi import APIRouter, Depends, File, Form, Request, Response, UploadFile, status
from pymongo.asynchronous.database import AsyncDatabase

from ..deps import company_filter, current_user, db
from ..errors import ApiError, not_found
from ..schemas.common import _date
from ..schemas.entities import DRIVER_DOC_TYPES, VEHICLE_DOC_TYPES, DocumentOut, DocumentsSummaryItem
from ..security import create_file_token, decode_file_token
from ..services.crud import get_company_doc
from ..services.documents import EXPIRING_DAYS, MAX_FILE_BYTES, clean_filename, sniff_mime
from ..utils import iso, is_oid, now, oid

router = APIRouter(tags=["Документи"])

KYIV = ZoneInfo("Europe/Kyiv")
Owner = Literal["vehicles", "drivers"]
_OWNERS: dict[str, tuple[tuple[str, ...], str]] = {
    "vehicles": (VEHICLE_DOC_TYPES, "Машину"),
    "drivers": (DRIVER_DOC_TYPES, "Водія"),
}


def _doc_out(request: Request, doc: dict) -> DocumentOut:
    doc_id = str(doc["_id"])
    url = request.url_for("document_file", doc_id=doc_id).include_query_params(token=create_file_token(doc_id))
    return DocumentOut(
        id=doc_id, type=doc["type"], valid_until=doc.get("validUntil"), name=doc["name"], mime=doc["mime"],
        size=doc["size"], created_at=iso(doc.get("createdAt")), url=str(url),
    )


def _register(owner: Owner) -> None:
    doc_types, what = _OWNERS[owner]

    # summary оголошено ДО /{owner_id}/…, хоча шляхи й так не перетинаються
    @router.get(f"/{owner}/documents/summary", response_model=dict[str, DocumentsSummaryItem],
                name=f"{owner}_documents_summary")
    async def summary(user: dict = Depends(current_user), database: AsyncDatabase = Depends(db)):
        """{ "<id>": { count, expiring, expired } } — expiring: validUntil протягом 30 днів, expired — уже минув."""
        today = datetime.now(KYIV).date()
        soon = (today + timedelta(days=EXPIRING_DAYS)).isoformat()
        out: dict[str, dict] = {}
        cursor = database.documents.find({**company_filter(user), "ownerType": owner}, {"ownerId": 1, "validUntil": 1})
        async for d in cursor:
            row = out.setdefault(d["ownerId"], {"count": 0, "expiring": 0, "expired": 0})
            row["count"] += 1
            valid = d.get("validUntil")
            if valid and valid < today.isoformat():
                row["expired"] += 1
            elif valid and valid <= soon:
                row["expiring"] += 1
        return out

    @router.get(f"/{owner}/{{owner_id}}/documents", response_model=list[DocumentOut], name=f"{owner}_documents")
    async def list_documents(owner_id: str, request: Request, user: dict = Depends(current_user),
                             database: AsyncDatabase = Depends(db)):
        await get_company_doc(database, user, owner, owner_id, what)
        cursor = database.documents.find(
            {**company_filter(user), "ownerType": owner, "ownerId": owner_id}, {"fileId": 0}
        ).sort([("createdAt", -1), ("_id", -1)])
        return [_doc_out(request, d) async for d in cursor]

    @router.post(f"/{owner}/{{owner_id}}/documents", response_model=DocumentOut, status_code=status.HTTP_201_CREATED,
                 name=f"{owner}_upload_document")
    async def upload_document(
        owner_id: str,
        request: Request,
        file: UploadFile = File(...),
        type: str = Form(...),
        valid_until: str | None = Form(None, alias="validUntil"),
        user: dict = Depends(current_user),
        database: AsyncDatabase = Depends(db),
    ):
        await get_company_doc(database, user, owner, owner_id, what)
        if type not in doc_types:
            raise ApiError(422, f"Невідомий тип документа. Можливі: {', '.join(doc_types)}", "validation_error")
        try:
            valid_until = _date(valid_until.strip() if valid_until else None)
        except ValueError as exc:
            raise ApiError(422, str(exc), "validation_error") from None

        data = await file.read(MAX_FILE_BYTES + 1)
        if len(data) > MAX_FILE_BYTES:
            raise ApiError(413, "Файл завеликий (максимум 10 МБ)", "file_too_large")
        if not data:
            raise ApiError(422, "Файл порожній", "validation_error")
        mime = sniff_mime(data)
        if mime is None:
            raise ApiError(415, "Підтримуються лише фото (JPG, PNG, WEBP) та PDF", "unsupported_file")

        file_result = await database.files.insert_one({"companyId": user["companyId"], "data": Binary(data)})
        doc = {
            "companyId": user["companyId"], "ownerType": owner, "ownerId": owner_id, "type": type,
            "validUntil": valid_until, "name": clean_filename(file.filename, mime), "mime": mime, "size": len(data),
            "fileId": file_result.inserted_id, "createdAt": now(), "createdBy": user["_id"],
        }
        result = await database.documents.insert_one(doc)
        doc["_id"] = result.inserted_id
        return _doc_out(request, doc)

    @router.delete(f"/{owner}/{{owner_id}}/documents/{{doc_id}}", status_code=status.HTTP_204_NO_CONTENT,
                   name=f"{owner}_delete_document")
    async def delete_document(owner_id: str, doc_id: str, user: dict = Depends(current_user),
                              database: AsyncDatabase = Depends(db)):
        doc = await database.documents.find_one(
            {"_id": oid(doc_id, "Документ"), **company_filter(user), "ownerType": owner, "ownerId": owner_id}
        )
        if doc is None:
            raise not_found("Документ")
        await database.documents.delete_one({"_id": doc["_id"]})
        if doc.get("fileId"):
            await database.files.delete_one({"_id": doc["fileId"]})
        return Response(status_code=status.HTTP_204_NO_CONTENT)


for _owner in _OWNERS:
    _register(_owner)  # type: ignore[arg-type]


@router.get("/files/{doc_id}", name="document_file", include_in_schema=False)
async def document_file(doc_id: str, token: str = "", database: AsyncDatabase = Depends(db)):
    """Віддає файл документа. Доступ — лише за підписаним посиланням з відповіді API (діє 2 години)."""
    if decode_file_token(token) != doc_id or not is_oid(doc_id):
        raise ApiError(403, "Посилання на файл недійсне або застаріло. Оновіть сторінку", "file_link_expired")
    doc = await database.documents.find_one({"_id": oid(doc_id)})
    stored = await database.files.find_one({"_id": doc["fileId"]}) if doc and doc.get("fileId") else None
    if stored is None:
        raise not_found("Файл")
    filename = quote(doc["name"])
    return Response(
        content=bytes(stored["data"]),
        media_type=doc["mime"],
        headers={
            "Content-Disposition": f"inline; filename*=UTF-8''{filename}",
            "Cache-Control": "private, max-age=3600",
            "X-Content-Type-Options": "nosniff",
        },
    )

