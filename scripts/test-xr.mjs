import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ts from "typescript";
import { Box3, BoxGeometry, DoubleSide, Group, Mesh, MeshBasicMaterial, PerspectiveCamera,
  PlaneGeometry, Quaternion, Scene, Vector3 } from "three";

const root = new URL("../", import.meta.url);
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      const target = new URL(specifier.slice(2), root);
      if (existsSync(fileURLToPath(target) + ".ts")) target.pathname += ".ts";
      return { url: target.href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith(root.href) && url.endsWith(".ts") && !url.includes("/node_modules/")) {
      return { format: "module", shortCircuit: true, source: ts.transpileModule(
        readFileSync(new URL(url), "utf8"),
        { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } },
      ).outputText };
    }
    return nextLoad(url, context);
  },
});

globalThis.document = { createElement: () => ({ getContext: () => null }) };
const { ArchPresentationCore } = await import("../src/needle/ArchPresentationCore.ts");
const { detectTeleportSurfaces } = await import("../src/viewer/sceneSetup.ts");
const { exportQuickLook, supportsQuickLook } = await import("../src/viewer/quickLook.ts");
const { unzipSync, strFromU8 } = await import("three/examples/jsm/libs/fflate.module.js");

test("Quick Look support uses the native AR link capability without requiring WebXR", () => {
  const original = globalThis.document;
  try {
    globalThis.document = { createElement: () => ({ relList: { supports: (rel) => rel === "ar" } }) };
    assert.equal(supportsQuickLook(), true);
    globalThis.document = { createElement: () => ({ relList: { supports: () => false } }) };
    assert.equal(supportsQuickLook(), false);
    globalThis.document = { createElement: () => ({ relList: { supports: () => { throw new Error("Unsupported token"); } } }) };
    assert.equal(supportsQuickLook(), false);
    delete globalThis.document;
    assert.equal(supportsQuickLook(), false);
  } finally {
    globalThis.document = original;
  }
});

test("Quick Look exports a metre-scale USDZ without the viewer transform or overlays", async () => {
  const viewerRoot = new Group();
  viewerRoot.scale.setScalar(0.02);
  viewerRoot.position.set(20, 0, -30);
  const model = new Group();
  model.name = "Building";
  model.scale.setScalar(0.01);
  const material = new MeshBasicMaterial({ color: 0x228866 });
  let materialDisposed = false;
  material.addEventListener("dispose", () => { materialDisposed = true; });
  const mesh = new Mesh(new BoxGeometry(200, 300, 400), material);
  mesh.name = "BuildingMesh";
  model.add(mesh);
  const overlay = new Mesh(new BoxGeometry(), material);
  overlay.name = "HotspotOverlay";
  viewerRoot.add(model, overlay);
  viewerRoot.updateMatrixWorld(true);
  const before = mesh.matrixWorld.clone();
  const blob = await exportQuickLook(model);
  assert.equal(blob.type, "model/vnd.usdz+zip");
  const archive = unzipSync(new Uint8Array(await blob.arrayBuffer()));
  const scene = strFromU8(archive["model.usda"]);
  assert.match(scene, /metersPerUnit = 1/);
  assert.match(scene, /BuildingMesh/);
  assert.match(scene, /preliminary:planeAnchoring:alignment = "horizontal"/);
  assert.doesNotMatch(scene, /HotspotOverlay/);
  assert.match(scene, /0\.01/);
  assert.equal(model.parent, viewerRoot);
  assert.equal(mesh.material, material);
  assert.equal(materialDisposed, false);
  assert.ok(mesh.matrixWorld.equals(before));
  mesh.geometry.dispose();
  overlay.geometry.dispose();
  material.dispose();
});

test("Quick Look rejects empty models instead of producing a blank AR asset", async () => {
  await assert.rejects(exportQuickLook(new Group()), /no visible surfaces/);
});

