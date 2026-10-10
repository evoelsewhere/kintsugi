# Install Kintsugi

> **Planned behavior.** The images are not published yet (milestone M0). This guide describes how installation will work.

## Before you start

You need:
- A Linux host with Docker Engine 24+ (26+ recommended) and Docker Compose v2. Rough sizing: 4 vCPU, 16 GB RAM, 100 GB disk.
- Outbound network access from the host to:
  - every Git server the project uses;
  - the LLM providers you will configure.
- A DNS name and TLS termination (reverse proxy) for the portal.

## 1. Get the package

Copy the [`deploy/compose`](../../deploy/compose/) directory to the host.

## 2. Configure `.env`

```bash
cp .env.example .env
```

Fill in at least these variables:
- `KINTSUGI_PUBLIC_URL`
- `KINTSUGI_SECRET_KEY` (generate it with `openssl rand -base64 32`)
- `POSTGRES_PASSWORD`
- `KINTSUGI_BOOTSTRAP_ADMIN_PASSWORD`

All variables are listed in the [configuration reference](../reference/configuration.md).

## 3. Start

```bash
docker compose up -d
```

Point your reverse proxy at `KINTSUGI_HTTP_PORT`. Sign in with the bootstrap admin, then change the password.

## 4. Configure the installation

Do these in order:
1. **LLM providers** for the runtime: Admin → LLM Providers. See [configure LLM providers](configure-llm-providers.md).
2. **Extension allowlists**, only if projects need them:
   - extra harness renderers and transformer plugins (Admin → Harnesses).
3. **Git servers and credentials**: Admin → Connectors. Register as many servers as the project uses (GitHub, Azure DevOps, GitLab, Bitbucket, Gitea, or plain git).
4. **Users and roles**: Admin → Users.
5. **Projects**: create or join each project, register its repos and write its standards. See [build a project](build-project.md).

## Air-gapped installation

1. Load the image tarballs into a local registry.
2. Set `KINTSUGI_REGISTRY` to that registry.
3. Configure LLM providers that are reachable from the host, e.g. a local vLLM endpoint as a custom provider.

## Upgrade and backup

- **Upgrade**: run `docker compose pull && docker compose up -d`. Migrations run on start.
- **Backup**: back up the `pg-data` volume. Code and documents are already in Git, and `KINTSUGI_DATA_DIR` is rebuilt from Git; back it up only if you imported repositories that exist nowhere else.
