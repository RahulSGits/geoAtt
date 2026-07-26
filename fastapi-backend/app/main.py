from app.api import attendance, auth, websockets
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from prisma import Prisma

db = Prisma()

load_dotenv()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    await db.connect()
    yield
    # Shutdown
    await db.disconnect()

app = FastAPI(
    title="GeoSelfie API",
    description="Enterprise Biometric Attendance Backend",
    version="1.0.0",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health_check():
    return {"status": "ok", "service": "geoselfie-backend"}

app.include_router(attendance.router)
app.include_router(auth.router)
app.include_router(websockets.router)