function fixture() {
  const scene = new Scene();
  const playerRig = new Group();
  const camera = new PerspectiveCamera();
  camera.position.set(0.2, 1.65, 0.1);
  playerRig.add(camera);
  scene.add(playerRig);
  const modelRoot = new Group();
  scene.add(modelRoot);
  const hands = [new Group(), new Group()];
  for (const hand of hands) {
    hand.joints = {};
    hand.visible = false;
  }
  const controllers = [new Group(), new Group()];
  const session = { environmentBlendMode: "alpha-blend", inputSources: [], end: async () => {} };
  const xr = {
    isPresenting: true,
    getHand: (index) => hands[index],
    getController: (index) => controllers[index],
    getSession: () => session,
    getReferenceSpace: () => ({}),
    addEventListener() {}, removeEventListener() {},
  };
  const renderer = { xr, setClearColor() {}, setClearAlpha() {} };
  const changes = [];
  const notices = [];
  const core = new ArchPresentationCore({ renderer, scene, camera, playerRig, modelRoot,
    teleportSurfaces: [], onPlacementChange: (value) => changes.push(value),
    onNotice: (message) => notices.push(message) });
  core.onSessionStart();
  core.setMode("ar", true);
  return { core, scene, playerRig, camera, modelRoot, hands, controllers, session, xr, changes, notices };
}

function closeVector(actual, expected) {
  assert.ok(actual.distanceTo(expected) < 1e-6, `${actual.toArray()} != ${expected.toArray()}`);
}

function hitFrame(position, orientation = new Quaternion()) {
  return { getHitTestResults: () => [{ getPose: () => ({ transform: { position, orientation } }) }] };
}

test("MR stays hidden until a detected floor is selected and remains anchored", () => {
  const { core, modelRoot, controllers } = fixture();
  assert.equal(modelRoot.visible, false);
  core.hitTestRequested = true;
  core.hitTestSource = {};
  core.updateHitTest(hitFrame(new Vector3(1, 0, -2)));
  assert.equal(core.isPlaced, false);
  assert.equal(core.placementReticle.visible, true);
  core.onSelectStart({ target: controllers[0] });
  core.onSelectEnd({ target: controllers[0] });
  assert.equal(core.isPlaced, true);
  assert.equal(modelRoot.visible, true);
  const placed = modelRoot.position.clone();
  core.updateHitTest(hitFrame(new Vector3(5, 0, -8)));
  closeVector(modelRoot.position, placed);
});

test("walls, tables, lost poses and lost hits never retain a placement target", () => {
  const { core } = fixture();
  core.hitTestRequested = true;
  core.hitTestSource = {};
  core.updateHitTest(hitFrame(new Vector3(0, 0, -2)));
  core.updateHitTest(hitFrame(new Vector3(0, 0.8, -2)));
  assert.equal(core.reticlePoint, null);
  core.updateHitTest(hitFrame(new Vector3(0, 0, -2), new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2)));
  assert.equal(core.reticlePoint, null);
  core.updateHitTest({ getHitTestResults: () => [{ getPose: () => null }] });
  assert.equal(core.reticlePoint, null);
  core.updateHitTest({ getHitTestResults: () => [] });
  assert.equal(core.placementReticle.visible, false);
});

test("scaling preserves the rotated entrance anchor and clamps to 2%-200%", () => {
  const { core, modelRoot } = fixture();
  const entry = new Vector3(2, 0, -1);
  const anchor = new Vector3(4, 0, -5);
  modelRoot.rotation.y = Math.PI / 3;
  core.setEntryPoint(entry);
  core.placeAt(anchor);
  for (const scale of [0.02, 0.5, 1, 2]) {
    core.setScale(scale);
    closeVector(modelRoot.localToWorld(entry.clone()), anchor);
    assert.equal(modelRoot.scale.x, scale);
  }
  core.setScale(100);
  assert.equal(core.getScale(), 2);
  core.setScale(-1);
  assert.equal(core.getScale(), 0.02);
  core.setScale(NaN);
  assert.equal(core.getScale(), 0.02);
});

test("re-placement clears old hit and teleport targets", () => {
  const { core, modelRoot, changes } = fixture();
  core.placeAt(new Vector3());
  core.reticlePoint = new Vector3(4, 0, 4);
  core.teleportPoint = new Vector3(2, 0, 2);
  core.resetPlacement();
  assert.equal(core.isPlaced, false);
  assert.equal(modelRoot.visible, false);
  assert.equal(core.reticlePoint, null);
  assert.equal(core.teleportPoint, null);
  assert.equal(changes.at(-1), false);
});

