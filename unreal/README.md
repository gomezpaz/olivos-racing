# Olivos GP — Unreal Engine edition

Cesium for Unreal + Google Photorealistic 3D Tiles. Maximum-fidelity path
(desktop build your brother downloads), alongside the shareable web build.

## One-time setup

1. Free ~60 GB of disk (or use an external SSD).
2. Install the Epic Games Launcher: `brew install --cask epic-games` → sign in.
3. Launcher → Unreal Engine → Library → install **UE 5.6** (pick the external
   drive in "Install Location" if using one).
4. Install **Cesium for Unreal** (free) from Fab into the engine.
5. Open `unreal/OlivosGP/OlivosGP.uproject` — say yes to compiling the module
   (Xcode is already set up on this machine).
6. In the editor Python console:
   `import bootstrap_olivos; bootstrap_olivos.run("YOUR_GOOGLE_MAPS_API_KEY")`
7. Press Play. WASD/arrows drive, Space handbrake.

## Status / roadmap

- [x] Project + arcade Sharan pawn (ported from the web build's physics)
- [x] Level bootstrap script (georeference, Google tiles, sun, player start)
- [ ] Import the Sharan glTF (replaces the placeholder box)
- [ ] Race logic port (checkpoints, laps, timing from web `track.js`)
- [ ] Multiplayer sessions (listen server + direct connect first, EOS later)
- [ ] Packaged Mac/Windows builds published via GitHub Releases
