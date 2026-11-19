"""Моделі запитів і відповідей розділу «Авторизація»."""
from typing import Literal

from pydantic import Field, model_validator

from .common import CamelModel, Code, Email, FullName2, Password, Phone


class CompanyChoice(CamelModel):
    """{ mode: 'create', name } — нова компанія, або { mode: 'join', code } — за кодом запрошення."""

    mode: Literal["create", "join"]
    name: str | None = Field(default=None, max_length=120)
    code: str | None = Field(default=None, max_length=20)
    city: str | None = Field(default=None, max_length=80)  # місто компанії (реєстрація власника)

    @model_validator(mode="after")
    def _check(self):
        if self.mode == "create" and not (self.name and len(self.name) >= 2):
            raise ValueError("Вкажіть назву компанії")
        if self.mode == "join":
            if not self.code:
                raise ValueError("Вкажіть код запрошення")
            self.code = self.code.upper()
        return self


class RegisterIn(CamelModel):
    """Власник створює компанію (role: owner, company.mode: create), менеджер приєднується за кодом (manager, join)."""

    name: FullName2
    email: Email
    phone: Phone
    password: Password
    company: CompanyChoice | None = None
    role: Literal["owner", "manager"] | None = None

    @model_validator(mode="after")
    def _role_matches_company(self):
        mode = self.company.mode if self.company else None
        if self.role is None:  # старий фронт без role — визначаємо за вибором компанії
            self.role = "manager" if mode == "join" else "owner"
        if self.role == "owner" and mode != "create":
            raise ValueError("Власник реєструє нову компанію: вкажіть її назву")
        if self.role == "manager" and mode != "join":
            raise ValueError("Менеджер приєднується до компанії за кодом запрошення від власника")
        return self


class EmailCodeIn(CamelModel):
    email: Email
    code: Code


class ResendIn(CamelModel):
    email: Email
    purpose: Literal["verify", "verify_phone", "reset"] = "verify"


class LoginIn(CamelModel):
    email: Email
    password: str = Field(min_length=1, max_length=128)
    role: Literal["owner", "manager"] | None = None  # вкладка на сторінці входу
    owner_code: str | None = Field(default=None, max_length=40)


class OwnerCodeResetIn(CamelModel):
    email: Email


class OwnerCodeIn(CamelModel):
    password: str = Field(min_length=1, max_length=128)


class JoinRequestIn(CamelModel):
    code: str = Field(min_length=4, max_length=20)


class ForgotIn(CamelModel):
    email: Email


class ResetIn(CamelModel):
    email: Email
    code: Code
    password: Password


class PhoneIn(CamelModel):
    email: Email
    phone: Phone


class GoogleIn(CamelModel):
    credential: str = Field(min_length=10)


class ChangePasswordIn(CamelModel):
    current_password: str = Field(default="", max_length=128)
    new_password: Password

    @model_validator(mode="after")
    def _differs(self):
        if self.current_password and self.current_password == self.new_password:
            raise ValueError("Новий пароль має відрізнятися від поточного")
        return self


class UserOut(CamelModel):
    id: str
    name: str
    email: str
    phone: str | None = None
    phone_verified: bool
    role: str | None = None  # null — новий користувач Google ще не обрав компанію
    company_id: str | None = None
    member_status: str | None = None  # лише в менеджерів: pending | active | rejected
    company_name: str | None = None
    position: str | None = None
    avatar_url: str | None = None


class AuthResponse(CamelModel):
    token: str
    user: UserOut
    is_new: bool = False  # щойно створений через Google → фронт відкриває «Завершіть реєстрацію»
    owner_code: str | None = None  # новий код власника — віддається один раз (після реєстрації чи першого входу)


class CompleteSignupIn(CamelModel):
    """«Завершіть реєстрацію» після першого входу через Google (лише менеджер: join + код запрошення)."""

    name: FullName2
    phone: Phone
    company: CompanyChoice


class CompleteSignupOut(CamelModel):
    user: UserOut
    message: str


class RegisterOut(CamelModel):
    email: str
    message: str


class VerifyEmailOut(CamelModel):
    next: Literal["verify_phone"] = "verify_phone"
    phone: str | None


class PhoneOut(CamelModel):
    phone: str
    message: str
