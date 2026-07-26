from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from typing import List, Dict

router = APIRouter(tags=["WebSockets"])


class ConnectionManager:
    def __init__(self):
        # Store active connections grouped by companyId
        self.active_connections: Dict[str, List[WebSocket]] = {}

    async def connect(self, websocket: WebSocket, company_id: str):
        await websocket.accept()
        if company_id not in self.active_connections:
            self.active_connections[company_id] = []
        self.active_connections[company_id].append(websocket)

    def disconnect(self, websocket: WebSocket, company_id: str):
        if company_id in self.active_connections:
            if websocket in self.active_connections[company_id]:
                self.active_connections[company_id].remove(websocket)
            if not self.active_connections[company_id]:
                del self.active_connections[company_id]

    async def broadcast_to_company(self, message: dict, company_id: str):
        if company_id in self.active_connections:
            for connection in self.active_connections[company_id]:
                try:
                    await connection.send_json(message)
                except Exception:
                    pass


manager = ConnectionManager()


@router.websocket("/ws/admin/{company_id}")
async def websocket_endpoint(websocket: WebSocket, company_id: str):
    await manager.connect(websocket, company_id)
    try:
        while True:
            # We don't expect much inbound from client except pings
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        manager.disconnect(websocket, company_id)

# Helper method to be called from attendance.py when a punch happens


async def notify_new_punch(
        company_id: str,
        employee_id: str,
        punch_type: str,
        timestamp: str):
    message = {
        "event": "new_attendance",
        "data": {
            "employeeId": employee_id,
            "type": punch_type,
            "timestamp": timestamp
        }
    }
    await manager.broadcast_to_company(message, company_id)
