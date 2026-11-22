"""Документи машин і водіїв: копії (фото або PDF) техпаспорта, страховки, посвідчення…

Метадані — у колекції `documents`, самі файли — у `files` (до 10 МБ, тож вміщуються в документ MongoDB
і не потребують окремого сховища). Тип файлу визначаємо за вмістом, а не за назвою чи заголовком.
"""
from urllib.parse import quote

from fastapi import Response
from pymongo.asynchronous.database import AsyncDatabase

from ..errors import not_found

MAX_FILE_BYTES = 10 * 1024 * 1024
EXPIRING_DAYS = 30


def sniff_mime(data: bytes) -> str | None:
    """Справжній тип файлу за першими байтами: JPEG, PNG, WebP або PDF; інакше None."""
    if data[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    if data[:5] == b"%PDF-":
        return "application/pdf"
    return None


def clean_filename(name: str | None, mime: str) -> str:
    base = (name or "").replace("\\", "/").rsplit("/", 1)[-1].strip()
    base = "".join(ch for ch in base if ch.isprintable())[:150]
    if base:
        return base
    return "document.pdf" if mime == "application/pdf" else "document." + mime.split("/")[-1]


async def file_response(database: AsyncDatabase, doc: dict | None) -> Response:
    """Сам файл документа (фото чи PDF) — відкривається в браузері, а не скачується."""
    stored = await database.files.find_one({"_id": doc["fileId"]}) if doc and doc.get("fileId") else None
    if stored is None:
        raise not_found("Файл")
    return Response(
        content=bytes(stored["data"]),
        media_type=doc["mime"],
        headers={
            "Content-Disposition": f"inline; filename*=UTF-8''{quote(doc['name'])}",
            "Cache-Control": "private, max-age=3600",
            "X-Content-Type-Options": "nosniff",
        },
    )


async def delete_owner_documents(database: AsyncDatabase, company_id, owner_type: str, owner_id: str) -> None:
    """Видаляє всі документи машини/водія разом із файлами (коли видаляють саму машину чи водія)."""
    query = {"companyId": company_id, "ownerType": owner_type, "ownerId": owner_id}
    file_ids = [d["fileId"] async for d in database.documents.find(query, {"fileId": 1}) if d.get("fileId")]
    if file_ids:
        await database.files.delete_many({"_id": {"$in": file_ids}})
    await database.documents.delete_many(query)
