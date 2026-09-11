# CloudForge

CloudForge is a self-service deployment platform: users register GitHub repos,
and the backend clones, builds (Docker), and deploys them to a Kubernetes
cluster (Minikube/dev), exposing the app via a NodePort URL.

## Repository layout

- `Backend/` — Express + Mongoose API (`npm run dev` in `Backend/`)

## Backend quickstart

```bash
cd Backend
cp .env.example .env   # then fill in MONGO_URI / JWT_SECRET
npm install
npm run dev            # nodemon -> http://localhost:5000
```

## Why `nodemon.json` exists — read before adding transient directories

`npm run dev` runs the server under **nodemon**, which by default watches
`**/*.*` under the project root and restarts on every file change.

The deployment pipeline writes cloned repositories into `Backend/workspace/`
during `repo.service.cloneRepo()`. Without the ignore rule in `nodemon.json`,
nodemon detects those clone writes and **restarts the server mid-clone**,
killing the `git` process and leaving a half-cloned folder (`.git` only, no
checked-out files) with no thrown error to catch.

Rules for future changes:

- **Any directory the backend writes to at runtime must be added to
  `nodemon.json` `ignore`.** `workspace/*` and `workspace/**` are listed there
  for exactly this reason.
- If you add a build-temp dir, cache dir, upload dir, or similar, add it to
  `nodemon.json` (and `.gitignore`) too — otherwise nodemon will restart the
  server mid-operation and the resulting bugs are very hard to trace.
- The backend currently writes only `workspace/` at runtime; nothing else
  needs ignoring.

## API

All routes under `/api` are JSON; send `Content-Type: application/json` with a
properly quoted body (bare `{name:...}` will be rejected with
`400 {"error":"Invalid JSON in request body"}`).

- `POST /api/auth/register`, `POST /api/auth/login` — get a JWT
- `POST /api/projects`, `GET /api/projects` — create/list repos (auth)
- `POST /api/deployments` — start a deploy (202, runs async)
- `GET /api/deployments/:id` — poll status (`pending` → `cloning` → `building`
  → `pushing` → `deploying` → `running`, or `failed`)
- `GET /api/deployments/:id/logs` — container logs (409 until running)
- `POST /api/deployments/:id/scale` — `{ replicas }` (1–10)
- `POST /api/deployments/:id/restart` — rolling restart
- `DELETE /api/deployments/:id` — delete the Deployment

## Kubernetes notes

- The backend expects a reachable cluster (kubeconfig). For Minikube, set
  `NODE_IP=$(minikube ip)` so the populated `url` uses the Minikube VM IP
  rather than a discovered node address.
- Deployments/Services are applied into the namespace matching
  `deployment.environment` (created if missing).

---

# Local Setup Guide (Windows)

Everything needed to run CloudForge from zero on a Windows machine. This
mirrors the actual setup used during development.

## Required accounts

- **MongoDB Atlas** (free tier) — or a local MongoDB install. Provides the
  connection string for `MONGO_URI`.
- **Docker Hub** — free account. Your username/password go in
  `DOCKER_REGISTRY_USERNAME` / `DOCKER_REGISTRY_PASSWORD`; images are pushed
  to your personal namespace.
- **GitHub** — to create the test repositories you deploy.

## Required software

- **Node.js** (18+; developed on 22)
- **Docker Desktop** — includes `docker` CLI + daemon; **kubectl usually ships
  with Docker Desktop** on Windows (`C:\Program Files\Docker\Docker\resources\bin`),
  so a separate kubectl install is often unnecessary.
- **Minikube** — for the local Kubernetes cluster.

## .env variables

Copy `Backend/.env.example` to `Backend/.env` and fill in:

