// 3B Dijital Garaj: prosedürel araç modelleri, dinamik yerleşim, seçim ve etkileşim (Three.js).
import * as THREE from '/vendor/three/build/three.module.js';
import { OrbitControls } from '/vendor/three/addons/controls/OrbitControls.js';

export function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
  } catch {
    return false;
  }
}

export const STATUS_COLORS = { available: 0x22a559, on_trip: 0x2f6fe4, maintenance: 0xf08a24, broken: 0xdc3b3b, passive: 0x9aa0a8 };
const ALERT_COLORS = { critical: '#dc2626', warning: '#ea7a0c', info: '#2563eb' };

// ---------------------------------------------------------------- Malzemeler / yardımcılar
function makeMats(color) {
  return {
    body: new THREE.MeshStandardMaterial({ color: new THREE.Color(color || '#9aa3ad'), metalness: 0.35, roughness: 0.42 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x1b2633, metalness: 0.6, roughness: 0.12 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x24272c, metalness: 0.2, roughness: 0.75 }),
    tire: new THREE.MeshStandardMaterial({ color: 0x1a1a1c, roughness: 0.9 }),
    hub: new THREE.MeshStandardMaterial({ color: 0xb9bec6, metalness: 0.8, roughness: 0.3 }),
    light: new THREE.MeshStandardMaterial({ color: 0xfff6d6, emissive: 0xfff2c4, emissiveIntensity: 0.6 }),
    tail: new THREE.MeshStandardMaterial({ color: 0xc8202a, emissive: 0x8a0d14, emissiveIntensity: 0.5 }),
    cargo: new THREE.MeshStandardMaterial({ color: 0xe9ecef, metalness: 0.1, roughness: 0.6 }),
    yellow: new THREE.MeshStandardMaterial({ color: 0xf2b705, metalness: 0.2, roughness: 0.5 }),
    steel: new THREE.MeshStandardMaterial({ color: 0x6b7280, metalness: 0.7, roughness: 0.35 }),
  };
}

function mesh(geo, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}
const box = (w, hgt, d, mat, x, y, z) => mesh(new THREE.BoxGeometry(w, hgt, d), mat, x, y, z);

/** Yan profilden (z, y) gövde: x ekseninde W genişliğinde, ortalanmış. */
function profile(points, W, mat, bevel = 0.04) {
  const shape = new THREE.Shape();
  points.forEach(([z, y], i) => (i ? shape.lineTo(z, y) : shape.moveTo(z, y)));
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: W - bevel * 2, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, steps: 1 });
  geo.rotateY(-Math.PI / 2);
  geo.translate((W - bevel * 2) / 2, 0, 0);
  return mesh(geo, mat);
}

function wheel(g, m, r, w, x, z) {
  const t = mesh(new THREE.CylinderGeometry(r, r, w, 22), m.tire, x, r, z);
  t.rotation.z = Math.PI / 2;
  const hub = mesh(new THREE.CylinderGeometry(r * 0.55, r * 0.55, w + 0.02, 14), m.hub, x, r, z);
  hub.rotation.z = Math.PI / 2;
  g.add(t, hub);
}

function axle(g, m, r, w, W, z) {
  wheel(g, m, r, w, W / 2 - w / 2 + 0.02, z);
  wheel(g, m, r, w, -W / 2 + w / 2 - 0.02, z);
}

function lights(g, m, W, L, y, inset = 0.25) {
  for (const s of [-1, 1]) {
    g.add(box(0.32, 0.12, 0.05, m.light, s * (W / 2 - inset), y, L / 2 + 0.01));
    g.add(box(0.28, 0.12, 0.05, m.tail, s * (W / 2 - inset), y, -L / 2 - 0.01));
  }
}

