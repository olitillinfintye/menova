import { Euler, MathUtils, type Object3D, type PerspectiveCamera, Vector3 } from "three";

export interface LocomotionOptions {
  /** Metres per second while walking. */
  walkSpeed?: number;
  /** Multiplier applied while Shift is held. */
  sprintMultiplier?: number;
  /** Eye height above the rig origin, in metres. */
  eyeHeight?: number;
  /** Radians per pixel of pointer movement. */
  lookSensitivity?: number;
  /** Radians per pixel for touch drag. */
  touchLookSensitivity?: number;
}

interface TouchState {
  identifier: number;
  originX: number;
  originY: number;
  currentX: number;
  currentY: number;
}

/**
 * Desktop and mobile locomotion for the non-immersive viewer.
 *
 * Desktop: WASD/arrows to move, Q/E or Space/C for vertical, pointer-lock mouse
 * look, Shift to sprint.
 *
 * Touch: the left half of the screen is a virtual joystick (drag to walk), the
 * right half is a look pad (drag to turn). Both work simultaneously.
 *
 * The rig is the "feet" transform and owns yaw; the camera owns pitch. Keeping
 * them separate is what lets the same rig be handed to WebXR, where the headset
 * pose replaces the camera transform entirely.
 */
export class Locomotion {
  private readonly rig: Object3D;
  private readonly camera: PerspectiveCamera;
  private readonly element: HTMLElement;
  private readonly options: Required<LocomotionOptions>;

  private readonly keys = new Set<string>();
  private readonly moveTouches = new Map<number, TouchState>();
  private readonly lookTouches = new Map<number, TouchState>();

  private yaw = 0;
  private pitch = 0;
  private pointerLocked = false;
  private enabled = true;
  private disposed = false;

  /** Radius of the virtual joystick in CSS pixels. */
  private static readonly JOYSTICK_RADIUS = 70;

  private readonly forward = new Vector3();
  private readonly right = new Vector3();
  private readonly displacement = new Vector3();
  private readonly euler = new Euler(0, 0, 0, "YXZ");

  constructor(
    rig: Object3D,
    camera: PerspectiveCamera,
    element: HTMLElement,
    options: LocomotionOptions = {},
  ) {
    this.rig = rig;
    this.camera = camera;
    this.element = element;
    this.options = {
      walkSpeed: options.walkSpeed ?? 2.6,
      sprintMultiplier: options.sprintMultiplier ?? 2.5,
      eyeHeight: options.eyeHeight ?? 1.65,
      lookSensitivity: options.lookSensitivity ?? 0.0022,
      touchLookSensitivity: options.touchLookSensitivity ?? 0.005,
    };

    this.yaw = rig.rotation.y;
    this.camera.position.y = this.options.eyeHeight;

    this.attach();
  }

  // ----------------------------------------------------------------- public

