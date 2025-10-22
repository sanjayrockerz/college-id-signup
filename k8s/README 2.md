# Kubernetes Deployment Manifests

This directory contains Kubernetes manifests for deploying the chat backend with proper WebSocket support, health checks, and graceful shutdown.

## Files

- **deployment.yaml**: Main application deployment with health probes and lifecycle hooks
- **service.yaml**: ClusterIP service exposing port 3001
- **ingress-nginx.yaml**: NGINX Ingress Controller configuration
- **ingress-alb.yaml**: AWS ALB Ingress configuration
- **configmap.yaml**: Application configuration
- **hpa.yaml**: Horizontal Pod Autoscaler
- **pdb.yaml**: Pod Disruption Budget for high availability

## Quick Deploy

### Development/Staging

```bash
# Create namespace
kubectl create namespace chat-backend-dev

# Apply all manifests
kubectl apply -f k8s/ -n chat-backend-dev

# Verify deployment
kubectl get pods,svc,ingress -n chat-backend-dev
kubectl logs -f deployment/chat-backend -n chat-backend-dev
```

### Production

```bash
# Create namespace
kubectl create namespace chat-backend-prod

# Update environment-specific values in configmap.yaml
# - DATABASE_URL
# - REDIS_URL
# - FRONTEND_URL
# - JWT_SECRET

# Apply manifests
kubectl apply -f k8s/configmap.yaml -n chat-backend-prod
kubectl apply -f k8s/deployment.yaml -n chat-backend-prod
kubectl apply -f k8s/service.yaml -n chat-backend-prod
kubectl apply -f k8s/pdb.yaml -n chat-backend-prod
kubectl apply -f k8s/hpa.yaml -n chat-backend-prod

# Choose ingress (nginx or alb)
kubectl apply -f k8s/ingress-nginx.yaml -n chat-backend-prod
# OR
kubectl apply -f k8s/ingress-alb.yaml -n chat-backend-prod

# Verify
kubectl get all -n chat-backend-prod
kubectl rollout status deployment/chat-backend -n chat-backend-prod
```

## Testing Graceful Shutdown

```bash
# Connect multiple clients
for i in {1..20}; do
  wscat -c "wss://your-domain.com/socket.io/?EIO=4&transport=websocket" &
done

# Trigger rolling update
kubectl rollout restart deployment/chat-backend -n chat-backend-prod

# Monitor disconnections (should be minimal)
kubectl logs -f deployment/chat-backend -n chat-backend-prod | grep disconnect
```

## Scaling

```bash
# Manual scaling
kubectl scale deployment/chat-backend --replicas=5 -n chat-backend-prod

# Check HPA status
kubectl get hpa -n chat-backend-prod
kubectl describe hpa chat-backend -n chat-backend-prod
```

## Troubleshooting

```bash
# Check pod status
kubectl get pods -l app=chat-backend -n chat-backend-prod

# View logs
kubectl logs -l app=chat-backend -n chat-backend-prod --tail=100

# Exec into pod
kubectl exec -it deployment/chat-backend -n chat-backend-prod -- /bin/sh

# Check health endpoints
kubectl exec -it deployment/chat-backend -n chat-backend-prod -- \
  curl http://localhost:3001/health

# View events
kubectl get events -n chat-backend-prod --sort-by='.lastTimestamp'
```

## Configuration Updates

```bash
# Update ConfigMap
kubectl edit configmap chat-backend-config -n chat-backend-prod

# Restart deployment to pick up changes
kubectl rollout restart deployment/chat-backend -n chat-backend-prod
```

## Monitoring

```bash
# Watch pod metrics
kubectl top pods -l app=chat-backend -n chat-backend-prod

# View resource usage
kubectl describe deployment chat-backend -n chat-backend-prod
```
