import { Group, type Material, type Mesh, MeshStandardMaterial } from "three";

export function supportsQuickLook(): boolean {
  if (typeof document === "undefined") return false;
  const iosBrowser = typeof navigator !== "undefined"
    && (/iPad|iPhone|iPod/.test(navigator.userAgent)
      || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1))
    && /CriOS\/|EdgiOS\/|FxiOS\/|DuckDuckGo\//.test(navigator.userAgent);
  try {
    return Boolean(document.createElement("a").relList?.supports?.("ar") || iosBrowser);
  } catch {
    return iosBrowser;
  }
}

export async function exportQuickLook(model: Group): Promise<Blob> {
  const [{ USDZExporter }, textureUtils] = await Promise.all([
    import("three/examples/jsm/exporters/USDZExporter.js"),
    import("three/examples/jsm/utils/WebGLTextureUtils.js"),
  ]);
  const root = new Group();
  root.add(model.clone(true));
  const converted = new Map<Material, MeshStandardMaterial>();
  let meshCount = 0;

  const convertMaterial = (material: Material): Material => {
    if ((material as MeshStandardMaterial).isMeshStandardMaterial) return material;
    const cached = converted.get(material);
    if (cached) return cached;
    const source = material as Material & Partial<Pick<MeshStandardMaterial,
      "color" | "map" | "emissive" | "emissiveMap" | "normalMap" | "aoMap" | "alphaMap"
    >>;
    const replacement = new MeshStandardMaterial({
      name: material.name,
      color: source.color ?? 0xffffff,
      map: source.map ?? null,
      emissive: source.emissive ?? 0x000000,
      emissiveMap: source.emissiveMap ?? null,
      normalMap: source.normalMap ?? null,
      aoMap: source.aoMap ?? null,
      alphaMap: source.alphaMap ?? null,
      opacity: material.opacity,
      transparent: material.transparent,
      alphaTest: material.alphaTest,
      side: material.side,
      roughness: 1,
      metalness: 0,
    });
    converted.set(material, replacement);
    return replacement;
  };

  try {
    root.traverseVisible((object) => {
      const mesh = object as Mesh;
      if (!mesh.isMesh) return;
      meshCount++;
      mesh.material = Array.isArray(mesh.material)
        ? mesh.material.map(convertMaterial)
        : convertMaterial(mesh.material);
    });
    if (meshCount === 0) throw new Error("This model has no visible surfaces to export for AR.");
    root.updateMatrixWorld(true);
    const exporter = new USDZExporter();
    exporter.setTextureUtils(textureUtils);
    const data = await exporter.parseAsync(root, {
      quickLookCompatible: true,
      maxTextureSize: 1024,
      onlyVisible: true,
    });
    return new Blob([new Uint8Array(data)], { type: "model/vnd.usdz+zip" });
  } finally {
    for (const material of converted.values()) material.dispose();
  }
}