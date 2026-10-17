from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import get_current_user, get_prefs, user_today
from ..models import DailyReport, User
from ..services import reports as svc

router = APIRouter(prefix="/api/reports", tags=["reports"])


def _day(db, user, d):
    return d or user_today(get_prefs(db, user))


@router.get("")
def list_reports(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = db.query(DailyReport.report_date).filter_by(user_id=user.id).order_by(DailyReport.report_date.desc()).limit(365).all()
    return [r[0].isoformat() for r in rows]


@router.get("/daily")
def daily(date_: date | None = Query(None, alias="date"), user: User = Depends(get_current_user),
          db: Session = Depends(get_db)):
    return svc.get_report(db, user, _day(db, user, date_))


@router.get("/daily/export")
def export(date_: date | None = Query(None, alias="date"), format: str = "pdf",
           user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if format not in ("pdf", "csv"):
        raise HTTPException(422, "format must be pdf or csv")
    d = _day(db, user, date_)
    r = svc.get_report(db, user, d)
    name = f"daily-report-{d.isoformat()}.{format}"
    hdr = {"Content-Disposition": f'attachment; filename="{name}"'}
    if format == "csv":
        return Response(svc.report_csv(r), media_type="text/csv", headers=hdr)
    return Response(svc.report_pdf(r), media_type="application/pdf", headers=hdr)
