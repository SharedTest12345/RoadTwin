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

// Matte dark-slate/charcoal — a neutral canvas the road, guardrails, and vehicle
// lights can pop against, rather than a busy olive-green that competed with them.
// Kept noticeably lighter than the background/fog color (#090d16) — the first
// pass matched them too closely and the ground became genuinely invisible
// (not just moody) whenever a road's camera angle faced away from the sun.
export function groundTexture(isHilly: boolean): THREE.CanvasTexture {
  const canvas = isHilly
    ? speckleCanvas(256, "#2a3548", [["#374260", 900], ["#1c2436", 900], ["#42506e", 250]], 7)
    : speckleCanvas(256, "#1e2740", [["#26314c", 700], ["#161d30", 700], ["#303e5c", 200]], 11);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(24, 24);
  tex.anisotropy = 4;
  return tex;
}

export function asphaltTexture(): THREE.CanvasTexture {
  const canvas = speckleCanvas(256, "#22262c", [["#2c3138", 1400], ["#181b20", 1400], ["#33383f", 300]], 3);
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
  const baseColor = `hsl(${baseHue}, 12%, ${16 + Math.floor(rand() * 6)}%)`;

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
  const warm = rand() < 0.5;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!lit || rand() > 0.32) continue;
      const pad = cw * 0.22;
      ectx.fillStyle = warm
        ? `rgb(255, ${190 + Math.floor(rand() * 40)}, ${110 + Math.floor(rand() * 50)})`
        : `rgb(${210 + Math.floor(rand() * 30)}, ${225 + Math.floor(rand() * 20)}, 255)`;
      ectx.fillRect(c * cw + pad, r * ch + pad * 1.3, cw - pad * 2, ch - pad * 2.6);
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
