from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import get_current_user
from ..models import User
from ..services import ai as svc

router = APIRouter(prefix="/api/ai", tags=["ai"])


class ChatIn(BaseModel):
    message: str = Field(min_length=1, max_length=2000)


@router.get("/status")
def status():
    return {"enabled": svc.ai_enabled(), "provider": "anthropic" if svc.ai_enabled() else "rules"}


@router.post("/chat")
def chat(body: ChatIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return svc.chat(db, user, body.message.strip())


@router.get("/insights")
def insights(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return svc.insights(db, user)
