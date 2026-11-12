"""Розділ 1 контракту: реєстрація, підтвердження пошти й телефону, вхід (email, Google, Facebook)."""
from fastapi import APIRouter, Depends, status
from pymongo.asynchronous.database import AsyncDatabase
from pymongo.errors import DuplicateKeyError

from ..deps import any_user, db, optional_user
from ..errors import ApiError
from ..schemas.auth import (
    AuthResponse,
    ChangePasswordIn,
    EmailCodeIn,
    FacebookIn,
    ForgotIn,
    GoogleIn,
    LoginIn,
    PhoneIn,
    PhoneOut,
    RegisterIn,
    RegisterOut,
    ResendIn,
    ResetIn,
    UserOut,
    VerifyEmailOut,
)
from ..schemas.common import Message
from ..security import hash_password, verify_password
from ..services import codes, notify, social
from ..services.users import PHONE_SETUP_WINDOW, attach_company, auth_response, new_user_doc, release_phone_from_unverified, user_out
from ..utils import now

router = APIRouter(prefix="/auth", tags=["Авторизація"])

BAD_CREDENTIALS = ApiError(401, "Невірний email або пароль", "invalid_credentials")


async def _send_email_code(database: AsyncDatabase, email: str, purpose: str, *, cooldown: bool = True) -> None:
    code = await codes.issue(database, email, purpose, enforce_cooldown=cooldown)
    await notify.send_code_email(email, code, purpose)


async def _send_phone_code(database: AsyncDatabase, user: dict, *, cooldown: bool = True) -> None:
    code = await codes.issue(database, user["email"], "verify_phone", enforce_cooldown=cooldown)
    await notify.send_code_sms(user["phone"], code)


async def _phone_setup_user(database: AsyncDatabase, email: str, token_user: dict | None = None) -> dict:
    """Користувач, який зараз має право прив'язати/підтвердити телефон.
    Якщо в запиті є дійсний токен — беремо користувача з нього (контракт), інакше за email у «вікні» після входу."""
    user = token_user or await database.users.find_one({"email": email})
    if user is None or not user.get("emailVerified"):
        raise ApiError(400, "Спершу підтвердіть пошту", "email_not_verified")
    if user.get("phoneVerified"):
        raise ApiError(400, "Телефон уже підтверджено. Увійдіть у систему", "phone_already_verified")
    if token_user is None:
        until = user.get("phoneSetupUntil")
        if until is None or until < now():
            raise ApiError(401, "Час на підтвердження телефону минув. Увійдіть знову", "phone_setup_expired")
    return user


# ---------- Реєстрація ----------
@router.post("/register", response_model=RegisterOut, status_code=status.HTTP_201_CREATED)
async def register(body: RegisterIn, database: AsyncDatabase = Depends(db)):
    existing = await database.users.find_one({"email": body.email})
    if existing and existing.get("emailVerified"):
        raise ApiError(409, "Цей email уже зареєстровано. Увійдіть або відновіть пароль", "email_taken")

    if await release_phone_from_unverified(database, body.phone, except_id=existing["_id"] if existing else None):
        raise ApiError(409, "Цей номер уже використовується", "phone_taken")

    pending = {"mode": "create", "name": f"Компанія {body.name}"}
    if body.company:
        if body.company.mode == "join":
            company = await database.companies.find_one({"inviteCode": body.company.code})
            if company is None:
                raise ApiError(404, "Компанію з таким кодом не знайдено. Перевірте код у колеги", "company_not_found")
            pending = {"mode": "join", "companyId": company["_id"]}
        else:
            pending = {"mode": "create", "name": " ".join(body.company.name.split())}

    fields = {"name": body.name, "phone": body.phone, "passwordHash": hash_password(body.password), "pendingCompany": pending}
    if existing:  # незавершена реєстрація з тим самим email — перезаписуємо дані
        await database.users.update_one({"_id": existing["_id"]}, {"$set": fields})
    else:
        try:
            await database.users.insert_one(new_user_doc(email=body.email, **fields))
        except DuplicateKeyError:
            raise ApiError(409, "Цей email або номер уже використовується", "email_taken") from None

    await _send_email_code(database, body.email, "verify", cooldown=False)
    return RegisterOut(email=body.email, message="Код підтвердження надіслано на пошту")