| Variable | Required | Purpose |
|---|---|---|
| `PORT` | optional | API port (default `5000`) |
| `MONGO_URI` | **required** | MongoDB connection string (Atlas or local) |
| `JWT_SECRET` | **required** | Secret used to sign auth tokens |
| `JWT_EXPIRES_IN` | optional | Token lifetime (default `1d`) |
| `DOCKER_REGISTRY_USERNAME` | **required** | Docker Hub username; images are tagged `<username>/<image>:<tag>`; pipeline fails fast if unset |
| `DOCKER_REGISTRY_PASSWORD` | required* | Docker Hub password (only needed if you automate `docker login`) |
| `DOCKER_REGISTRY_URL` | optional | Custom registry host (defaults to Docker Hub) |
| `NODE_IP` | only for `SERVICE_TYPE=NodePort` | Node IP used in the deployed app URL; get it from `minikube ip` |
| `SERVICE_TYPE` | optional | `LoadBalancer` (default) or `NodePort`. LoadBalancer works on Minikube (needs `minikube tunnel`) and k3s (ships ServiceLB/Klipper). Use NodePort only on clusters with no LoadBalancer controller |
| `LOCAL_DEV` | only for local Minikube dev | `true` on a dev machine running Minikube + tunnel. Enables the pre-flight host-port-conflict check (gotcha g). Leave unset in the cloud |

## Setup order

```bash
# 1. Install backend dependencies
cd Backend
npm install

# 2. Create and fill .env (see table above)
cp .env.example .env

# 3. Log in to Docker Hub so docker push is authenticated
docker login

# 4. Start Minikube (Docker driver) and confirm kubectl sees it
minikube start --driver=docker
kubectl get nodes        # -> minikube Ready

# 5. Get the Minikube VM IP and put it in .env as NODE_IP
minikube ip              # e.g. 192.168.49.2 -> NODE_IP=192.168.49.2
#    (NODE_IP is only used if SERVICE_TYPE=NodePort; not needed for the
#    default LoadBalancer setup)

# 6. Start minikube tunnel in a SEPARATE terminal and leave it open
minikube tunnel          # keeps running; assigns LoadBalancer IPs (127.0.0.1)
#    One tunnel serves ALL deployments — no per-deployment commands needed.
#    If it prompts for admin credentials, approve the UAC prompt.

# 7. Start the backend
npm run dev              # nodemon -> http://localhost:5000
```

> **About `minikube tunnel`:** each deployment creates a `LoadBalancer` Service.
> `minikube tunnel` (run once, kept open in its own terminal) gives every one
> of those Services an external IP (`127.0.0.1`) and forwards ports to your
> host, so every deployment's URL is directly clickable. It must be running
> **before** you create deployments — if it isn't, the deployment stays
> `deploying` for ~90s while the pipeline waits for an address, then flips to
> `running` with an empty URL and a note that the tunnel is required.

## Known Windows-specific gotchas

a) **nodemon watches `workspace/`** — `npm run dev` restarts on file changes,
   and the clone step writes into `Backend/workspace/`. Without the ignore
   rule in `nodemon.json`, a mid-clone restart kills git and leaves only a
   `.git` folder with no checked-out files. **`nodemon.json` already fixes
   this — do not remove it**, and add any new runtime-written directory to its
   `ignore` list.

b) **Docker image refs need your username prefix** — images must be
   `<username>/<image>:<tag>`. Without the prefix, `docker push` targets the
   official library namespace and fails with `insufficient_scope:
   authorization failed`. The pipeline tags correctly via
   `DOCKER_REGISTRY_USERNAME`; make sure it is set.

c) **`docker push` needs an active login** — the pipeline does not automate
   `docker login`. Run `docker login` once per session or the push fails with
   an authentication error (wrapped as `Failed to push image ...`).

d) **Stale Minikube kubeconfig after sleep/resume** — on Windows with the
   Docker driver the kubeconfig can go stale after idle, causing
   `ECONNREFUSED` from the Kubernetes client. Fix: `minikube update-context`.
   If that doesn't help: `minikube stop`, then `minikube start`, then
   re-check `minikube ip` in case it changed and update `NODE_IP` in `.env`.

