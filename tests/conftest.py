import os
import sys
import pytest

# Ensure backend directory is in sys.path
backend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "backend"))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

import database

@pytest.fixture(autouse=True)
def temporary_database(tmp_path, monkeypatch):
    """Ensure all tests run in an isolated temporary SQLite database, leaving dev DB untouched."""
    db_file = tmp_path / "test_isolated.db"
    db_url = f"sqlite:///{db_file}"
    monkeypatch.setenv("DATABASE_URL", db_url)
    
    # Dispose of existing engine if any and re-initialize with temporary database
    if database.engine:
        database.engine.dispose()
    database.engine = None
    database.SessionLocal = None
    database.init_db()
    
    yield
    
    # Teardown: dispose test engine and reset database globals
    if database.engine:
        database.engine.dispose()
    database.engine = None
    database.SessionLocal = None
