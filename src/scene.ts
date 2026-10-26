import * as THREE from 'three';
import type { Point, Quality, Save, Snapshot, SpeciesId } from './contracts';
import { HOTSPOTS, bossUnlocked, hotspotAt, isWater } from './simulation';

const TAU = Math.PI * 2;
const UP = new THREE.Vector3(0, 1, 0);
const SPECIES: SpeciesId[] = ['perch', 'trout', 'bass', 'pike', 'king'];

function random(seed: number): () => number {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
    return (seed >>> 0) / 4294967296;
  };
}

function woodTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;
  const rand = random(127);
  ctx.fillStyle = '#d4b78c';
  ctx.fillRect(0, 0, 128, 512);
  for (let i = 0; i < 230; i++) {
    const x = rand() * 128;
    ctx.strokeStyle = `rgba(70,43,23,${0.025 + rand() * 0.12})`;
    ctx.lineWidth = 0.3 + rand() * 1.2;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.bezierCurveTo(x + 8, 140, x - 8, 340, x + rand() * 5, 512);
    ctx.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 4;
  return texture;
}

function surface(color: THREE.ColorRepresentation, roughness = 0.85): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness: 0 });
}

function mesh(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  parent: THREE.Object3D,
  x = 0, y = 0, z = 0,
): THREE.Mesh {
  const result = new THREE.Mesh(geometry, material);
  result.position.set(x, y, z);
  result.castShadow = true;
  result.receiveShadow = true;
  parent.add(result);
  return result;
}

function box(
  parent: THREE.Object3D, material: THREE.Material,
  x: number, y: number, z: number, w: number, h: number, d: number,
): THREE.Mesh {
  return mesh(new THREE.BoxGeometry(w, h, d), material, parent, x, y, z);
}

function beam(parent: THREE.Object3D, material: THREE.Material, a: THREE.Vector3, b: THREE.Vector3, radius: number): THREE.Mesh {
  const part = mesh(new THREE.CylinderGeometry(radius, radius * 1.08, a.distanceTo(b), 7), material, parent);
  part.position.copy(a).add(b).multiplyScalar(0.5);
  part.quaternion.setFromUnitVectors(UP, b.clone().sub(a).normalize());
  return part;
}

interface Ring {
  mesh: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  age: number;
  duration: number;
  size: number;
}

interface Droplet {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  age: number;
}

/** The entire lake is procedural: no image downloads, models, or reflection passes. */
export class LakeScene {
  public readonly canvas: HTMLCanvasElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(48, 1, 0.15, 780);
  private readonly boat = new THREE.Group();
  private readonly rod = new THREE.Group();
  private readonly float = new THREE.Group();
  private readonly fighter = new THREE.Group();
  private readonly trophy = new THREE.Group();
  private readonly aim = new THREE.Group();
  private readonly oars: THREE.Group[] = [];
  private readonly schools: THREE.Group[] = [];
  private readonly feedingGrounds: THREE.Group[] = [];
  private readonly fineDetail = new THREE.Group();
  private readonly royalWake = new THREE.Group();
  private readonly fishShadow = new THREE.Group();
  private readonly fishes = new Map<SpeciesId, THREE.Group>();
  private readonly trophies = new Map<SpeciesId, THREE.Group>();
  private readonly rings: Ring[] = [];
  private readonly droplets: Droplet[] = [];
  private readonly dummy = new THREE.Object3D();
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly plane = new THREE.Plane(UP, 0);
  private readonly hit = new THREE.Vector3();
  private readonly cameraGoal = new THREE.Vector3();
  private readonly lookGoal = new THREE.Vector3();
  private readonly look = new THREE.Vector3(0, 0, 16);
  private readonly rodTip = new THREE.Vector3();
  private readonly p = new THREE.Vector3();
  private readonly q = new THREE.Vector3();
  private readonly linePositions = new Float32Array(49 * 3);
  private readonly rodPositions = new Float32Array(19 * 3);
  private readonly lineGeometry = new THREE.BufferGeometry();
  private readonly rodGeometry = new THREE.BufferGeometry();
  private readonly rodGuides: THREE.Mesh[] = [];
  private rodShaft!: THREE.InstancedMesh;
  private readonly water: THREE.ShaderMaterial;
  private readonly hullPaint: THREE.MeshStandardMaterial;
  private readonly sun: THREE.DirectionalLight;
  private readonly particles: THREE.InstancedMesh;
  private readonly grain: THREE.CanvasTexture;
  private quality: Quality = 'high';
  private orbitYaw = 0;
  private orbitPitch = 0;
  private elapsed = 0;
  private ringCursor = 0;
  private dropCursor = 0;
  private effectClock = 0;
  private previousPhase = '';
  private paint = '';
  private lost = false;
  private disposed = false;
  private cameraReady = false;
  private readonly onLost: (event: Event) => void;
  private readonly onRestored: () => void;

