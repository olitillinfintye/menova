# Archviz

Architectural visualization, powered by Menova Studio.

Web-based architectural visualisation on Vercel. Upload a `.glb`, get a shareable
link, and walk the space on desktop, tablet or Meta Quest — including a mixed
reality dollhouse mode and 4K render capture.

## Android App

The native Android wrapper opens the main page without a native toolbar and includes
the Archviz launcher icon, animated loading screen, upload picker, and connection retry.
Run `npm run android:build` to create `artifacts/archviz-debug.apk` for direct
installation on Android 8.0+. The build also publishes `public/downloads/archviz.apk`
for the website's **Download APK** button; build the APK before deploying the site.
This APK is debug-signed for direct installation, not a Play Store release.
Open Archviz leads to the public library; Back to home returns to the main page.
See [Android setup and limits](android/README.md). The app loads the hosted website
and requires an internet connection.

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
| `/dashboard`             | Public library of published projects, with no upload controls   |
| `/viewer/{project_id}`   | Public walkthrough (the link you send a client)                  |
| `POST /api/upload`       | Admin-only upload tokens + signed `onUploadCompleted` webhook    |
| `GET /api/projects`      | Published projects; admins can also list hidden projects         |
| `POST /api/projects`     | Admin-only idempotent upload registration                        |
| `PATCH /api/projects`    | Updates hotspots (`{ hotspots }`) or admin-only visibility (`{ isPublic }`) |
| `DELETE /api/projects`   | Admin-only: deletes the blob, then the row                       |
| `/api/admin/thumbnails` | Admin-only thumbnail save (`PUT`) and removal (`DELETE`)         |
| `POST /api/admin/thumbnails/upload` | Admin-only image upload tokens                        |

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
- `ALLOW_ANONYMOUS=true` — development only. Enables general model sessions for
  legacy hotspot operations, but never grants admin or model upload permissions.
  The public library and published viewer links do not require this setting.
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

## Contact Enquiries and Admin

- `/contact` collects a name, email, optional phone/company, and project requirements.
- `/admin` shows actual enquiry counts, unique emails, model storage, monthly activity,
  enquiry statuses, and model formats. These are database metrics, not visitor tracking.
- `/admin/models` provides model upload, thumbnails, share, hotspot, visibility, and delete controls.
- `/admin/homepage` edits homepage text, links, solution cards, workflow steps, and the
  hero image, with draft changes, explicit publishing, and restoration of the defaults.
- `/admin/videos` manages the homepage and devices videos independently, with previews,
  upload progress, saving, and restoration of the bundled default video.
- `/admin/contacts` provides private search, status filters, pagination, email/phone links,
  project details, and New / Contacted / Closed status updates.
- `/admin/profile` changes the admin password after confirming the current password.

Set `ADMIN_PASSWORD` to an initial password (8 characters minimum; a unique 16+ character
password is recommended) and `AUTH_SECRET` to a random secret of at least 32 characters
in `.env.local` and your deployment's environment settings. Never put either value in
a `NEXT_PUBLIC_` variable or commit them. Restart or redeploy after changing environment
configuration. The initial password is salted and hashed with scrypt in the private
`admin_credentials` table on first use; only the hash is stored in the database. There
is no default admin password. Once initialized, the stored password takes precedence:
changing `ADMIN_PASSWORD` cannot reset it or overwrite a profile password change.
The bootstrap variable can be removed after initialization.

Sign in at `/admin/login`, then open the profile icon or `/admin/profile` to change the
password. New profile passwords require at least 16 characters and the correct current
password. A change rotates the credential version and signs out all other admin sessions;
the current browser receives a new session. Signed, HTTP-only, SameSite=Strict cookies
expire after eight hours and are Secure in production. Rotate `AUTH_SECRET` to revoke
all sessions without changing the stored password. Keep the same database and signing
secret configured in the target deployment; neither is provided by a GitHub push.

The existing `POSTGRES_URL` connection is reused. On first submission, the server
creates `contact_inquiries` and `request_limits` if needed. No additional service is
required. The public contact endpoint is POST-only; enquiry reads and updates require
the separate admin session even when `ALLOW_ANONYMOUS=true`. Admin model uploads use
the existing shared `public` workspace owner. Set `ALLOW_ANONYMOUS=false` to disable
anonymous access to general model mutations; the public library, published viewer links,
and contact form remain available. The public library is not an admin login.

Only admins can upload or register new models. The public library always requests
`/api/projects?public=1`, so it excludes hidden models even for a signed-in admin.
Signed Vercel Blob completion callbacks remain supported without browser cookies.

