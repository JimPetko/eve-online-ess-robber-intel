# Home server (Docker)

Runs the server and web UI as one container on a Docker host, published on the LAN at `http://<host>:3917`. The host needs Docker with Compose only: no Node and no GitHub access, because `deploy.sh` ships the code over SSH.

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
| `--dir DIR` | Install folder on the host (default `~/ess-robber-intel`) |
| `--seed-db FILE` | Load history into an empty volume. It is ignored once the volume has a database. |
| `--allow-any-branch` | Deploy a branch or a dirty checkout |

## Seeding history

To carry history over from another install, make a consistent copy with SQLite's backup, not a raw file copy of a live WAL database:

```sh
node -e 'require("node:sqlite").backup(new (require("node:sqlite").DatabaseSync)(process.argv[1], { readOnly: true }), process.argv[2])' \
  C:/ProgramData/ess-robber-intel/data/ess-robber-intel.sqlite seed.sqlite
ops/home-server/deploy.sh jpetko@192.168.0.187 --seed-db seed.sqlite
```

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
- The UI has no login, so anyone on the LAN can open it. To keep it on the host only, change the port mapping in `docker-compose.yml` to `127.0.0.1:3917:3917`. Set `ESS_PORT` in `ops/home-server/.env` on the host to use another port.