  constructor(container: HTMLElement, onContextLost: () => void, onContextRestored: () => void) {
    try {
      this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    } catch {
      throw new Error('Stillwater needs WebGL 2. Enable hardware acceleration in your browser, update your graphics driver, and reload. Try a current Chrome, Firefox, or Safari browser.');
    }
    this.canvas = this.renderer.domElement;
    this.canvas.setAttribute('aria-label', 'Stillwater wilderness lake, fishing boat, and moving water');
    this.canvas.style.display = 'block';
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    container.appendChild(this.canvas);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.13;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.scene.fog = new THREE.FogExp2('#b2c1ad', 0.0035);
    this.scene.add(new THREE.HemisphereLight('#c2d6cf', '#6c6c43', 2.15));
    this.sun = new THREE.DirectionalLight('#ffdb9f', 3.3);
    this.sun.position.set(-65, 95, -110);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.left = this.sun.shadow.camera.bottom = -70;
    this.sun.shadow.camera.right = this.sun.shadow.camera.top = 70;
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 300;
    this.sun.shadow.normalBias = 0.06;
    this.sun.shadow.bias = -0.00015;
    this.scene.add(this.sun);
    this.grain = woodTexture();
    this.hullPaint = surface('#476f68', 0.64);
    this.makeSky();
    this.water = this.makeWater();
    this.makeLandscape();
    this.makeDock();
    this.makeBoat();
    this.makeFishingGear();
    for (const species of SPECIES) {
      const fish = this.makeFish(species);
      fish.visible = false;
      this.fishes.set(species, fish);
      this.fighter.add(fish);
      const trophy = fish.clone();
      this.trophies.set(species, trophy);
      this.trophy.add(trophy);
    }
    this.scene.add(this.boat, this.float, this.fighter, this.trophy, this.aim);
    this.makeSchools();
    this.makeFeedingGrounds();
    const ringGeometry = new THREE.RingGeometry(0.88, 1, 48);
    for (let i = 0; i < 28; i++) {
      const material = new THREE.MeshBasicMaterial({
        color: '#c4ded0', transparent: true, opacity: 0, depthWrite: false,
        side: THREE.DoubleSide,
      });
      const circle = mesh(ringGeometry, material, this.scene) as Ring['mesh'];
      circle.rotation.x = -Math.PI / 2;
      circle.visible = false;
      circle.castShadow = false;
      this.rings.push({ mesh: circle, age: 10, duration: 2, size: 1 });
    }
    this.particles = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.045, 4, 3),
      new THREE.MeshBasicMaterial({ color: '#f4e8ba', transparent: true, opacity: 0.8 }),
      48,
    );
    this.particles.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.particles.frustumCulled = false;
    this.scene.add(this.particles);
    for (let i = 0; i < 48; i++) this.droplets.push({ x: 0, y: -20, z: 0, vx: 0, vy: 0, vz: 0, age: 10 });
    this.onLost = (event: Event) => {
      event.preventDefault();
      this.lost = true;
      onContextLost();
    };
    this.onRestored = () => {
      if (this.disposed) return;
      this.lost = false;
      this.renderer.resetState();
      this.setQuality(this.quality);
      this.resize();
      onContextRestored();
    };
    this.canvas.addEventListener('webglcontextlost', this.onLost);
    this.canvas.addEventListener('webglcontextrestored', this.onRestored);
    this.camera.position.set(5, 13, 51);
    this.setQuality('high');
    this.resize();
  }

  private makeSky(): void {
    const sky = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        sunDirection: { value: new THREE.Vector3(-0.4, 0.19, -0.9).normalize() },
      },
      vertexShader: `
        varying vec3 vDirection;
        void main() {
          vDirection = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform vec3 sunDirection;
        varying vec3 vDirection;
        void main() {
          vec3 d = normalize(vDirection);
          float h = max(d.y, 0.0);
          vec3 horizon = vec3(0.88, 0.70, 0.44);
          vec3 zenith = vec3(0.29, 0.47, 0.50);
          vec3 color = mix(horizon, zenith, smoothstep(0.0, 0.8, h));
          float sun = max(dot(d, sunDirection), 0.0);
          color += vec3(1.0, 0.46, 0.13) * pow(sun, 18.0) * 0.33;
          color += vec3(1.0, 0.80, 0.46) * pow(sun, 600.0) * 2.3;
          float cloud = sin(d.x * 19.0 + d.z * 7.0) * sin(d.z * 29.0 - d.x * 3.0);
          cloud *= sin(d.x * 55.0 + d.z * 18.0) * 0.4 + 0.6;
          color = mix(color, vec3(0.91, 0.82, 0.65), smoothstep(0.35, 0.8, cloud) * smoothstep(0.1, 0.25, h) * (1.0 - smoothstep(0.3, 0.55, h)) * 0.2);
          gl_FragColor = vec4(color, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    const dome = mesh(new THREE.SphereGeometry(650, 40, 24), sky, this.scene);
    dome.castShadow = dome.receiveShadow = false;
  }

  private makeWater(): THREE.ShaderMaterial {
    const material = new THREE.ShaderMaterial({
      uniforms: {
        time: { value: 0 },
        effects: { value: 1 },
        boatPosition: { value: new THREE.Vector2(0, 30) },
        boatSpeed: { value: 0 },
        boatHeading: { value: 0 },
        fishPosition: { value: new THREE.Vector2() },
        fishActivity: { value: 0 },
        royal: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
      vertexShader: `
        uniform float time;
        varying vec3 vWorld;
        void main() {
          vec3 p = position;
          vec4 world = modelMatrix * vec4(p, 1.0);
          world.y += sin(world.x * 0.27 + time * 0.7) * sin(world.z * 0.23 + time * 0.4) * 0.035;
          vWorld = world.xyz;
          gl_Position = projectionMatrix * viewMatrix * world;
        }`,
      fragmentShader: `
        uniform float time;
        uniform float effects;
        uniform vec2 boatPosition;
        uniform float boatSpeed;
        uniform float boatHeading;
        uniform vec2 fishPosition;
        uniform float fishActivity;
        uniform float royal;
        varying vec3 vWorld;
        void main() {
          vec2 p = vWorld.xz;
          float a = p.x * 0.52 + p.y * 0.31 + time * 0.85;
          float b = p.x * -0.34 + p.y * 0.68 - time * 0.6;
          float c = p.x * 1.71 + p.y * 1.24 + time * 1.4;
          vec2 gradient = vec2(cos(a) * 0.052 - cos(b) * 0.027, cos(a) * 0.031 + cos(b) * 0.054);
          gradient += vec2(cos(c), sin(c * 0.83)) * 0.014 * effects;
          vec3 n = normalize(vec3(-gradient.x, 1.0, -gradient.y));
          vec3 viewDir = normalize(cameraPosition - vWorld);
          float fresnel = pow(1.0 - max(dot(viewDir, n), 0.0), 3.0);
          float edge = length(p / vec2(85.0, 60.0));
          float i1 = length((p - vec2(-46.0, -20.0)) / vec2(10.0, 8.0));
          float i2 = length((p - vec2(42.0, 24.0)) / vec2(12.0, 8.0));
          float shallow = max(smoothstep(0.79, 1.0, edge), max(1.0 - smoothstep(1.0, 1.6, i1), 1.0 - smoothstep(1.0, 1.5, i2)));
          vec3 deep = vec3(0.018, 0.115, 0.145);
          vec3 color = mix(deep, vec3(0.19, 0.40, 0.32), shallow * 0.8);
          vec3 reflectedSky = mix(vec3(0.20, 0.36, 0.33), vec3(0.43, 0.37, 0.23), fresnel);
          color = mix(color, reflectedSky, 0.12 + fresnel * 0.48);
          // Broken vertical forest reflections anchor the lake to its banks.
          float reflectedTrees = sin(p.x * 0.43 + sin(p.x * 0.19) * 2.8 + gradient.x * 9.0);
          reflectedTrees += sin(p.x * 1.47 + gradient.y * 13.0) * 0.28;
          float bankReflection = smoothstep(0.45, 0.95, edge) * smoothstep(-0.6, 0.8, reflectedTrees);
          color = mix(color, vec3(0.06, 0.15, 0.13), bankReflection * 0.38);
          vec3 lightDir = normalize(vec3(-0.4, 0.35, -0.9));
          vec3 halfDir = normalize(lightDir + viewDir);
          float spec = pow(max(dot(n, halfDir), 0.0), 150.0);
          float sparkle = pow(max(dot(n, halfDir), 0.0), 580.0);
          color += vec3(1.0, 0.76, 0.38) * (spec * 0.30 + sparkle * 0.44) * effects;
          float ribbon = sin(p.y * 3.8 + sin(p.x * 1.1 + time) * 1.3 + time * 1.1);
          float rippleBreak = smoothstep(-0.15, 0.65, sin(p.x * 0.73 + p.y * 0.24 + sin(p.y * 0.81)));
          color += vec3(0.09, 0.15, 0.11) * smoothstep(0.94, 1.0, ribbon) * rippleBreak * 0.24;
          float foam = smoothstep(0.965, 0.999, edge) * (0.5 + sin(a * 2.0) * 0.3);
          foam += (1.0 - smoothstep(1.0, 1.07, min(i1, i2))) * 0.22;
          vec2 relative = p - boatPosition;
          vec2 stern = vec2(-sin(boatHeading), cos(boatHeading));
          float aft = dot(relative, stern);
          float lateral = abs(dot(relative, vec2(stern.y, -stern.x)));
          float wakeEdge = exp(-pow((lateral - aft * 0.32) * 3.0, 2.0));
          float wake = wakeEdge * smoothstep(0.5, 2.8, aft) * (1.0 - smoothstep(4.0, 13.0, aft));
          wake *= min(boatSpeed * 0.065, 0.35) * (0.7 + 0.3 * sin(aft * 6.0 - time * 4.0));
          color += vec3(0.55, 0.62, 0.48) * (foam * 0.42 + wake);
          float fishDistance = length(p - fishPosition);
          float pressure = sin(fishDistance * 5.0 - time * 3.0);
          float fishWave = smoothstep(0.76, 1.0, pressure) * exp(-fishDistance * 0.25) * fishActivity;
          color += mix(vec3(0.22, 0.40, 0.35), vec3(0.74, 0.43, 0.09), royal) * fishWave * 0.38;
          float caustic = sin(p.x * 2.6 + sin(p.y * 2.0 + time * 0.35)) * sin(p.y * 2.8 - time * 0.3);
          color += vec3(0.12, 0.20, 0.11) * smoothstep(0.72, 0.98, caustic) * shallow * effects * 0.28;
          float distanceFog = 1.0 - exp(-pow(length(cameraPosition - vWorld) * 0.0035, 2.0));
          color = mix(color, vec3(0.44, 0.52, 0.43), distanceFog);
          gl_FragColor = vec4(color, 0.965);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    const geometry = new THREE.CircleGeometry(1, 144);
    geometry.rotateX(-Math.PI / 2);
    const water = mesh(geometry, material, this.scene);
    water.scale.set(85, 1, 60);
    water.position.y = 0.015;
    water.castShadow = water.receiveShadow = false;
    water.renderOrder = 1;
    return material;
  }

  private makeLandscape(): void {
    const rand = random(9453);
    const turf = surface('#7e8550');
    const sand = surface('#ad9b70');
    const bark = surface('#65543d');
    const rock = surface('#7d8173');
    const darkRock = surface('#566c65');
    const leaves = [surface('#36594b'), surface('#4b6b4b'), surface('#627e50'), surface('#768548'), surface('#344f45')];
    const terrainGeometry = new THREE.BufferGeometry();
    const vertices: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    const rings = 12;
    const segments = 160;
    const color = new THREE.Color();
    for (let r = 0; r <= rings; r++) {
      for (let j = 0; j <= segments; j++) {
        const angle = j / segments * TAU;
        const f = r / rings;
        const radius = 1 + f * 2.4;
        const x = Math.sin(angle) * 85 * radius;
        const z = Math.cos(angle) * 60 * radius;
        const ridge = Math.sin(angle * 7 + 1) * 1.2 + Math.cos(angle * 13) * 0.6;
        const y = r === 0 ? -0.16 : 0.45 + f * 9 + ridge * Math.min(f * 6, 1) + Math.sin(x * 0.06) * Math.sin(z * 0.05) * f * 8;
        vertices.push(x, y, z);
        color.set(r < 2 ? '#ad9b70' : '#7e8550');
        color.multiplyScalar(0.93 + rand() * 0.14);
        colors.push(color.r, color.g, color.b);
        if (r < rings && j < segments) {
          const a = r * (segments + 1) + j;
          const b = a + segments + 1;
          indices.push(a, a + 1, b, a + 1, b + 1, b);
        }
      }
    }
    terrainGeometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    terrainGeometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    terrainGeometry.setIndex(indices);
    terrainGeometry.computeVertexNormals();
    mesh(terrainGeometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide }), this.scene);
    const bed = mesh(new THREE.CircleGeometry(1, 100), surface('#626d49'), this.scene, 0, -1.4, 0);
    bed.rotation.x = -Math.PI / 2;
    bed.scale.set(85, 60, 1);
    const islandGeometry = new THREE.SphereGeometry(1, 20, 9);
    const islands = [{ x: -46, z: -20, rx: 10, rz: 8 }, { x: 42, z: 24, rx: 12, rz: 8 }];
    for (const island of islands) {
      const bank = mesh(islandGeometry, sand, this.scene, island.x, -1.2, island.z);
      bank.scale.set(island.rx, 3.1, island.rz);
      const grass = mesh(islandGeometry, turf, this.scene, island.x, -0.35, island.z);
      grass.scale.set(island.rx * 0.88, 2.7, island.rz * 0.86);
    }

    // Shared instancing keeps a dense, hand-shaped forest inexpensive.
    const trunkInstances: THREE.Matrix4[] = [];
    const leafInstances: THREE.Matrix4[][] = leaves.map(() => []);
    const stoneInstances: THREE.Matrix4[] = [];
    const object = new THREE.Object3D();
    const addMatrix = (list: THREE.Matrix4[], x: number, y: number, z: number, sx: number, sy: number, sz: number, yaw = 0) => {
      object.position.set(x, y, z);
      object.rotation.set(0, yaw, 0);
      object.scale.set(sx, sy, sz);
      object.updateMatrix();
      list.push(object.matrix.clone());
    };
    const tree = (x: number, y: number, z: number, size: number, pine: boolean) => {
      const height = (pine ? 9 : 7.5) * size;
      addMatrix(trunkInstances, x, y + height * 0.42, z, 0.30 * size, height * 0.86, 0.30 * size);
      const tint = Math.floor(rand() * leaves.length);
      if (pine) {
        for (let tier = 0; tier < 5; tier++) {
          const width = (2.8 - tier * 0.43) * size;
          for (let lobe = 0; lobe < 3; lobe++) {
            const a = lobe * TAU / 3 + tier * 0.8;
            addMatrix(leafInstances[tint], x + Math.sin(a) * width * 0.3, y + (3.1 + tier * 1.25) * size, z + Math.cos(a) * width * 0.3,
              width * 0.78, size * (1.6 - tier * 0.12), width * 0.76, rand() * TAU);
          }
        }
        addMatrix(leafInstances[tint], x, y + height * 1.02, z, 0.65 * size, 1.4 * size, 0.65 * size);
      } else {
        for (let lobe = 0; lobe < 7; lobe++) {
          const a = lobe * 2.4;
          const spread = lobe === 0 ? 0 : size * (1.1 + rand() * 1.6);
          addMatrix(leafInstances[(tint + (lobe % 3 === 0 ? 1 : 0)) % leaves.length],
            x + Math.sin(a) * spread, y + height * (0.68 + rand() * 0.28), z + Math.cos(a) * spread,
            size * (1.8 + rand() * 1.1), size * (1.6 + rand()), size * (1.8 + rand()), rand() * TAU);
        }
      }
    };
    for (let i = 0; i < 245; i++) {
      const angle = rand() * TAU;
      const radius = 1.09 + rand() * 0.75;
      const x = Math.sin(angle) * 85 * radius;
      const z = Math.cos(angle) * 60 * radius;
      if (z > 56 && Math.abs(x) < 21) continue;
      const f = (radius - 1) / 2.4;
      const y = 0.7 + f * 9 + (Math.sin(angle * 7 + 1) * 1.2 + Math.cos(angle * 13) * 0.6) * Math.min(f * 6, 1)
        + Math.sin(x * 0.06) * Math.sin(z * 0.05) * f * 8;
      tree(x, y, z, 0.7 + rand() * 0.9, rand() > 0.49);
    }
    for (const island of islands) {
      for (let i = 0; i < 8; i++) {
        const a = rand() * TAU;
        const r = Math.sqrt(rand()) * 0.55;
        tree(island.x + Math.cos(a) * r * island.rx, 1.6, island.z + Math.sin(a) * r * island.rz, 0.65 + rand() * 0.4, i % 3 === 0);
      }
    }
    for (let i = 0; i < 130; i++) {
      const a = rand() * TAU;
      const r = 1.01 + rand() * 0.045;
      const size = 0.5 + rand() * 1.4;
      if (Math.cos(a) > 0.9 && Math.abs(Math.sin(a) * 85) < 7) continue;
      addMatrix(stoneInstances, Math.sin(a) * 85 * r, 0.18, Math.cos(a) * 60 * r,
        size * 1.4, size * 0.75, size, rand() * TAU);
    }
    for (const island of islands) {
      for (let i = 0; i < 17; i++) {
        const a = i / 17 * TAU;
        addMatrix(stoneInstances, island.x + Math.sin(a) * island.rx * 0.91, 0.35, island.z + Math.cos(a) * island.rz * 0.91,
          0.7 + rand(), 0.5 + rand() * 0.5, 0.7 + rand(), a);
      }
    }
    const instantiate = (geometry: THREE.BufferGeometry, material: THREE.Material, list: THREE.Matrix4[]) => {
      const batch = new THREE.InstancedMesh(geometry, material, list.length);
      list.forEach((matrix, index) => batch.setMatrixAt(index, matrix));
      batch.castShadow = batch.receiveShadow = true;
      this.scene.add(batch);
    };
    instantiate(new THREE.CylinderGeometry(0.8, 1, 1, 6), bark, trunkInstances);
    const foliageGeometry = new THREE.IcosahedronGeometry(1, 1);
    leaves.forEach((material, i) => instantiate(foliageGeometry, material, leafInstances[i]));
    instantiate(new THREE.DodecahedronGeometry(1, 0), rock, stoneInstances);

    // Reeds form irregular coves rather than an unbroken decorative border.
    const reedMatrices: THREE.Matrix4[] = [];
    const reedTops: THREE.Matrix4[] = [];
    for (let i = 0; i < 360; i++) {
      const a = rand() * TAU;
      if (Math.sin(a * 5) < -0.05 || (Math.cos(a) > 0.92 && Math.abs(Math.sin(a)) < 0.25)) continue;
      const r = 0.965 + rand() * 0.037;
      const x = Math.sin(a) * 85 * r, z = Math.cos(a) * 60 * r;
      const h = 0.7 + rand() * 1.2;
      addMatrix(reedMatrices, x, h * 0.5 - 0.08, z, 0.035, h, 0.035);
      addMatrix(reedTops, x, h - 0.05, z, 0.065, 0.28, 0.065);
    }
    instantiate(new THREE.CylinderGeometry(1, 1, 1, 4), surface('#6c7b43'), reedMatrices);
    instantiate(new THREE.CylinderGeometry(1, 1, 1, 5), surface('#72563d'), reedTops);

    const mountainColors = ['#738f87', '#89a099', '#a1afa0'];
    for (let layer = 2; layer >= 0; layer--) {
      const material = surface(mountainColors[layer]);
      for (let i = 0; i < 10; i++) {
        const x = (i - 4.5) * 52 + (layer % 2) * 21;
        const z = -140 - layer * 74 - rand() * 20;
        const height = 35 + rand() * 45 + layer * 9;
        const geometry = new THREE.BufferGeometry();
        const pts: number[] = [], idx: number[] = [];
        const count = 13;
        for (let tier = 0; tier < 5; tier++) {
          const t = tier / 4;
          for (let j = 0; j < count; j++) {
            const a = j / count * TAU;
            const radius = (1 - t) * (29 + rand() * 13);
            pts.push(Math.cos(a) * radius + t * 7, t * height + (tier > 0 && tier < 4 ? rand() * 8 : 0), Math.sin(a) * radius * 0.7);
            if (tier < 4) {
              const p = tier * count + j, n = tier * count + (j + 1) % count;
              idx.push(p, p + count, n, n, p + count, n + count);
            }
          }
        }
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
        geometry.setIndex(idx);
        geometry.computeVertexNormals();
        const mountain = mesh(geometry, material, this.scene, x, 0, z);
        mountain.castShadow = false;
        mountain.material = material;
      }
    }
    // A few exposed outcrops give the northern shore a recognizable landmark.
    for (let i = 0; i < 7; i++) {
      const outcrop = mesh(new THREE.DodecahedronGeometry(1, 0), darkRock, this.scene, 18 + i * 3, 2 + rand() * 2, -60 - rand() * 5);
      outcrop.scale.set(3 + rand() * 2, 4 + rand() * 6, 3 + rand() * 2);
      outcrop.rotation.set(rand(), rand(), rand() * 0.2);
    }
    this.scene.add(this.fineDetail);
    const needleMatrices: THREE.Matrix4[] = [];
    for (let i = 0; i < 110; i++) {
      const a = rand() * TAU;
      const r = 1.15 + rand() * 0.6;
      const x = Math.sin(a) * 85 * r, z = Math.cos(a) * 60 * r;
      if (z > 60 && Math.abs(x) < 22) continue;
      const h = 7 + rand() * 9;
      for (let tier = 0; tier < 4; tier++) {
        const width = (3.6 - tier * 0.68) * h / 12;
        addMatrix(needleMatrices, x, 4 + h * (0.33 + tier * 0.2), z, width, h * 0.48, width, a);
      }
    }
    instantiate(new THREE.ConeGeometry(1, 1, 7), surface('#254d45'), needleMatrices);

    // Jagged snow shelves repeat the summit profile, not isolated white cones.
    for (let ridge = 0; ridge < 2; ridge++) {
      const positions: number[] = [], snow: number[] = [];
      const z = -220 - ridge * 78;
      for (let i = 0; i < 22; i++) {
        const x = -260 + i * 25;
        const h = 39 + ridge * 20 + Math.sin(i * 1.7 + ridge) * 17 + rand() * 21;
        const nextH = 39 + ridge * 20 + Math.sin((i + 1) * 1.7 + ridge) * 17 + rand() * 21;
        positions.push(x, -3, z, x, h, z, x + 25, nextH, z, x, -3, z, x + 25, nextH, z, x + 25, -3, z);
        snow.push(x, h, z + 0.1, x + 25, nextH, z + 0.1, x + 18, nextH - 9, z + 0.1,
          x, h, z + 0.1, x + 18, nextH - 9, z + 0.1, x + 7, h - 7, z + 0.1);
      }
      for (const [vertices, color] of [[positions, ridge ? '#8ba2a3' : '#617f82'], [snow, ridge ? '#d0d4c4' : '#b9c9c0']] as const) {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
        geometry.computeVertexNormals();
        const silhouette = mesh(geometry, new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }), this.scene);
        silhouette.castShadow = silhouette.receiveShadow = false;
      }
    }
    const mist = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `varying vec2 vUv; void main() {
        float veil = pow(sin(vUv.y * 3.14159), 2.0) * pow(sin(vUv.x * 3.14159), 0.5);
        gl_FragColor = vec4(0.68, 0.76, 0.68, veil * 0.19);
        #include <colorspace_fragment>
      }`,
    });
    for (let i = 0; i < 3; i++) {
      const veil = mesh(new THREE.PlaneGeometry(230 + i * 45, 9 + i * 3), mist, this.fineDetail, -18 + i * 13, 8 + i * 4, -79 - i * 33);
      veil.castShadow = veil.receiveShadow = false;
    }
    const padMaterial = surface('#527654', 0.57);
    const padGeometry = new THREE.CircleGeometry(1, 14, 0.17, TAU - 0.34);
    padGeometry.rotateX(-Math.PI / 2);
    for (let i = 0; i < 48; i++) {
      const x = -64 + rand() * 12, z = -1 + rand() * 25;
      if (!isWater({ x, z })) continue;
      const pad = mesh(padGeometry, padMaterial, this.fineDetail, x, 0.075 + i % 3 * 0.005, z);
      pad.scale.setScalar(0.24 + rand() * 0.40);
      pad.rotation.y = rand() * TAU;
      if (i % 7 === 0) {
        const flower = mesh(new THREE.ConeGeometry(0.14, 0.22, 7), surface('#d9bd83'), this.fineDetail, x, 0.2, z);
        flower.rotation.z = 0.2;
      }
    }
    const fallen = new THREE.Group();
    fallen.position.set(-73, 0.65, 5);
    fallen.rotation.y = 0.7;
    beam(fallen, bark, new THREE.Vector3(-5, 0, 0), new THREE.Vector3(4, 0.6, 0), 0.46);
    for (let i = 0; i < 4; i++) beam(fallen, bark, new THREE.Vector3(-2 + i * 1.5, 0.2, 0), new THREE.Vector3(-3 + i * 1.8, 1.2, i % 2 ? 1.6 : -1.1), 0.09);
    this.fineDetail.add(fallen);
  }

  private makeDock(): void {
    const dock = new THREE.Group();
    this.scene.add(dock);
    const timber = new THREE.MeshStandardMaterial({ color: '#a2855b', map: this.grain, roughness: 0.92 });
    const edge = surface('#594b35');
    const dark = surface('#3d554c');
    const roof = surface('#4b6258');
    const brass = new THREE.MeshStandardMaterial({ color: '#bda16a', roughness: 0.4, metalness: 0.6 });
    for (let i = 0; i < 48; i++) {
      box(dock, timber, 0, 0.9, 38 + i * 0.47, 4.4, 0.20, 0.43);
      if (i % 10 === 0) {
        for (const x of [-2.1, 2.1]) {
          mesh(new THREE.CylinderGeometry(0.17, 0.23, 3.6, 8), edge, dock, x, 0.3, 38 + i * 0.47);
          const cap = mesh(new THREE.CylinderGeometry(0.21, 0.21, 0.1, 8), timber, dock, x, 2.1, 38 + i * 0.47);
          cap.rotation.y = 0.3;
        }
      }
    }
    box(dock, edge, -1.7, 0.66, 49, 0.18, 0.28, 22.7);
    box(dock, edge, 1.7, 0.66, 49, 0.18, 0.28, 22.7);
    for (const z of [47.5, 52.2, 56.9]) {
      beam(dock, timber, new THREE.Vector3(-2.1, 1.75, z), new THREE.Vector3(-2.1, 1.75, z + 4.5), 0.075);
      beam(dock, timber, new THREE.Vector3(2.1, 1.75, z), new THREE.Vector3(2.1, 1.75, z + 4.5), 0.075);
    }
    for (const x of [-1.5, 1.5]) {
      mesh(new THREE.TorusGeometry(0.18, 0.04, 6, 16), brass, dock, x, 1.08, 39).rotation.x = Math.PI / 2;
    }
    const rope = new THREE.MeshStandardMaterial({ color: '#b9aa80', roughness: 1 });
    for (let i = 0; i < 4; i++) {
      const coil = mesh(new THREE.TorusGeometry(0.4 - i * 0.065, 0.035, 5, 28), rope, dock, -1.1, 1.06 + i * 0.025, 42);
      coil.rotation.x = Math.PI / 2;
    }
    const house = new THREE.Group();
    house.position.set(-10.5, 1, 62.5);
    this.scene.add(house);
    box(house, edge, 0, 0.22, 0, 10, 0.4, 8);
    box(house, dark, 0, 2.55, 0, 8.5, 4.8, 6.6);
    for (let i = 0; i < 21; i++) {
      box(house, timber, -4.1 + i * 0.41, 2.55, -3.36, 0.32, 4.65, 0.12);
    }
    for (const x of [-4.3, 4.3]) {
      box(house, edge, x, 2.7, -3.5, 0.25, 5.3, 0.3);
    }
    box(house, edge, 0, 4.9, -3.5, 9.2, 0.27, 0.35);
    for (const side of [-1, 1]) {
      const panel = box(house, roof, side * 2.4, 5.3, 0, 5.55, 0.28, 8.25);
      panel.rotation.z = -side * 0.31;
      for (let i = 0; i < 10; i++) {
        const seam = box(house, dark, side * 2.4, 5.47, -3.8 + i * 0.83, 5.6, 0.06, 0.06);
        seam.rotation.z = -side * 0.31;
      }
    }
    box(house, edge, 0, 6.16, 0, 0.20, 0.2, 8.4);
    box(house, edge, 1.9, 2.5, -3.5, 2.8, 2.2, 0.18);
    const glass = new THREE.MeshStandardMaterial({ color: '#d7a65d', emissive: '#b16d27', emissiveIntensity: 0.35, roughness: 0.3 });
    box(house, glass, 1.9, 2.5, -3.61, 2.5, 1.9, 0.05);
    box(house, timber, 1.9, 2.5, -3.66, 0.12, 2, 0.08);
    box(house, timber, 1.9, 2.5, -3.66, 2.6, 0.12, 0.08);
    box(house, dark, -2, 2.1, -3.52, 2, 3.6, 0.12);
    for (let i = 0; i < 6; i++) box(house, timber, -2.8 + i * 0.31, 2.1, -3.6, 0.25, 3.5, 0.08);
    mesh(new THREE.SphereGeometry(0.08, 8, 6), brass, house, -1.35, 2.05, -3.75);
    box(house, timber, 0, 0.55, -5.3, 10, 0.23, 3.8);
    for (const x of [-4.5, 4.5]) box(house, timber, x, 2, -6.6, 0.18, 3.1, 0.18);
    const awning = box(house, surface('#9a7651'), 0, 3.95, -5.15, 10, 0.16, 3.9);
    awning.rotation.x = -0.10;
    box(house, timber, 1.8, 1.4, -5.2, 3.7, 1.5, 0.9);
    for (let i = 0; i < 3; i++) {
      box(house, edge, -3.2 + i * 1.1, 1.1, -5.2, 0.9, 0.8, 0.8);
      for (let j = 0; j < 3; j++) box(house, timber, -3.2 + i * 1.1, 0.85 + j * 0.24, -5.66, 0.92, 0.15, 0.07);
    }
    const signCanvas = document.createElement('canvas');
    signCanvas.width = 512;
    signCanvas.height = 128;
    const ctx = signCanvas.getContext('2d')!;
    ctx.fillStyle = '#283e36';
    ctx.fillRect(0, 0, 512, 128);
    ctx.strokeStyle = '#cbbd8b';
    ctx.lineWidth = 3;
    ctx.strokeRect(9, 9, 494, 110);
    ctx.fillStyle = '#f1dfae';
    ctx.textAlign = 'center';
    ctx.font = '28px Georgia, serif';
    ctx.fillText('STILLWATER', 256, 52);
    ctx.font = '17px Georgia, serif';
    ctx.fillText('B O A T H O U S E   &   M A R K E T', 256, 87);
    const signTexture = new THREE.CanvasTexture(signCanvas);
    signTexture.colorSpace = THREE.SRGBColorSpace;
    mesh(new THREE.PlaneGeometry(5.8, 1.45), new THREE.MeshStandardMaterial({ map: signTexture, roughness: 0.9 }), house, 0, 4.1, -7.15).rotation.y = Math.PI;
    const lanternMetal = surface('#39443b');
    for (const x of [-4, 4]) {
      box(house, lanternMetal, x, 3.25, -6.7, 0.36, 0.5, 0.34);
      box(house, glass, x, 3.25, -6.73, 0.25, 0.34, 0.28);
      box(house, lanternMetal, x, 3.55, -6.7, 0.45, 0.12, 0.43);
    }
    // Jetty-to-market boardwalk and a mooring buoy.
    for (let i = 0; i < 20; i++) box(dock, timber, -i * 0.48, 1.3, 58.2, 0.43, 0.16, 2.6);
    const buoy = mesh(new THREE.SphereGeometry(0.38, 12, 8), surface('#bb7049'), dock, 4, 0.2, 42);
    buoy.scale.y = 1.4;
  }

  private makeBoat(): void {
    const wood = new THREE.MeshStandardMaterial({ color: '#b99866', map: this.grain, roughness: 0.73 });
    const trim = surface('#d4b47c', 0.7);
    const darkWood = surface('#68533c');
    const metal = new THREE.MeshStandardMaterial({ color: '#535e59', metalness: 0.65, roughness: 0.4 });
    const sections = [
      [-2.75, 0.05], [-2.3, 0.64], [-1.6, 1.03], [-0.5, 1.18], [0.7, 1.16], [1.65, 0.96], [2.0, 0.86],
    ];
    for (const side of [-1, 1]) {
      for (let plank = 0; plank < 5; plank++) {
        const points: number[] = [], indices: number[] = [];
        for (let i = 0; i < sections.length; i++) {
          const [z, width] = sections[i];
          for (let edge = 0; edge < 2; edge++) {
            const t = (plank + edge) / 5;
            const x = side * width * (0.20 + Math.sin(t * Math.PI / 2) * 0.8);
            const y = -0.40 + t * 1.13 + (Math.abs(z) / 2.75) ** 2 * 0.3;
            points.push(x, y, z);
          }
          if (i < sections.length - 1) {
            const a = i * 2;
            indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
          }
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
        geometry.setIndex(indices);
        geometry.computeVertexNormals();
        this.hullPaint.side = THREE.DoubleSide;
        wood.side = THREE.DoubleSide;
        mesh(geometry, plank === 4 ? wood : this.hullPaint, this.boat);
      }
      const railPoints = sections.map(([z, width]) => new THREE.Vector3(side * width, 0.76 + (Math.abs(z) / 2.75) ** 2 * 0.3, z));
      mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(railPoints), 36, 0.07, 6, false), trim, this.boat);
      for (let i = 1; i < 6; i++) {
        const [z, width] = sections[i];
        const rib = new THREE.CatmullRomCurve3([
          new THREE.Vector3(side * width * 0.16, -0.26, z),
          new THREE.Vector3(side * width * 0.68, 0.10, z),
          new THREE.Vector3(side * width * 0.95, 0.67, z),
        ]);
        mesh(new THREE.TubeGeometry(rib, 8, 0.045, 5), darkWood, this.boat);
      }
    }
    for (let i = 0; i < 7; i++) {
      box(this.boat, wood, (i - 3) * 0.20, -0.13, -0.2, 0.185, 0.09, 3.8);
    }
    box(this.boat, wood, 0, 0.35, 2, 1.75, 0.8, 0.10);
    for (const z of [-1.45, 0.10, 1.35]) {
      const width = z === -1.45 ? 1.83 : 2.12;
      box(this.boat, trim, 0, 0.49, z, width, 0.12, 0.46);
      for (const x of [-width * 0.4, width * 0.4]) {
        box(this.boat, darkWood, x, 0.24, z, 0.1, 0.45, 0.28);
        for (const offset of [-0.12, 0.12]) {
          mesh(new THREE.SphereGeometry(0.025, 5, 3), metal, this.boat, x, 0.56, z + offset);
        }
      }
    }
    box(this.boat, darkWood, 0, 0.12, 2.13, 0.08, 0.55, 0.7);
    const crate = box(this.boat, surface('#4f655b'), -0.4, 0.13, 0.75, 0.60, 0.44, 0.55);
    box(crate, trim, 0, 0.24, 0, 0.63, 0.05, 0.58);
    box(crate, metal, 0, 0.06, -0.29, 0.11, 0.1, 0.04);
    mesh(new THREE.CylinderGeometry(0.22, 0.19, 0.38, 12, 1, true), metal, this.boat, 0.52, 0.08, 0.72);
    for (const side of [-1, 1]) {
      const oar = new THREE.Group();
      oar.position.set(side * 1.14, 0.68, 0.2);
      oar.rotation.y = side * 0.25;
      oar.rotation.z = side * -0.1;
      beam(oar, wood, new THREE.Vector3(-side * 0.3, 0, 0), new THREE.Vector3(side * 2.2, 0, 0), 0.045);
      const blade = box(oar, trim, side * 2.38, 0, 0, 0.8, 0.085, 0.24);
      blade.rotation.y = side * 0.1;
      mesh(new THREE.TorusGeometry(0.11, 0.025, 5, 12), metal, this.boat, side * 1.14, 0.76, 0.2).rotation.y = Math.PI / 2;
      this.boat.add(oar);
      this.oars.push(oar);
    }
    const rope = surface('#bcb089');
    for (let i = 0; i < 4; i++) {
      const coil = mesh(new THREE.TorusGeometry(0.25 - i * 0.04, 0.022, 4, 24), rope, this.boat, 0, 0.59 + i * 0.015, -1.45);
      coil.rotation.x = Math.PI / 2;
    }
    const cushion = box(this.boat, surface('#865c43'), 0, 0.60, 0.1, 0.74, 0.13, 0.42);
    cushion.rotation.z = 0.02;
  }

  private makeFishingGear(): void {
    const carbon = surface('#343c33', 0.45);
    const cork = surface('#c0a575');
    const metal = new THREE.MeshStandardMaterial({ color: '#adb8a0', roughness: 0.3, metalness: 0.7 });
    this.rod.position.set(0.66, 0.85, -0.2);
    this.boat.add(this.rod);
    beam(this.rod, cork, new THREE.Vector3(0, 0, 0.45), new THREE.Vector3(0, 0.5, -0.1), 0.06);
    this.rodGeometry.setAttribute('position', new THREE.BufferAttribute(this.rodPositions, 3).setUsage(THREE.DynamicDrawUsage));
    const rodLine = new THREE.Line(this.rodGeometry, new THREE.LineBasicMaterial({ color: '#2d3e37', linewidth: 2 }));
    rodLine.frustumCulled = false;
    this.rod.add(rodLine);
    this.rodShaft = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 6), carbon, 18);
    this.rodShaft.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.rodShaft.frustumCulled = false;
    this.rod.add(this.rodShaft);
    mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.16, 12), metal, this.rod, -0.12, 0.25, 0.1).rotation.z = Math.PI / 2;
    beam(this.rod, carbon, new THREE.Vector3(-0.2, 0.2, 0.1), new THREE.Vector3(-0.33, 0.1, 0.1), 0.025);
    mesh(new THREE.SphereGeometry(0.055, 7, 5), cork, this.rod, -0.34, 0.1, 0.1);
    for (let i = 0; i < 5; i++) {
      const t = (i + 1) / 5;
      const guide = mesh(new THREE.TorusGeometry(0.04 - t * 0.02, 0.008, 4, 8), metal, this.rod, 0, 0.5 + t * 1.85, -0.1 - t * 3.15);
      guide.rotation.x = Math.PI / 2;
      this.rodGuides.push(guide);
    }
    this.lineGeometry.setAttribute('position', new THREE.BufferAttribute(this.linePositions, 3).setUsage(THREE.DynamicDrawUsage));
    const line = new THREE.Line(this.lineGeometry, new THREE.LineBasicMaterial({ color: '#ede6bf', transparent: true, opacity: 0.78, depthWrite: false }));
    line.frustumCulled = false;
    line.renderOrder = 4;
    this.scene.add(line);
    const white = surface('#e8e4cc', 0.5);
    const red = surface('#bd6745', 0.5);
    mesh(new THREE.SphereGeometry(0.11, 12, 8), white, this.float, 0, 0.05, 0).scale.y = 1.3;
    mesh(new THREE.SphereGeometry(0.09, 12, 8), red, this.float, 0, 0.14, 0);
    mesh(new THREE.CylinderGeometry(0.017, 0.017, 0.38, 5), red, this.float, 0, 0.30, 0);
    const ring = mesh(new THREE.RingGeometry(0.7, 0.81, 56), new THREE.MeshBasicMaterial({ color: '#dfd4a3', transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false }), this.aim);
    ring.rotation.x = -Math.PI / 2;
    ring.castShadow = false;
    for (let i = 0; i < 4; i++) {
      const tick = box(this.aim, new THREE.MeshBasicMaterial({ color: '#dfd4a3', transparent: true, opacity: 0.6 }), Math.sin(i * Math.PI / 2) * 1.05, 0, Math.cos(i * Math.PI / 2) * 1.05, 0.05, 0.025, 0.28);
      tick.rotation.y = i * Math.PI / 2;
      tick.castShadow = false;
    }
  }

  private makeFish(species: SpeciesId): THREE.Group {
    const group = new THREE.Group();
    const config = {
      perch: { color: '#a3a04e', belly: '#dec58b', fin: '#bc7040', length: 1.55, width: 0.31, height: 0.45 },
      trout: { color: '#7aa39a', belly: '#d2d7b8', fin: '#839a86', length: 1.85, width: 0.28, height: 0.34 },
      bass: { color: '#668652', belly: '#c9c58b', fin: '#687e42', length: 1.8, width: 0.36, height: 0.48 },
      pike: { color: '#879865', belly: '#c5cba0', fin: '#8f9660', length: 2.65, width: 0.24, height: 0.32 },
      king: { color: '#e6b643', belly: '#fff0ba', fin: '#c98527', length: 2.85, width: 0.46, height: 0.66 },
    }[species];
    const skin = surface(config.color, 0.4);
    skin.metalness = species === 'king' ? 0.66 : 0.24;
    const belly = surface(config.belly, 0.48);
    const fins = surface(config.fin, 0.7);
    fins.side = THREE.DoubleSide;
    const bodyGeometry = new THREE.SphereGeometry(1, 20, 12);
    const positions: number[] = [], indices: number[] = [], colors: number[] = [];
    const baseColor = new THREE.Color(config.color);
    const bellyColor = new THREE.Color(config.belly);
    const tint = new THREE.Color();
    const profile = [0.15, 0.56, 0.85, 0.99, 1, 0.94, 0.78, 0.55, 0.30, 0.14, 0.11];
    for (let ring = 0; ring < profile.length; ring++) {
      const z = (ring / (profile.length - 1) - 0.5) * config.length;
      for (let side = 0; side <= 24; side++) {
        const a = side / 24 * TAU;
        positions.push(Math.cos(a) * config.width * profile[ring],
          Math.sin(a) * config.height * profile[ring] + Math.sin(ring / 10 * Math.PI) * 0.025, z);
        tint.copy(baseColor).lerp(bellyColor, Math.max(0, -Math.sin(a)) * 0.85);
        tint.multiplyScalar(0.72 + (Math.sin(a) + 1) * 0.17);
        colors.push(tint.r, tint.g, tint.b);
        if (ring < profile.length - 1 && side < 24) {
          const v = ring * 25 + side;
          indices.push(v, v + 1, v + 25, v + 1, v + 26, v + 25);
        }
      }
    }
    const spindle = new THREE.BufferGeometry();
    spindle.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    spindle.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    spindle.setIndex(indices);
    spindle.computeVertexNormals();
    const bodySkin = skin.clone();
    bodySkin.color.set('#ffffff');
    bodySkin.vertexColors = true;
    mesh(spindle, bodySkin, group);
    const lower = mesh(bodyGeometry, belly, group, 0, -config.height * 0.45, 0);
    lower.scale.set(config.width * 0.88, config.height * 0.5, config.length * 0.40);
    const nose = mesh(bodyGeometry, skin, group, 0, -0.01, -config.length * 0.41);
    nose.scale.set(config.width * (species === 'bass' ? 0.8 : 0.58), config.height * 0.56, species === 'pike' ? 0.36 : 0.22);
    const fin = (vertices: number[], material: THREE.Material, parent: THREE.Object3D = group) => {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
      geometry.computeVertexNormals();
      return mesh(geometry, material, parent);
    };
    const tailZ = config.length * 0.49;
    const tail = new THREE.Group();
    tail.name = 'tail';
    tail.position.z = tailZ - 0.14;
    group.add(tail);
    const royal = species === 'king';
    const edgeMaterial = new THREE.LineBasicMaterial({ color: royal ? '#ffe4a0' : config.belly, transparent: true, opacity: 0.65 });
    const membrane = (parent: THREE.Object3D, root: THREE.Vector3, outer: THREE.Vector3[], material: THREE.Material) => {
      const vertices: number[] = [], ribs: number[] = [];
      for (let i = 0; i < outer.length - 1; i++) {
        vertices.push(root.x, root.y, root.z, outer[i].x, outer[i].y, outer[i].z, outer[i + 1].x, outer[i + 1].y, outer[i + 1].z);
      }
      fin(vertices, material, parent);
      outer.forEach((point, i) => {
        ribs.push(root.x, root.y, root.z, point.x, point.y, point.z);
        if (i) ribs.push(outer[i - 1].x, outer[i - 1].y, outer[i - 1].z, point.x, point.y, point.z);
      });
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(ribs, 3));
      parent.add(new THREE.LineSegments(geometry, edgeMaterial));
    };
    const tailEdge: THREE.Vector3[] = [];
    for (let i = 0; i <= 16; i++) {
      const t = i / 16;
      const spread = (t - 0.5) * (royal ? 2.35 : species === 'pike' ? 1.0 : 1.18);
      const fork = Math.pow(Math.abs(t - 0.5) * 2, 1.2);
      tailEdge.push(new THREE.Vector3(Math.sin(t * Math.PI * 3) * (royal ? 0.13 : 0.025), spread,
        (royal ? 0.96 : 0.45) + fork * (royal ? 1.10 : 0.38) + Math.sin(t * Math.PI * 8) * (royal ? 0.10 : 0.025)));
    }
    membrane(tail, new THREE.Vector3(0, 0, 0), tailEdge, fins);
    const dorsalZ = species === 'pike' ? 0.6 : 0;
    fin([0, config.height * 0.8, dorsalZ - 0.4, 0, config.height + (species === 'perch' ? 0.43 : 0.26), dorsalZ + 0.04,
      0, config.height * 0.73, dorsalZ + 0.50], fins);
    for (const side of [-1, 1]) {
      fin([side * config.width * 0.7, -0.08, -0.23, side * (config.width + 0.30), -0.30, 0.20,
        side * config.width * 0.5, -0.14, 0.33], fins);
      const eyeZ = -config.length * 0.36;
      mesh(new THREE.SphereGeometry(0.070, 10, 7), surface('#d9c17a', 0.3), group, side * config.width * 0.65, config.height * 0.20, eyeZ);
      mesh(new THREE.SphereGeometry(0.038, 8, 6), surface('#172a26', 0.2), group, side * config.width * 0.78, config.height * 0.20, eyeZ - 0.02);
      const gill = mesh(new THREE.TorusGeometry(config.height * 0.5, 0.014, 4, 16, Math.PI), surface('#526c54'), group,
        side * config.width * 0.92, 0, -config.length * 0.20);
      gill.rotation.y = Math.PI / 2;
      if (species === 'perch' || species === 'bass' || species === 'king') {
        for (let i = 0; i < (species === 'bass' ? 1 : 6); i++) {
          const stripe = mesh(new THREE.SphereGeometry(1, 8, 6), surface(species === 'king' ? '#d8ba64' : '#4f6641'), group,
            side * config.width * 0.96, 0.04, species === 'bass' ? 0 : -0.43 + i * 0.19);
          stripe.scale.set(0.016, species === 'bass' ? 0.055 : 0.27, species === 'bass' ? 0.58 : 0.043);
        }
      } else {
        for (let i = 0; i < 23; i++) {
          const z = (i % 8 - 3.5) * config.length * 0.085;
          const y = (Math.floor(i / 8) - 1) * config.height * 0.40;
          const dot = mesh(new THREE.SphereGeometry(species === 'trout' ? 0.027 : 0.035, 5, 4), surface(species === 'trout' ? '#4e6d62' : '#c4c58f'), group,
            side * config.width * Math.sqrt(Math.max(0.1, 1 - (z / config.length * 2) ** 2)) * 0.97, y, z);
          dot.scale.x = 0.45;
        }
        if (species === 'trout') {
          const pink = mesh(new THREE.SphereGeometry(1, 12, 6), surface('#ac8780'), group, side * config.width * 0.96, -0.02, 0);
          pink.scale.set(0.012, 0.05, 0.55);
        }
      }
    }
    if (royal) {
      const gold = new THREE.MeshStandardMaterial({ color: '#ffe09a', metalness: 0.82, roughness: 0.26, emissive: '#b86b0a', emissiveIntensity: 0.10 });
      const jewel = new THREE.MeshStandardMaterial({ color: '#47bfb2', metalness: 0.45, roughness: 0.22, emissive: '#17463b', emissiveIntensity: 0.25 });
      const crown = new THREE.Group();
      crown.position.set(0, config.height * 0.73, -0.62);
      crown.rotation.x = -0.10;
      group.add(crown);
      const band = mesh(new THREE.TorusGeometry(0.29, 0.055, 7, 24), gold, crown);
      band.rotation.x = Math.PI / 2;
      for (let i = 0; i < 5; i++) {
        const a = i / 5 * TAU;
        const h = i === 0 ? 0.53 : 0.40;
        const x = Math.sin(a) * 0.28, z = Math.cos(a) * 0.28;
        const point = mesh(new THREE.ConeGeometry(0.11, h, 4), gold, crown, x, h * 0.45, z);
        point.rotation.z = -Math.sin(a) * 0.18;
        mesh(new THREE.IcosahedronGeometry(0.065, 0), jewel, crown, x * 1.1, h * 0.94, z * 1.1);
      }
      for (const side of [-1, 1]) {
        const wing = new THREE.Group();
        wing.name = side === -1 ? 'finLeft' : 'finRight';
        group.add(wing);
        const edge: THREE.Vector3[] = [];
        for (let i = 0; i <= 12; i++) {
          const t = i / 12;
          edge.push(new THREE.Vector3(side * (config.width + Math.sin(t * Math.PI) * 0.68),
            -0.22 - Math.sin(t * Math.PI) * 0.48, -0.2 + t * 2.75 + Math.sin(t * Math.PI * 6) * 0.08));
        }
        membrane(wing, new THREE.Vector3(side * config.width * 0.7, -0.12, -0.38), edge, fins);
      }
      const dorsalEdge: THREE.Vector3[] = [];
      for (let i = 0; i <= 14; i++) {
        const t = i / 14;
        dorsalEdge.push(new THREE.Vector3(0, config.height * 0.7 + Math.sin(t * Math.PI) * 0.65 + (i % 2 ? 0.08 : 0.23), -0.35 + t * 1.85));
      }
      membrane(group, new THREE.Vector3(0, 0.35, 0.5), dorsalEdge, fins);
      const scaleGeometry = new THREE.SphereGeometry(1, 6, 4);
      const scales = new THREE.InstancedMesh(scaleGeometry, gold, 96);
      const stamp = new THREE.Object3D();
      for (let i = 0; i < 96; i++) {
        const side = i < 48 ? -1 : 1;
        const col = i % 12, row = Math.floor(i % 48 / 12);
        const z = -0.78 + col * 0.14 + row % 2 * 0.065;
        const y = -0.26 + row * 0.16;
        const fullness = Math.sqrt(Math.max(0.1, 1 - (z / 1.4) ** 2 - (y / 0.72) ** 2));
        stamp.position.set(side * config.width * fullness, y, z);
        stamp.scale.set(0.023, 0.065, 0.085);
        stamp.rotation.x = -0.28;
        stamp.updateMatrix();
        scales.setMatrixAt(i, stamp.matrix);
      }
      group.add(scales);
    }
    return group;
  }

  private makeSchools(): void {
    const material = new THREE.MeshBasicMaterial({ color: '#b1cbb2', transparent: true, opacity: 0.20, depthWrite: false });
    const body = new THREE.SphereGeometry(1, 8, 5);
    for (let i = 0; i < 22; i++) {
      const group = new THREE.Group();
      const fish = mesh(body, material, group);
      fish.scale.set(0.13, 0.07, 0.48);
      fish.renderOrder = 2;
      fish.castShadow = false;
      const tail = mesh(new THREE.ConeGeometry(0.18, 0.30, 3), material, group, 0, 0, 0.5);
      tail.rotation.x = Math.PI / 2;
      tail.scale.z = 0.3;
      tail.renderOrder = 2;
      tail.castShadow = false;
      group.position.y = -0.09;
      this.schools.push(group);
      this.scene.add(group);
    }
    // Tiny distant birds are deliberately geometry, not a screen-space overlay.
    const birdMaterial = surface('#475d55');
    for (let i = 0; i < 7; i++) {
      const bird = new THREE.Group();
      const x = -20 + i * 5, y = 31 + Math.sin(i) * 3, z = -110 - i * 3;
      beam(bird, birdMaterial, new THREE.Vector3(-0.8, 0.25, 0), new THREE.Vector3(0, 0, -0.1), 0.045);
      beam(bird, birdMaterial, new THREE.Vector3(0, 0, -0.1), new THREE.Vector3(0.8, 0.25, 0), 0.045);
      bird.position.set(x, y, z);
      this.scene.add(bird);
    }
  }

  private makeFeedingGrounds(): void {
    const fishShape = new THREE.Shape();
    fishShape.moveTo(0, -0.85);
    fishShape.bezierCurveTo(0.35, -0.43, 0.35, 0.14, 0.08, 0.52);
    fishShape.lineTo(0.30, 0.85);
    fishShape.lineTo(0, 0.70);
    fishShape.lineTo(-0.30, 0.85);
    fishShape.lineTo(-0.08, 0.52);
    fishShape.bezierCurveTo(-0.35, 0.14, -0.35, -0.43, 0, -0.85);
    const silhouette = new THREE.ShapeGeometry(fishShape, 12);
    silhouette.rotateX(-Math.PI / 2);
    const shadow = mesh(silhouette, new THREE.MeshBasicMaterial({ color: '#a8d2be', transparent: true, opacity: 0.34, depthWrite: false, side: THREE.DoubleSide }), this.fishShadow);
    shadow.castShadow = shadow.receiveShadow = false;
    shadow.renderOrder = 2;
    this.scene.add(this.fishShadow);
    HOTSPOTS.forEach((spot, index) => {
      const ground = new THREE.Group();
      ground.position.set(spot.x, 0.095, spot.z);
      const color = spot.species === 'king' ? '#eac06a' : '#a4cec1';
      for (let i = 0; i < 3; i++) {
        const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.30, side: THREE.DoubleSide, depthWrite: false });
        const arc = mesh(new THREE.RingGeometry(0.97, 1, 56, 1, i * TAU / 3, TAU * 0.22), material, ground);
        arc.rotation.x = -Math.PI / 2;
        arc.scale.setScalar(spot.radius * 0.72);
        arc.castShadow = arc.receiveShadow = false;
        arc.renderOrder = 3;
      }
      for (let i = 0; i < 3; i++) {
        const fish = mesh(silhouette, new THREE.MeshBasicMaterial({ color: spot.species === 'king' ? '#deb460' : '#9ac6af', transparent: true, opacity: 0.38, depthWrite: false, side: THREE.DoubleSide }), ground);
        fish.name = 'activity';
        fish.position.set(Math.sin(i * 2.1 + index) * spot.radius * 0.34, 0.006 + i * 0.002, Math.cos(i * 2.1 + index) * spot.radius * 0.34);
        fish.scale.setScalar(spot.species === 'king' ? 1.35 : 0.72);
        fish.castShadow = fish.receiveShadow = false;
        fish.renderOrder = 3;
      }
      if (spot.species === 'king') {
        const crest = new THREE.Shape();
        crest.moveTo(-1, -0.5);
        crest.lineTo(-1.25, 0.75);
        crest.lineTo(-0.5, 0.15);
        crest.lineTo(0, 1.05);
        crest.lineTo(0.5, 0.15);
        crest.lineTo(1.25, 0.75);
        crest.lineTo(1, -0.5);
        crest.closePath();
        const geometry = new THREE.ShapeGeometry(crest);
        geometry.rotateX(-Math.PI / 2);
        const crown = mesh(geometry, new THREE.MeshBasicMaterial({ color: '#eaca83', side: THREE.DoubleSide, transparent: true, opacity: 0.5, depthWrite: false }), ground, 0, 0.02, 0);
        crown.name = 'crest';
        crown.renderOrder = 3;
        crown.castShadow = crown.receiveShadow = false;
      }
      this.feedingGrounds.push(ground);
      this.scene.add(ground);
    });
    const gold = new THREE.MeshBasicMaterial({ color: '#ffe0a0', transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false });
    const inner = mesh(new THREE.RingGeometry(0.47, 0.54, 48), gold, this.aim);
    inner.name = 'precision';
    inner.rotation.x = -Math.PI / 2;
    inner.castShadow = false;
    for (let i = 0; i < 4; i++) {
      const diamond = mesh(new THREE.OctahedronGeometry(0.12, 0), gold, this.aim, Math.sin(i * Math.PI / 2) * 1.35, 0.04, Math.cos(i * Math.PI / 2) * 1.35);
      diamond.name = 'precision';
      diamond.scale.y = 0.25;
      diamond.castShadow = false;
    }
    for (let i = 0; i < 3; i++) {
      const material = new THREE.MeshBasicMaterial({ color: '#e3bc6d', transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false });
      const crest = mesh(new THREE.RingGeometry(0.97, 1, 64, 1, i * 0.7, TAU * 0.78), material, this.royalWake);
      crest.rotation.x = -Math.PI / 2;
      crest.scale.setScalar(1.5 + i * 0.7);
      crest.castShadow = false;
      crest.renderOrder = 3;
    }
    const direction = mesh(new THREE.ConeGeometry(0.3, 1.2, 3), gold, this.royalWake, 0, 0.03, -3.1);
    direction.rotation.x = -Math.PI / 2;
    direction.castShadow = false;
    direction.renderOrder = 3;
    this.scene.add(this.royalWake);
  }

  private ripple(x: number, z: number, size: number, duration = 2.4): void {
    const ring = this.rings[this.ringCursor++ % this.rings.length];
    ring.age = 0;
    ring.duration = duration;
    ring.size = size;
    ring.mesh.position.set(x, 0.055 + this.ringCursor % 3 * 0.004, z);
    ring.mesh.visible = true;
  }

  private splash(x: number, z: number, amount: number): void {
    this.ripple(x, z, 2.8, 2.5);
    this.ripple(x, z, 1.5, 1.8);
    for (let i = 0; i < amount; i++) {
      const drop = this.droplets[this.dropCursor++ % this.droplets.length];
      const angle = i * 2.39996;
      drop.x = x;
      drop.y = 0.1;
      drop.z = z;
      drop.vx = Math.sin(angle) * (0.6 + (i % 3) * 0.35);
      drop.vz = Math.cos(angle) * (0.6 + (i % 3) * 0.35);
      drop.vy = 1.8 + i % 5 * 0.43;
      drop.age = 0;
    }
  }

  update(snapshot: Snapshot, save: Save, dt: number): void {
    if (this.disposed || this.lost) return;
    const step = snapshot.paused ? 0 : Math.min(Math.max(dt, 0), 0.05);
    const motion = !save.settings.reducedMotion;
    const moving = motion && !snapshot.paused;
    if (moving) this.elapsed += step;
    const time = this.elapsed;
    this.water.uniforms.time.value = time;
    this.water.uniforms.boatPosition.value.set(snapshot.boat.x, snapshot.boat.z);
    this.water.uniforms.boatSpeed.value = Math.abs(snapshot.boat.speed);
    this.water.uniforms.boatHeading.value = snapshot.boat.yaw;
    this.water.uniforms.fishPosition.value.set(snapshot.fish.x, snapshot.fish.z);
    const kingFight = snapshot.phase === 'fight' && snapshot.fish.species === 'king';
    const telling = snapshot.phase === 'fight' && snapshot.behavior === 'tell';
    this.water.uniforms.fishActivity.value = snapshot.phase === 'fight' ? telling ? 1 : snapshot.behavior === 'run' ? 0.7 : 0.25 : 0;
    this.water.uniforms.royal.value = kingFight ? 1 : 0;
    if (this.quality !== save.settings.quality) this.setQuality(save.settings.quality);
    if (this.paint !== save.paint) {
      this.paint = save.paint;
      const paints: Record<string, string> = {
        cedar: '#887248', forest: '#446b58', teal: '#477f7b', red: '#974f3d',
        cream: '#b9b18a', blue: '#4e7484', sunset: '#a96546', moss: '#657650',
        midnight: '#3a505b', ivory: '#d4ccb0', ember: '#9c5541', sage: '#7d8d6d',
      };
      this.hullPaint.color.set(paints[save.paint] ?? (/^#[0-9a-f]{6}$/i.test(save.paint) ? save.paint : '#476f68'));
    }
    this.boat.position.set(snapshot.boat.x, 0.05 + (motion ? Math.sin(time * 1.45) * 0.035 : 0), snapshot.boat.z);
    this.boat.rotation.set(motion ? Math.sin(time * 1.15) * 0.009 : 0, -snapshot.boat.yaw, motion ? Math.sin(time * 1.6) * 0.014 : 0);
    const rowing = Math.min(Math.abs(snapshot.boat.speed) / 5, 1);
    this.oars.forEach((oar, index) => {
      const side = index === 0 ? -1 : 1;
      oar.rotation.y = side * (0.25 + Math.sin(time * 3.3) * 0.45 * rowing);
      oar.rotation.z = side * (-0.10 + Math.cos(time * 3.3) * 0.17 * rowing);
    });
    const fishing = snapshot.phase !== 'aim' && snapshot.phase !== 'charge' && snapshot.phase !== 'land';
    const aiming = snapshot.phase === 'aim' || snapshot.phase === 'charge';
    this.aim.visible = aiming;
    this.aim.position.set(snapshot.target.x, 0.11, snapshot.target.z);
    const spot = hotspotAt(snapshot.target);
    const precision = snapshot.precision && !!spot && (spot.species !== 'king' || bossUnlocked(save));
    this.aim.scale.setScalar((precision ? 1.45 : 1.25) + (motion ? Math.sin(time * 2) * 0.025 : 0));
    this.aim.children.forEach(object => {
      if (object.name === 'precision') object.visible = precision;
      const material = (object as THREE.Mesh).material as THREE.MeshBasicMaterial;
      material.color.set(snapshot.legalTarget ? precision ? '#ffcf64' : '#dce6ca' : '#d18168');
      material.opacity = precision ? 0.95 : 0.65;
    });
    this.float.visible = fishing;
    this.float.position.set(snapshot.float.x, Math.max(-0.16, snapshot.float.y) + (motion ? Math.sin(time * 3) * 0.025 : 0), snapshot.float.z);
    this.float.rotation.z = motion ? snapshot.phase === 'bite' ? Math.sin(time * 16) * 0.4 : Math.sin(time * 2) * 0.08 : 0;
    const tension = snapshot.phase === 'fight' ? snapshot.tension : 0;
    const cast = snapshot.phase === 'charge' ? snapshot.charge : snapshot.phase === 'cast' ? 0.25 : 0;
    this.rod.rotation.y = THREE.MathUtils.clamp(snapshot.boat.yaw - snapshot.aimYaw, -1.25, 1.25);
    this.rod.rotation.x = -cast * 0.85 + (snapshot.phase === 'fight' ? -0.16 : 0);
    for (let i = 0; i < 19; i++) {
      const t = i / 18;
      const bend = tension * t * t;
      this.rodPositions[i * 3] = Math.sin(time * 9) * bend * (motion ? 0.06 : 0);
      this.rodPositions[i * 3 + 1] = 0.5 + t * 1.85 - bend * 1.25;
      this.rodPositions[i * 3 + 2] = -0.1 - t * 3.15;
    }
    this.rodGeometry.attributes.position.needsUpdate = true;
    for (let i = 0; i < 18; i++) {
      this.p.fromArray(this.rodPositions, i * 3);
      this.q.fromArray(this.rodPositions, (i + 1) * 3);
      this.dummy.position.copy(this.p).add(this.q).multiplyScalar(0.5);
      const length = this.p.distanceTo(this.q);
      this.q.sub(this.p).normalize();
      this.dummy.quaternion.setFromUnitVectors(UP, this.q);
      const radius = 0.028 - i / 18 * 0.016;
      this.dummy.scale.set(radius, length, radius);
      this.dummy.updateMatrix();
      this.rodShaft.setMatrixAt(i, this.dummy.matrix);
    }
    this.rodShaft.instanceMatrix.needsUpdate = true;
    for (let i = 0; i < this.rodGuides.length; i++) {
      const t = (i + 1) / 5;
      this.rodGuides[i].position.set(0, 0.5 + t * 1.85 - tension * t * t * 1.25, -0.1 - t * 3.15);
    }
    this.boat.updateMatrixWorld(true);
    this.rodTip.set(this.rodPositions[54], this.rodPositions[55], this.rodPositions[56]);
    this.rod.localToWorld(this.rodTip);
    this.p.set(fishing ? snapshot.float.x : snapshot.boat.x, fishing ? this.float.position.y + 0.35 : 0.4, fishing ? snapshot.float.z : snapshot.boat.z - 2);
    const lineDistance = this.p.distanceTo(this.rodTip);
    for (let i = 0; i < 49; i++) {
      const t = i / 48;
      this.q.lerpVectors(this.rodTip, this.p, t);
      const arc = snapshot.phase === 'cast' ? Math.min(lineDistance * 0.24, 6) : -Math.min(lineDistance * 0.035, 1.1) * (1 - tension * 0.85);
      this.q.y += Math.sin(t * Math.PI) * arc;
      this.linePositions[i * 3] = this.q.x;
      this.linePositions[i * 3 + 1] = Math.max(this.q.y, 0.10);
      this.linePositions[i * 3 + 2] = this.q.z;
    }
    this.lineGeometry.attributes.position.needsUpdate = true;
    const showFish = snapshot.phase === 'fight';
    this.fighter.visible = showFish;
    this.fighter.position.set(snapshot.fish.x, snapshot.fish.y, snapshot.fish.z);
    this.fighter.rotation.set(0, -snapshot.fish.heading, motion && snapshot.behavior === 'jump' ? Math.sin(time * 7) * 0.3 : 0);
    this.fighter.scale.setScalar(kingFight ? 1.18 : 1);
    for (const [species, fish] of this.fishes) fish.visible = species === snapshot.fish.species;
    this.trophy.visible = snapshot.phase === 'land' && snapshot.catch !== null;
    for (const [species, fish] of this.trophies) fish.visible = species === snapshot.catch?.species;
    const yaw = -snapshot.boat.yaw;
    this.trophy.position.set(snapshot.boat.x - Math.sin(yaw) * 2.4, 2.7, snapshot.boat.z - Math.cos(yaw) * 2.4);
    this.trophy.rotation.set(0, yaw + Math.PI / 2 + (motion ? Math.sin(time * 0.7) * 0.15 : 0), -0.08);
    this.trophy.scale.setScalar(1.5);
    for (const model of [...this.fishes.values(), ...this.trophies.values()]) {
      if (!model.visible) continue;
      const tail = model.getObjectByName('tail');
      if (tail) tail.rotation.y = motion ? Math.sin(time * (telling ? 8 : snapshot.behavior === 'run' ? 10 : 3.8)) * (telling ? 0.12 : 0.20) : 0;
      for (const name of ['finLeft', 'finRight']) {
        const fin = model.getObjectByName(name);
        if (fin) fin.rotation.z = motion ? Math.sin(time * 2.4 + (name === 'finLeft' ? 0 : 2)) * 0.08 : 0;
      }
    }
    this.fishShadow.visible = showFish && snapshot.fish.y < 0.1;
    this.fishShadow.position.set(snapshot.fish.x, 0.088, snapshot.fish.z);
    this.fishShadow.rotation.y = -snapshot.fish.heading;
    this.fishShadow.scale.set(kingFight ? 1.6 : 0.8, 1, kingFight ? 2.1 : snapshot.fish.species === 'pike' ? 1.5 : 1.05);
    const shadowMaterial = (this.fishShadow.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial;
    shadowMaterial.color.set(kingFight ? '#ecc875' : '#b2d5ba');
    this.royalWake.visible = showFish && (kingFight || telling);
    this.royalWake.position.set(snapshot.fish.x, 0.105, snapshot.fish.z);
    this.royalWake.rotation.y = -snapshot.fish.heading - snapshot.runDirection * 0.8;
    this.royalWake.children.forEach((object, index) => {
      object.visible = index === 3 ? telling : index < (kingFight ? snapshot.bossPhase : 1);
      if (index < 3) {
        const material = (object as THREE.Mesh).material as THREE.MeshBasicMaterial;
        material.color.set(telling ? '#ffda87' : kingFight ? ['#e4be70', '#f4a65c', '#fff0bb'][snapshot.bossPhase - 1] ?? '#e4be70' : '#b5d9c6');
        material.opacity = telling ? 0.48 : 0.23;
        const scale = 1.5 + index * 0.7 + (telling ? 1 - Math.min(snapshot.surgeIn, 1) : 0);
        object.scale.setScalar(scale);
      }
    });
    const unlocked = bossUnlocked(save);
    this.feedingGrounds.forEach((ground, index) => {
      const hot = HOTSPOTS[index];
      ground.visible = hot.species !== 'king' || unlocked;
      const matched = hot.lure === snapshot.lure;
      for (let i = 0; i < ground.children.length; i++) {
        const object = ground.children[i] as THREE.Mesh;
        const material = object.material as THREE.MeshBasicMaterial;
        if (object.name === 'activity') {
          const a = time * (hot.species === 'king' ? 0.13 : 0.25) + i * 2.1 + index;
          object.position.x = Math.sin(a) * hot.radius * 0.34;
          object.position.z = Math.cos(a) * hot.radius * 0.34;
          object.rotation.y = Math.PI / 2 + a;
          object.visible = this.quality !== 'low' || i === 3;
        } else if (object.name !== 'crest') {
          const swell = 0.72 + (motion ? Math.sin(time * 0.7 + i * 2.1) * 0.05 : 0);
          object.scale.setScalar(hot.radius * swell);
          material.opacity = matched ? 0.40 : 0.22;
          material.color.set(matched ? '#e9ca86' : hot.species === 'king' ? '#bfab78' : '#a0cbbd');
        }
      }
    });

    if (snapshot.phase !== this.previousPhase) {
      if (moving && (snapshot.phase === 'wait' || snapshot.phase === 'bite')) this.splash(snapshot.float.x, snapshot.float.z, 14);
      if (moving && snapshot.phase === 'land') this.splash(snapshot.boat.x, snapshot.boat.z - 2, 24);
      this.previousPhase = snapshot.phase;
    }
    if (moving) this.effectClock += step;
    if (this.effectClock > 0.42) {
      this.effectClock = 0;
      if (fishing) this.ripple(snapshot.float.x, snapshot.float.z, snapshot.phase === 'fight' ? 1.6 : 0.9);
      if (Math.abs(snapshot.boat.speed) > 0.5) {
        this.ripple(snapshot.boat.x + Math.sin(yaw) * 1.6, snapshot.boat.z + Math.cos(yaw) * 1.6, 1.5, 2.2);
      }
      if (snapshot.behavior === 'jump' && showFish) this.splash(snapshot.fish.x, snapshot.fish.z, this.quality === 'low' ? 6 : 12);
    }
    for (const ring of this.rings) {
      if (moving) ring.age += step;
      const t = ring.age / ring.duration;
      ring.mesh.visible = t < 1 && !save.settings.reducedMotion && (this.quality !== 'low' || this.rings.indexOf(ring) < 10);
      ring.mesh.scale.setScalar((0.1 + t * ring.size));
      ring.mesh.material.opacity = Math.max(0, (1 - t) * 0.32);
    }
    for (let i = 0; i < this.droplets.length; i++) {
      const drop = this.droplets[i];
      if (moving && drop.age < 2) {
        drop.age += step;
        drop.x += drop.vx * step;
        drop.z += drop.vz * step;
        drop.vy -= 7 * step;
        drop.y += drop.vy * step;
      }
      this.dummy.position.set(drop.x, drop.y, drop.z);
      this.dummy.scale.setScalar(drop.y > 0 && drop.age < 2 ? 1 : 0);
      this.dummy.updateMatrix();
      this.particles.setMatrixAt(i, this.dummy.matrix);
    }
    this.particles.instanceMatrix.needsUpdate = true;
    this.particles.visible = this.quality !== 'low' && !save.settings.reducedMotion;
    for (let i = 0; i < this.schools.length; i++) {
      const fish = this.schools[i];
      const centerX = i < 11 ? -12 : 19;
      const centerZ = i < 11 ? 11 : -10;
      const a = time * 0.11 + i * 0.62;
      fish.position.set(centerX + Math.sin(a) * (4 + i % 4), 0.078, centerZ + Math.cos(a) * (3 + i % 3));
      fish.rotation.y = Math.PI / 2 - a;
      fish.visible = this.quality !== 'low' || i < 6;
    }

    const cameraYaw = yaw + this.orbitYaw;
    this.cameraGoal.set(
      snapshot.boat.x + Math.sin(cameraYaw) * 17.5 + Math.cos(cameraYaw) * 3.3,
      10.8 + this.orbitPitch * 11,
      snapshot.boat.z + Math.cos(cameraYaw) * 17.5 - Math.sin(cameraYaw) * 3.3,
    );
    // Keep the view inside the lake without changing its height or introducing a camera roll.
    const cameraRadius = Math.hypot(this.cameraGoal.x / 81, this.cameraGoal.z / 56);
    if (cameraRadius > 1) {
      this.cameraGoal.x /= cameraRadius;
      this.cameraGoal.z /= cameraRadius;
    }
    this.lookGoal.set(snapshot.boat.x - Math.sin(cameraYaw) * 8, 4.5, snapshot.boat.z - Math.cos(cameraYaw) * 8);
    const smoothing = snapshot.paused ? 0 : 1 - Math.exp(-step * 3);
    if (!this.cameraReady) {
      this.camera.position.copy(this.cameraGoal);
      this.look.copy(this.lookGoal);
      this.cameraReady = true;
    } else {
      this.camera.position.lerp(this.cameraGoal, smoothing);
      this.look.lerp(this.lookGoal, smoothing);
    }
    this.camera.lookAt(this.look);
    this.renderer.render(this.scene, this.camera);
  }

  resize(): void {
    if (this.disposed) return;
    const parent = this.canvas.parentElement;
    const width = Math.max(1, parent?.clientWidth ?? window.innerWidth);
    const height = Math.max(1, parent?.clientHeight ?? window.innerHeight);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.fov = width < height ? 58 : 48;
    this.camera.updateProjectionMatrix();
  }

  setQuality(quality: Quality): void {
    if (this.disposed) return;
    this.quality = quality;
    const ratios = { low: 1, medium: 1.4, high: 1.8 };
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, ratios[quality]));
    this.renderer.shadowMap.enabled = quality !== 'low';
    this.sun.castShadow = quality !== 'low';
    const mapSize = quality === 'high' ? 2048 : 1024;
    if (this.sun.shadow.mapSize.x !== mapSize) {
      this.sun.shadow.mapSize.set(mapSize, mapSize);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    this.water.uniforms.effects.value = quality === 'low' ? 0.3 : quality === 'medium' ? 0.7 : 1;
    this.fineDetail.visible = quality !== 'low';
    this.resize();
  }

  orbit(deltaYaw: number, deltaPitch: number): void {
    this.orbitYaw = THREE.MathUtils.clamp(this.orbitYaw + deltaYaw, -Math.PI * 0.92, Math.PI * 0.92);
    this.orbitPitch = THREE.MathUtils.clamp(this.orbitPitch + deltaPitch, -0.35, 0.8);
  }

  resetCamera(): void {
    this.orbitYaw = 0;
    this.orbitPitch = 0;
  }

  pickWater(clientX: number, clientY: number): Point | null {
    if (this.disposed || this.lost) return null;
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    this.pointer.set((clientX - rect.left) / rect.width * 2 - 1, 1 - (clientY - rect.top) / rect.height * 2);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    if (!this.raycaster.ray.intersectPlane(this.plane, this.hit)) return null;
    const { x, z } = this.hit;
    if (Math.hypot(x / 85, z / 60) > 0.985) return null;
    if (Math.hypot((x + 46) / 10, (z + 20) / 8) < 1.08 || Math.hypot((x - 42) / 12, (z - 24) / 8) < 1.08) return null;
    if (Math.abs(x) < 2.3 && z > 37) return null;
    return { x, z };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.canvas.removeEventListener('webglcontextlost', this.onLost);
    this.canvas.removeEventListener('webglcontextrestored', this.onRestored);
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    const textures = new Set<THREE.Texture>();
    this.scene.traverse((object) => {
      if (object instanceof THREE.InstancedMesh) object.dispose();
      const drawable = object as THREE.Mesh;
      if (drawable.geometry) geometries.add(drawable.geometry);
      if (drawable.material) {
        for (const material of Array.isArray(drawable.material) ? drawable.material : [drawable.material]) {
          materials.add(material);
          for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
        }
      }
    });
    geometries.forEach((geometry) => geometry.dispose());
    materials.forEach((material) => material.dispose());
    textures.add(this.grain);
    textures.forEach((texture) => texture.dispose());
    this.sun.shadow.map?.dispose();
    this.renderer.dispose();
    this.scene.clear();
    this.canvas.remove();
  }
}
