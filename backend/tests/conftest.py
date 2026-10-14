import os
import sys

# Ensure test DB is isolated from live running server
os.environ["DATABASE_URL"] = "sqlite:///./test_foundry.db"
os.environ["IS_TESTING"] = "1"

# Ensure backend root is in sys.path
backend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)
