#!/bin/bash
# Quick backend health check script for EC2

echo "=== Backend Health Check ==="
echo ""

echo "1. Checking if Docker container is running..."
docker ps | grep -E "cerina|backend|8000" || echo "   ❌ No backend container found"

echo ""
echo "2. Checking if port 8000 is listening..."
sudo netstat -tlnp | grep 8000 || sudo ss -tlnp | grep 8000 || echo "   ❌ Port 8000 not listening"

echo ""
echo "3. Testing localhost health endpoint..."
curl -s http://localhost:8000/health && echo "" || echo "   ❌ Backend not responding on localhost"

echo ""
echo "4. Testing public IP health endpoint..."
PUBLIC_IP=$(curl -s http://169.254.169.254/latest/meta-data/public-ipv4 2>/dev/null || echo "54.147.175.216")
echo "   Testing http://${PUBLIC_IP}:8000/health"
curl -s --max-time 5 http://${PUBLIC_IP}:8000/health && echo "" || echo "   ❌ Backend not accessible from public IP"

echo ""
echo "5. Checking Docker logs (last 10 lines)..."
docker logs --tail 10 $(docker ps -q --filter "publish=8000" | head -1) 2>/dev/null || echo "   ⚠️  Could not fetch logs"

echo ""
echo "=== Check Complete ==="