  /** Disables input without tearing down listeners (used while in XR). */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.keys.clear();
      this.moveTouches.clear();
      this.lookTouches.clear();
      this.exitPointerLock();
    }
  }

  /** Places the rig and resets look angles. */
  teleportTo(position: Vector3, yaw?: number): void {
    this.rig.position.copy(position);
    if (yaw !== undefined) {
      this.yaw = yaw;
      this.rig.rotation.y = yaw;
    }
  }

  /** Advances movement. Call once per frame with the frame delta in seconds. */
  update(deltaSeconds: number): void {
    if (!this.enabled || this.disposed) return;

    const dt = MathUtils.clamp(deltaSeconds, 0, 0.1); // ignore tab-switch spikes

    this.applyTouchLook(dt);

    const input = this.readMoveInput();
    if (input.x === 0 && input.y === 0 && input.z === 0) {
      this.applyRotation();
      return;
    }

    const sprint = this.keys.has("shiftleft") || this.keys.has("shiftright");
    const speed = this.options.walkSpeed * (sprint ? this.options.sprintMultiplier : 1);

    // Movement is relative to where the user is looking, flattened to the
    // ground plane so looking down does not drive the camera into the floor.
    this.forward.set(0, 0, -1).applyAxisAngle(new Vector3(0, 1, 0), this.yaw);
    this.right.set(1, 0, 0).applyAxisAngle(new Vector3(0, 1, 0), this.yaw);

    this.displacement
      .set(0, 0, 0)
      .addScaledVector(this.forward, input.z)
      .addScaledVector(this.right, input.x);

    if (this.displacement.lengthSq() > 1) this.displacement.normalize();
    this.displacement.y = input.y;
    this.displacement.multiplyScalar(speed * dt);

    this.rig.position.add(this.displacement);
    this.applyRotation();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.detach();
  }

  // ---------------------------------------------------------------- internal

  private applyRotation(): void {
    this.rig.rotation.y = this.yaw;
    this.euler.set(this.pitch, 0, 0);
    this.camera.quaternion.setFromEuler(this.euler);
    this.camera.position.y = this.options.eyeHeight;
  }

  /** Combined keyboard + joystick axes, each in the range -1..1. */
  private readMoveInput(): { x: number; y: number; z: number } {
    let x = 0;
    let y = 0;
    let z = 0;

    if (this.keys.has("keyw") || this.keys.has("arrowup")) z += 1;
    if (this.keys.has("keys") || this.keys.has("arrowdown")) z -= 1;
    if (this.keys.has("keyd") || this.keys.has("arrowright")) x += 1;
    if (this.keys.has("keya") || this.keys.has("arrowleft")) x -= 1;
    if (this.keys.has("keye") || this.keys.has("space")) y += 1;
    if (this.keys.has("keyq") || this.keys.has("keyc")) y -= 1;

    for (const touch of this.moveTouches.values()) {
      const dx = touch.currentX - touch.originX;
      const dy = touch.currentY - touch.originY;
      const radius = Locomotion.JOYSTICK_RADIUS;
      x += MathUtils.clamp(dx / radius, -1, 1);
      z += MathUtils.clamp(-dy / radius, -1, 1);
    }

    return {
      x: MathUtils.clamp(x, -1, 1),
      y: MathUtils.clamp(y, -1, 1),
      z: MathUtils.clamp(z, -1, 1),
    };
  }

  /** Applies look-pad drag as a rate, so a held finger keeps turning. */
  private applyTouchLook(dt: number): void {
    for (const touch of this.lookTouches.values()) {
      const dx = touch.currentX - touch.originX;
      const dy = touch.currentY - touch.originY;
      this.yaw -= dx * this.options.touchLookSensitivity * dt * 12;
      this.pitch = MathUtils.clamp(
        this.pitch - dy * this.options.touchLookSensitivity * dt * 12,
        -Math.PI / 2 + 0.01,
        Math.PI / 2 - 0.01,
      );
    }
  }

  // ------------------------------------------------------------- listeners

  private attach(): void {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onWindowBlur);

    this.element.addEventListener("mousedown", this.onMouseDown);
    this.element.addEventListener("mousemove", this.onMouseMove);
    document.addEventListener("pointerlockchange", this.onPointerLockChange);

    this.element.addEventListener("touchstart", this.onTouchStart, { passive: false });
    this.element.addEventListener("touchmove", this.onTouchMove, { passive: false });
    this.element.addEventListener("touchend", this.onTouchEnd);
    this.element.addEventListener("touchcancel", this.onTouchEnd);
    this.element.addEventListener("contextmenu", this.onContextMenu);
  }

  private detach(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onWindowBlur);

    this.element.removeEventListener("mousedown", this.onMouseDown);
    this.element.removeEventListener("mousemove", this.onMouseMove);
    document.removeEventListener("pointerlockchange", this.onPointerLockChange);

    this.element.removeEventListener("touchstart", this.onTouchStart);
    this.element.removeEventListener("touchmove", this.onTouchMove);
    this.element.removeEventListener("touchend", this.onTouchEnd);
    this.element.removeEventListener("touchcancel", this.onTouchEnd);
    this.element.removeEventListener("contextmenu", this.onContextMenu);

    this.exitPointerLock();
  }

  private exitPointerLock(): void {
    if (this.pointerLocked && document.pointerLockElement === this.element) {
      document.exitPointerLock();
    }
  }

  private readonly onKeyDown = (event: KeyboardEvent) => {
    if (!this.enabled) return;
    // Never swallow keys aimed at the overlay UI.
    const target = event.target as HTMLElement | null;
    if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;

    this.keys.add(event.code.toLowerCase());
    if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.code)) {
      event.preventDefault();
    }
  };

  private readonly onKeyUp = (event: KeyboardEvent) => {
    this.keys.delete(event.code.toLowerCase());
  };

  private readonly onWindowBlur = () => {
    // Otherwise a key held during an alt-tab sticks forever.
    this.keys.clear();
  };

  private readonly onMouseDown = (event: MouseEvent) => {
    if (!this.enabled || event.button !== 0) return;
    if (document.pointerLockElement !== this.element) {
      void this.element.requestPointerLock?.();
    }
  };

  private readonly onPointerLockChange = () => {
    this.pointerLocked = document.pointerLockElement === this.element;
  };

  private readonly onMouseMove = (event: MouseEvent) => {
    if (!this.enabled || !this.pointerLocked) return;
    this.yaw -= event.movementX * this.options.lookSensitivity;
    this.pitch = MathUtils.clamp(
      this.pitch - event.movementY * this.options.lookSensitivity,
      -Math.PI / 2 + 0.01,
      Math.PI / 2 - 0.01,
    );
  };

  private readonly onContextMenu = (event: Event) => {
    if (this.enabled) event.preventDefault();
  };

  private readonly onTouchStart = (event: TouchEvent) => {
    if (!this.enabled) return;
    const midpoint = this.element.clientWidth / 2;

    for (const touch of Array.from(event.changedTouches)) {
      const state: TouchState = {
        identifier: touch.identifier,
        originX: touch.clientX,
        originY: touch.clientY,
        currentX: touch.clientX,
        currentY: touch.clientY,
      };
      // Left half drives movement, right half drives look.
      if (touch.clientX < midpoint) this.moveTouches.set(touch.identifier, state);
      else this.lookTouches.set(touch.identifier, state);
    }
    event.preventDefault();
  };

  private readonly onTouchMove = (event: TouchEvent) => {
    if (!this.enabled) return;
    for (const touch of Array.from(event.changedTouches)) {
      const state =
        this.moveTouches.get(touch.identifier) ?? this.lookTouches.get(touch.identifier);
      if (!state) continue;
      state.currentX = touch.clientX;
      state.currentY = touch.clientY;
    }
    event.preventDefault();
  };

  private readonly onTouchEnd = (event: TouchEvent) => {
    for (const touch of Array.from(event.changedTouches)) {
      this.moveTouches.delete(touch.identifier);
      this.lookTouches.delete(touch.identifier);
    }
  };

  /** Current joystick origin//knob positions, for rendering an on-screen HUD. */
  getJoystickState(): { originX: number; originY: number; knobX: number; knobY: number } | null {
    const touch = this.moveTouches.values().next().value;
    if (!touch) return null;

    const dx = touch.currentX - touch.originX;
    const dy = touch.currentY - touch.originY;
    const distance = Math.hypot(dx, dy);
    const scale = distance > Locomotion.JOYSTICK_RADIUS
      ? Locomotion.JOYSTICK_RADIUS / distance
      : 1;

    return {
      originX: touch.originX,
      originY: touch.originY,
      knobX: touch.originX + dx * scale,
      knobY: touch.originY + dy * scale,
    };
  }
}
