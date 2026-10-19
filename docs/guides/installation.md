# Install Kintsugi

Kintsugi runs as a Docker Compose installation with one app container, one worker container, and PostgreSQL. The repository's GitHub Actions workflow builds and publishes the app and worker images to GHCR and deploys commits from `master` over SSH.

## Before you start

- A Linux host with Docker Engine 24+ and Docker Compose v2.20+. Suggested sizing: 4 vCPU, 16 GB RAM, and 100 GB disk.
- Outbound network access from the host to GHCR, the Git servers the project uses, and configured LLM providers.
- A DNS name and TLS termination for the portal.
- An SSH account that can run Docker Compose. Membership in the `docker` group grants root-equivalent host access.

Use the SSH host and user supplied by your administrator. If the command does not specify a port, use SSH's default port, `22`. Store the account password only as the GitHub Actions secret named `SSH_PASSWORD`.

## 1. Connect and prepare the host

Connect from a terminal. SSH asks for the account password interactively; do not put it in the command line:

```bash
ssh -p 22 username@host.example
```

Replace the example account, host, and port with the values provided for your server.

Check that Docker and the Compose plugin are available and that this account can run them:

```bash
docker --version
docker compose version
docker info
```

If `docker info` reports a permission error, ask the server administrator to grant this account Docker access, then reconnect. The deploy workflow does not install Docker or change server permissions.

Create the deployment and data directories. The worker image runs as UID/GID `10001`, so give it ownership of the data directory:

```bash
sudo install -d -o username -g username /home/username/kintsugi/deploy/compose
sudo install -d -o 10001 -g 10001 /srv/kintsugi/data
```

The first workflow run copies `docker-compose.yml` and `.env.example` into the deployment directory, then stops because `.env` does not exist yet. After that first run, initialize the installation settings on the host:

```bash
cd /home/username/kintsugi/deploy/compose
cp .env.example .env
```

Set `KINTSUGI_PUBLIC_URL`, `KINTSUGI_SECRET_KEY`, `POSTGRES_PASSWORD`, `KINTSUGI_BOOTSTRAP_ADMIN_PASSWORD`, and `KINTSUGI_DATA_DIR`. Generate secrets on the host; use a hex value for `POSTGRES_PASSWORD` so it can safely appear in the Compose database URL:

```bash
openssl rand -base64 32   # KINTSUGI_SECRET_KEY
openssl rand -hex 32      # POSTGRES_PASSWORD
```

Do not commit or send `.env` to GitHub. See the [configuration reference](../reference/configuration.md) for every setting.

Save `.env`, then confirm it contains real values and not the example placeholders before starting the deployment workflow again.

## 2. Configure GitHub Actions

In the GitHub repository, open **Settings → Secrets and variables → Actions**. Under **Variables**, add these repository variables. These values map from the SSH command above:

| Variable | Value |
|---|---|
| `SSH_HOST` | The server host or IP address |
| `SSH_USER` | The SSH account name |
| `SSH_PORT` | The configured port, or `22` if the command omitted it |
| `KINTSUGI_REMOTE_DIR` | The absolute deployment directory on the host |

Add these repository secrets:

| Secret | Value |
|---|---|
| `SSH_PASSWORD` | Password for the SSH account |
| `SSH_KNOWN_HOSTS` | The verified known-hosts entry for the host and port |

Enter secret values directly in GitHub's secret editor. Do not add passwords or tokens as repository variables, commit them, or paste them into workflow files.

To obtain `SSH_KNOWN_HOSTS`, run `ssh-keyscan -p 22 host.example` from a trusted machine, replacing the example port and host. Verify the returned fingerprint with the server administrator or hosting console before saving the line as the secret. The workflow rejects an unknown or changed host key.

GitHub Actions uses its built-in `GITHUB_TOKEN` to publish and pull the GHCR images, so no separate registry token is needed. The GHCR pull token is sent over SSH for the duration of the pull and stored in a temporary Docker config directory that the workflow removes afterward. If the packages already exist, grant this repository Actions access to them in the package settings.

## 3. Run the deployment

After the feature branch is merged into `master`, open **Actions → Build and deploy Kintsugi → Run workflow**, select `master`, and start the workflow. The initial run prepares the remote Compose directory and stops if `.env` has not been created. Complete step 1 on the host, then run the workflow again from `master`.

On subsequent pushes to `master`, the workflow builds both images, tags them with the commit SHA, publishes them to GHCR, copies the Compose bundle, updates `KINTSUGI_REGISTRY` and `KINTSUGI_VERSION` in the host `.env`, then pulls and restarts the stack. A failed image build prevents the SSH deployment job from running.

After the first successful deployment, point the reverse proxy at `KINTSUGI_HTTP_PORT`, open `KINTSUGI_PUBLIC_URL`, sign in with the bootstrap admin credentials from `.env`, and change the bootstrap password.

## 4. Configure the installation

Do these in order:

1. **LLM providers** for the runtime: Admin → LLM Providers. See [configure LLM providers](configure-llm-providers.md).
2. **Extension allowlists**, only if projects need them: extra harness renderers and transformer plugins (Admin → Harnesses).
3. **Git servers and credentials**: Admin → Connectors. Register the Git servers the project uses.
4. **Users and roles**: Admin → Users.
5. **Projects**: create or join each project, register its repositories, and write its standards. See [build a project](build-project.md).

## Air-gapped installation

Build and transfer the image tarballs into a local registry, set `KINTSUGI_REGISTRY` to that registry, and configure reachable LLM providers such as a local vLLM endpoint.

## Upgrade and backup

- **Upgrade**: deploy a commit through GitHub Actions. For manual upgrades, authenticate to GHCR with a read-only package token, then run `docker compose pull && docker compose up -d --wait` in the deployment directory. Database migrations run on app start.
- **Backup**: back up the `pg-data` volume. Code and documents are in Git, and `KINTSUGI_DATA_DIR` is rebuilt from Git; back it up if it contains imported repositories that exist nowhere else.
