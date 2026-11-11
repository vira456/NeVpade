"""Моделі запитів і відповідей розділу «Авторизація»."""
from typing import Literal

from pydantic import Field, model_validator

from .common import CamelModel, Code, Email, Password, Phone


class CompanyChoice(CamelModel):
    """{ mode: 'create', name } — нова компанія, або { mode: 'join', code } — за кодом запрошення."""

    mode: Literal["create", "join"]
    name: str | None = Field(default=None, max_length=120)
    code: str | None = Field(default=None, max_length=20)

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
    name: str = Field(min_length=2, max_length=100)
    email: Email
    phone: Phone
    password: Password
    company: CompanyChoice | None = None


class EmailCodeIn(CamelModel):
    email: Email
    code: Code


class ResendIn(CamelModel):
    email: Email
    purpose: Literal["verify", "verify_phone", "reset"] = "verify"


class LoginIn(CamelModel):
    email: Email
    password: str = Field(min_length=1, max_length=128)


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


class FacebookIn(CamelModel):
    access_token: str = Field(min_length=10)


class ChangePasswordIn(CamelModel):
    current_password: str = Field(default="", max_length=128)
    new_password: Password


class UserOut(CamelModel):
    id: str
    name: str
    email: str
    phone: str | None = None
    phone_verified: bool
    role: str
    company_id: str
    company_name: str | None = None
    position: str | None = None
    avatar_url: str | None = None


class AuthResponse(CamelModel):
    token: str
    user: UserOut


class RegisterOut(CamelModel):
    email: str
    message: str


class VerifyEmailOut(CamelModel):
    next: Literal["verify_phone"] = "verify_phone"
    phone: str | None


class PhoneOut(CamelModel):
    phone: str
    message: str
