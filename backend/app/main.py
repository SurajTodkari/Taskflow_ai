import importlib
import logging
import os
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from sqlalchemy import text
from starlette.exceptions import HTTPException as StarletteHTTPException

from .config import settings
from .db import SessionLocal
from .deps import limiter

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"),
                    format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("taskflow")

if os.environ.get("RENDER") and settings.DATABASE_URL.startswith("sqlite"):
    log.error("DATABASE_URL is not set: using ephemeral SQLite. All users/tasks are LOST on every "
              "redeploy/restart. Create a Render Postgres and set DATABASE_URL on this service.")

app = FastAPI(title="TaskFlow AI API", version="1.0.0")
app.state.limiter = limiter


async def _rate_limited(request: Request, exc: RateLimitExceeded):
    return JSONResponse({"detail": "Too many requests, slow down."}, status_code=429,
                        headers={"Retry-After": "60"})


app.add_exception_handler(RateLimitExceeded, _rate_limited)
app.add_middleware(SlowAPIMiddleware)
app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins_list, allow_credentials=True,
                   allow_methods=["*"], allow_headers=["*"], expose_headers=["X-Total-Count", "Content-Disposition"])


@app.exception_handler(RequestValidationError)
async def _validation(request: Request, exc: RequestValidationError):
    errs = exc.errors()
    parts = []
    for e in errs:
        loc = ".".join(str(x) for x in e.get("loc", []) if x not in ("body", "query", "path"))
        msg = str(e.get("msg", "invalid")).replace("Value error, ", "")
        parts.append(f"{loc}: {msg}" if loc else msg)
    safe = [{"loc": list(e.get("loc", [])), "msg": str(e.get("msg", "")), "type": e.get("type")} for e in errs]
    return JSONResponse({"detail": "; ".join(parts) or "Validation error", "errors": safe}, status_code=422)


@app.exception_handler(StarletteHTTPException)
async def _http(request: Request, exc: StarletteHTTPException):
    return JSONResponse({"detail": exc.detail}, status_code=exc.status_code, headers=getattr(exc, "headers", None))


@app.exception_handler(Exception)
async def _unhandled(request: Request, exc: Exception):
    log.exception("Unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse({"detail": "Internal server error"}, status_code=500)


@app.get("/favicon.ico", include_in_schema=False)
def favicon():
    return Response(status_code=204)


@app.get("/health")
def health():
    ok = True
    try:
        with SessionLocal() as db:
            db.execute(text("SELECT 1"))
    except Exception:
        log.exception("health db check failed")
        ok = False
    return JSONResponse({"status": "ok" if ok else "degraded", "db": ok}, status_code=200 if ok else 503)


for _name in ("auth", "tasks", "projects", "settings"):
    app.include_router(importlib.import_module(f"app.routers.{_name}").router)

for _name in ("dashboard", "notifications", "reports", "analytics", "ai", "calendar", "ws"):
    try:
        _mod = importlib.import_module(f"app.routers.{_name}")
        app.include_router(_mod.router)
    except ModuleNotFoundError as e:
        if e.name != f"app.routers.{_name}":
            log.exception("router %s failed to import", _name)
        else:
            log.warning("router %s not present, skipped", _name)
    except Exception:
        log.exception("router %s failed to load, skipped", _name)


# Serve the built frontend (if present) from the same service; API stays under /api.
_static = Path(os.environ.get("STATIC_DIR", Path(__file__).resolve().parent.parent / "static"))
if (_static / "index.html").is_file():
    _index = _static / "index.html"

    @app.get("/{full_path:path}", include_in_schema=False)
    def spa(full_path: str):
        if full_path.startswith("api/"):
            return JSONResponse({"detail": "Not Found"}, status_code=404)
        f = (_static / full_path).resolve()
        if full_path and f.is_file() and _static.resolve() in f.parents:
            return FileResponse(f)
        return FileResponse(_index)
else:
    @app.get("/", include_in_schema=False)
    def root():
        return {"name": "TaskFlow AI API", "docs": "/docs", "health": "/health"}