test("MR room teleport moves the building, never the physical tracking rig", () => {
  const { core, playerRig, camera, modelRoot } = fixture();
  core.placeAt(new Vector3(0, 0, -2));
  const destination = new Vector3(2, 1, -3);
  const target = modelRoot.localToWorld(destination.clone());
  const rigBefore = playerRig.position.clone();
  core.teleportRigTo(target);
  closeVector(playerRig.position, rigBefore);
  const feet = camera.getWorldPosition(new Vector3());
  feet.y = playerRig.position.y;
  closeVector(modelRoot.localToWorld(destination.clone()), feet);
  const anchor = modelRoot.localToWorld(core.entryPoint.clone());
  core.setScale(0.5);
  closeVector(modelRoot.localToWorld(core.entryPoint.clone()), anchor);
});

test("fingertip contact activates once until withdrawn and cannot also place", () => {
  const { core, hands, controllers } = fixture();
  const finger = new Group();
  hands[1].visible = true;
  hands[1].joints["index-finger-tip"] = finger;
  hands[1].add(finger);
  core.menuHand = hands[0];
  core.menuVisible = true;
  const button = core.menuButtons.find((item) => item.action === "smaller");
  const state = core.hands[1];
  finger.position.copy(button.root.getWorldPosition(new Vector3()));
  core.updateHandTouch(state);
  assert.equal(core.getScale(), 0.8);
  for (let frame = 0; frame < 20; frame++) core.updateHandTouch(state);
  assert.equal(core.getScale(), 0.8);
  core.reticlePoint = new Vector3(0, 0, -3);
  core.onSelectStart({ target: controllers[1] });
  core.onSelectEnd({ target: controllers[1] });
  assert.equal(core.isPlaced, false);
  finger.position.z += 0.1;
  core.updateHandTouch(state);
  core.touchBlockedUntil = 0;
  finger.position.z -= 0.1;
  core.updateHandTouch(state);
  assert.equal(core.getScale(), 0.64);
});

test("button corners are hittable without overlapping neighboring buttons", () => {
  const { core } = fixture();
  for (const button of core.menuButtons) {
    const point = button.root.localToWorld(new Vector3(0.049, 0.021, 0.01));
    assert.equal(core.findButtonAt(point), button);
    assert.equal(core.findButtonAt(button.root.localToWorld(new Vector3(0, 0, 0.08))), null);
  }
});

test("hand target-ray select activates a menu button without floor placement", () => {
  const { core, controllers } = fixture();
  const button = core.menuButtons.find((item) => item.action === "smaller");
  core.menu.visible = true;
  core.menuVisible = true;
  controllers[0].position.copy(button.root.getWorldPosition(new Vector3())).add(new Vector3(0, 0, 0.4));
  core.reticlePoint = new Vector3(0, 0, -2);
  core.onSelectStart({ target: controllers[0] });
  core.onSelectEnd({ target: controllers[0] });
  assert.equal(core.getScale(), 0.8);
  assert.equal(core.isPlaced, false);
});

test("only the pointer owning a target can complete its selection", () => {
  const { core, controllers } = fixture();
  core.reticlePoint = new Vector3(0, 0, -2);
  core.onSelectStart({ target: controllers[0] });
  core.onSelectStart({ target: controllers[1] });
  core.onSelectEnd({ target: controllers[1] });
  assert.equal(core.isPlaced, false);
  core.onSelectEnd({ target: controllers[0] });
  assert.equal(core.isPlaced, true);
});

test("unavailable hit-test never silently places at the user's feet", () => {
  const { core, notices } = fixture();
  core.updateHitTest({});
  assert.equal(core.isPlaced, false);
  assert.match(notices.at(-1), /unavailable/);
});

test("teleport ray cannot pass through a wall to a room floor", () => {
  const { core, controllers, modelRoot } = fixture();
  core.placeAt(new Vector3());
  const floor = new Mesh(new PlaneGeometry(10, 10).rotateX(-Math.PI / 2), new MeshBasicMaterial({ side: DoubleSide }));
  modelRoot.add(floor);
  core.teleportSurfaces.push(floor);
  controllers[0].position.set(0, 1.5, 2);
  controllers[0].lookAt(0, 0, -2);
  controllers[0].rotateY(Math.PI);
  core.onSelectStart({ target: controllers[0] });
  core.updateControllerRay();
  assert.ok(core.teleportPoint);
  const wall = new Mesh(new BoxGeometry(5, 3, 0.2), new MeshBasicMaterial());
  wall.position.set(0, 1.5, 0);
  modelRoot.add(wall);
  core.updateControllerRay();
  assert.equal(core.teleportPoint, null);
});

