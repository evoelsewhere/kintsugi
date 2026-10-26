# Deploy with the published Docker images

Run Kintsugi on your own Linux host using the same app and worker images published by this repository. You do not need to build the TypeScript workspace or configure a GitHub Actions deployment to use them.

## Requirements

- Docker Engine 24+ and Docker Compose v2.20+ on a Linux host. Start with 4 vCPU, 16 GB RAM and 100 GB disk, then size for repository storage and concurrent jobs.
- Access to GHCR, your Git servers and the LLM providers you configure.
- A DNS name and a TLS reverse proxy for shared access; an SSH tunnel is sufficient for a local evaluation.

The shipped images are `ghcr.io/evoelsewhere/kintsugi-app` and `ghcr.io/evoelsewhere/kintsugi-worker`. Both are published with `latest` and `sha-<full-commit>` tags by the [image workflow](../../.github/workflows/deploy.yml). Use the **same tag for both**. `latest` is the latest published development build, not a stable release. Pin `sha-<full-commit>` for repeatable installations and upgrades. Check the image's platform support before choosing a host.

## 1. Download the Compose package

Use the Compose bundle from the same commit as your chosen images. Replace `FULL_COMMIT_SHA` with the full commit from a successful **Build and deploy Kintsugi** run:

```sh
mkdir -p kintsugi
cd kintsugi
KINTSUGI_COMMIT=FULL_COMMIT_SHA
curl -fL "https://raw.githubusercontent.com/evoelsewhere/kintsugi/$KINTSUGI_COMMIT/deploy/compose/docker-compose.yml" -o docker-compose.yml
curl -fL "https://raw.githubusercontent.com/evoelsewhere/kintsugi/$KINTSUGI_COMMIT/deploy/compose/.env.example" -o .env
chmod 600 .env
```

The package starts three services: the app (API and portal), the worker (runtime, orchestration and Git writes), and PostgreSQL with pgvector. PostgreSQL is the only datastore; documents stay in Git.

## 2. Set your installation values

Edit the private `.env` file:

```dotenv
KINTSUGI_REGISTRY=ghcr.io/evoelsewhere
KINTSUGI_VERSION=sha-FULL_COMMIT_SHA
KINTSUGI_HTTP_BIND=127.0.0.1
KINTSUGI_HTTP_PORT=8080
KINTSUGI_PUBLIC_URL=http://localhost:8080
KINTSUGI_DATA_DIR=/srv/kintsugi/data
KINTSUGI_BOOTSTRAP_ADMIN_USER=admin
```

Set `KINTSUGI_SECRET_KEY` to a newly generated base64 32-byte key, `POSTGRES_PASSWORD` to a random hexadecimal password, and `KINTSUGI_BOOTSTRAP_ADMIN_PASSWORD` to a unique password of at least eight characters. Generate values locally and paste them into `.env`:

```sh
openssl rand -base64 32
openssl rand -hex 32
openssl rand -hex 16
```

Keep `.env` private. Preserve the encryption key for the lifetime of the database and back it up securely; replacing it makes stored Git tokens and LLM credentials unreadable. Exact settings: [configuration reference](../reference/configuration.md).

Create the data directory and assign it to the non-root worker user:

```sh
sudo mkdir -p /srv/kintsugi/data
sudo chown 10001:10001 /srv/kintsugi/data
```

If you chose a different `KINTSUGI_DATA_DIR`, use that directory in both commands.

## 3. Pull and start

If GHCR requires authentication, run `docker login ghcr.io -u YOUR_GITHUB_USERNAME` and enter a token with `read:packages` at its password prompt. Never put the token in `.env` or in shell arguments. Public packages can be pulled without signing in.

```sh
docker compose config --quiet
docker compose pull
docker compose up -d --wait
docker compose ps
```

The app runs database migrations on startup. `docker compose ps` should show a healthy app and database and a running worker. Investigate startup errors with:

```sh
docker compose logs --tail=100 app worker
```

The default port binds only to loopback. From your computer, open a tunnel to the host:

```sh
ssh -L 8080:127.0.0.1:8080 username@your-host
```

Visit `http://localhost:8080`, sign in with the bootstrap account you configured, and change its password. For shared access, configure a TLS reverse proxy to `127.0.0.1:8080`, set `KINTSUGI_PUBLIC_URL` to the public HTTPS origin and recreate the containers with `docker compose up -d --wait`. Expose only the app through the proxy.

## 4. Configure and run your first project

Configure LLM providers, Git connections and permissions in the portal, then follow the [first project walkthrough](first-project.md). Provider keys and Git tokens belong in the portal, which encrypts them in PostgreSQL. Member CLI installers are served by your own installation at `/guideline`.

## Upgrade, backup and recovery

1. Back up PostgreSQL and the private `.env` before upgrading. For a small installation, create a database dump with `docker compose exec -T postgres pg_dump -U kintsugi -Fc kintsugi > kintsugi-backup.dump`. Protect the backup as sensitive data and test restoring it on a separate installation.
2. Preserve the matching Compose package and image tag. Back up the Git repositories at their source; also preserve imported repositories that exist only in `KINTSUGI_DATA_DIR`.
3. Download the Compose bundle at the new image commit, inspect configuration changes and set the new `KINTSUGI_VERSION` for both services.
4. Run `docker compose pull`, then `docker compose up -d --wait`. Verify sign-in, repository sync and worker status in Monitoring.

Database migrations may prevent an image-only downgrade. Recovery can require restoring the pre-upgrade database together with its matching encryption key and images. `docker compose down` stops the stack; do not use `down -v` unless you intend to delete its database volume.

To build and deploy images through your own GitHub Actions workflow instead, see [installation and automated deployment](installation.md).
