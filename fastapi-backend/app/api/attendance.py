from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from app.services.face_service import FaceService
from app.main import db
import json

router = APIRouter(prefix="/attendance", tags=["Attendance"])


class FaceEnrollRequest(BaseModel):
    employee_id: str
    image_base64: str


class AttendancePunchRequest(BaseModel):
    employee_id: str
    image_base64: str
    lat: float
    lng: float
    type: str  # "IN" or "OUT"


@router.post("/enroll")
async def enroll_face(req: FaceEnrollRequest):
    employee = await db.employee.find_unique(where={"id": req.employee_id})
    if not employee:
        raise HTTPException(status_code=404, detail="Employee not found")

    encoding = FaceService.enroll_face(req.image_base64)
    if not encoding:
        raise HTTPException(
            status_code=400,
            detail="Could not extract face from image. Ensure exactly one face is clearly visible.")

    await db.employee.update(
        where={"id": req.employee_id},
        data={
            "faceEnrolled": True,
            "faceSignature": json.dumps(encoding)
        }
    )

    return {"status": "success", "message": "Face registered successfully."}


@router.post("/punch")
async def punch_attendance(req: AttendancePunchRequest):
    employee = await db.employee.find_unique(where={"id": req.employee_id})
    if not employee or not employee.faceEnrolled or not employee.faceSignature:
        raise HTTPException(status_code=400, detail="Face not enrolled")

    stored_encoding = json.loads(employee.faceSignature)
    verify_result = FaceService.verify_face(req.image_base64, stored_encoding)

    if not verify_result["match"]:
        raise HTTPException(status_code=401, detail="Face verification failed")

    if not verify_result["liveness_passed"]:
        raise HTTPException(status_code=401, detail="Liveness check failed")

    # Create AttendanceSession log (Mocking some fields for brevity)
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc)

    # In a real app we would check if there is an active session for "OUT"
    # punch, etc.
    await db.attendancesession.create(
        data={
            "companyId": employee.companyId,
            "employeeId": employee.id,
            "date": now,
            "checkInAt": now,
            "checkInLat": req.lat,
            "checkInLng": req.lng,
            "faceVerified": True,
            "livenessPassed": True
        }
    )

    # Broadcast to HR dashboard
    from app.api.websockets import notify_new_punch
    import asyncio
    asyncio.create_task(
        notify_new_punch(
            employee.companyId,
            employee.id,
            req.type,
            now.isoformat()))

    return {
        "status": "success",
        "message": f"Punched {req.type} successfully",
        "distance": verify_result["distance"]
    }
