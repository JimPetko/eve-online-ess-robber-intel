# Home server (Docker)

Runs the server and web UI as one container on a Docker host. The container listens on the host only (`127.0.0.1:3917`), and Tailscale Funnel publishes it at **https://chimera.tail719253.ts.net**. The host needs Docker with Compose only: no Node and no GitHub access, because `deploy.sh` ships the code over SSH.

## Deploy or update

From a clean checkout of `main`, in Git Bash or any POSIX shell:

```sh
git pull
ops/home-server/deploy.sh jpetko@192.168.0.187
```

`deploy.sh` does four things:
1. Copies `git archive HEAD` over SSH into `~/ess-robber-intel` on the host, replacing the previous copy. The deployed commit is in `~/ess-robber-intel/DEPLOYED_COMMIT`.
2. Builds the image there with `docker compose build --pull`.
3. Restarts the container.
4. Waits for `/api/health`.

It asks for the SSH password up to three times. Set up key auth (`ssh-copy-id`) to skip that.

| Option | Use |
|---|---|
| `--dir DIR` | Install folder on the host (default `~/ess-robber-intel`). Quote a `~` path (`--dir '~/foo'`) so the host expands it, not your shell. |
| `--seed-db FILE` | Load history into an empty volume. It is ignored once the volume has a database. |
| `--allow-any-branch` | Deploy a branch or a dirty checkout |

## Seeding history

To carry history over from another install, make a consistent copy with SQLite's backup, not a raw file copy of a live WAL database:

```sh
node -e 'require("node:sqlite").backup(new (require("node:sqlite").DatabaseSync)(process.argv[1], { readOnly: true }), process.argv[2])' \
  C:/ProgramData/ess-robber-intel/data/ess-robber-intel.sqlite seed.sqlite
ops/home-server/deploy.sh jpetko@192.168.0.187 --seed-db seed.sqlite
```

## First Admin

Every page needs a signed-in Account. Create the first Admin once, on the host, after the first deploy. The password is read from stdin, so it is not in the repo, the image or the shell history (the leading space keeps it out of bash history):

```sh
cd ~/ess-robber-intel/ops/home-server
 echo 'temporary-password' | docker compose exec -T server node dist/server/accounts-cli.js create-admin "Frank Wiggles"
```

The Admin must choose a new password at first sign-in, then creates the other Accounts under **Accounts**.

## Public URL (Tailscale Funnel)

Tailscale Funnel terminates HTTPS with a certificate it renews itself and forwards to `127.0.0.1:3917`. The router needs no port forwarding and the home IP stays hidden.

One-time setup on the host, as a Tailscale operator (`sudo tailscale set --operator=$USER`):

1. Approve Funnel and HTTPS certificates for the machine in the Tailscale admin console. `tailscale funnel 3917` prints the link when they are off.
2. Publish it. `--bg` stores the config in tailscaled, so it survives reboots and redeploys:

   ```sh
   tailscale funnel --bg 3917
   tailscale funnel status
   ```

Take it offline with `tailscale funnel --https=443 off`.

Two settings keep this safe, and both are the defaults in `docker-compose.yml`:

- **The container port is bound to `127.0.0.1`.** Funnel is the only way in. A client that reached the port directly could forge `X-Forwarded-For`.
- **`TRUST_PROXY=1`.** The app trusts exactly one proxy in front. The session cookie is marked `Secure`, and the sign-in throttle counts each client's own IP, not the proxy's. Set `TRUST_PROXY=` (empty) in `ops/home-server/.env` only if you run the app without a proxy.

Because of the `127.0.0.1` binding, the LAN address `http://192.168.0.187:3917` no longer works. Use the public URL, or the same URL from inside the tailnet.

## On the host

```sh
cd ~/ess-robber-intel/ops/home-server
docker compose ps                   # healthy?
docker compose logs -f server       # hourly poll lines
docker compose down                 # stop; data stays in the ess-robber-intel_ess-data volume
```

- The Compose project is `ess-robber-intel`, and the database lives in the `ess-robber-intel_ess-data` volume at `/data/ess-robber-intel.sqlite`.
- The container runs as the image's `node` user and restarts unless you stop it.
- `docker stop` sends SIGTERM, so the server gets up to 10 s to finish a sync, inside the 15 s stop grace period.
- Every page needs a signed-in Account. Set `ESS_PORT` in `ops/home-server/.env` on the host to use another host port, and point `tailscale funnel` at it.
