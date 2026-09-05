# Menova Studio

Web-based architectural visualisation on Vercel. Upload a `.glb`, get a shareable
link, and walk the space on desktop, tablet or Meta Quest — including a mixed
reality dollhouse mode and 4K render capture.

## Stack

| Concern            | Choice                                                        |
| ------------------ | ------------------------------------------------------------- |
| Framework          | Next.js App Router, React 19, TypeScript, Tailwind CSS v4      |
| Model storage      | Vercel Blob (client uploads via `@vercel/blob/client`)          |
| Project metadata   | Vercel Postgres (`@vercel/postgres`)                            |
| Rendering / XR     | three.js + Needle Engine component layer                        |

## Routes

| Path                     | What it does                                                    |
| ------------------------ | --------------------------------------------------------------- |
| `/`                      | Landing page                                                     |
| `/dashboard`             | Builder dashboard: drag-and-drop upload + project grid           |
| `/viewer/{project_id}`   | Public walkthrough (the link you send a client)                  |
| `POST /api/upload`       | Blob client-token handshake + `onUploadCompleted` webhook        |
| `GET /api/projects`      | Project list for the dashboard                                   |
| `POST /api/projects`     | Idempotent upload registration (localhost + webhook-race safe)   |
| `PATCH /api/projects`    | Replaces a project's hotspot list (`{ hotspots }`)               |
| `DELETE /api/projects`   | Deletes the blob, then the row                                   |

## Setup

```bash
npm install
cp .env.example .env.local   # then fill it in
npm run dev
```

Link the Vercel resources and pull their credentials:

```bash
vercel link && vercel blob store add && vercel env pull .env.local
```

The `projects` table is created on first use by `ensureSchema()` in
[`lib/db.ts`](lib/db.ts); no migration step is required to get started.

### Environment variables

See [`.env.example`](.env.example). The ones that matter most:

- `BLOB_READ_WRITE_TOKEN`, `POSTGRES_URL` — provisioned by Vercel.
- `AUTH_SECRET` — HMAC key for the session cookie (`openssl rand -hex 32`).
- `ALLOW_ANONYMOUS=true` — development only. Treats every caller as the `public`
  owner so the dashboard works before you wire up an identity provider.
- `ALLOWED_ORIGINS` — comma-separated cross-site origins, or `*`. Empty means
  same-origin only.
- `NEXT_PUBLIC_SITE_URL` — used to build shareable viewer links.

## Upload pipeline

The 100MB ceiling is enforced in three places, because any single one can be
bypassed:

1. **Browser** — `file.size` is checked before `upload()` runs, so an oversized
   file never leaves the machine and the user gets an immediate error modal.
2. **Token handshake** — `onBeforeGenerateToken` re-checks the declared size and
   the `.glb` extension, and sets `maximumSizeInBytes`, which makes Vercel Blob
   abort the transfer server-side if the real stream exceeds the limit.
3. **Registration** — `POST /api/projects` rejects an out-of-range `sizeBytes`.

Bytes travel browser → Blob directly, so the 4.5MB serverless request body limit
never applies.

### The `uploadRef` idempotency key

`onUploadCompleted` is a webhook from Vercel's infrastructure, so **it never
fires against `localhost`**. The browser therefore also registers the upload via
`POST /api/projects` once `upload()` resolves. Both paths carry the same
`uploadRef`, and the unique constraint on that column means whichever arrives
first creates the row while the other becomes a no-op returning the same record.

## Viewer

`app/viewer/[id]/page.tsx` resolves the Blob URL on the server, then
`ViewerCanvas.tsx` builds the WebGL scene:

- `.glb` loaded with `GLTFLoader` + Draco, Meshopt and KTX2 decoders.
- `centerModel()` puts the footprint on the origin with the floor slab on `Y=0`,
  which is what makes 1:1 mode line up with the physical floor in a headset.
- `detectTeleportSurfaces()` walks the triangles, transforms each face normal
  into world space and flags meshes that are mostly upward-facing, large enough
  to stand on and low enough to be a storey surface. Detection is area-weighted
  and sampled, so a 2M-triangle model costs the same as a 20k one.
- Hemisphere fill + soft directional key light, with the shadow camera fitted to
  the model's bounding radius.
- **Capture 4K Render** resizes the drawing buffer to 3840×2160 with
  `updateStyle = false`, renders one frame, reads it back with `toDataURL()` and
  restores the previous size, pixel ratio and camera aspect. This is why the
  renderer is created with `preserveDrawingBuffer: true`.

## XR presentation

