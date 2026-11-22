# APEX // Endurance

A browser-playable GT sprint-racing prototype built with Three.js and Vite. It is designed for GitHub Pages: no Unreal Editor, installer, game server, API key, or model training is required to play.

## Play

- **W / ↑** accelerate
- **S / ↓** brake / reverse
- **A / D** steer
- **Space** handbrake
- **C** chase / hood camera
- **R** recover to the racing line
- **Esc** pause
- Gamepad: left stick + analog triggers (browser gamepad API)
- Touch: on-screen steering / brake / throttle controls

Run locally with Node.js 20+:

```sh
npm ci
npm run dev
```

Production smoke build:

```sh
npm run build
```

## What is simulated

The browser build has a lightweight local vehicle model with a bicycle-model steering response, speed-dependent engine force, braking/reverse, aerodynamic drag, a friction-limited yaw response, grip loss off the racing surface, recovery, car contact, ABS-style braking and traction-control grip caps, lap timing, saved personal best, a marked pit lane, grid boxes, curbs, barriers, and three local opponents. Rivals have different pace, reaction cadence, line variation, and overtake tendencies; choose Calm, Club (default), or Challenge before the start. They do not call a cloud service and require no model download or training.

These are humanized local control policies, not a pretrained neural-network model. A generic downloadable driving model would not reliably transfer to this custom vehicle physics; a genuinely learned policy needs training/evaluation against the same simulation.

This is a **web racing prototype**, not an Unreal Engine project or a validated professional-grade motorsport simulator. Its simplified model is not a substitute for a tire model calibrated against real telemetry. The browser build was chosen because this repository is requested to deploy on static GitHub Pages. For high-fidelity Unreal rendering/physics, the appropriate path is a desktop Unreal build or separately hosted GPU Pixel Streaming; a static Pages site cannot run that server.

## Assets

The following GLBs were supplied in the Google Drive `TRAIN` folder and are included as runtime assets:

- `model-4.glb` → `public/assets/gt3-car.glb` (fictional GT3-style car)
- `model-5.glb` → its asphalt base-color, normal, and roughness maps are extracted into `public/assets/asphalt-*.png` (the playable circuit surface is generated as a closed spline mesh)
- `model-6.glb` → `public/assets/safety-barriers.glb` (barrier and guardrail geometry)

`model-3.glb` is a residential-house interior (LOD/collision mesh set), not a racing asset, so it was intentionally excluded from the game build. Check that all supplied assets are licensed for redistribution before making the Pages site public.

## Deployment

The `Deploy to GitHub Pages` workflow builds with the repository subpath and publishes `dist/` whenever a change lands on `main`. First-time setup is blocked until a repository admin enables **Settings → Pages → Build and deployment → Source: GitHub Actions**; the current GitHub integration cannot create the Pages site through the API. Once enabled, rerun the failed Pages workflow (or merge a new change). After its successful deployment, the site is available at `https://i-am-dev-god.github.io/SPACE-GOD/`.
