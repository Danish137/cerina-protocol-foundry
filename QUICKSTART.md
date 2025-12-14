# Quick Start Guide

Get the Cerina Protocol Foundry running in 5 minutes!

## Prerequisites Check

- [ ] Python 3.10+ installed
- [ ] Node.js 18+ installed
- [ ] Groq API key (FREE - Get from https://console.groq.com)

## Step 1: Backend Setup (2 minutes)

```bash
cd backend
python -m venv venv

# Windows
venv\Scripts\activate

# macOS/Linux
source venv/bin/activate

pip install -r requirements.txt

# rename the .envexample to .env

# Start server
uvicorn main:app --reload
```

Backend should be running on `http://localhost:8000`

## Step 2: Frontend Setup (2 minutes)

```bash
cd frontend
npm install
npm run dev
```

Frontend should be running on `http://localhost:3000`

## Step 3: Test It! (1 minute)

1. Open `http://localhost:3000` in your browser
2. Enter an intent: "Create an exposure hierarchy for agoraphobia"
3. Click "Create Protocol"
4. Watch the agents work in real-time!
5. When workflow halts, review and approve the draft

## MCP Server Setup

```bash
cd mcp_server
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt

# Set backend URL
export BACKEND_URL=http://localhost:8000

```

## Troubleshooting


**Frontend won't connect?**
- Ensure backend is running first
- Check browser console for errors
- Verify CORS settings

**Agents not working?**
- Check API key or proxy is valid 
- Verify database file is writable
- Check backend logs for errors

## Next Steps

- Read `docs/ARCHITECTURE.md` for system design
- Read `docs/USAGE.md` for detailed usage
- Read `docs/SETUP.md` for advanced configuration

