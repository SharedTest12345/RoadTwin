import * as THREE from "three";

/** All textures here are generated on a <canvas> at runtime — no network assets,
 * no CDN, works fully offline. Cheap speckle/grain noise is enough to break up
 * flat colors into something that reads as a real surface instead of a solid fill. */

function speckleCanvas(size: number, base: string, variants: [string, number][], seed = 1) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  let h = seed;
  const rand = () => {
    h = (h * 9301 + 49297) % 233280;
    return h / 233280;
  };
  for (const [color, count] of variants) {
    ctx.fillStyle = color;
    for (let i = 0; i < count; i++) {
      const x = rand() * size, y = rand() * size, r = 0.5 + rand() * 1.8;
      ctx.globalAlpha = 0.15 + rand() * 0.35;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
  return canvas;
}

// Daylight ground: scrubby hillside green for steep/ghat roads, drier verge green
// for flat ones. The previous dark-slate palette was chosen for a night scene, and
// under a real sky it read as tarmac stretching to the horizon rather than ground.
export function groundTexture(isHilly: boolean): THREE.CanvasTexture {
  const canvas = isHilly
    ? speckleCanvas(256, "#5d6b42", [["#6d7c4e", 900], ["#4a5636", 900], ["#7d8a5f", 250]], 7)
    : speckleCanvas(256, "#6b7550", [["#7a8560", 700], ["#57603f", 700], ["#8a9470", 200]], 11);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(24, 24);
  tex.anisotropy = 4;
  return tex;
}

// Mid-gray daylight asphalt. At the old #22262c the road surface was within a few
// percent of the night background, so the ribbon only ever read as its painted
// lane markings — the actual carriageway was invisible.
export function asphaltTexture(): THREE.CanvasTexture {
  const canvas = speckleCanvas(256, "#4a4e55", [["#565b63", 1400], ["#3e424a", 1400], ["#61666e", 300]], 3);
  const ctx = canvas.getContext("2d")!;
  // faint longitudinal grain
  ctx.globalAlpha = 0.08;
  ctx.strokeStyle = "#000000";
  for (let i = 0; i < 40; i++) {
    ctx.beginPath();
    const x = Math.random() * 256;
    ctx.moveTo(x, 0);
    ctx.lineTo(x + (Math.random() - 0.5) * 20, 256);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** Real speed humps are painted with black/yellow diagonal hazard stripes —
 * distinct from the crossing's flat white bands, and diagonal so it reads as
 * a hazard marking rather than a second crosswalk. */
export function speedBumpTexture(): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#181818";
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = "#f2c230";
  ctx.save();
  ctx.translate(size / 2, size / 2);
  ctx.rotate(Math.PI / 4);
  ctx.translate(-size, -size);
  const stripeWidth = size / 4;
  for (let x = 0; x < size * 4; x += stripeWidth * 2) {
    ctx.fillRect(x, 0, stripeWidth, size * 2);
  }
  ctx.restore();
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** A building's look is TWO textures, not one — a dark diffuse facade (map) plus
 * a separate black-except-windows emissive map. A single "bright window color on
 * a diffuse map" reads as a muddy checkerboard at night because diffuse pixels
 * only reflect scene light; they don't glow. An emissive map actually lights up
 * regardless of ambient light, which is what makes windows read as windows and
 * lets bloom pick them up — same trick already used for streetlights/headlights. */
export function buildingTextures(seed: number, lit = true): { map: THREE.CanvasTexture; emissiveMap: THREE.CanvasTexture } {
  const size = 128;
  let h = seed * 97 + 13;
  const rand = () => {
    h = (h * 9301 + 49297) % 233280;
    return h / 233280;
  };
  const cols = 5, rows = 8;
  const cw = size / cols, ch = size / rows;
  const baseHue = 205 + Math.floor(rand() * 30);
  // Daylight concrete/render, not a night silhouette. At the old ~16% lightness
  // the facades were black boxes once the scene stopped being a night shot.
  const baseColor = `hsl(${baseHue}, 10%, ${58 + Math.floor(rand() * 12)}%)`;

  const mapCanvas = document.createElement("canvas");
  mapCanvas.width = mapCanvas.height = size;
  const mctx = mapCanvas.getContext("2d")!;
  mctx.fillStyle = baseColor;
  mctx.fillRect(0, 0, size, size);
  mctx.strokeStyle = "rgba(0,0,0,0.35)";
  mctx.lineWidth = 1;
  for (let c = 1; c < cols; c++) { mctx.beginPath(); mctx.moveTo(c * cw, 0); mctx.lineTo(c * cw, size); mctx.stroke(); }
  for (let r = 1; r < rows; r++) { mctx.beginPath(); mctx.moveTo(0, r * ch); mctx.lineTo(size, r * ch); mctx.stroke(); }

  const emCanvas = document.createElement("canvas");
  emCanvas.width = emCanvas.height = size;
  const ectx = emCanvas.getContext("2d")!;
  ectx.fillStyle = "#000000";
  ectx.fillRect(0, 0, size, size);
  // Windows are painted into BOTH maps. In daylight a window reads as dark glass
  // against a light facade (the diffuse pass); the emissive pass is kept only as a
  // faint sheen on a subset, so lit windows still register without the building
  // turning into a glowing lantern the way a night-only emissive map would.
  const warm = rand() < 0.5;
  const pad = cw * 0.22;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = c * cw + pad, y = r * ch + pad * 1.3;
      const w = cw - pad * 2, h = ch - pad * 2.6;
      mctx.fillStyle = `rgba(38, 48, 60, ${0.55 + rand() * 0.3})`;
      mctx.fillRect(x, y, w, h);
      if (!lit || rand() > 0.22) continue;
      ectx.fillStyle = warm
        ? `rgb(120, ${80 + Math.floor(rand() * 30)}, 40)`
        : `rgb(${70 + Math.floor(rand() * 25)}, ${85 + Math.floor(rand() * 20)}, 110)`;
      ectx.fillRect(x, y, w, h);
    }
  }

  const map = new THREE.CanvasTexture(mapCanvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  const emissiveMap = new THREE.CanvasTexture(emCanvas);
  emissiveMap.colorSpace = THREE.SRGBColorSpace;
  emissiveMap.wrapS = emissiveMap.wrapT = THREE.RepeatWrapping;
  return { map, emissiveMap };
}