// ---------------------------------------------------------------- Gövde tipleri (ön yön +z)
const BUILDERS = {
  car(m) {
    const g = new THREE.Group();
    const W = 1.8;
    const L = 4.5;
    g.add(profile([[-2.25, 0.3], [2.25, 0.3], [2.25, 0.62], [2.05, 0.8], [0.95, 0.9], [-1.85, 0.94], [-2.25, 0.86]], W, m.body));
    g.add(profile([[0.95, 0.88], [0.32, 1.34], [-1.12, 1.38], [-1.82, 0.93]], W - 0.14, m.glass, 0.02));
    g.add(box(W - 0.2, 0.05, 1.42, m.body, 0, 1.385, -0.4));
    axle(g, m, 0.33, 0.24, W, 1.42);
    axle(g, m, 0.33, 0.24, W, -1.42);
    lights(g, m, W, L, 0.68);
    return { group: g, w: W, l: L, h: 1.42 };
  },
  suv(m) {
    const g = new THREE.Group();
    const W = 1.92;
    const L = 4.8;
    g.add(profile([[-2.4, 0.42], [2.4, 0.42], [2.4, 0.85], [2.2, 1.0], [1.15, 1.08], [-2.32, 1.1], [-2.4, 1.02]], W, m.body));
    g.add(profile([[1.15, 1.06], [0.55, 1.72], [-2.2, 1.74], [-2.32, 1.08]], W - 0.14, m.glass, 0.02));
    g.add(box(W - 0.18, 0.06, 2.7, m.body, 0, 1.76, -0.8));
    g.add(box(W - 0.4, 0.05, 2.2, m.dark, 0, 1.82, -0.8));
    axle(g, m, 0.4, 0.28, W, 1.5);
    axle(g, m, 0.4, 0.28, W, -1.5);
    lights(g, m, W, L, 0.92);
    return { group: g, w: W, l: L, h: 1.84 };
  },
  van(m) {
    const g = new THREE.Group();
    const W = 1.98;
    const L = 5.0;
    g.add(profile([[-2.5, 0.38], [2.5, 0.38], [2.5, 0.85], [2.3, 1.05], [1.55, 1.15], [0.9, 2.05], [-2.5, 2.1]], W, m.body));
    g.add(profile([[1.5, 1.17], [0.98, 1.95], [0.75, 1.95], [0.75, 1.2]], W + 0.01, m.glass, 0));
    g.add(box(W + 0.01, 0.42, 1.2, m.glass, 0, 1.6, -0.2));
    axle(g, m, 0.36, 0.25, W, 1.65);
    axle(g, m, 0.36, 0.25, W, -1.6);
    lights(g, m, W, L, 0.95);
    return { group: g, w: W, l: L, h: 2.1 };
  },
  pickup(m) {
    const g = new THREE.Group();
    const W = 1.9;
    const L = 5.3;
    g.add(profile([[-2.65, 0.45], [2.65, 0.45], [2.65, 0.95], [2.4, 1.1], [1.3, 1.16], [-0.2, 1.16], [-0.2, 1.05], [-2.65, 1.05]], W, m.body));
    g.add(profile([[1.3, 1.14], [0.75, 1.78], [-0.6, 1.8], [-0.6, 1.14]], W - 0.12, m.glass, 0.02));
    g.add(box(W - 0.16, 0.06, 1.25, m.body, 0, 1.82, 0.08));
    // kasa
    g.add(box(W, 0.42, 0.06, m.body, 0, 1.25, -0.62));
    g.add(box(W, 0.42, 0.06, m.body, 0, 1.25, -2.62));
    g.add(box(0.06, 0.42, 2.0, m.body, W / 2 - 0.03, 1.25, -1.62));
    g.add(box(0.06, 0.42, 2.0, m.body, -W / 2 + 0.03, 1.25, -1.62));
    g.add(box(W - 0.12, 0.04, 1.95, m.dark, 0, 1.07, -1.62));
    axle(g, m, 0.4, 0.28, W, 1.7);
    axle(g, m, 0.4, 0.28, W, -1.75);
    lights(g, m, W, L, 0.98);
    return { group: g, w: W, l: L, h: 1.85 };
  },
  minibus(m) {
    const g = new THREE.Group();
    const W = 2.1;
    const L = 7.0;
    g.add(profile([[-3.5, 0.42], [3.5, 0.42], [3.5, 1.0], [3.3, 1.25], [2.75, 1.35], [2.3, 2.55], [-3.5, 2.62]], W, m.body));
    g.add(profile([[2.72, 1.37], [2.32, 2.4], [2.0, 2.42], [2.0, 1.4]], W + 0.01, m.glass, 0));
    g.add(box(W + 0.01, 0.62, 4.9, m.glass, 0, 1.92, -0.6));
    g.add(box(W - 0.3, 0.06, 5.5, m.cargo, 0, 2.64, -0.4));
    axle(g, m, 0.4, 0.28, W, 2.3);
    axle(g, m, 0.4, 0.28, W, -2.3);
    lights(g, m, W, L, 1.0);
    return { group: g, w: W, l: L, h: 2.68 };
  },
  bus(m) {
    const g = new THREE.Group();
    const W = 2.5;
    const L = 12;
    g.add(box(W, 2.75, L, m.body, 0, 0.45 + 1.375, 0));
    g.add(box(W + 0.02, 0.95, L - 2.4, m.glass, 0, 2.35, -0.7));
    g.add(box(W - 0.15, 1.5, 0.05, m.glass, 0, 2.05, L / 2 + 0.01));
    g.add(box(0.9, 1.6, 0.05, m.glass, W / 2 - 0.5, 1.25, L / 2 + 0.02));
    g.add(box(W - 0.4, 0.3, 3.2, m.cargo, 0, 3.35, -2));
    g.add(box(W + 0.02, 0.18, L, m.dark, 0, 0.55, 0));
    axle(g, m, 0.5, 0.32, W, 3.6);
    axle(g, m, 0.5, 0.32, W, -3.4);
    lights(g, m, W, L, 0.8, 0.35);
    return { group: g, w: W, l: L, h: 3.5 };
  },
  truck(m) {
    const g = new THREE.Group();
    const W = 2.5;
    const L = 8.5;
    const cabZ = L / 2 - 1.15;
    g.add(box(W, 1.9, 2.3, m.body, 0, 0.75 + 0.95, cabZ));
    g.add(box(W - 0.1, 0.85, 0.05, m.glass, 0, 2.1, cabZ + 1.16));
    g.add(box(W + 0.01, 0.6, 1.0, m.glass, 0, 2.15, cabZ + 0.45));
    g.add(box(W - 0.3, 0.35, 1.6, m.body, 0, 2.82, cabZ - 0.2));
    g.add(box(1.2, 0.3, L - 0.6, m.dark, 0, 0.75, -0.2));
    g.add(box(W, 2.6, L - 2.65, m.cargo, 0, 1.0 + 1.3, -L / 2 + (L - 2.65) / 2));
    g.add(box(W + 0.02, 0.18, L - 2.65, m.body, 0, 1.05, -L / 2 + (L - 2.65) / 2));
    axle(g, m, 0.52, 0.34, W, cabZ - 0.1);
    axle(g, m, 0.52, 0.34, W, -L / 2 + 1.3);
    axle(g, m, 0.52, 0.34, W, -L / 2 + 2.45);
    lights(g, m, W, L, 1.0, 0.3);
    return { group: g, w: W, l: L, h: 3.6 };
  },
  tractor(m) {
    const g = new THREE.Group();
    const W = 2.1;
    const L = 4.2;
    g.add(box(0.9, 0.85, 1.9, m.body, 0, 1.25, 0.95));
    g.add(box(0.95, 0.12, 1.95, m.dark, 0, 1.72, 0.95));
    g.add(box(1.25, 0.5, 1.3, m.body, 0, 1.15, -0.8));
    // kabin
    for (const [x, z] of [[0.6, -0.15], [-0.6, -0.15], [0.6, -1.45], [-0.6, -1.45]]) g.add(box(0.07, 1.4, 0.07, m.dark, x, 2.1, z));
    g.add(box(1.35, 0.08, 1.45, m.body, 0, 2.83, -0.8));
    g.add(box(1.2, 1.25, 1.25, m.glass, 0, 2.05, -0.8));
    g.add(mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.3, 10), m.steel, 0.3, 2.2, 1.55));
    // tekerlekler
    wheel(g, m, 0.8, 0.5, W / 2 - 0.25, -1.0);
    wheel(g, m, 0.8, 0.5, -W / 2 + 0.25, -1.0);
    wheel(g, m, 0.48, 0.32, 0.72, 1.45);
    wheel(g, m, 0.48, 0.32, -0.72, 1.45);
    g.add(box(0.45, 0.12, 0.05, m.light, 0, 1.4, 1.92));
    return { group: g, w: W, l: L, h: 2.9 };
  },
  trailer(m) {
    const g = new THREE.Group();
    const W = 2.45;
    const L = 8.0;
    g.add(box(W, 0.25, L - 1.0, m.dark, 0, 1.1, -0.5));
    g.add(box(W, 2.5, L - 1.2, m.body, 0, 1.25 + 1.25, -0.5));
    g.add(box(W + 0.02, 0.1, L - 1.2, m.cargo, 0, 3.78, -0.5));
    g.add(box(0.12, 0.12, 1.3, m.steel, 0, 0.9, L / 2 - 0.65));
    g.add(mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.08, 14), m.steel, 0, 0.9, L / 2 - 0.05));
    axle(g, m, 0.5, 0.32, W, -L / 2 + 1.2);
    axle(g, m, 0.5, 0.32, W, -L / 2 + 2.35);
    for (const s of [-1, 1]) g.add(box(0.28, 0.12, 0.05, m.tail, s * (W / 2 - 0.3), 1.05, -L / 2 + 0.49));
    return { group: g, w: W, l: L, h: 3.8 };
  },
  forklift(m) {
    const g = new THREE.Group();
    const W = 1.2;
    const L = 3.2;
    g.add(box(W, 0.75, 2.0, m.body, 0, 0.75, -0.2));
    g.add(box(W, 0.7, 0.55, m.dark, 0, 0.85, -1.2));
    g.add(box(0.5, 0.5, 0.5, m.dark, 0, 1.35, -0.35));
    for (const [x, z] of [[0.5, 0.6], [-0.5, 0.6], [0.5, -0.9], [-0.5, -0.9]]) g.add(box(0.06, 1.25, 0.06, m.dark, x, 1.75, z));
    g.add(box(W, 0.06, 1.6, m.dark, 0, 2.38, -0.15));
    // direk ve çatallar
    g.add(box(0.08, 2.7, 0.1, m.steel, 0.38, 1.4, 0.95));
    g.add(box(0.08, 2.7, 0.1, m.steel, -0.38, 1.4, 0.95));
    g.add(box(0.85, 0.5, 0.06, m.steel, 0, 0.45, 1.05));
    g.add(box(0.12, 0.05, 1.1, m.steel, 0.25, 0.2, 1.6));
    g.add(box(0.12, 0.05, 1.1, m.steel, -0.25, 0.2, 1.6));
    wheel(g, m, 0.32, 0.25, W / 2 - 0.1, 0.55);
    wheel(g, m, 0.32, 0.25, -W / 2 + 0.1, 0.55);
    wheel(g, m, 0.26, 0.2, W / 2 - 0.1, -1.0);
    wheel(g, m, 0.26, 0.2, -W / 2 + 0.1, -1.0);
    return { group: g, w: W, l: L, h: 2.8 };
  },
  excavator(m) {
    const g = new THREE.Group();
    const W = 2.6;
    const L = 7.0;
    for (const s of [-1, 1]) {
      g.add(box(0.6, 0.75, 3.6, m.tire, s * (W / 2 - 0.3), 0.38, -0.6));
      g.add(box(0.5, 0.35, 3.3, m.steel, s * (W / 2 - 0.3), 0.4, -0.6));
    }
    const top = new THREE.Group();
    top.position.set(0, 0.85, -0.6);
    top.add(mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.2, 20), m.dark, 0, 0.1, 0));
    top.add(box(2.4, 0.9, 2.7, m.body, 0, 0.65, -0.35));
    top.add(box(0.95, 1.2, 1.1, m.body, -0.65, 1.7, 0.45));
    top.add(box(0.97, 0.8, 1.0, m.glass, -0.65, 1.8, 0.5));
    // bom ve kova
    const boom = box(0.35, 0.4, 3.1, m.body, 0.45, 2.05, 1.95);
    boom.rotation.x = -0.45;
    const arm = box(0.28, 0.32, 2.0, m.body, 0.45, 2.15, 3.8);
    arm.rotation.x = 0.9;
    const bucket = box(0.9, 0.6, 0.55, m.dark, 0.45, 1.2, 4.35);
    top.add(boom, arm, bucket);
    g.add(top);
    return { group: g, w: W, l: L, h: 3.4 };
  },
  motorcycle(m) {
    const g = new THREE.Group();
    const W = 0.8;
    const L = 2.2;
    const wh = (z) => {
      const t = mesh(new THREE.TorusGeometry(0.3, 0.08, 10, 24), m.tire, 0, 0.38, z);
      t.rotation.y = Math.PI / 2;
      const hb = mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.1, 10), m.hub, 0, 0.38, z);
      hb.rotation.z = Math.PI / 2;
      g.add(t, hb);
    };
    wh(0.75);
    wh(-0.75);
    g.add(box(0.3, 0.35, 0.9, m.body, 0, 0.75, 0.05));
    g.add(box(0.28, 0.12, 0.7, m.dark, 0, 0.95, -0.4));
    g.add(box(0.25, 0.25, 0.5, m.steel, 0, 0.5, -0.05));
    const fork = box(0.06, 0.75, 0.06, m.steel, 0, 0.7, 0.68);
    fork.rotation.x = 0.35;
    g.add(fork, box(0.7, 0.05, 0.05, m.dark, 0, 1.1, 0.55), box(0.18, 0.12, 0.08, m.light, 0, 0.95, 0.75));
    return { group: g, w: W, l: L, h: 1.15 };
  },
  generic(m) {
    const g = new THREE.Group();
    const W = 1.85;
    const L = 4.5;
    g.add(box(W, 0.75, L, m.body, 0, 0.72, 0));
    g.add(box(W - 0.15, 0.6, 2.3, m.glass, 0, 1.38, -0.3));
    g.add(box(W - 0.15, 0.05, 2.3, m.body, 0, 1.7, -0.3));
    axle(g, m, 0.36, 0.25, W, 1.45);
    axle(g, m, 0.36, 0.25, W, -1.45);
    lights(g, m, W, L, 0.8);
    return { group: g, w: W, l: L, h: 1.72 };
  },
};