Each admin model card can upload, preview, save, replace, or remove a thumbnail.
Images accept JPG, PNG, or WebP up to 5 MB and upload directly to Vercel Blob.
The server verifies the project-specific path, stored type, and actual file size
before saving the trusted URL. The nullable `thumbnail_url` column is added on
first use. Existing projects and failed image loads keep the generated cover.
Replacing or removing a thumbnail retains earlier images in Blob storage.

Only signed-in admins can delete models or change their visibility, even when anonymous
model access is enabled. In `/admin/models`, each model has a **Public / Hidden** switch.
Hidden models stay in the admin workspace but are excluded from public model lists;
their viewer pages and metadata return not found to visitors. Admins can still preview
them. Existing and newly uploaded models default to Public. The `is_public` column is
added automatically by the existing schema setup.

Visibility controls website access, not file revocation: files use public Vercel Blob
storage, so a direct file URL that was already shared or downloaded remains accessible.
Use private storage and authenticated downloads if file-level confidentiality is required.

Site videos accept MP4 or WebM files up to 100 MB. Choosing a file creates a local preview;
**Save video** uploads it directly to Vercel Blob and publishes it to the selected section.
The save endpoint verifies the stored file's path, type, and size. Video upload, save, and
reset endpoints require an admin session and reject cross-site requests. Selections use
the existing `POSTGRES_URL` connection in an automatically created `site_videos` table.
Homepage requests load the latest saved selections without a rebuild. Both sections use
the bundled video until a custom video is saved. Restoring a default does not delete
previous uploads from Blob storage. The admin page reports storage failures; the public
homepage falls back to the bundled video when settings cannot be loaded.

Homepage content uses the same database connection in an automatically created
`site_content` table. **Save homepage** publishes all seven sections together; subsequent
homepage requests show the saved content without a rebuild. Concurrent edits are checked
by revision, so an older editor cannot silently overwrite a newer save. Public reads
fall back to the original content on storage failure; the admin editor reports failures
and retains its draft. Restoring defaults leaves video selections unchanged.

Hero images accept a site path, an HTTPS URL, or a JPG, PNG, or WebP upload up to 5 MB.
Uploads are staged until Save and their stored metadata is verified before publication.
Replaced images remain in Blob storage. Homepage reads, saves, restores, and upload-token
endpoints under `/api/admin/homepage` require an admin session; mutations also reject
cross-site requests. Content is rendered as plain text, with bounded fields and validated
links. Supported model formats and technical upload limits remain application settings.

Submissions have server-side field/body limits, parameterized SQL, duplicate protection,
and a hidden spam trap. Login and contact requests are limited to ten attempts per
15 minutes per client using Vercel's trusted forwarded IP header; outside Vercel the
limit uses a shared bucket. A different hosting proxy should supply an explicitly
trusted client-address strategy before deployment. Neither raw IP addresses nor
contact bodies are logged. Enquiries remain in the database until an operator removes
them; define a retention policy appropriate to your business.

Run `npm run test:contact`, `npm run test:admin`, `npm run test:media`,
`npm run test:thumbnails`, and `npm run build` to verify input validation, origin checks,
throttling, private access, library visibility, media settings, session expiry, and compilation.

## XR presentation

`ArchPresentationController.ts` is the Needle Engine `Behaviour`; the runtime
logic lives in `ArchPresentationCore.ts`, which drives `WebGLRenderer.xr`
directly. Needle renders through that same renderer, so one implementation
serves both the Needle scene graph and the standalone viewer.

| Mode                  | Scale  | Background        | Anchor                                |
| --------------------- | ------ | ----------------- | ------------------------------------- |
| A — 1:1 walkthrough   | `1.0`  | Virtual skybox    | Floor at `Y=0`                        |
| B — Dollhouse preview | `0.02` | Desktop preview  | Model footprint                       |
| C — Mixed reality     | `0.02`–`2.0` | Passthrough | Selected real floor = first hotspot |

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
(`Locomotion.travelTo`) or teleports the VR rig with the saved yaw; the first
hotspot doubles as the MR entrance point. In MR, selecting a hotspot translates
the building so that hotspot lands at the user's physical feet, without rotating
or moving the tracked rig.

### iPhone and iPad AR

Supported iOS browsers use Apple AR Quick Look instead of requiring WebXR.
Once the model loads, the viewer prepares a metre-scale USDZ automatically;
**View in your space** is then a native `rel="ar"` link with a single image
child, activated directly by the user's tap. Failed preparation offers **Retry AR**.
Quick Look detection also covers known iOS Chrome, Firefox, Edge and DuckDuckGo
browsers that do not advertise AR-link support. Unsupported embedded browsers
should open the viewer in Safari.