`ArchPresentationController.ts` is the Needle Engine `Behaviour`; the runtime
logic lives in `ArchPresentationCore.ts`, which drives `WebGLRenderer.xr`
directly. Needle renders through that same renderer, so one implementation
serves both the Needle scene graph and the standalone viewer.

| Mode                  | Scale  | Background        | Anchor                                |
| --------------------- | ------ | ----------------- | ------------------------------------- |
| A — 1:1 walkthrough   | `1.0`  | Virtual skybox    | Floor at `Y=0`                        |
| B — Dollhouse / MR    | `0.02` | Passthrough       | XR hit-test surface (floor or table)  |
| C — AR 1:1 (phone)    | `1.0`  | Camera feed       | Tapped floor point = first hotspot    |

Switching tweens scale and position together with an ease-in-out cubic. The
loaded file is wrapped in a neutral `Group` whose origin is the footprint centre
on the floor, so scaling pivots there and FBX unit-normalising scales on the
file's own root are preserved (`walkScale` is read from the root, not assumed to
be 1).

### Hotspots

A project stores up to 40 hotspots (`hotspots JSONB` on `projects`), each a feet
position in model-local metres plus a heading. Builders author them in the
viewer with `?edit=1` (“Add hotspot here” captures the current pose) and save
through `PATCH /api/projects`. `src/viewer/Hotspots.ts` renders them as
billboarded sprites parented to the model root, so they ride along through the
dollhouse tween and AR placement. Selecting one glides the desktop rig
(`Locomotion.travelTo`) or teleports the XR rig with the saved yaw; the first
hotspot doubles as the AR entrance point.

### AR at 1:1 (WebXR on Android Chrome)

**View in your space** requests `immersive-ar` with `hit-test` and
`dom-overlay`. The model is hidden while a reticle tracks the floor; a tap
anchors the model so its entry point sits on the reticle, then the user walks the
building physically. The React HUD is passed as the overlay root, and
`beforexrselect` is cancelled on its buttons so pressing **Exit AR** never
doubles as a placement tap. iOS Safari has no WebXR, so the button only appears
where `isSessionSupported("immersive-ar")` is true.

**Palm menu.** The palm normal is derived geometrically from the wrist, index
metacarpal and pinky metacarpal joints — `(index − wrist) × (pinky − wrist)` for
a left hand, operands swapped for a right — rather than from a joint's own axes,
because joint-space conventions vary between runtimes while that triangle does
not. When `dot(palmNormal, toCamera) > 0.7` the holographic menu appears above
the wrist. A pinch (index tip to thumb tip under 2cm, releasing at 3cm) presses
the button the pinch started on.

**Fallback chain.** Hand tracking → Quest controllers (left thumbstick walks
relative to head yaw, right thumbstick snap-turns 45° around the head, trigger
ray teleports to a detected floor or selects a hotspot) → desktop WASD with
pointer-lock look → mobile touch, where the left half of the screen is a walk
joystick and the right half a look pad.

Hit-test poses arrive in the XR reference space, which is the player rig's local
frame, so they are mapped through `playerRig.localToWorld` before being used as
world anchors.

Passthrough requires an `immersive-ar` session: the blend mode is fixed when the
session is created, so entering through **Enter VR** and then switching to
dollhouse gives you the miniature against a black void rather than your room. The
controller reports this through `onNotice` instead of failing silently.

### Needle Engine and the three.js instance

`@needle-tools/engine` depends on its own three build, `@needle-tools/three`,
and a Needle project aliases `three` to it at bundle time. Two copies of three in
one graph means two sets of classes, so `instanceof` checks across the boundary
silently fail.

The split in this repo keeps that contained:

- `ArchPresentationController.ts` imports **types only** from `three`, so it
  compiles against whichever build the bundler resolves.
- `ArchPresentationCore.ts` imports three values and is what the standalone
  viewer instantiates directly.

If you move this component into a Needle-hosted scene, alias `three` to
`@needle-tools/three` in `next.config.mjs` so the core and the engine share one
instance:

```js
webpack: (config) => {
  config.resolve.alias.three = "@needle-tools/three";
  return config;
},
```

`TeleportTarget` is resolved at runtime rather than imported, so an engine
version that has moved the symbol degrades to raycast teleporting instead of
throwing at module load. Call `registerNeedleExports(NeedleModule)` once at
startup to hand the component your engine module.

## Notes and limits

- No multiplayer, by design.
- `ALLOW_ANONYMOUS` must be `false` in production; replace `lib/auth.ts` with
  your identity provider and call `createSessionValue()` to mint the cookie.
- `ensureSchema()` runs a `CREATE TABLE IF NOT EXISTS` on cold start. Move it to
  a build-time migration once the schema starts changing.