e) **Direct NodePort URLs are unreachable from the Windows host — use the
   tunnel** — with the Docker driver, `http://<minikube-ip>:<nodePort>` is
   frequently NOT directly open from the host browser due to how the driver
   networks the VM. CloudForge avoids this by defaulting to `LoadBalancer`
   Services: run `minikube tunnel` once (own terminal, kept open) and every
   deployment gets a working `http://127.0.0.1:<port>` URL — no per-deployment
   `minikube service --url` needed. If the tunnel is not running when a
   deployment finishes building, the deployment stays `deploying` for ~90s
   while the pipeline polls for a load balancer address, then flips to
   `running` with an empty URL; start the tunnel and the URL appears after a
   re-deploy or page reload.

f) **Phase 2 (k3s) keeps working** — k3s ships its own LoadBalancer
   controller (ServiceLB, formerly Klipper), so `LoadBalancer` Services get an
   IP on a bare k3s VM too. Only clusters with *no* LoadBalancer controller at
   all need `SERVICE_TYPE=NodePort`.

g) **Host processes can hijack tunnel ports** — on a local Minikube + tunnel
   setup, a LoadBalancer Service's port is bound on the *host* by the tunnel.
   If any other host process (pgAdmin, Apache, a dev server — not just other
   CloudForge deployments) already listens on that port, the OS silently
   routes the tunnel's traffic to that process, so the deployment's URL serves
   the wrong application. CloudForge guards against this when
   `LOCAL_DEV=true` and `SERVICE_TYPE=LoadBalancer`: the pipeline checks the
   requested port is free on the host (a `net.createServer().listen()` bind
   test — no shelling out to netstat) and fails the deployment immediately
   with "Port N is already in use on this machine by another process. Choose
   a different port for this deployment." This only applies to local dev; on a
   cloud cluster the Service port is bound inside the cluster, never on the
   backend host, so the check is disabled there.

## How to verify it's working

With the backend running and a cluster up, exercise the API end-to-end
(register -> project -> deploy -> poll -> kubectl -> tunnel):

```bash
# 1. Register a user, capture the token
curl -X POST http://localhost:5000/api/auth/register -H "Content-Type: application/json" \
  -d "{\"name\":\"Dev\",\"email\":\"dev@example.com\",\"password\":\"testpass123\"}"
# -> {"token":"...","user":{...}}   (use this token below)

# 2. Create a project pointing at a small public repo
curl -X POST http://localhost:5000/api/projects -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"Demo\",\"repository\":\"https://github.com/octocat/Hello-World\"}"
# -> 201 {"_id":"...","name":"Demo",...}   (note the project _id)

# 3. Create a deployment
curl -X POST http://localhost:5000/api/deployments -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d "{\"projectId\":\"<PROJECT_ID>\",\"branch\":\"master\",\"replicas\":1,\"cpu\":\"250m\",\"memory\":\"256Mi\",\"port\":8080}"
# -> 202 {"deploymentId":"...","status":"pending"}   (pipeline runs in the background)

# 4. Poll status until "running" (or "failed" + errorMessage)
curl http://localhost:5000/api/deployments/<DEPLOYMENT_ID> -H "Authorization: Bearer <TOKEN>"
# -> status moves pending -> cloning -> building -> pushing -> deploying -> running

# 5. Confirm the pod is up in the cluster
kubectl get pods -n development

# 6. Open the deployment's URL from the API response — it is directly
#    clickable because minikube tunnel is running (step 6 of setup).
curl http://localhost:5000/api/deployments/<DEPLOYMENT_ID> -H "Authorization: Bearer <TOKEN>"
# -> {"url":"http://127.0.0.1:3xxxx", ...} — browse to that URL
```

If step 4 ends in `failed`, the `errorMessage` field on the deployment says
why (bad repo URL, missing `DOCKER_REGISTRY_USERNAME`, docker not logged in,
push timeout, etc.).
