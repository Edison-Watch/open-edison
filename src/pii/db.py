from datetime import UTC, datetime

from sqlalchemy import Column, Integer, String, create_engine, event, select
from sqlalchemy.orm import Session, declarative_base

from src.config import get_config_dir

Base = declarative_base()


class TokenModel(Base):  # type: ignore[misc]
    __tablename__ = "pii_tokens"
    id = Column(Integer, primary_key=True)  # type: ignore[assignment]
    token = Column(String, nullable=False)  # type: ignore[assignment]
    session_id = Column(String, nullable=False)  # type: ignore[assignment]
    value_plaintext = Column(String, nullable=False)  # type: ignore[assignment]
    categories = Column(String, nullable=False)  # type: ignore[assignment]
    source_kind = Column(String, nullable=False)  # type: ignore[assignment]
    source_name = Column(String, nullable=False)  # type: ignore[assignment]
    created_at = Column(String, nullable=False)  # type: ignore[assignment]
    last_used_at = Column(String, nullable=True)  # type: ignore[assignment]


def _set_sqlite_pragmas(dbapi_connection, _connection_record):  # type: ignore[no-untyped-def]
    cur = dbapi_connection.cursor()  # type: ignore[attr-defined]
    try:
        cur.execute("PRAGMA journal_mode=DELETE")  # type: ignore[attr-defined]
        cur.execute("PRAGMA synchronous=FULL")  # type: ignore[attr-defined]
    finally:
        cur.close()  # type: ignore[attr-defined]


def _engine():
    cfg_dir = get_config_dir()
    db_path = cfg_dir / "sessions.db"
    engine = create_engine(f"sqlite:///{db_path}")
    event.listen(engine, "connect", _set_sqlite_pragmas)  # type: ignore[arg-type]

    Base.metadata.create_all(engine)  # type: ignore[misc]
    return engine


def store_token_db(
    *,
    token: str,
    session_id: str,
    value_plaintext: str,
    categories: list[str],
    source_kind: str,
    source_name: str,
) -> None:
    with Session(_engine()) as s:
        now = datetime.now(UTC).isoformat()
        row = TokenModel(
            token=token,
            session_id=session_id,
            value_plaintext=value_plaintext,
            categories=",".join(categories),
            source_kind=source_kind,
            source_name=source_name,
            created_at=now,
            last_used_at=now,
        )
        s.add(row)
        s.commit()


def lookup_token_db(token: str, session_id: str) -> str | None:
    with Session(_engine()) as s:
        row: TokenModel | None = s.execute(
            select(TokenModel).where(TokenModel.token == token, TokenModel.session_id == session_id)
        ).scalar_one_or_none()
        if row is None:
            return None
        row.last_used_at = datetime.now(UTC).isoformat()  # pyright: ignore[reportAttributeAccessIssue]
        s.commit()
        return row.value_plaintext  # pyright: ignore[reportReturnType]
