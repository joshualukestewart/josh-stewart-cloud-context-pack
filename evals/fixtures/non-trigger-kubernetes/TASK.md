# Cluster manifests (fixture)

A vanilla Kubernetes deployment and its horizontal pod autoscaler. There is
no managed-service annotation, no cloud provider resource and no service
mesh here; treat this as a plain cluster.

## What exists

- `k8s/deployment.yaml`
- `k8s/hpa.yaml`

## Observed behaviour

Under sustained load the pods are visibly busy, but the replica count never
moves above 2.
