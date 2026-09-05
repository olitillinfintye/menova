import {
  CanvasTexture,
  LinearFilter,
  type Object3D,
  type PerspectiveCamera,
  Raycaster,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  Vector2,
  Vector3,
} from "three";

import type { Hotspot } from "@/lib/types";

export interface HotspotLayerOptions {
  /** Root of the loaded model; markers are parented here so they scale with it. */
  modelRoot: Object3D;
  camera: PerspectiveCamera;
  /** Canvas element receiving pointer events. */
  element: HTMLElement;
  onSelect: (hotspot: Hotspot) => void;
}

interface Marker {
  hotspot: Hotspot;
  sprite: Sprite;
  material: SpriteMaterial;
  texture: CanvasTexture;
  aspect: number;
}

/** Marker height above the saved feet position, in model units (metres). */
const MARKER_HEIGHT = 1.35;
/** Screen-relative marker size: fraction of the distance to the camera. */
const SIZE_PER_METRE = 0.11;
const MIN_SIZE = 0.16;
const MAX_SIZE = 1.6;
const TAP_SLOP_PX = 8;
const TAP_MAX_MS = 400;

/**
 * Billboarded, clickable "go here" markers inside a model.
 *
 * Positions are stored in the model's local space, so markers follow the
 * building through the dollhouse tween and AR placement without any extra
 * bookkeeping. Selection works with mouse, touch, pointer-lock crosshair and
 * (via {@link hitTest}) XR controller rays.
 */
export class HotspotLayer {
  private readonly modelRoot: Object3D;
  private readonly camera: PerspectiveCamera;
  private readonly element: HTMLElement;
  private readonly onSelect: (hotspot: Hotspot) => void;

  private readonly markers: Marker[] = [];
  private readonly raycaster = new Raycaster();
  private readonly ndc = new Vector2();
  private readonly worldPos = new Vector3();
  private readonly cameraPos = new Vector3();
  private readonly worldScale = new Vector3();

  private hovered: Marker | null = null;
  private visible = true;
  private disposed = false;
  private pointerDown: { x: number; y: number; time: number } | null = null;

  constructor(options: HotspotLayerOptions) {
    this.modelRoot = options.modelRoot;
    this.camera = options.camera;
    this.element = options.element;
    this.onSelect = options.onSelect;

    this.element.addEventListener("pointerdown", this.onPointerDown);
    this.element.addEventListener("pointerup", this.onPointerUp);
    this.element.addEventListener("pointermove", this.onPointerMove);
  }

  // ------------------------------------------------------------------ public

  setHotspots(hotspots: Hotspot[]): void {
    this.clearMarkers();
    hotspots.forEach((hotspot, index) => {
      const { texture, aspect } = createMarkerTexture(index + 1, hotspot.label);
      const material = new SpriteMaterial({
        map: texture,
        transparent: true,
        depthTest: false,
        depthWrite: false,
      });
      const sprite = new Sprite(material);
      sprite.name = `MenovaHotspot:${hotspot.id}`;
      sprite.renderOrder = 990;
      sprite.center.set(0.5, 0);
      sprite.position.set(hotspot.position.x, hotspot.position.y + MARKER_HEIGHT, hotspot.position.z);
      sprite.visible = this.visible;
      sprite.userData.hotspotId = hotspot.id;
      this.modelRoot.add(sprite);
      this.markers.push({ hotspot, sprite, material, texture, aspect });
    });
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    for (const marker of this.markers) marker.sprite.visible = visible;
  }

  /** Objects an external raycaster (XR controller) should test against. */
  get hitObjects(): Object3D[] {
    return this.markers.map((marker) => marker.sprite);
  }

  /** Resolves a raycaster hit back to its hotspot. */
  hitTest(raycaster: Raycaster): Hotspot | null {
    if (!this.visible || this.markers.length === 0) return null;
    raycaster.camera = this.camera;
    const hits = raycaster.intersectObjects(this.hitObjects, false);
    const id = hits[0]?.object.userData.hotspotId as string | undefined;
    return this.markers.find((marker) => marker.hotspot.id === id)?.hotspot ?? null;
  }

  /** True when a client-space point is over a marker. */
  pickAt(clientX: number, clientY: number): Hotspot | null {
    return this.pick(this.toNdc(clientX, clientY));
  }

