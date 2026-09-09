import {
  Box3,
  Color,
  DirectionalLight,
  HemisphereLight,
  Mesh,
  type Object3D,
  PCFSoftShadowMap,
  type Scene,
  Sphere,
  Triangle,
  Vector3,
  type WebGLRenderer,
} from "three";

/** Result of normalising a freshly loaded model. */
export interface ModelBounds {
  /** World-space bounding box after centring. */
  box: Box3;
  /** Box dimensions in metres. */
  size: Vector3;
  /** Bounding sphere radius, used to frame the camera and shadow volume. */
  radius: number;
  /** The model's footprint centre, before it was moved. */
  originalCenter: Vector3;
}

/**
 * Centres a model horizontally on the origin and drops it onto the Y=0 plane.
 *
 * Architectural exports arrive in survey coordinates that can be kilometres
 * from the origin, which destroys float precision and breaks XR teleportation.
 * Sitting the floor slab exactly on Y=0 is also what makes 1:1 walkthrough mode
 * line up with the physical floor on a headset.
 */
export function centerModel(root: Object3D): ModelBounds {
  root.updateWorldMatrix(true, true);

  const box = new Box3().setFromObject(root);

  if (box.isEmpty()) {
    throw new Error("The model contains no renderable geometry.");
  }

  const center = box.getCenter(new Vector3());
  const size = box.getSize(new Vector3());

  // X/Z to the origin, Y so the lowest point rests on the ground plane.
  root.position.x -= center.x;
  root.position.z -= center.z;
  root.position.y -= box.min.y;
  root.updateWorldMatrix(true, true);

  const centeredBox = new Box3().setFromObject(root);
  const sphere = centeredBox.getBoundingSphere(new Sphere());

  return {
    box: centeredBox,
    size,
    radius: Math.max(sphere.radius, 0.001),
    originalCenter: center,
  };
}

/** Turns on shadow casting/receiving and disables frustum-culling artefacts. */
export function enableShadows(root: Object3D): void {
  root.traverse((child) => {
    if (!(child instanceof Mesh)) return;
    child.castShadow = true;
    child.receiveShadow = true;

    // Large architectural meshes frequently ship without bounds; without them
    // frustum culling pops entire walls in and out of view.
    if (child.geometry && !child.geometry.boundingSphere) {
      child.geometry.computeBoundingSphere();
    }
  });
}

export interface LightingHandles {
  hemisphere: HemisphereLight;
  sun: DirectionalLight;
  dispose: () => void;
}

/**
 * Adds a hemisphere fill plus a soft directional key light sized to the model.
 *
 * The shadow camera is fitted to the bounding radius so a 4m apartment and a
 * 200m tower both get usable shadow texel density.
 */
export function createLighting(
  scene: Scene,
  radius: number,
  renderer?: WebGLRenderer,
): LightingHandles {
  const hemisphere = new HemisphereLight(
    new Color(0xdfe9ff), // cool sky
    new Color(0x5a4f45), // warm bounce from the ground
    2.2,
  );
  hemisphere.position.set(0, radius * 2, 0);
  scene.add(hemisphere);

  const sun = new DirectionalLight(0xfff4e6, 2.6);
  sun.position.set(radius * 1.2, radius * 2.0, radius * 0.9);
  sun.castShadow = true;

  const extent = Math.max(radius * 1.6, 2);
  sun.shadow.camera.left = -extent;
  sun.shadow.camera.right = extent;
  sun.shadow.camera.top = extent;
  sun.shadow.camera.bottom = -extent;
  sun.shadow.camera.near = 0.1;
  sun.shadow.camera.far = radius * 6 + 10;
  // 2048 keeps Quest 3 comfortably inside its fill-rate budget; desktop can
  // afford 4096.
  const shadowSize = renderer?.capabilities.isWebGL2 && !isLikelyStandalone() ? 4096 : 2048;
  sun.shadow.mapSize.set(shadowSize, shadowSize);
  sun.shadow.bias = -0.0008;
  sun.shadow.normalBias = Math.max(0.02, radius * 0.002);
  sun.target.position.set(0, 0, 0);

  scene.add(sun);
  scene.add(sun.target);

  if (renderer) {
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = PCFSoftShadowMap;
  }

  return {
    hemisphere,
    sun,
    dispose: () => {
      scene.remove(hemisphere, sun, sun.target);
      hemisphere.dispose();
      sun.dispose();
      sun.shadow.map?.dispose();
    },
  };
}

/** Rough standalone-headset heuristic used only to pick shadow resolution. */
function isLikelyStandalone(): boolean {
  if (typeof navigator === "undefined") return false;
  return /OculusBrowser|Quest|Pico|Wolvic/i.test(navigator.userAgent);
}

export interface TeleportDetectionOptions {
  /** Faces whose world normal is within this angle of +Y count as walkable. */
  maxSlopeDegrees?: number;
  /** Minimum upward-facing area, in square metres, for a mesh to qualify. */
  minAreaSquareMetres?: number;
  /** Upward area must be at least this fraction of the mesh's total area. */
  minUpwardRatio?: number;
  /** Ignore surfaces above this height, relative to the model's total height. */
  maxRelativeHeight?: number;
  /** Upper bound on triangles inspected per mesh; larger meshes are sampled. */
  maxTrianglesPerMesh?: number;
}