test("floor detection handles a mesh rotated into a horizontal floor", () => {
  const rootObject = new Group();
  const floor = new Mesh(new PlaneGeometry(4, 4), new MeshBasicMaterial());
  floor.rotation.x = -Math.PI / 2;
  rootObject.add(floor);
  const box = new Box3().setFromObject(rootObject);
  const bounds = { box, size: new Vector3(4, 2, 4), radius: 3 };
  assert.equal(detectTeleportSurfaces(rootObject, bounds)[0]?.mesh, floor);
});

test("session end restores the pre-XR rig and clears placement", () => {
  const { core, playerRig, modelRoot } = fixture();
  core.placeAt(new Vector3(2, 0, -3));
  playerRig.position.set(20, 3, -15);
  core.onSessionEnd();
  closeVector(playerRig.position, new Vector3());
  assert.equal(core.isPlaced, false);
  assert.equal(core.getMode(), "walkthrough");
  assert.equal(modelRoot.visible, true);
});

test("explicit placement requires a current floor hit", () => {
  const { core } = fixture();
  core.placeOnDetectedFloor();
  assert.equal(core.isPlaced, false);
  core.hitTestRequested = true;
  core.hitTestSource = {};
  core.updateHitTest(hitFrame(new Vector3(0, 0, -2)));
  assert.equal(core.floorDetected, true);
  core.placeOnDetectedFloor();
  assert.equal(core.isPlaced, true);
  assert.equal(core.floorDetected, false);
  core.resetPlacement();
  assert.equal(core.floorDetected, false);
});

test("hand Rooms menu paginates all hotspots and teleports only after placement", () => {
  const { core, modelRoot, camera, playerRig } = fixture();
  const hotspots = Array.from({ length: 10 }, (_, index) => ({
    id: `room-${index}`, label: `Room ${index + 1}`, position: { x: index + 1, y: 0, z: -3 }, yaw: 0,
  }));
  core.setHotspots(hotspots);
  core.activateButton(core.menuButtons.find((button) => button.action === "rooms"));
  assert.equal(core.menuButtons.filter((button) => button.hotspot).length, 4);
  const first = core.menuButtons.find((button) => button.hotspot);
  const before = modelRoot.position.clone();
  core.activateButton(first);
  closeVector(modelRoot.position, before);
  core.placeAt(new Vector3());
  core.activateButton(first);
  const feet = camera.getWorldPosition(new Vector3());
  feet.y = playerRig.position.y;
  closeVector(modelRoot.localToWorld(new Vector3(1, 0, -3)), feet);
  core.activateButton(core.menuButtons.find((button) => button.action === "next"));
  assert.equal(core.menuButtons.find((button) => button.hotspot).hotspot.id, "room-4");
  core.activateButton(core.menuButtons.find((button) => button.action === "next"));
  assert.equal(core.menuButtons.filter((button) => button.hotspot).length, 2);
  core.setHotspots(hotspots.slice(0, 2));
  assert.equal(core.roomPage, 0);
  assert.equal(core.menuButtons.filter((button) => button.hotspot).length, 2);
  core.setHotspots([]);
  assert.ok(core.menuButtons.some((button) => button.label === "No hotspots"));
  core.activateButton(core.menuButtons.find((button) => button.action === "controls"));
  assert.ok(core.menuButtons.some((button) => button.action === "rooms"));
});

test("holding a fingertip through a Rooms page change does not activate the new button", () => {
  const { core, hands } = fixture();
  core.setHotspots(Array.from({ length: 8 }, (_, index) => ({
    id: `room-${index}`, label: `Room ${index}`, position: { x: index, y: 0, z: -2 }, yaw: 0,
  })));
  const finger = new Group();
  hands[1].visible = true;
  hands[1].joints["index-finger-tip"] = finger;
  hands[1].add(finger);
  core.menuHand = hands[0];
  core.menuVisible = true;
  core.menu.visible = true;
  const rooms = core.menuButtons.find((button) => button.action === "rooms");
  finger.position.copy(rooms.root.getWorldPosition(new Vector3()));
  core.updateHandTouch(core.hands[1]);
  assert.equal(core.menuView, "rooms");
  core.touchBlockedUntil = 0;
  core.updateHandTouch(core.hands[1]);
  assert.equal(core.roomPage, 0);
  finger.position.z += 0.1;
  core.updateHandTouch(core.hands[1]);
  finger.position.z -= 0.1;
  core.touchBlockedUntil = 0;
  core.updateHandTouch(core.hands[1]);
  assert.equal(core.roomPage, 1);
});