@router.post("/verify-email", response_model=VerifyEmailOut)
async def verify_email(body: EmailCodeIn, database: AsyncDatabase = Depends(db)):
    """Крок 1: код з пошти. Далі — SMS на телефон (токен ще не видається)."""
    user = await database.users.find_one({"email": body.email})
    if user is None:
        raise ApiError(400, "Термін дії коду минув. Запросіть новий код", "code_expired")
    if user.get("emailVerified"):
        raise ApiError(400, "Пошту вже підтверджено. Увійдіть у систему", "email_already_verified")

    await codes.consume(database, body.email, "verify", body.code)
    await database.users.update_one({"_id": user["_id"]}, {"$set": {"emailVerified": True, "phoneSetupUntil": now() + PHONE_SETUP_WINDOW}})
    user["emailVerified"] = True
    if user.get("companyId") is None:
        await attach_company(database, user, user.get("pendingCompany"))

    if user.get("phone"):
        await _send_phone_code(database, user, cooldown=False)
    return VerifyEmailOut(phone=user.get("phone"))


@router.post("/phone", response_model=PhoneOut)
async def add_phone(body: PhoneIn, database: AsyncDatabase = Depends(db), token_user: dict | None = Depends(optional_user)):
    """Додати/змінити номер (після входу через соцмережу або на кроці підтвердження) → SMS з кодом."""
    user = await _phone_setup_user(database, body.email, token_user)
    if await release_phone_from_unverified(database, body.phone, except_id=user["_id"]):
        raise ApiError(409, "Цей номер уже використовується", "phone_taken")
    try:
        await database.users.update_one({"_id": user["_id"]}, {"$set": {"phone": body.phone}})
    except DuplicateKeyError:
        raise ApiError(409, "Цей номер уже використовується", "phone_taken") from None
    user["phone"] = body.phone
    await _send_phone_code(database, user, cooldown=False)
    return PhoneOut(phone=body.phone, message="Код надіслано в SMS")


@router.post("/verify-phone", response_model=AuthResponse)
async def verify_phone(body: EmailCodeIn, database: AsyncDatabase = Depends(db),
                       token_user: dict | None = Depends(optional_user)):
    """Крок 2: код з SMS → вхід у систему."""
    user = await _phone_setup_user(database, body.email, token_user)
    if not user.get("phone"):
        raise ApiError(400, "Спершу вкажіть номер телефону", "phone_required")
    await codes.consume(database, user["email"], "verify_phone", body.code)
    await database.users.update_one({"_id": user["_id"]}, {"$set": {"phoneVerified": True}, "$unset": {"phoneSetupUntil": ""}})
    user["phoneVerified"] = True
    return await auth_response(database, user)


@router.post("/resend-code", response_model=Message)
async def resend_code(body: ResendIn, database: AsyncDatabase = Depends(db), token_user: dict | None = Depends(optional_user)):
    user = await database.users.find_one({"email": body.email})
    if body.purpose == "verify":
        if user and not user.get("emailVerified"):
            await _send_email_code(database, body.email, "verify")
    elif body.purpose == "reset":
        if user and user.get("emailVerified"):
            await _send_email_code(database, body.email, "reset")
    else:  # verify_phone
        user = await _phone_setup_user(database, body.email, token_user)
        if not user.get("phone"):
            raise ApiError(400, "Спершу вкажіть номер телефону", "phone_required")
        await _send_phone_code(database, user)
    return Message(message="Код надіслано повторно")


# ---------- Вхід ----------
@router.post("/login", response_model=AuthResponse)
async def login(body: LoginIn, database: AsyncDatabase = Depends(db)):
    user = await database.users.find_one({"email": body.email})
    if user is None or not verify_password(body.password, user.get("passwordHash")):
        raise BAD_CREDENTIALS
    if not user.get("emailVerified"):
        try:  # заодно надсилаємо свіжий код, фронт перекине на сторінку його введення
            await _send_email_code(database, body.email, "verify")
        except ApiError:
            pass
        raise ApiError(403, "Пошту не підтверджено", "email_not_verified")
    return await auth_response(database, user)


