# Home server (Docker)

Runs the server and web UI as a container on a Docker host, published to the internet over HTTPS by a Tailscale Funnel container at **https://ess-robber-intel.tail719253.ts.net**. The host needs Docker with Compose only: no Node and no GitHub access, because `deploy.sh` ships the code over SSH.

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

The `tailscale` service joins your tailnet as its own machine, `ess-robber-intel`, and publishes the server through Funnel at **https://ess-robber-intel.tail719253.ts.net**. Funnel terminates HTTPS with a certificate Tailscale renews itself. The router needs no port forwarding and the home IP stays hidden. The `server` service publishes no port, so the only way in is through Funnel.

One-time setup:

1. In the Tailscale admin console, make sure HTTPS certificates and Funnel are allowed for your tailnet's members (`tailscale funnel` on any machine prints the approval link when they are off).
2. Deploy. On its first start the `tailscale` service has no identity yet, so it logs a sign-in link:

   ```sh
   docker compose logs tailscale | grep -o 'https://login.tailscale.com/[^ ]*'
   ```

   Open it while signed in to Tailscale to add the `ess-robber-intel` machine. It keeps its identity in the `ess-robber-intel_ts-state` volume, so this is needed only once.

For an unattended first start, put a one-off auth key (admin console, **Settings > Keys**, neither reusable nor ephemeral) in `ops/home-server/.env` on the host as `TS_AUTHKEY=tskey-auth-...` instead. `deploy.sh` keeps that file across redeploys.

`tailscale-serve.json` holds the Funnel config. Check it with `docker compose exec tailscale tailscale funnel status`. Take the site offline with `docker compose stop tailscale`.

`TRUST_PROXY=1` (the default) tells the app to trust exactly one proxy in front, the `tailscale` service. The session cookie is then marked `Secure`, and the sign-in throttle counts each client's own IP, not the proxy's. Do not publish the `server` port: a client that reached it directly could forge `X-Forwarded-For`.

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
- Every page needs a signed-in Account. The server is not reachable on the LAN or the host directly; use the public URL.
