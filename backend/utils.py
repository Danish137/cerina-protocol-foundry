"""
Utility functions for error handling and logging
"""

import logging
from datetime import datetime
from typing import Any, Dict
from database import get_db_session, AgentActivity

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

def log_agent_activity(
    session_id: str,
    agent_name: str,
    action: str,
    reasoning: str = None,
    state_snapshot: Dict[str, Any] = None
):
    """Log agent activity to database"""
    try:
        db = get_db_session()
        activity = AgentActivity(
            session_id=session_id,
            agent_name=agent_name,
            action=action,
            reasoning=reasoning,
            timestamp=datetime.now(),
            state_snapshot=state_snapshot
        )
        db.add(activity)
        db.commit()
        db.close()
    except Exception as e:
        logger.error(f"Failed to log agent activity: {e}")

def safe_get_state_value(state: Dict[str, Any], key: str, default: Any = None):
    """Safely get value from state dictionary"""
    try:
        return state.get(key, default)
    except (AttributeError, TypeError):
        return default

def format_error_message(error: Exception) -> str:
    """Format error message for API responses"""
    error_type = type(error).__name__
    error_msg = str(error)
    return f"{error_type}: {error_msg}"

