from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import get_current_user, get_prefs, get_tz, user_today
from ..models import User
from ..services.analytics import build_analytics

router = APIRouter(prefix="/api/analytics", tags=["analytics"])


@router.get("")
def analytics(range: int = 7, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if range not in (7, 30, 90):
        raise HTTPException(422, "range must be 7, 30 or 90")
    prefs = get_prefs(db, user)
    return build_analytics(db, user.id, user_today(prefs), get_tz(prefs), range)
