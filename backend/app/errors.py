"""Єдиний формат помилок API: { "detail": "Текст для користувача", "code": "machine_code" }."""
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException


class ApiError(Exception):
    def __init__(self, status: int, detail: str, code: str | None = None):
        super().__init__(detail)
        self.status = status
        self.detail = detail
        self.code = code


def not_found(what: str = "Запис") -> ApiError:
    return ApiError(404, f"{what} не знайдено", "not_found")


def _body(detail: str, code: str | None = None) -> dict:
    return {"detail": detail, "code": code} if code else {"detail": detail}


# Переклад типових помилок валідації Pydantic українською
_VALIDATION_MESSAGES = {
    "missing": "Поле обов'язкове",
    "string_too_short": "Занадто коротке значення",
    "string_too_long": "Занадто довге значення",
    "value_error": None,  # текст беремо з повідомлення валідатора
    "enum": "Недопустиме значення",
    "literal_error": "Недопустиме значення",
    "int_parsing": "Має бути ціле число",
    "float_parsing": "Має бути число",
    "greater_than_equal": "Значення занадто мале",
    "less_than_equal": "Значення занадто велике",
    "json_invalid": "Некоректний JSON",
}


def _validation_text(err: dict) -> str:
    field = ".".join(str(p) for p in err.get("loc", ()) if p not in ("body", "query", "path"))
    kind = err.get("type", "")
    text = _VALIDATION_MESSAGES.get(kind)
    if text is None:
        text = str(err.get("msg", "Некоректне значення")).removeprefix("Value error, ")
    return f"{field}: {text}" if field and kind != "value_error" else text


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def _api_error(_: Request, exc: ApiError):
        return JSONResponse(_body(exc.detail, exc.code), status_code=exc.status)

    @app.exception_handler(RequestValidationError)
    async def _validation_error(_: Request, exc: RequestValidationError):
        errors = exc.errors()
        detail = _validation_text(errors[0]) if errors else "Некоректні дані"
        return JSONResponse(_body(detail, "validation_error"), status_code=422)

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(_: Request, exc: StarletteHTTPException):
        translated = {"Not Found": "Ресурс не знайдено", "Method Not Allowed": "Метод не підтримується"}
        detail = translated.get(str(exc.detail), str(exc.detail))
        return JSONResponse(_body(detail), status_code=exc.status_code, headers=getattr(exc, "headers", None))
