# Install Kintsugi

Kintsugi runs as a Docker Compose installation with one app container, one worker container, and PostgreSQL. The repository's GitHub Actions workflow builds and publishes the app and worker images to GHCR and deploys commits from `master` over SSH.

## Before you start

- A Linux host with Docker Engine 24+ and Docker Compose v2.20+. Suggested sizing: 4 vCPU, 16 GB RAM, and 100 GB disk.
- Outbound network access from the host to GHCR, the Git servers the project uses, and configured LLM providers.
- A DNS name and TLS termination for public portal access. For initial access without DNS/TLS, the workflow binds the app to loopback so you can use an SSH tunnel.
- An SSH account that can run Docker Compose. Membership in the `docker` group grants root-equivalent host access.

Use the SSH host and user supplied by your administrator. If the command does not specify a port, use SSH's default port, `22`. Store the account password only as the GitHub Actions secret named `SSH_PASSWORD`.

## 1. Prepare the host

The account must be able to run Docker Compose. Membership in the `docker` group grants root-equivalent host access. Connect from a terminal; SSH asks for the account password interactively, so do not put it in the command line:

```bash
ssh -p 22 username@host.example
```

Replace the example account, host, and port with the values provided for your server.

Install Docker Engine and its Compose plugin if needed, then confirm this account can use them:

```bash
docker --version
docker compose version
docker info
```

If `docker info` reports a permission error, ask the server administrator to grant this account Docker access, then reconnect. The deploy workflow does not install Docker or change server permissions.

Create the deployment directory. The workflow copies the Compose files here and creates `.env` on the first deployment:

```bash
mkdir -p /home/username/kintsugi/deploy/compose
```

The SSH user needs non-interactive `sudo` permission for one command: the workflow assigns the data directory to UID/GID `10001`, used by the worker container. It does not install Docker or change Docker permissions.

On its first run, the workflow copies `.env.example` to `.env`, takes any configured secrets from GitHub Actions, and generates missing keys/passwords on the host. It sets `.env` permissions to `600` and never prints secret values in Actions logs. The starter defaults bind the app to `127.0.0.1:8080`; set the optional `KINTSUGI_PUBLIC_URL` repository variable to your HTTPS URL if you have a domain and TLS proxy.

For a shared deployment, set `KINTSUGI_BOOTSTRAP_ADMIN_PASSWORD` in GitHub Actions secrets before the first run and share the chosen initial credential through your team's approved private channel. The workflow never prints it. If you leave it unset, the host generates a random password; an SSH-authorized administrator can retrieve it from the private `.env` file and share it privately with the intended user. Sign in with the configured bootstrap admin username and change the password. Keep `.env` private and back it up securely; the encryption key must remain unchanged or stored provider/Git credentials in the database cannot be decrypted.

For initial access without a public domain, open an SSH tunnel from your computer:

```bash
ssh -L 8080:127.0.0.1:8080 -p 22 username@host.example
```

Keep that terminal open and visit `http://localhost:8080` in your browser. If you changed `KINTSUGI_HTTP_PORT`, change the remote destination port in the tunnel command to match. For public access, configure DNS and a TLS reverse proxy to `127.0.0.1:<KINTSUGI_HTTP_PORT>`, then set the `KINTSUGI_PUBLIC_URL` Actions variable to the HTTPS URL.

The host `.env` holds runtime configuration. On later deploys, configured `KINTSUGI_PUBLIC_URL`, `KINTSUGI_HTTP_BIND`, and `KINTSUGI_HTTP_PORT` repository variables update their matching `.env` entries; if left unset, the existing values stay as-is. `KINTSUGI_DATA_DIR` and the bootstrap identity/secrets are applied only on first install. `KINTSUGI_REGISTRY` and `KINTSUGI_VERSION` are managed by the workflow. Do not commit or send `.env` to GitHub. See the [configuration reference](../reference/configuration.md) for every setting.

## 2. Configure GitHub Actions

In the GitHub repository, open **Settings → Secrets and variables → Actions**. Under **Variables**, add these repository variables. These values map from the SSH command above:

