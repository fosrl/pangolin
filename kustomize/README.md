# Kubernetes Deployment with Kustomize

This directory contains Kubernetes manifests for deploying Pangolin using kustomize.

## Architecture

The deployment consists of:

1. **Pangolin Server** - Main application server
   - Image: `fosrl/pangolin:latest`
   - Port: 3001 (API)
   - Requires config volume for configuration and database

2. **Gerbil + Traefik (Sidecar)** - VPN tunnel and reverse proxy
   - Gerbil Image: `fosrl/gerbil:latest`
   - Traefik Image: `traefik:v3.6`
   - Runs as a single pod with both containers (sidecar pattern)
   - Gerbil requires NET_ADMIN and SYS_MODULE capabilities
   - Traefik handles HTTP/HTTPS routing (ports 80, 443)
   - Gerbil handles WireGuard VPN (ports 51820, 21820 UDP)

## Prerequisites

- Kubernetes cluster (1.24+)
- `kubectl` configured to access your cluster
- Persistent volume provisioner (for config storage)
- LoadBalancer support (for external access) or NodePort/Ingress

## Quick Start

1. **Prepare Configuration**

   Before deploying, you need to create a configuration file. Copy the example config:

   ```bash
   kubectl create namespace pangolin --dry-run=client -o yaml | kubectl apply -f -
   ```

   Create a config.yml based on `config/config.example.yml` and create a ConfigMap or mount it via PVC.

2. **Deploy with Kustomize**

   ```bash
   kubectl apply -k kustomize/base
   ```

3. **Verify Deployment**

   ```bash
   kubectl get all -n pangolin
   kubectl logs -n pangolin -l app.kubernetes.io/name=pangolin
   ```

## Configuration

### Persistent Storage

The deployment uses a single PVC (`pangolin-config-pvc`) that stores:
- Pangolin configuration (`/app/config`)
- Gerbil keys (`/var/config`)
- Traefik configuration (`/etc/traefik`)
- Let's Encrypt certificates (`/letsencrypt`)

By default, it requests 1GB of storage. Adjust as needed in your kustomize overlay.

### Traefik Configuration

You'll need to create a Traefik configuration file. Example structure:

```
config/
├── config.yml         # Pangolin configuration
├── traefik/
│   ├── traefik_config.yml
│   └── ... (other traefik configs)
├── db/               # Database files (if using SQLite)
└── letsencrypt/      # Let's Encrypt certificates
```

### Environment Variables

You can customize the deployment by creating overlays. Create a `kustomization.yaml` in `overlays/production/`:

```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization

resources:
- ../../base

namespace: pangolin-production

images:
- name: fosrl/pangolin
  newTag: v1.0.0
- name: fosrl/gerbil
  newTag: v1.0.0

configMapGenerator:
- name: pangolin-config
  files:
  - config.yml=path/to/your/config.yml

patchesStrategicMerge:
- patches/pvc-size.yaml
```

## Accessing the Service

The deployment exposes:
- **LoadBalancer Service** (gerbil): External access for HTTP/HTTPS and WireGuard
  - Port 80: HTTP
  - Port 443: HTTPS
  - Port 51820: WireGuard UDP
  - Port 21820: WireGuard UDP (alternative)

- **ClusterIP Service** (pangolin): Internal API access
  - Port 3001: API endpoint

### Option 1: LoadBalancer (Default)

If your cluster supports LoadBalancer services (e.g., cloud provider, MetalLB):

```bash
kubectl get svc gerbil -n pangolin
```

Use the external IP to access Pangolin.

### Option 2: NodePort

Create an overlay to change the service type:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: gerbil
  namespace: pangolin
spec:
  type: NodePort
```

### Option 3: Ingress

Create an Ingress resource to expose the service through an Ingress Controller:

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: pangolin
  namespace: pangolin
spec:
  ingressClassName: nginx  # or your ingress class
  rules:
  - host: pangolin.yourdomain.com
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: gerbil
            port:
              number: 80
```

## Resource Requirements

Default resource requests and limits:

| Container | CPU Request | CPU Limit | Memory Request | Memory Limit |
|-----------|-------------|-----------|----------------|--------------|
| Pangolin  | 100m        | 1000m     | 256Mi          | 1Gi          |
| Gerbil    | 100m        | 500m      | 128Mi          | 512Mi        |
| Traefik   | 100m        | 500m      | 128Mi          | 512Mi        |

Adjust these in your production overlay based on your needs.

## Security Considerations

1. **Capabilities**: Gerbil requires `NET_ADMIN` and `SYS_MODULE` capabilities for WireGuard tunneling
2. **RBAC**: Consider implementing proper RBAC rules for production
3. **Network Policies**: Restrict network access as needed
4. **TLS/SSL**: Traefik handles TLS termination. Configure certificates appropriately
5. **Secrets**: Store sensitive data (database passwords, API keys) in Kubernetes Secrets

## Production Recommendations

For production deployments:

1. **Separate Configurations**: Use separate PVCs for different components instead of one shared PVC
2. **Database**: Use an external managed database (PostgreSQL) instead of SQLite
3. **High Availability**: Run multiple replicas with proper affinity/anti-affinity rules
4. **Monitoring**: Add Prometheus ServiceMonitor and appropriate metrics
5. **Backup**: Implement backup strategies for your PVCs and configuration
6. **GitOps**: Use GitOps tools (ArgoCD, Flux) for deployment management

## Troubleshooting

### Check Pod Status

```bash
kubectl get pods -n pangolin
kubectl describe pod <pod-name> -n pangolin
```

### View Logs

```bash
# Pangolin logs
kubectl logs -n pangolin -l app.kubernetes.io/component=server -c pangolin

# Gerbil logs
kubectl logs -n pangolin -l app.kubernetes.io/component=tunnel -c gerbil

# Traefik logs
kubectl logs -n pangolin -l app.kubernetes.io/component=tunnel -c traefik
```

### Common Issues

1. **PVC not binding**: Check your storage class and PVC configuration
2. **Gerbil container failing**: Ensure NET_ADMIN capability is available in your cluster
3. **Traefik not routing**: Verify Traefik configuration and certificate setup
4. **Pangolin not starting**: Check database connection and configuration file

## Customization Examples

### Change Image Tags

Create `overlays/production/kustomization.yaml`:

```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization

resources:
- ../../base

images:
- name: fosrl/pangolin
  newTag: v1.2.3
- name: fosrl/gerbil
  newTag: v1.2.3
```

### Adjust PVC Size

Create `overlays/production/patches/pvc.yaml`:

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: pangolin-config-pvc
  namespace: pangolin
spec:
  resources:
    requests:
      storage: 5Gi
```

### Add Node Selector

Create `overlays/production/patches/node-selector.yaml`:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: pangolin
  namespace: pangolin
spec:
  template:
    spec:
      nodeSelector:
        kubernetes.io/role: worker
```

## Further Reading

- [Pangolin Documentation](https://docs.pangolin.net)
- [Kustomize Documentation](https://kubectl.docs.kubernetes.io/guides/introduction/kustomize/)
- [Traefik Documentation](https://doc.traefik.io/traefik/)

## Contributing

Please see the main [CONTRIBUTING.md](../../CONTRIBUTING.md) for contribution guidelines.

## License

This project is dual licensed under AGPL-3 and the Fossorial Commercial License. See [LICENSE](../../LICENSE) for details.
