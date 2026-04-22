# BabyTracker Helm Chart

Deploy [BabyTracker](https://github.com/mbentancour/babytracker) to Kubernetes.

## Quick start

```bash
helm install babytracker ./deploy/helm/babytracker \
  --set secrets.postgresPassword=$(openssl rand -base64 32)
```

## Prerequisites

- Kubernetes 1.24+
- A `StorageClass` that supports ReadWriteOnce PVCs
- Helm 3.8+

## Configuration

Key values (see [values.yaml](values.yaml) for the full list):

| Parameter | Default | Description |
|-----------|---------|-------------|
| `image.repository` | `ghcr.io/mbentancour/babytracker` | Container image |
| `image.tag` | `""` (chart appVersion) | Image tag |
| `replicaCount` | `1` | Must be 1 — BabyTracker uses local volumes |
| `config.tlsEnabled` | `true` | Serve HTTPS in the container; set `false` when ingress terminates TLS |
| `persistence.enabled` | `true` | PVC for photos, backups, certs |
| `persistence.size` | `5Gi` | PVC size |
| `service.type` | `ClusterIP` | `LoadBalancer` for direct external access |
| `service.port` | `443` | Container port |
| `ingress.enabled` | `false` | Enable ingress resource |
| `postgresql.enabled` | `true` | Deploy bundled Postgres StatefulSet |
| `postgresql.persistence.size` | `5Gi` | Postgres PVC size |
| `secrets.postgresPassword` | — | **Required** when `postgresql.enabled=true` |
| `secrets.databaseUrl` | — | **Required** when `postgresql.enabled=false` |
| `secrets.jwtSecret` | `""` (auto-generated) | JWT signing secret |

## Architecture

The chart deploys:

1. **BabyTracker Deployment** (1 replica, `Recreate` strategy — single pod with local data)
2. **PostgreSQL StatefulSet** (optional, 1 replica with PVC)
3. **Services** for both
4. **Secret** for credentials + ACME DNS provider tokens
5. **PVC** for BabyTracker data (`/var/lib/babytracker`)
6. **Ingress** (optional)

## TLS

Two options:

### 1. App-managed TLS (default)

BabyTracker serves HTTPS on port 443 with a self-signed certificate by default.
Upgrade to Let's Encrypt via the Settings UI (supports Cloudflare, Route53,
DuckDNS, Namecheap, Simply.com) — no ingress needed. Expose via
`service.type=LoadBalancer` or ingress passthrough.

### 2. Ingress-terminated TLS

Let your ingress controller (nginx, traefik, etc.) handle TLS via cert-manager:

```yaml
config:
  tlsEnabled: false  # App serves HTTP; ingress does TLS

service:
  port: 8099  # Arbitrary in-cluster port

ingress:
  enabled: true
  className: nginx
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-prod
  hosts:
    - host: baby.example.com
      paths:
        - path: /
          pathType: Prefix
  tls:
    - secretName: babytracker-tls
      hosts:
        - baby.example.com
```

## External database

To use an existing PostgreSQL instead of the bundled one:

```yaml
postgresql:
  enabled: false

secrets:
  databaseUrl: postgres://user:pass@postgres.example.com:5432/babytracker?sslmode=require
```

## Upgrades

```bash
helm upgrade babytracker ./deploy/helm/babytracker \
  --reuse-values
```

The app auto-runs schema migrations on startup. PostgreSQL data is preserved.

## Uninstall

```bash
helm uninstall babytracker
kubectl delete pvc -l app.kubernetes.io/instance=babytracker  # if you want to delete data
```