| Variable | Value |
|---|---|
| `SSH_HOST` | The server host or IP address |
| `SSH_USER` | The SSH account name |
| `SSH_PORT` | The configured port, or `22` if the command omitted it |
| `KINTSUGI_REMOTE_DIR` | The absolute deployment directory on the host |
| `KINTSUGI_PUBLIC_URL` | Optional; public HTTPS URL. Unset keeps the `.env.example` default for SSH-tunnel access |
| `KINTSUGI_HTTP_BIND` | Optional; host bind address. Defaults to `127.0.0.1`; `0.0.0.0` exposes the port on all interfaces |
| `KINTSUGI_HTTP_PORT` | Optional; host port exposed by Compose. Defaults to `8080` |
| `KINTSUGI_DATA_DIR` | Optional; host data directory, set on first install only. Defaults to `<KINTSUGI_REMOTE_DIR>/data` |
| `KINTSUGI_BOOTSTRAP_ADMIN_USER` | Optional; first admin username. Defaults to `admin` |

Add these repository secrets:

| Secret | Value |
|---|---|
| `SSH_PASSWORD` | Password for the SSH account |
| `SSH_KNOWN_HOSTS` | The verified known-hosts entry for the host and port |
| `KINTSUGI_SECRET_KEY` | Optional; base64-encoded 32-byte encryption key for first install |
| `POSTGRES_PASSWORD` | Optional; at least 32 hexadecimal characters for first install |
| `KINTSUGI_BOOTSTRAP_ADMIN_PASSWORD` | Optional; at least 8 letters, digits, dots, underscores, or hyphens for first install |

Enter secret values directly in GitHub's secret editor. The three Kintsugi secrets are read only when `.env` is first created; later deployments preserve their stored values so the database password or encryption key cannot be rotated accidentally. If these secrets are unset, the workflow generates them on the server. Anyone who can deploy through Actions can trigger deployment, but secret values are not included in workflow output. Do not add passwords or tokens as repository variables, commit them, or paste them into workflow files.

`SSH_KNOWN_HOSTS` must be the full `ssh-keyscan` host-key line (for example, `host.example ssh-ed25519 AAAA...`), not a fingerprint. For a non-default SSH port, keep the `[host]:port` prefix emitted by `ssh-keyscan`. Verify the fingerprint with the server administrator or hosting console before saving the line. The workflow checks that the secret contains an ED25519 entry matching `SSH_HOST` and `SSH_PORT`, then enforces strict host-key checking. On Windows, if the bundled `ssh-keyscan` errors on key exchange, run this in PowerShell with WSL installed (replace the host and port):

```powershell
wsl sh -lc "ssh-keyscan -T 10 -t ed25519 -p 22 host.example 2>/dev/null" | Select-String '^[^#]' | ForEach-Object { $_.Line } | Set-Clipboard
```

Paste the copied full line into the `SSH_KNOWN_HOSTS` secret. `ssh-keyscan` only retrieves the presented key; it does not verify its identity.

GitHub Actions uses its built-in `GITHUB_TOKEN` to publish and pull the GHCR images, so no separate registry token is needed. The GHCR pull token is sent over SSH for the duration of the pull and stored in a temporary Docker config directory that the workflow removes afterward. If the packages already exist, grant this repository Actions access to them in the package settings.

## 3. Run the deployment

After the feature branch is merged into `master`, open **Actions → Build and deploy Kintsugi → Run workflow**, select `master`, and start the workflow. On first run it initializes `.env` from the configured Actions variables/secrets and deploys the stack. If it fails on host preparation, follow the exact `sudo chown` instruction in the Actions log, then rerun the workflow. Secret values are not printed in the workflow log.

On subsequent pushes to `master`, the workflow builds both images, tags them with the commit SHA, publishes them to GHCR, copies the Compose bundle, updates workflow-managed values in the host `.env`, then pulls and restarts the stack. A failed image build prevents the SSH deployment job from running.

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
