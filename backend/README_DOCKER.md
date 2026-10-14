# Docker Setup for Backend

## Quick Start

### Prerequisites
- Docker installed
- Environment variables set (see `.env` file)

### Build and Run Locally

```bash
# Build the image
docker build -t cerina-backend:latest .

# Run with docker-compose (recommended)
cd ..
docker-compose up -d

# Or run directly
docker run -p 8000:8000 \
  -e OPENAI_API_KEY=your_key \
  -e DATABASE_URL=sqlite:///./data/cerina_foundry.db \
  -v $(pwd)/data:/app/data \
  cerina-backend:latest
```

### Using Docker Compose

From the project root:

```bash
docker-compose up -d          # Start in background
docker-compose logs -f        # View logs
docker-compose down           # Stop
docker-compose restart        # Restart
```

### Environment Variables

Create a `.env` file in the `backend/` directory:

```env
OPENAI_API_KEY=your_api_key
OPENAI_BASE_URL=https://api.chatanywhere.tech/v1
DATABASE_URL=sqlite:///./data/cerina_foundry.db
BACKEND_URL=http://localhost:8000
```

### Database Persistence

The SQLite database is stored in `backend/data/` directory, which is mounted as a volume. This ensures data persists across container restarts.

### Testing

```bash
# Health check
curl http://localhost:8000/health

# Create a protocol
curl -X POST http://localhost:8000/api/protocols/create \
  -H "Content-Type: application/json" \
  -d '{"intent": "Create a sleep hygiene protocol"}'
```

### Troubleshooting

```bash
# View logs
docker logs cerina-backend

# Check container status
docker ps

# Access container shell
docker exec -it cerina-backend /bin/bash
```

