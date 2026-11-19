"""Перевірка ID-токена Google (вхід менеджера через Google)."""
import logging

from fastapi.concurrency import run_in_threadpool
from google.auth.exceptions import GoogleAuthError, TransportError
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token

from ..config import settings
from ..errors import ApiError

log = logging.getLogger("nevpade.social")

_google_request = google_requests.Request()  # кешує HTTP-сесію для завантаження ключів Google


async def verify_google(credential: str) -> dict:
    """ID-токен Google Identity Services → {sub, email, name, picture}."""
    if not settings.google_client_id:
        raise ApiError(503, "Вхід через Google не налаштовано на сервері", "google_not_configured")
    try:
        info = await run_in_threadpool(id_token.verify_oauth2_token, credential, _google_request, settings.google_client_id)
    except TransportError:  # не вдалося завантажити ключі Google — це не помилка користувача
        log.exception("Google недоступний під час перевірки токена")
        raise ApiError(502, "Google тимчасово недоступний. Спробуйте пізніше", "google_unavailable") from None
    except (ValueError, GoogleAuthError) as exc:
        log.info("Недійсний Google-токен: %s", exc)
        raise ApiError(401, "Не вдалося підтвердити вхід через Google. Спробуйте ще раз", "google_invalid") from None

    if info.get("iss") not in ("accounts.google.com", "https://accounts.google.com"):
        raise ApiError(401, "Недійсний токен Google", "google_invalid")
    if not info.get("email") or not info.get("email_verified"):
        raise ApiError(400, "Пошта в акаунті Google не підтверджена", "email_not_verified")
    return {
        "sub": info["sub"],
        "email": info["email"].lower(),
        "name": info.get("name") or info["email"].split("@")[0],
        "picture": info.get("picture"),
    }
