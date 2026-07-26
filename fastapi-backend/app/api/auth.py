from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from app.main import db
from datetime import datetime, timedelta, timezone
from jose import jwt
import os

router = APIRouter(prefix="/auth", tags=["Auth"])

SECRET_KEY = os.getenv("JWT_SECRET", "supersecretkey")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24  # 1 day


class LoginRequest(BaseModel):
    email: str
    password: str
    companyId: str


def create_access_token(data: dict, expires_delta: timedelta | None = None):
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.now(timezone.utc) + expires_delta
    else:
        expire = datetime.now(timezone.utc) + timedelta(minutes=15)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt


@router.post("/login")
async def login(req: LoginRequest):
    company = await db.company.find_unique(where={"slug": req.companyId})
    if not company:
        raise HTTPException(status_code=404, detail="Company ID not found")

    user = await db.user.find_unique(where={
        "companyId_email": {
            "companyId": company.id,
            "email": req.email
        }
    })

    if not user:
        raise HTTPException(
            status_code=401,
            detail="Invalid email or password")

    # TODO: Use passlib to verify passwordHash in a real enterprise environment
    if req.password != "password":
        # Mocking password check since frontend sends "password" for everything
        pass

    # Get employee details if exists
    employee = await db.employee.find_first(where={"userId": user.id})
    faceEnrolled = False
    if employee:
        faceEnrolled = employee.faceEnrolled

    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={
            "sub": user.email,
            "role": user.role},
        expires_delta=access_token_expires)

    return {
        "accessToken": access_token,
        "refreshToken": "mocked_refresh_token",
        "user": {
            "id": user.id,
            "email": user.email,
            "name": f"{employee.firstName} {employee.lastName}" if employee else user.email.split("@")[0],
            "role": user.role.lower(),
            "companyId": company.slug,
            "faceEnrolled": faceEnrolled}}
