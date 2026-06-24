# aceman on Windows (WSL2)

aceman runs inside WSL2 (Ubuntu) and serves its web UI to your Windows
browser. This folder is a self-contained kit of Windows `.bat` scripts
that set everything up and launch it — you don't need to touch the Linux
command line.

> GPU/VA-API acceleration does **not** work under WSL, so the external-
> player CLI path isn't useful here. Use the **web UI** (browser playback),
> which is what these scripts launch.

## Get the files onto Windows

Download this `wsl/` folder to your PC (e.g. download the repo ZIP from
GitHub via **Code → Download ZIP**, then open the `wsl/` folder inside).
Keep all the files together in one folder.

## 1. Install — `install.bat`

Double-click **`install.bat`** and approve the UAC prompts. It:

1. Enables WSL, reboots (asks first — make sure WiFi auto-connects at
   startup, since the next phase downloads packages).
2. After reboot, auto-installs Ubuntu and provisions it: creates user
   `ace`, installs `podman git jq`, enables systemd (so `podman stats`
   reports memory), and clones the repo to `~/Projects/aceman`.
3. Creates an **aceman** shortcut on your Desktop.

## 2. Provide the engine tarball (one-time, required to play)

The Ace Stream engine tarball isn't shipped in the repo. The web UI runs
without it, but **playback needs it**. Inside WSL, drop your
`engine.tar.gz` into the clone:

```
~/Projects/aceman/container/engine/dist/engine.tar.gz
```

See [`../container/engine/README.md`](../container/engine/README.md).

## 3. Launch — `run.bat` (or the Desktop shortcut)

Double-click **`run.bat`** (or the **aceman** Desktop icon). It:

- opens a second window with the **live server logs**,
- waits for the server to come up (first launch builds container images —
  can take a few minutes),
- opens the URL in your default Windows browser automatically.

Keep the log window open while you use aceman; close it to stop.

## Update — `update.bat`

Runs `git pull` inside `~/Projects/aceman`. Read the trust note it prints
first.

## Uninstall — `uninstall.bat`

Unregisters the Ubuntu distro (deletes everything in it) and removes the
WSL app. Confirms before doing anything.

## Files in this kit

| File           | What                                                        |
|----------------|------------------------------------------------------------|
| `install.bat`  | Install WSL + Ubuntu, provision, create the Desktop shortcut |
| `setup.sh`     | Linux provisioning (run automatically by `install.bat`)    |
| `run.bat`      | Launch aceman_web and auto-open the browser                |
| `shortcut.bat` | Create the Desktop shortcut (also called by `install.bat`) |
| `update.bat`   | `git pull` the project inside WSL                          |
| `uninstall.bat`| Remove the distro + WSL                                     |
| `aceman.ico`   | Shortcut icon                                              |