export const BODY_KEYS = Object.keys(BUILDERS);

// ---------------------------------------------------------------- Doku yardımcıları
function canvasTexture(w, hgt, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = hgt;
  draw(c.getContext('2d'), w, hgt);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function roundRect(ctx, x, y, w, hgt, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + hgt, r);
  ctx.arcTo(x + w, y + hgt, x, y + hgt, r);
  ctx.arcTo(x, y + hgt, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function plateSprite(text) {
  const tex = canvasTexture(512, 112, (ctx, w, hgt) => {
    roundRect(ctx, 4, 4, w - 8, hgt - 8, 14);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.lineWidth = 6;
    ctx.strokeStyle = '#1f2937';
    ctx.stroke();
    ctx.fillStyle = '#1d4ed8';
    roundRect(ctx, 7, 7, 64, hgt - 14, 10);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 30px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('TR', 39, hgt / 2 + 2);
    ctx.fillStyle = '#111827';
    ctx.font = 'bold 60px ui-monospace, "Cascadia Mono", Consolas, monospace';
    ctx.fillText(text, (w + 70) / 2, hgt / 2 + 3, w - 100);
  });
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true }));
  sp.scale.set(2.3, 0.5, 1);
  sp.renderOrder = 10;
  return sp;
}

function alertSprite(level, count) {
  const tex = canvasTexture(128, 128, (ctx) => {
    ctx.beginPath();
    ctx.arc(64, 64, 56, 0, Math.PI * 2);
    ctx.fillStyle = ALERT_COLORS[level] || ALERT_COLORS.info;
    ctx.fill();
    ctx.lineWidth = 8;
    ctx.strokeStyle = '#fff';
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 72px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(count > 1 ? String(Math.min(count, 99)) : '!', 64, 70);
  });
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true }));
  sp.scale.set(0.75, 0.75, 1);
  sp.renderOrder = 11;
  return sp;
}

