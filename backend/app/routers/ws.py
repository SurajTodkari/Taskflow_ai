import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from ..db import SessionLocal
from ..models import User
from ..security import decode_access_token
from ..services.realtime import broadcast, manager

log = logging.getLogger(__name__)
router = APIRouter(tags=["ws"])


def notify_changed(user_id: int, entity: str = "tasks") -> None:
    """Called (sync) from other modules after mutations."""
    broadcast(user_id, {"type": "changed", "entity": entity})


@router.websocket("/ws")
async def ws_endpoint(websocket: WebSocket, token: str = ""):
    uid = decode_access_token(token) if token else None
    ok = False
    if uid:
        with SessionLocal() as db:
            u = db.get(User, uid)
            ok = bool(u and u.is_active)
    if not ok:
        await websocket.close(code=4401)
        return
    await manager.connect(uid, websocket)
    try:
        while True:
            msg = await websocket.receive_text()
            if msg == "ping":
                await websocket.send_json({"type": "pong"})
    except WebSocketDisconnect:
        pass
    except Exception:
        log.debug("ws error", exc_info=True)
    finally:
        manager.disconnect(uid, websocket)
