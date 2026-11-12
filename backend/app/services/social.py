"""Перевірка токенів Google та Facebook."""
import logging

import httpx
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


async def verify_facebook(access_token: str) -> dict:
    """Access token Facebook SDK → {id, email, name}."""
    # Без секрету неможливо перевірити, що токен видано саме нашому застосунку, — тоді токен будь-якого
    # іншого Facebook-застосунку давав би вхід у чужий акаунт. Тому секрет обов'язковий.
    if not settings.facebook_app_id or not settings.facebook_app_secret:
        raise ApiError(503, "Вхід через Facebook не налаштовано на сервері", "facebook_not_configured")
    invalid = ApiError(401, "Не вдалося підтвердити вхід через Facebook", "facebook_invalid")
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            debug = await client.get(
                "https://graph.facebook.com/debug_token",
                params={"input_token": access_token, "access_token": f"{settings.facebook_app_id}|{settings.facebook_app_secret}"},
            )
            data = debug.json().get("data") or {}
            if not data.get("is_valid") or str(data.get("app_id")) != settings.facebook_app_id:
                raise invalid
            resp = await client.get(
                "https://graph.facebook.com/me",
                params={"fields": "id,name,email", "access_token": access_token},
            )
            if resp.status_code != 200:
                raise invalid
            me = resp.json()
    except (httpx.HTTPError, ValueError) as exc:
        log.exception("Facebook недоступний під час перевірки токена")
        raise ApiError(502, "Facebook тимчасово недоступний. Спробуйте пізніше", "facebook_unavailable") from exc
    if not me.get("email"):
        raise ApiError(400, "Facebook не надав email. Дозвольте доступ до пошти або зареєструйтесь через email", "facebook_no_email")
    return {"id": me["id"], "email": me["email"].lower(), "name": me.get("name") or me["email"].split("@")[0]}