function textSprite(text, color = '#64748b', size = 44) {
  const tex = canvasTexture(512, 96, (ctx, w, hgt) => {
    ctx.fillStyle = color;
    ctx.font = `600 ${size}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, w / 2, hgt / 2);
  });
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true }));
  sp.scale.set(3.2, 0.6, 1);
  return sp;
}

// ---------------------------------------------------------------- Sahne
export class Garage3D {
  constructor(container, { onSelect, onHover, onAdd, canAdd = false } = {}) {
    this.container = container;
    this.onSelect = onSelect;
    this.onHover = onHover;
    this.onAdd = onAdd;
    this.canAdd = canAdd;
    this.items = new Map(); // id -> { v, group, hit, pad, plate, marker, mats, dims, slot }
    this.disposables = [];
    this.filter = null;
    this.selectedId = null;
    this.hoverId = null;
    this.t0 = performance.now();
    this.fly = null;

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.classList.add('garage-canvas');
    container.append(renderer.domElement);
    this.renderer = renderer;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xeef1f5);
    scene.fog = new THREE.Fog(0xeef1f5, 80, 220);
    this.scene = scene;

    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 500);
    this.controls = new OrbitControls(this.camera, renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI / 2.15;
    this.controls.minDistance = 4;
    this.controls.maxDistance = 160;
    this.controls.screenSpacePanning = false;

    scene.add(new THREE.HemisphereLight(0xffffff, 0xb8c0cc, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
    scene.add(sun, sun.target);
    this.sun = sun;

    this.world = new THREE.Group();
    scene.add(this.world);

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.down = null;

    this._onMove = (e) => this.handleMove(e);
    this._onDown = (e) => (this.down = { x: e.clientX, y: e.clientY, t: performance.now() });
    this._onUp = (e) => this.handleUp(e);
    this._onLeave = () => this.setHover(null);
    renderer.domElement.addEventListener('pointermove', this._onMove);
    renderer.domElement.addEventListener('pointerdown', this._onDown);
    renderer.domElement.addEventListener('pointerup', this._onUp);
    renderer.domElement.addEventListener('pointerleave', this._onLeave);

    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(container);
    this.resize();

    this.selBox = new THREE.Box3Helper(new THREE.Box3(), new THREE.Color(0x4f46e5));
    this.selBox.material.transparent = true;
    this.selBox.visible = false;
    scene.add(this.selBox);

    const loop = () => {
      this.raf = requestAnimationFrame(loop);
      this.tick();
    };
    loop();
  }

  resize() {
    const w = Math.max(1, this.container.clientWidth);
    const hgt = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, hgt, false);
    this.camera.aspect = w / hgt;
    this.camera.updateProjectionMatrix();
  }

  track(obj) {
    this.disposables.push(obj);
    return obj;
  }

  clearWorld() {
    this.world.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      for (const m of mats) {
        m.map?.dispose();
        m.dispose();
      }
    });
    this.world.clear();
    this.items.clear();
  }

  /** Araç listesine göre garajı (yeniden) kurar. */
  setVehicles(list) {
    this.clearWorld();
    const built = list.map((v) => {
      const builder = BUILDERS[v.body] || BUILDERS.generic;
      const mats = makeMats(v.color);
      const model = builder(mats);
      // Türün tanımlı uzunluğuna göre ölçekle (orantılı)
      const scale = v.length && model.l ? Math.min(1.6, Math.max(0.6, v.length / model.l)) : 1;
      model.group.scale.setScalar(scale);
      return { v, mats, model, dims: { w: model.w * scale, l: model.l * scale, h: model.h * scale } };
    });

    // ---- Yerleşim: sıralar, her sıra en uzun aracına göre derinlik alır
    const n = built.length + (this.canAdd ? 1 : 0);
    const avgW = built.length ? built.reduce((s, b) => s + b.dims.w + 1.3, 0) / built.length : 3.2;
    const perRow = Math.max(3, Math.min(12, Math.ceil(Math.sqrt(n * 1.8))));
    const maxRowWidth = perRow * Math.max(3.1, avgW);
    const rows = [];
    let cur = { items: [], width: 0, depth: 0 };
    const slotFor = (b) => ({ sw: Math.max(2.8, b.dims.w + 1.3), sd: b.dims.l + 1.6 });
    for (const b of built) {
      const { sw, sd } = slotFor(b);
      if (cur.items.length && cur.width + sw > maxRowWidth) {
        rows.push(cur);
        cur = { items: [], width: 0, depth: 0 };
      }
      cur.items.push({ b, sw, sd });
      cur.width += sw;
      cur.depth = Math.max(cur.depth, sd);
    }
    if (this.canAdd) {
      const sw = 3.2;
      if (cur.items.length && cur.width + sw > maxRowWidth) {
        rows.push(cur);
        cur = { items: [], width: 0, depth: 0 };
      }
      cur.items.push({ add: true, sw, sd: 6 });
      cur.width += sw;
      cur.depth = Math.max(cur.depth, 6);
    }
    if (cur.items.length) rows.push(cur);

    const LANE = 6.5;
    const totalWidth = Math.max(16, ...rows.map((r) => r.width));
    let z = 0;
    const slotPositions = [];
    rows.forEach((row, ri) => {
      // Satır ortalanır; araçlar şeride (+z yönüne) bakar
      let x = -row.width / 2;
      const rowZ = z - row.depth / 2;
      for (const it of row.items) {
        const cx = x + it.sw / 2;
        slotPositions.push({ it, cx, cz: rowZ, sw: it.sw, sd: row.depth, ri });
        x += it.sw;
      }
      z -= row.depth + LANE;
    });
    const totalDepth = -z - LANE;
    const centerZ = -totalDepth / 2;
    this.bounds = { width: totalWidth, depth: totalDepth, centerZ };

    // ---- Zemin ve şerit çizgileri
    const floorMat = new THREE.MeshStandardMaterial({ color: 0xd5d9df, roughness: 0.95 });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(totalWidth + 30, totalDepth + 30), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, 0, centerZ);
    floor.receiveShadow = true;
    this.world.add(floor);
    const laneMat = new THREE.MeshBasicMaterial({ color: 0xe8b923 });
    let lz = 0;
    for (const row of rows) {
      const laneZ = lz + LANE / 2 + 0.2;
      for (let x = -totalWidth / 2; x < totalWidth / 2; x += 2.4) {
        const dash = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.14), laneMat);
        dash.rotation.x = -Math.PI / 2;
        dash.position.set(x + 0.65, 0.012, laneZ);
        this.world.add(dash);
      }
      lz -= row.depth + LANE;
    }
    // arka duvar ve kolonlar
    const wallMat = new THREE.MeshStandardMaterial({ color: 0xf4f5f7, roughness: 0.9 });
    const wall = new THREE.Mesh(new THREE.BoxGeometry(totalWidth + 30, 4, 0.4), wallMat);
    wall.position.set(0, 2, -totalDepth - 15 + 0.2);
    wall.receiveShadow = true;
    this.world.add(wall);
    const pillarMat = new THREE.MeshStandardMaterial({ color: 0xc9ced6, roughness: 0.8 });
    const stripeMat = new THREE.MeshStandardMaterial({ color: 0xf2b705, roughness: 0.6 });
    for (const sx of [-1, 1]) {
      for (let pz = 0; pz > -totalDepth - 1; pz -= 10) {
        const p = new THREE.Mesh(new THREE.BoxGeometry(0.6, 4, 0.6), pillarMat);
        p.position.set(sx * (totalWidth / 2 + 3), 2, pz - 2);
        p.castShadow = true;
        const s = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.4, 0.62), stripeMat);
        s.position.set(p.position.x, 0.4, p.position.z);
        this.world.add(p, s);
      }
    }

    // ---- Yuvalar ve araçlar
    const lineMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    for (const sp of slotPositions) {
      const { it, cx, cz, sw, sd } = sp;
      // yuva çizgileri (sol/sağ/arka)
      for (const lx of [cx - sw / 2, cx + sw / 2]) {
        const ln = new THREE.Mesh(new THREE.PlaneGeometry(0.1, sd), lineMat);
        ln.rotation.x = -Math.PI / 2;
        ln.position.set(lx, 0.011, cz);
        this.world.add(ln);
      }
      const back = new THREE.Mesh(new THREE.PlaneGeometry(sw, 0.1), lineMat);
      back.rotation.x = -Math.PI / 2;
      back.position.set(cx, 0.011, cz - sd / 2);
      this.world.add(back);

      if (it.add) {
        const padMat = new THREE.MeshBasicMaterial({ color: 0x4f46e5, transparent: true, opacity: 0.08 });
        const pad = new THREE.Mesh(new THREE.PlaneGeometry(sw - 0.5, sd - 0.6), padMat);
        pad.rotation.x = -Math.PI / 2;
        pad.position.set(cx, 0.015, cz);
        const plus = textSprite('+ Araç ekle', '#4f46e5', 54);
        plus.position.set(cx, 0.9, cz);
        plus.scale.set(3.0, 0.56, 1);
        const hit = new THREE.Mesh(new THREE.BoxGeometry(sw - 0.4, 1.4, sd - 0.6), new THREE.MeshBasicMaterial({ visible: false }));
        hit.position.set(cx, 0.7, cz);
        hit.userData.add = true;
        this.world.add(pad, plus, hit);
        this.addHit = hit;
        continue;
      }

      const { v, mats, model, dims } = it.b;
      const padMat = new THREE.MeshStandardMaterial({ color: STATUS_COLORS[v.display_status] ?? STATUS_COLORS.passive, transparent: true, opacity: 0.32, roughness: 1 });
      const pad = new THREE.Mesh(new THREE.PlaneGeometry(sw - 0.35, sd - 0.4), padMat);
      pad.rotation.x = -Math.PI / 2;
      pad.position.set(cx, 0.014, cz);
      pad.receiveShadow = true;
      const stripeMat2 = new THREE.MeshBasicMaterial({ color: STATUS_COLORS[v.display_status] ?? STATUS_COLORS.passive });
      const stripe = new THREE.Mesh(new THREE.PlaneGeometry(sw - 0.35, 0.28), stripeMat2);
      stripe.rotation.x = -Math.PI / 2;
      stripe.position.set(cx, 0.016, cz + sd / 2 - 0.34);

      const group = model.group;
      // aracı yuvanın biraz arkasına it (ön tarafta şerit boşluğu)
      group.position.set(cx, 0, cz - (sd - dims.l) / 2 + 0.5);
      group.userData.vehicleId = v.id;

      const plateSp = plateSprite(v.plate);
      plateSp.position.set(cx, dims.h + 0.55, group.position.z);
      const level = v.alert_level;
      let marker = null;
      if (level) {
        marker = alertSprite(level, v.alerts?.length || 1);
        marker.position.set(cx, dims.h + 1.3, group.position.z);
        marker.userData.baseY = marker.position.y;
      }
      const hit = new THREE.Mesh(new THREE.BoxGeometry(Math.max(dims.w, 1.2) + 0.2, dims.h + 0.3, dims.l + 0.2), new THREE.MeshBasicMaterial({ visible: false }));
      hit.position.set(cx, (dims.h + 0.3) / 2, group.position.z);
      hit.userData.vehicleId = v.id;

      this.world.add(pad, stripe, group, plateSp, hit);
      if (marker) this.world.add(marker);
      const item = { v, group, hit, pad, padMat, stripeMat: stripeMat2, plate: plateSp, marker, mats, dims, cx, cz: group.position.z };
      this.items.set(v.id, item);
      this.applyLook(item);
    }

    // ---- Işık ve kamera sınırları
    const span = Math.max(totalWidth, totalDepth) + 20;
    this.sun.position.set(totalWidth * 0.3 + 10, 30, centerZ + 25);
    this.sun.target.position.set(0, 0, centerZ);
    const sc = this.sun.shadow.camera;
    sc.left = -span / 2;
    sc.right = span / 2;
    sc.top = span / 2;
    sc.bottom = -span / 2;
    sc.near = 1;
    sc.far = 120;
    sc.updateProjectionMatrix();
    this.controls.maxDistance = Math.max(60, span * 2);
    if (!this.cameraInit) {
      this.resetView(false);
      this.cameraInit = true;
    }
    if (this.selectedId && !this.items.has(this.selectedId)) this.select(null);
    else if (this.selectedId) this.updateSelBox();
    this.applyFilter();
  }

  /** Sefer: hayalet (yarı saydam); filtre dışı: soluk. */
  applyLook(item) {
    const ghost = item.v.display_status === 'on_trip';
    const dim = item.dimmed;
    const op = dim ? 0.1 : ghost ? 0.28 : 1;
    for (const m of Object.values(item.mats)) {
      m.transparent = op < 1;
      m.opacity = op;
      m.depthWrite = op >= 1;
      m.needsUpdate = true;
    }
    item.group.traverse((o) => { if (o.isMesh) o.castShadow = op >= 1; });
    item.padMat.opacity = dim ? 0.08 : 0.32;
    item.stripeMat.transparent = true;
    item.stripeMat.opacity = dim ? 0.25 : 1;
    item.plate.material.opacity = dim ? 0.25 : 1;
    if (item.marker) item.marker.material.opacity = dim ? 0.2 : 1;
  }

  setFilter(fn) {
    this.filter = fn;
    this.applyFilter();
  }

  applyFilter() {
    for (const item of this.items.values()) {
      item.dimmed = this.filter ? !this.filter(item.v) : false;
      this.applyLook(item);
    }
  }

  resetView(animate = true) {
    const b = this.bounds || { width: 20, depth: 20, centerZ: -10 };
    // Yerleşimi çevreleyen küreyi, görüş açısının dar ekseni (dikey ya da yatay) içine sığdır.
    const radius = Math.hypot(b.width / 2, b.depth / 2) + 2;
    const vfov = THREE.MathUtils.degToRad(this.camera.fov);
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * this.camera.aspect);
    const dist = (radius / Math.sin(Math.min(vfov, hfov) / 2)) * 0.74;
    const target = new THREE.Vector3(0, 0, b.centerZ + b.depth * 0.04);
    const pos = target.clone().addScaledVector(new THREE.Vector3(0.12, 0.62, 0.8).normalize(), dist);
    if (animate) this.flyTo(pos, target);
    else {
      this.camera.position.copy(pos);
      this.controls.target.copy(target);
      this.controls.update();
    }
  }

  flyTo(pos, target, ms = 750) {
    this.fly = { from: this.camera.position.clone(), to: pos, tFrom: this.controls.target.clone(), tTo: target, start: performance.now(), ms };
  }

  focus(id) {
    const it = this.items.get(id);
    if (!it) return;
    const d = Math.max(7, it.dims.l * 1.1 + 4);
    const target = new THREE.Vector3(it.cx, it.dims.h * 0.45, it.cz);
    this.flyTo(new THREE.Vector3(it.cx + d * 0.55, it.dims.h + d * 0.55, it.cz + d * 0.95), target);
  }

  select(id, { focus = true, silent = false } = {}) {
    this.selectedId = id;
    if (!id) {
      this.selBox.visible = false;
      if (!silent) this.onSelect?.(null);
      return;
    }
    this.updateSelBox();
    if (focus) this.focus(id);
    if (!silent) this.onSelect?.(this.items.get(id)?.v || null);
  }

  updateSelBox() {
    const it = this.items.get(this.selectedId);
    if (!it) {
      this.selBox.visible = false;
      return;
    }
    this.selBox.box.setFromObject(it.group).expandByScalar(0.15);
    this.selBox.visible = true;
  }

  pick(e) {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const targets = [...[...this.items.values()].map((i) => i.hit), ...(this.addHit ? [this.addHit] : [])];
    const hit = this.raycaster.intersectObjects(targets, false)[0];
    if (!hit) return null;
    if (hit.object.userData.add) return { add: true };
    return { id: hit.object.userData.vehicleId };
  }

  handleMove(e) {
    if (e.buttons) return; // sürükleme sırasında ipucu yok
    const p = this.pick(e);
    this.renderer.domElement.style.cursor = p ? 'pointer' : 'grab';
    this.setHover(p?.id ?? (p?.add ? 'add' : null), e);
  }

  setHover(id, e) {
    if (id !== this.hoverId) {
      const prev = this.items.get(this.hoverId);
      if (prev) prev.group.position.y = 0;
      this.hoverId = id;
      const cur = this.items.get(id);
      if (cur && !cur.dimmed) cur.group.position.y = 0.06;
    }
    const v = id === 'add' ? { add: true } : this.items.get(id)?.v || null;
    this.onHover?.(v, e);
  }

  handleUp(e) {
    if (!this.down) return;
    const moved = Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y);
    this.down = null;
    if (moved > 5) return;
    const p = this.pick(e);
    if (p?.add) this.onAdd?.();
    else if (p?.id) this.select(p.id);
    else this.select(null);
  }

  tick() {
    const t = (performance.now() - this.t0) / 1000;
    if (this.fly) {
      const k = Math.min(1, (performance.now() - this.fly.start) / this.fly.ms);
      const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      this.camera.position.lerpVectors(this.fly.from, this.fly.to, e);
      this.controls.target.lerpVectors(this.fly.tFrom, this.fly.tTo, e);
      if (k >= 1) this.fly = null;
    }
    for (const it of this.items.values()) {
      if (it.marker) it.marker.position.y = it.marker.userData.baseY + Math.sin(t * 2.6 + it.cx) * 0.12;
    }
    if (this.selBox.visible) this.selBox.material.opacity = 0.6 + Math.sin(t * 4) * 0.4;
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.resizeObs.disconnect();
    const el = this.renderer.domElement;
    el.removeEventListener('pointermove', this._onMove);
    el.removeEventListener('pointerdown', this._onDown);
    el.removeEventListener('pointerup', this._onUp);
    el.removeEventListener('pointerleave', this._onLeave);
    this.controls.dispose();
    this.clearWorld();
    this.selBox.geometry.dispose();
    this.selBox.material.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss?.();
    el.remove();
  }
}
