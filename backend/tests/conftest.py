import os
import tempfile

os.environ["DATABASE_URL"] = os.environ.get("TEST_DATABASE_URL", "sqlite://")
os.environ["RATE_LIMIT_ENABLED"] = "false"
os.environ["SECRET_KEY"] = "test-secret-key-test-secret-key-1234"
os.environ["UPLOAD_DIR"] = tempfile.mkdtemp(prefix="tf-uploads-")

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.db import Base, engine  # noqa: E402
from app.main import app  # noqa: E402


@pytest.fixture(autouse=True)
def _db():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    yield
    Base.metadata.drop_all(engine)


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


def register(client, email="a@example.com", password="password123", name="Alice", timezone="UTC"):
    r = client.post("/api/auth/register", json={"email": email, "password": password, "name": name,
                                                "timezone": timezone})
    assert r.status_code == 201, r.text
    return r.json()


@pytest.fixture
def auth_headers(client):
    tok = register(client)
    return {"Authorization": f"Bearer {tok['access_token']}"}


@pytest.fixture
def make_headers(client):
    def _make(email):
        tok = register(client, email=email)
        return {"Authorization": f"Bearer {tok['access_token']}"}
    return _make
