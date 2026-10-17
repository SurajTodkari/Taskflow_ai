import importlib
import logging
import os
from contextlib import asynccontextmanager
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



def _load_or_create_secret() -> str:
    """Zero-config fallback: keep a random signing key in the database so it survives restarts."""
    import secrets as _secrets
    from sqlalchemy import text as _text
    from .db import engine
    with engine.begin() as con:
        con.execute(_text("CREATE TABLE IF NOT EXISTS app_secrets (name VARCHAR(64) PRIMARY KEY, value TEXT NOT NULL)"))
    for _ in range(2):
        with engine.begin() as con:
            row = con.execute(_text("SELECT value FROM app_secrets WHERE name='secret_key'")).first()
            if row:
                return row[0]
            try:
                con.execute(_text("INSERT INTO app_secrets (name, value) VALUES ('secret_key', :v)"),
                            {"v": _secrets.token_urlsafe(48)})
            except Exception:  # concurrent start inserted first; re-read
                pass
    raise RuntimeError("could not create SECRET_KEY")


if os.environ.get("RENDER") and settings.SECRET_KEY.startswith("dev-secret"):
    settings.SECRET_KEY = _load_or_create_secret()
    logging.getLogger("taskflow").warning(
        "SECRET_KEY env var not set: using a random key stored in the database. Set SECRET_KEY to manage it yourself.")
if os.environ.get("RENDER") and settings.DATABASE_URL.startswith("sqlite"):
    log.error("DATABASE_URL is not set: using ephemeral SQLite. All users/tasks are LOST on every "
              "redeploy/restart. Create a Render Postgres and set DATABASE_URL on this service.")

def _worker_enabled() -> bool:
    # default: on only when running on Render (free plan has no cron service); never in tests
    default = "1" if os.environ.get("RENDER") else "0"
    return os.environ.get("RUN_WORKER_IN_PROCESS", default).strip().lower() in ("1", "true", "yes", "on")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    stop = None
    if _worker_enabled():
        from .worker import start_background
        stop = start_background(interval=60)
        log.info("in-process worker started (every 60s)")
    try:
        yield
    finally:
        if stop is not None:
            stop.set()


app = FastAPI(title="TaskFlow AI API", version="1.0.0", lifespan=lifespan)
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

for _name in ("dashboard", "notifications", "reports", "analytics", "ai", "calendar", "ws", "jira"):
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

    @app.api_route("/{full_path:path}", methods=["GET", "HEAD"], include_in_schema=False)
    def spa(full_path: str):
        if full_path.startswith("api/"):
            return JSONResponse({"detail": "Not Found"}, status_code=404)
        f = (_static / full_path).resolve()
        if full_path and f.is_file() and _static.resolve() in f.parents:
            # hashed assets are immutable; sw.js and other root files must always revalidate
            cache = "public, max-age=31536000, immutable" if full_path.startswith("assets/") else "no-cache"
            return FileResponse(f, headers={"Cache-Control": cache})
        return FileResponse(_index, headers={"Cache-Control": "no-cache"})
else:
    @app.api_route("/", methods=["GET", "HEAD"], include_in_schema=False)
    def root():
        return {"name": "TaskFlow AI API", "docs": "/docs", "health": "/health"}