  /** Keeps markers a constant apparent size and updates hover state. */
  update(pointerLocked: boolean): void {
    if (this.disposed || !this.visible || this.markers.length === 0) return;

    this.camera.getWorldPosition(this.cameraPos);
    this.modelRoot.getWorldScale(this.worldScale);
    const inverseScale = 1 / Math.max(this.worldScale.x, 1e-6);

    for (const marker of this.markers) {
      marker.sprite.getWorldPosition(this.worldPos);
      const distance = this.worldPos.distanceTo(this.cameraPos);
      const size = Math.min(MAX_SIZE, Math.max(MIN_SIZE, distance * SIZE_PER_METRE)) * inverseScale;
      marker.sprite.scale.set(size * marker.aspect, size, 1);
    }

    if (pointerLocked) this.setHovered(this.pick(this.ndc.set(0, 0)));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.element.removeEventListener("pointerdown", this.onPointerDown);
    this.element.removeEventListener("pointerup", this.onPointerUp);
    this.element.removeEventListener("pointermove", this.onPointerMove);
    this.clearMarkers();
  }

  // ---------------------------------------------------------------- internal

  private clearMarkers(): void {
    for (const marker of this.markers) {
      marker.sprite.parent?.remove(marker.sprite);
      marker.material.dispose();
      marker.texture.dispose();
    }
    this.markers.length = 0;
    this.hovered = null;
    this.element.style.cursor = "";
  }

  private toNdc(clientX: number, clientY: number): Vector2 {
    const rect = this.element.getBoundingClientRect();
    return this.ndc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
  }

  private pick(ndc: Vector2): Hotspot | null {
    if (!this.visible || this.markers.length === 0) return null;
    this.raycaster.setFromCamera(ndc, this.camera);
    return this.hitTest(this.raycaster);
  }

  private setHovered(hotspot: Hotspot | null): void {
    const next = hotspot ? this.markers.find((m) => m.hotspot.id === hotspot.id) ?? null : null;
    if (next === this.hovered) return;
    if (this.hovered) this.hovered.material.color.setHex(0xffffff);
    if (next) next.material.color.setHex(0xffe9b3);
    this.hovered = next;
    this.element.style.cursor = next ? "pointer" : "";
  }

  private readonly onPointerDown = (event: PointerEvent) => {
    if (!this.visible) return;
    this.pointerDown = { x: event.clientX, y: event.clientY, time: performance.now() };
  };

  private readonly onPointerMove = (event: PointerEvent) => {
    if (!this.visible || document.pointerLockElement === this.element) return;
    if (event.pointerType === "touch") return;
    this.setHovered(this.pick(this.toNdc(event.clientX, event.clientY)));
  };

  private readonly onPointerUp = (event: PointerEvent) => {
    const start = this.pointerDown;
    this.pointerDown = null;
    if (!start || !this.visible) return;

    const moved = Math.hypot(event.clientX - start.x, event.clientY - start.y);
    if (moved > TAP_SLOP_PX || performance.now() - start.time > TAP_MAX_MS) return;

    const locked = document.pointerLockElement === this.element;
    const hotspot = locked
      ? this.pick(this.ndc.set(0, 0))
      : this.pick(this.toNdc(event.clientX, event.clientY));
    if (hotspot) this.onSelect(hotspot);
  };
}

/** Draws a numbered gold badge with a label pill into a texture. */
function createMarkerTexture(index: number, label: string): { texture: CanvasTexture; aspect: number } {
  const height = 160;
  const padding = 24;
  const badge = 112;
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  const font = "600 44px system-ui, -apple-system, 'Segoe UI', sans-serif";
  let textWidth = 0;
  if (context) {
    context.font = font;
    textWidth = Math.min(context.measureText(label).width, 520);
  }
  const width = Math.ceil(badge + padding * 3 + textWidth);
  canvas.width = width;
  canvas.height = height;

  if (context) {
    context.clearRect(0, 0, width, height);

    // pill
    context.beginPath();
    context.roundRect(4, (height - 120) / 2, width - 8, 120, 60);
    context.fillStyle = "rgba(22, 22, 58, 0.86)";
    context.fill();
    context.lineWidth = 4;
    context.strokeStyle = "rgba(226, 184, 95, 0.9)";
    context.stroke();

    // badge
    context.beginPath();
    context.arc(padding + badge / 2, height / 2, badge / 2 - 8, 0, Math.PI * 2);
    context.fillStyle = "#c9962a";
    context.fill();

    context.fillStyle = "#16163a";
    context.font = "700 52px system-ui, -apple-system, 'Segoe UI', sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(String(index), padding + badge / 2, height / 2 + 2);

    // label
    context.fillStyle = "#f4f3fb";
    context.font = font;
    context.textAlign = "left";
    context.fillText(label, padding * 2 + badge, height / 2 + 2, 520);
  }

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.needsUpdate = true;
  return { texture, aspect: width / height };
}