export interface TeleportSurface {
  mesh: Mesh;
  /** Upward-facing world area in square metres. */
  upwardArea: number;
  /** Mean world-space height of the upward-facing faces. */
  averageHeight: number;
}

/**
 * Finds meshes that behave like floors, terraces or stair landings.
 *
 * Rather than trusting object names (which differ per authoring tool) this
 * walks the triangles, transforms each face normal into world space and
 * accumulates area-weighted statistics. Meshes that are mostly upward facing,
 * big enough to stand on and low enough to be a storey surface are returned and
 * flagged in `userData.menovaTeleport` so the XR layer can attach Needle
 * Engine's `TeleportTarget` component to them.
 */
export function detectTeleportSurfaces(
  root: Object3D,
  bounds: ModelBounds,
  options: TeleportDetectionOptions = {},
): TeleportSurface[] {
  const {
    maxSlopeDegrees = 15,
    minAreaSquareMetres = 0.75,
    minUpwardRatio = 0.12,
    maxRelativeHeight = 0.95,
    maxTrianglesPerMesh = 20000,
  } = options;

  const minNormalY = Math.cos((maxSlopeDegrees * Math.PI) / 180);
  const heightLimit = bounds.box.min.y + bounds.size.y * maxRelativeHeight;

  const surfaces: TeleportSurface[] = [];

  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  const normal = new Vector3();
  const edge1 = new Vector3();
  const edge2 = new Vector3();

  root.updateWorldMatrix(true, true);

  root.traverse((child) => {
    if (!(child instanceof Mesh) || !child.geometry) return;

    const geometry = child.geometry;
    const position = geometry.getAttribute("position");
    if (!position) return;

    const index = geometry.getIndex();
    const triangleCount = (index ? index.count : position.count) / 3;
    if (triangleCount < 1) return;

    // Sample uniformly on very dense meshes so detection stays O(constant).
    const stride = Math.max(1, Math.ceil(triangleCount / maxTrianglesPerMesh));
    const sampledFraction = 1 / stride;

    // Sampled sums; scaled back to full-mesh values after the loop.
    let sampledUpwardArea = 0;
    let sampledTotalArea = 0;
    let weightedHeight = 0;

    for (let tri = 0; tri < triangleCount; tri += stride) {
      const i0 = index ? index.getX(tri * 3) : tri * 3;
      const i1 = index ? index.getX(tri * 3 + 1) : tri * 3 + 1;
      const i2 = index ? index.getX(tri * 3 + 2) : tri * 3 + 2;

      a.fromBufferAttribute(position, i0).applyMatrix4(child.matrixWorld);
      b.fromBufferAttribute(position, i1).applyMatrix4(child.matrixWorld);
      c.fromBufferAttribute(position, i2).applyMatrix4(child.matrixWorld);

      // 1/2 |AB x AC|
      const area = edge1.subVectors(b, a).cross(edge2.subVectors(c, a)).length() * 0.5;
      if (!Number.isFinite(area) || area <= 0) continue;

      sampledTotalArea += area;

      Triangle.getNormal(a, b, c, normal);

      // Double-sided floor slabs can be wound either way; treat |n.y| as up.
      if (Math.abs(normal.y) >= minNormalY) {
        const height = (a.y + b.y + c.y) / 3;
        if (height <= heightLimit) {
          sampledUpwardArea += area;
          weightedHeight += height * area;
        }
      }
    }

    if (sampledTotalArea <= 0) return;

    // Area is an unbiased estimate: scale the sample back up to the full mesh.
    const upwardArea = sampledUpwardArea / sampledFraction;
    const totalArea = sampledTotalArea / sampledFraction;
    const ratio = upwardArea / totalArea;

    if (upwardArea >= minAreaSquareMetres && ratio >= minUpwardRatio) {
      child.userData.menovaTeleport = true;
      surfaces.push({
        mesh: child,
        upwardArea,
        // Height is an area-weighted mean, so it uses the raw sampled sums.
        averageHeight: sampledUpwardArea > 0 ? weightedHeight / sampledUpwardArea : 0,
      });
    }
  });

  // Biggest walkable slabs first: the ground floor should win ties.
  return surfaces.sort((left, right) => right.upwardArea - left.upwardArea);
}

/** Narrows an arbitrary material property to a disposable texture. */
function isDisposableTexture(value: unknown): value is { dispose: () => void } {
  return (
    typeof value === "object" &&
    value !== null &&
    "isTexture" in value &&
    typeof (value as { dispose?: unknown }).dispose === "function"
  );
}

/** Frees GPU memory for every geometry/material/texture under `root`. */
export function disposeHierarchy(root: Object3D): void {
  root.traverse((child) => {
    if (!(child instanceof Mesh)) return;
    child.geometry?.dispose();
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) {
      if (!material) continue;
      for (const value of Object.values(material) as unknown[]) {
        // Textures are the only disposable properties on standard materials.
        if (isDisposableTexture(value)) value.dispose();
      }
      material.dispose();
    }
  });
}