@router.post("/forgot-password", response_model=Message)
async def forgot_password(body: ForgotIn, database: AsyncDatabase = Depends(db)):
    user = await database.users.find_one({"email": body.email})
    if user and user.get("emailVerified"):
        try:
            await _send_email_code(database, body.email, "reset")
        except ApiError as exc:
            if exc.status != 429:
                raise
    # Однакова відповідь для будь-якого email — щоб не розкривати, хто зареєстрований
    return Message(message="Якщо такий email зареєстровано, на нього надіслано код")


@router.post("/reset-password", response_model=Message)
async def reset_password(body: ResetIn, database: AsyncDatabase = Depends(db)):
    user = await database.users.find_one({"email": body.email})
    if user is None or not user.get("emailVerified"):
        raise ApiError(400, "Термін дії коду минув. Запросіть новий код", "code_expired")
    await codes.consume(database, body.email, "reset", body.code)
    await database.users.update_one({"_id": user["_id"]}, {"$set": {"passwordHash": hash_password(body.password)}})
    return Message(message="Пароль змінено")


# ---------- Соцмережі ----------
async def _social_login(database: AsyncDatabase, *, provider_field: str, provider_id: str, email: str, name: str,
                        avatar: str | None = None) -> AuthResponse:
    user = await database.users.find_one({provider_field: provider_id}) or await database.users.find_one({"email": email})

    if user is None:
        doc = new_user_doc(name=name, email=email, emailVerified=True, avatarUrl=avatar, **{provider_field: provider_id})
        try:
            result = await database.users.insert_one(doc)
        except DuplicateKeyError:  # паралельний запит уже створив користувача
            user = await database.users.find_one({"email": email})
        else:
            doc["_id"] = result.inserted_id
            user = doc
    else:
        update: dict = {provider_field: provider_id}
        if not user.get("emailVerified"):
            # Хтось почав реєстрацію з цим email, але не підтвердив його. Соцмережа довела, що пошта
            # належить цьому користувачу, тож чужий пароль/номер/вибір компанії скидаємо.
            update.update(emailVerified=True, passwordHash=None, phone=None, phoneVerified=False)
            user.update(update)
            user.pop("pendingCompany", None)
            await database.users.update_one({"_id": user["_id"]}, {"$unset": {"pendingCompany": ""}})
        if avatar and not user.get("avatarUrl"):
            update["avatarUrl"] = avatar
        await database.users.update_one({"_id": user["_id"]}, {"$set": update})
        user.update(update)

    if user.get("companyId") is None:
        await attach_company(database, user, None)
    return await auth_response(database, user)


@router.post("/google", response_model=AuthResponse)
async def google_login(body: GoogleIn, database: AsyncDatabase = Depends(db)):
    info = await social.verify_google(body.credential)
    return await _social_login(database, provider_field="googleId", provider_id=info["sub"],
                               email=info["email"], name=info["name"], avatar=info.get("picture"))


@router.post("/facebook", response_model=AuthResponse)
async def facebook_login(body: FacebookIn, database: AsyncDatabase = Depends(db)):
    info = await social.verify_facebook(body.access_token)
    return await _social_login(database, provider_field="facebookId", provider_id=info["id"],
                               email=info["email"], name=info["name"])


# ---------- Поточний користувач ----------
@router.get("/me", response_model=UserOut)
async def me(user: dict = Depends(any_user), database: AsyncDatabase = Depends(db)):
    return await user_out(database, user)


@router.post("/change-password", response_model=Message)
async def change_password(body: ChangePasswordIn, user: dict = Depends(any_user), database: AsyncDatabase = Depends(db)):
    # Користувач, що входив лише через Google/Facebook, пароля не має — дозволяємо задати його без поточного
    if user.get("passwordHash") and not verify_password(body.current_password, user["passwordHash"]):
        raise ApiError(400, "Невірний поточний пароль", "invalid_password")
    await database.users.update_one({"_id": user["_id"]}, {"$set": {"passwordHash": hash_password(body.new_password)}})
    return Message(message="Пароль змінено")
