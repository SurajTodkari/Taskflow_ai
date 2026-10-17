"""WebSocket connection manager; broadcast is thread-safe (callable from sync request handlers)."""
import asyncio
import logging
from collections import defaultdict

from fastapi import WebSocket

log = logging.getLogger(__name__)


class ConnectionManager:
    def __init__(self):
        self.conns: dict[int, set[WebSocket]] = defaultdict(set)
        self.loop: asyncio.AbstractEventLoop | None = None

    async def connect(self, user_id: int, ws: WebSocket):
        self.loop = asyncio.get_running_loop()
        await ws.accept()
        self.conns[user_id].add(ws)

    def disconnect(self, user_id: int, ws: WebSocket):
        self.conns[user_id].discard(ws)
        if not self.conns[user_id]:
            self.conns.pop(user_id, None)

    async def _send(self, user_id: int, event: dict):
        for ws in list(self.conns.get(user_id, ())):
            try:
                await ws.send_json(event)
            except Exception:
                self.disconnect(user_id, ws)

    def broadcast(self, user_id: int, event: dict) -> None:
        if not self.conns.get(user_id) or self.loop is None or self.loop.is_closed():
            return
        try:
            running = asyncio.get_running_loop()
        except RuntimeError:
            running = None
        if running is self.loop:
            self.loop.create_task(self._send(user_id, event))
        else:
            asyncio.run_coroutine_threadsafe(self._send(user_id, event), self.loop)


manager = ConnectionManager()


def broadcast(user_id: int, event: dict) -> None:
    try:
        manager.broadcast(user_id, event)
    except Exception as e:  # pragma: no cover
        log.debug("broadcast failed: %s", e)
