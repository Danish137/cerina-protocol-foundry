# Deployment Guide

This guide covers deploying the Cerina Protocol Foundry backend to AWS EC2 using Docker.

## Architecture

- **Frontend**: Deployed on Vercel
- **Backend**: Deployed on AWS EC2 with Docker
- **Database**: SQLite (persisted on EBS volume)

## Prerequisites

- AWS Account
- EC2 instance (t3.small or larger recommended)
- Docker installed on EC2
- Domain name (optional, for custom domain)

## Step 1: Prepare Docker Image

### Option A: Build Locally and Push to Docker Hub

```bash
# Build the image
cd backend
docker build -t your-dockerhub-username/cerina-backend:latest .

# Test locally
docker run -p 8000:8000 \
  -e OPENAI_API_KEY=your_key \
  -e DATABASE_URL=sqlite:///./data/cerina_foundry.db \
  -v $(pwd)/data:/app/data \
  your-dockerhub-username/cerina-backend:latest

# Push to Docker Hub
docker push your-dockerhub-username/cerina-backend:latest
```

### Option B: Build on EC2

Build directly on your EC2 instance (see Step 3).

## Step 2: Set Up EC2 Instance

1. **Launch EC2 Instance**
   - AMI: Amazon Linux 2023 or Ubuntu 22.04 LTS
   - Instance Type: t3.small (2 vCPU, 2GB RAM) minimum
   - Storage: 20GB EBS volume (for SQLite database)
   - Security Group: Allow inbound on port 8000 (or 443 if using HTTPS)

2. **Connect to EC2**
   ```bash
   ssh -i your-key.pem ec2-user@your-ec2-ip
   ```

3. **Install Docker**
   ```bash
   # Amazon Linux 2023
   sudo yum update -y
   sudo yum install docker -y
   sudo systemctl start docker
   sudo systemctl enable docker
   sudo usermod -a -G docker ec2-user
   
   # Ubuntu
   sudo apt-get update
   sudo apt-get install docker.io -y
   sudo systemctl start docker
   sudo systemctl enable docker
   sudo usermod -aG docker ubuntu
   ```

   Log out and log back in for group changes to take effect.

## Step 3: Deploy Backend

### Create Deployment Directory

```bash
# On EC2
mkdir -p ~/cerina-backend/data
cd ~/cerina-backend
```

### Option A: Pull from Docker Hub

```bash
docker pull your-dockerhub-username/cerina-backend:latest
```

### Option B: Build on EC2

```bash
# Clone your repository
git clone https://github.com/yourusername/cerina-protocol-foundry.git
cd cerina-protocol-foundry/backend

# Build image
docker build -t cerina-backend:latest .
```

### Create Environment File

```bash
# Create .env file
cat > ~/cerina-backend/.env << EOF
OPENAI_API_KEY=your_api_key_here
OPENAI_BASE_URL=https://api.chatanywhere.tech/v1
DATABASE_URL=sqlite:///./data/cerina_foundry.db
BACKEND_URL=http://your-ec2-ip:8000
EOF
```

### Run Container

```bash
docker run -d \
  --name cerina-backend \
  --restart unless-stopped \
  -p 8000:8000 \
  -v ~/cerina-backend/data:/app/data \
  --env-file ~/cerina-backend/.env \
  cerina-backend:latest
```

Or if using Docker Hub image:

```bash
docker run -d \
  --name cerina-backend \
  --restart unless-stopped \
  -p 8000:8000 \
  -v ~/cerina-backend/data:/app/data \
  --env-file ~/cerina-backend/.env \
  your-dockerhub-username/cerina-backend:latest
```

## Step 4: Verify Deployment

```bash
# Check container status
docker ps

# Check logs
docker logs cerina-backend

# Test health endpoint
curl http://localhost:8000/health
```

## Step 5: Set Up Reverse Proxy (Optional but Recommended)

For production, use Nginx as a reverse proxy with SSL:

### Install Nginx

```bash
# Amazon Linux
sudo yum install nginx -y

# Ubuntu
sudo apt-get install nginx -y
```

### Configure Nginx

```bash
sudo nano /etc/nginx/conf.d/cerina.conf
```

Add:

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

### Set Up SSL with Let's Encrypt

```bash
# Install Certbot
sudo yum install certbot python3-certbot-nginx -y  # Amazon Linux
# or
sudo apt-get install certbot python3-certbot-nginx -y  # Ubuntu

# Get certificate
sudo certbot --nginx -d your-domain.com
```

## Step 6: Update Frontend Configuration

Update your Vercel frontend to point to your EC2 backend:

1. Update `frontend/vite.config.ts` proxy target (for local dev)
2. Set environment variable in Vercel: `VITE_API_URL=https://your-domain.com`
3. Update CORS in `backend/main.py` to include your Vercel domain

## Step 7: Backup Strategy

### Manual Backup

```bash
# Backup SQLite database
docker exec cerina-backend cp /app/data/cerina_foundry.db /app/data/backup_$(date +%Y%m%d).db

# Copy from container to EC2
docker cp cerina-backend:/app/data/cerina_foundry.db ~/backups/
```

### Automated Backup Script

Create `~/cerina-backend/backup.sh`:

```bash
#!/bin/bash
BACKUP_DIR=~/backups
mkdir -p $BACKUP_DIR
docker exec cerina-backend cp /app/data/cerina_foundry.db /app/data/backup_$(date +%Y%m%d_%H%M%S).db
docker cp cerina-backend:/app/data/backup_*.db $BACKUP_DIR/
# Keep only last 7 days
find $BACKUP_DIR -name "backup_*.db" -mtime +7 -delete
```

Add to crontab:

```bash
crontab -e
# Add: 0 2 * * * ~/cerina-backend/backup.sh
```

## Troubleshooting

### Container Won't Start

```bash
# Check logs
docker logs cerina-backend

# Check if port is in use
sudo netstat -tulpn | grep 8000

# Restart container
docker restart cerina-backend
```

### Database Issues

```bash
# Check database file permissions
ls -la ~/cerina-backend/data/

# Fix permissions if needed
sudo chown -R 1000:1000 ~/cerina-backend/data
```

### Update Application

```bash
# Pull latest image
docker pull your-dockerhub-username/cerina-backend:latest

# Stop and remove old container
docker stop cerina-backend
docker rm cerina-backend

# Run new container (same command as before)
docker run -d \
  --name cerina-backend \
  --restart unless-stopped \
  -p 8000:8000 \
  -v ~/cerina-backend/data:/app/data \
  --env-file ~/cerina-backend/.env \
  your-dockerhub-username/cerina-backend:latest
```

## Monitoring

### View Logs

```bash
# Real-time logs
docker logs -f cerina-backend

# Last 100 lines
docker logs --tail 100 cerina-backend
```

### Resource Usage

```bash
# Container stats
docker stats cerina-backend

# Disk usage
df -h
du -sh ~/cerina-backend/data/
```

## Cost Estimate

- **EC2 t3.small**: ~$15/month
- **EBS 20GB**: ~$2/month
- **Data Transfer**: Variable (first 100GB free)
- **Total**: ~$17-20/month

## Security Best Practices

1. Use security groups to restrict access
2. Set up SSL/TLS with Let's Encrypt
3. Keep Docker and system updated
4. Use strong environment variables
5. Regular backups
6. Monitor logs for suspicious activity

