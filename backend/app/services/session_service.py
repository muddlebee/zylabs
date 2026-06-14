import json
import uuid
from datetime import datetime

from sqlalchemy.orm import Session

from app.db import SessionModel, ReportModel


def create_session(db: Session, company_name: str, company_url: str, objective: str) -> SessionModel:
    session = SessionModel(
        id=str(uuid.uuid4()),
        company_name=company_name,
        company_url=company_url,
        objective=objective,
        status="created",
        created_at=datetime.utcnow(),
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


def get_session(db: Session, session_id: str) -> SessionModel | None:
    return db.query(SessionModel).filter(SessionModel.id == session_id).first()


def list_sessions(db: Session) -> list[SessionModel]:
    return db.query(SessionModel).order_by(SessionModel.created_at.desc()).all()


def update_session_status(db: Session, session_id: str, status: str) -> None:
    db.query(SessionModel).filter(SessionModel.id == session_id).update({"status": status})
    db.commit()


def save_report(db: Session, session_id: str, report_dict: dict) -> ReportModel:
    existing = db.query(ReportModel).filter(ReportModel.session_id == session_id).first()
    if existing:
        existing.report_json = json.dumps(report_dict)
        db.commit()
        db.refresh(existing)
        return existing
    report = ReportModel(
        session_id=session_id,
        report_json=json.dumps(report_dict),
        created_at=datetime.utcnow(),
    )
    db.add(report)
    db.commit()
    db.refresh(report)
    return report


def get_report(db: Session, session_id: str) -> dict | None:
    row = db.query(ReportModel).filter(ReportModel.session_id == session_id).first()
    if row:
        return json.loads(row.report_json)
    return None
