import os
import sys
import pytest
from httpx import AsyncClient, ASGITransport

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from main import app
from database import init_db

@pytest.fixture(autouse=True)
def setup_test_db():
    init_db()

@pytest.mark.asyncio
async def test_outage_hook_ignored_by_default():
    """
    Security A2 Test:
    Proves that X-Test-Outage-Provider header is strictly ignored when TEST_ALLOW_OUTAGE_SIMULATION
    is not set to 'true'.
    """
    # Ensure flag is unset / off
    os.environ.pop("TEST_ALLOW_OUTAGE_SIMULATION", None)
    os.environ.pop("SIMULATE_OUTAGE_PROVIDER", None)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        # Send create request with outage header
        resp = await client.post(
            "/api/protocols/create",
            json={"intent": "Thought challenging exercise for general testing"},
            headers={"x-test-outage-provider": "groq"}
        )
        assert resp.status_code == 200

        # Verify SIMULATE_OUTAGE_PROVIDER was NOT set in the environment
        assert "SIMULATE_OUTAGE_PROVIDER" not in os.environ, \
            "SECURITY VIOLATION: SIMULATE_OUTAGE_PROVIDER was set despite TEST_ALLOW_OUTAGE_SIMULATION being unset!"

@pytest.mark.asyncio
async def test_outage_hook_honored_only_when_explicitly_enabled():
    """
    Security A2 Test:
    Proves that X-Test-Outage-Provider header is ONLY honored when TEST_ALLOW_OUTAGE_SIMULATION is 'true'.
    """
    os.environ["TEST_ALLOW_OUTAGE_SIMULATION"] = "true"
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
            resp = await client.post(
                "/api/protocols/create",
                json={"intent": "Thought challenging exercise for general testing"},
                headers={"x-test-outage-provider": "groq"}
            )
            assert resp.status_code == 200
            assert os.environ.get("SIMULATE_OUTAGE_PROVIDER") == "groq"
    finally:
        os.environ.pop("TEST_ALLOW_OUTAGE_SIMULATION", None)
        os.environ.pop("SIMULATE_OUTAGE_PROVIDER", None)