Quick Look provides its own placement and scaling controls. Viewer hotspots,
the hand menu and dollhouse transforms are excluded from the export. The USDZ
object URL is released when the viewer closes. Native camera placement must be
verified on a physical iPhone or iPad; browser simulations only check export and
launch behavior.

### Floor-First Mixed Reality

On WebXR-capable browsers, **Mixed Reality · Room Scale** and **View in your space**
start `immersive-ar` with required `local-floor` and `hit-test`, plus optional DOM
overlay. Hand tracking is requested only for `immersive-vr`.
The model starts hidden at a requested 1:1 scale. An upward-facing hit
within 30cm of the runtime's calibrated floor shows a placement reticle; walls
and tables are rejected. Aim at the floor and pinch/trigger, tap the phone screen,
or use **Place model** once **Floor detected** appears. Placement is explicit and
does not follow subsequent gaze movement. No floor support means no silent
placement at guessed coordinates.

The entrance is the first hotspot, falling back to the centred model origin.
Use the on-screen slider to scale from 2% to 200%;
**1:1** restores 100%. Scaling keeps the entrance anchored, including after a
room teleport. **Re-place** hides the model and requires a fresh floor hit.
The HUD cancels `beforexrselect` so its buttons cannot also place or teleport.

**VR-only palm menu.** Wrist and floating controller menus are visible and
interactive only during `immersive-vr`, using the requested session type rather
than background blending or presentation mode. AR, desktop and touch views
clear menu targets and cannot activate menu buttons. The palm normal is derived geometrically from the wrist, index
metacarpal and pinky metacarpal joints — `(index − wrist) × (pinky − wrist)` for
a left hand, operands swapped for a right — rather than from a joint's own axes,
because joint-space conventions vary between runtimes while that triangle does
not. When `dot(palmNormal, toCamera) > 0.7` the holographic menu appears above
the wrist. Touch a button with the other index fingertip, or aim the runtime's
hand ray and pinch/release to select. Touch is detected against the button's
rectangular face with an 18mm depth threshold; move the fingertip at least 65mm
from the last touch before another press. A short debounce prevents
touches from becoming duplicate ray selections. The menu offers MR, VR walk,
scale down/up, 1:1, re-placement, exit, and **Rooms**. Rooms shows four saved
hotspots per page with previous/next controls. Touch a room or select it with a
hand/controller ray to teleport in VR. Physical controllers get a floating
ray-selectable menu. Three.js primitive hand models provide visible hand feedback.

**Fallback chain.** Hand tracking → Quest controllers (left thumbstick walks
relative to head yaw, right thumbstick snap-turns 45° around the head, trigger
ray teleports to a detected floor or selects a hotspot) → desktop WASD with
pointer-lock look → mobile touch, where the left half of the screen is a walk
joystick and the right half a look pad.

Hand pinch and controller trigger use the same teleport selection path. After
MR placement, aim at a model floor or room hotspot and release to teleport.
Floor rays stop at the first model mesh, so a wall blocks teleporting through it.
In MR, teleporting translates the virtual building instead of the physical
tracking rig; virtual stairs/floors are brought to the user's real floor level.
Smooth thumbstick movement and snap-turn remain VR-only. Real obstacles are not
detected or removed: keep the headset's safety boundary enabled and a clear space.

Hit-test poses arrive in the XR reference space, which is the player rig's local
frame, so they are mapped through `playerRig.localToWorld` before being used as
world anchors.

Passthrough requires an `immersive-ar` session. Switching an opaque VR session
to MR is rejected with a notice; exit VR and enter Mixed Reality instead.
Session exit clears placement/selection state and restores the pre-XR rig.

Use a compatible Quest browser or Android Chrome with AR support and spatial
permissions. The Android APK's WebView does not provide full WebXR: use its
**Open XR in browser** action in the viewer. Model units determine whether 100% is physically
accurate; the app cannot infer an incorrectly exported model's real dimensions.

### XR Verification

`npm run test:xr` runs the actual presentation core against simulated XR frames,
hands, controller rays, and Three.js geometry (Node 22.15+ / 24 recommended).
`npm run build` includes the production TypeScript check.

For browser smoke checks, install Playwright/Chromium separately, set
`PLAYWRIGHT_MODULE` to its `playwright/index.mjs`, and run
`node scripts/check-viewer.mjs` against the running dev server. Optional
`VIEWER_ORIGIN` and `VIEWER_PATH` select another deployment/project. It uses an
existing project without changing its data, captures desktop/mobile screenshots,
and checks canvas pixels, mode controls, viewport bounds, and runtime errors.
Browser checks simulate XR capability discovery, not an immersive session.
Actual floor calibration, passthrough, tracking loss, touch ergonomics, placement,
scaling, and room teleportation still require an on-headset smoke test.

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
