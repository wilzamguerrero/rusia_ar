import * as ecs from '@8thwall/ecs'

/**
 * Controlador de LOD adaptativo generado por Zence Inverse Reality (AGE).
 * No editar a mano: se reescribe en cada publicación.
 */

interface ManifestLod {
  level: number
  path: string
  triangles: number
  vertices: number
  bytes: number
  geometricError: number
  screenSizeThreshold: number
}

interface AgeManifest {
  modelId: string
  bounds: { center: [number, number, number], radius: number }
  lods: ManifestLod[]
  recommendedInitialLod: number
  streaming: {
    progressive: boolean
    memoryBudgetMb: number
    meshCompression: 'none' | 'meshopt'
  }
}

interface CachedLod {
  level: number
  scene: any
  animations: any[]
  bytes: number
  lastUsed: number
}

interface EntityLodState {
  manifestUrl: string
  manifest: AgeManifest | null
  baseDir: string
  cache: Map<number, CachedLod>
  inFlight: Set<number>
  activeLevel: number
  lastSwitchAt: number
  emaFrameMs: number
  frameSamples: number
  perfBias: number
  activeChild: any
  mixer: any
  disposed: boolean
}

const states = new Map<ecs.Eid, EntityLodState>()
let sharedLoader: any | null = null
let meshoptPromise: Promise<void> | null = null

const ensureMeshoptDecoder = async (loader: any): Promise<void> => {
  if (typeof loader.setMeshoptDecoder !== 'function') return
  if (meshoptPromise === null) {
    meshoptPromise = (async () => {
      try {
        const decoderUrl = 'https://cdn.jsdelivr.net/npm/meshoptimizer@1.3.0/meshopt_decoder.mjs'
        const mod: any = await import(/* webpackIgnore: true */ decoderUrl)
        const decoder = mod.MeshoptDecoder ?? mod.default
        if (decoder !== undefined) {
          if (decoder.ready !== undefined) await decoder.ready
          loader.setMeshoptDecoder(decoder)
        }
      } catch (err) {
        console.warn('[AGE] No se pudo cargar MeshoptDecoder en runtime:', err)
      }
    })()
  }
  await meshoptPromise
}

const getEnhancedGltfLoader = async (needsMeshopt: boolean): Promise<any> => {
  const THREE = (window as any).THREE
  if (sharedLoader === null) {
    const loader = new THREE.GLTFLoader()
    if (typeof THREE.DRACOLoader === 'function') {
      const draco = new THREE.DRACOLoader()
      draco.setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.172.0/examples/jsm/libs/draco/gltf/')
      loader.setDRACOLoader(draco)
    }
    sharedLoader = loader
  }

  if (needsMeshopt) {
    await ensureMeshoptDecoder(sharedLoader)
  }

  return sharedLoader
}

const disposeSubtree = (root: any) => {
  if (root == null) return
  root.traverse((node: any) => {
    if (node.geometry && typeof node.geometry.dispose === 'function') {
      node.geometry.dispose()
    }
    const mats = Array.isArray(node.material) ? node.material : node.material ? [node.material] : []
    for (const m of mats) {
      for (const k of Object.keys(m)) {
        const val = m[k]
        if (val && typeof val.dispose === 'function' && val.isTexture) {
          val.dispose()
        }
      }
      if (typeof m.dispose === 'function') m.dispose()
    }
  })
}

const findActiveCamera = (world: any): any => {
  if (world.three?.activeCamera) return world.three.activeCamera
  let found: any = null
  world.three?.scene?.traverse((obj: any) => {
    if (found === null && obj && obj.isCamera) found = obj
  })
  return found
}

const computeCoverage = (
  THREE: any,
  obj: any,
  cam: any,
  centerArr: [number, number, number],
  radius: number
): number => {
  if (!obj || !cam || radius <= 0) return 0.5
  obj.updateWorldMatrix(true, false)
  const center = new THREE.Vector3(centerArr[0], centerArr[1], centerArr[2]).applyMatrix4(obj.matrixWorld)
  const pos = new THREE.Vector3()
  const quat = new THREE.Quaternion()
  const scl = new THREE.Vector3()
  obj.matrixWorld.decompose(pos, quat, scl)
  const worldRadius = radius * Math.max(Math.abs(scl.x), Math.abs(scl.y), Math.abs(scl.z), 1e-4)
  const camPos = new THREE.Vector3()
  cam.getWorldPosition(camPos)
  const dist = Math.max(0.01, camPos.distanceTo(center))
  const fov = typeof cam.fov === 'number' ? cam.fov : 60
  const tanHalf = Math.max(1e-4, Math.tan((fov * Math.PI) / 360))
  return (worldRadius / dist) / tanHalf
}

const evictCacheIfNeeded = (state: EntityLodState) => {
  if (!state.manifest) return
  const budgetBytes = Math.max(16, state.manifest.streaming.memoryBudgetMb || 96) * 1024 * 1024
  let total = 0
  state.cache.forEach(entry => { total += entry.bytes })
  if (total <= budgetBytes) return

  const ordered = Array.from(state.cache.values())
    .filter(e => e.level !== state.activeLevel)
    .sort((a, b) => a.lastUsed - b.lastUsed)

  for (const item of ordered) {
    if (total <= budgetBytes) break
    state.cache.delete(item.level)
    total -= item.bytes
    disposeSubtree(item.scene)
  }
}

const mountLod = (world: any, eid: ecs.Eid, state: EntityLodState, entry: CachedLod) => {
  const root = world.three.entityToObject.get(eid)
  if (!root) return

  const THREE = (window as any).THREE
  const cloned = typeof THREE.skeletonClone === 'function'
    ? THREE.skeletonClone(entry.scene)
    : entry.scene.clone(true)

  // Ocultar el modelo base de `gltf-system` si ya entró para que no se duplique
  for (const child of root.children) {
    if (child.userData && child.userData.gltf === true && !child.userData.ageLod) {
      child.visible = false
    }
  }

  if (state.activeChild !== null && state.activeChild.parent === root) {
    root.remove(state.activeChild)
    // No llamamos a disposeSubtree(state.activeChild) porque `cloned` comparte
    // geometría, materiales y texturas con `entry.scene` en `state.cache`.
  }

  cloned.visible = true
  cloned.matrixAutoUpdate = true
  cloned.updateMatrix()
  cloned.userData.ageLod = true
  cloned.userData.ageLevel = entry.level
  cloned.userData.eid = eid

  // Heredar sombras de la entidad y preparar bounds/culling como gltf-system
  const hasShadow = ecs.Shadow?.has?.(world, eid)
  const shadowCfg = hasShadow ? ecs.Shadow.get(world, eid) : null
  const hasAnim = entry.animations.length > 0
  cloned.traverse((n: any) => {
    if (n.isMesh) {
      if (shadowCfg) {
        n.castShadow = !!shadowCfg.castShadow
        n.receiveShadow = !!shadowCfg.receiveShadow
      }
      if (hasAnim) {
        n.frustumCulled = false
      }
      if (n.geometry && typeof n.geometry.computeBoundsTree === 'function' && !n.geometry.boundsTree) {
        n.geometry.computeBoundsTree()
      }
    }
  })

  root.add(cloned)
  if (typeof world.three?.notifyChanged === 'function') {
    world.three.notifyChanged(cloned)
  }
  root.userData = root.userData || {}
  root.userData.ageLodVersion = (root.userData.ageLodVersion || 0) + 1
  state.activeChild = cloned
  state.activeLevel = entry.level
  state.lastSwitchAt = performance.now()
  entry.lastUsed = Date.now()
}

const requestLod = async (
  world: any,
  eid: ecs.Eid,
  state: EntityLodState,
  level: number
) => {
  if (state.disposed || !state.manifest) return
  if (state.cache.has(level) || state.inFlight.has(level)) return
  const lod = state.manifest.lods.find(l => l.level === level)
  if (!lod) return

  state.inFlight.add(level)
  try {
    const resolvedUrl = (lod.path.startsWith('blob:') || lod.path.startsWith('http'))
      ? lod.path
      : state.baseDir + lod.path
    const res = await fetch(resolvedUrl)
    if (!res.ok) return
    const buffer = await res.arrayBuffer()
    if (state.disposed) return

    const loader = await getEnhancedGltfLoader(state.manifest.streaming.meshCompression === 'meshopt')
    const gltf: any = await new Promise((resolve, reject) => {
      loader.parse(buffer, state.baseDir, resolve, reject)
    })
    if (state.disposed) {
      disposeSubtree(gltf.scene)
      return
    }

    const entry: CachedLod = {
      level,
      scene: gltf.scene,
      animations: gltf.animations || [],
      bytes: lod.bytes || buffer.byteLength,
      lastUsed: Date.now(),
    }
    state.cache.set(level, entry)
    evictCacheIfNeeded(state)

    if (state.activeChild === null) {
      mountLod(world, eid, state, entry)
    }
  } catch (err) {
    console.warn('[AGE] Error cargando LOD ' + level + ':', err)
  } finally {
    state.inFlight.delete(level)
  }
}

ecs.registerComponent({
  name: 'inre-lod-adaptativo',
  schema: {
    manifestUrl: ecs.string,
    mode: ecs.string,
    manualLevel: ecs.i32,
    bias: ecs.f32,
  },
  schemaDefaults: {
    manifestUrl: '',
    mode: 'auto',
    manualLevel: 0,
    bias: 1.0,
  },

  add: (world, component) => {
    const url = component.schema.manifestUrl
    if (!url) return
    const slash = url.lastIndexOf('/')
    const baseDir = slash >= 0 ? url.slice(0, slash + 1) : ''

    const state: EntityLodState = {
      manifestUrl: url,
      manifest: null,
      baseDir,
      cache: new Map(),
      inFlight: new Set(),
      activeLevel: 0,
      lastSwitchAt: 0,
      emaFrameMs: 16.67,
      frameSamples: 0,
      perfBias: 0,
      activeChild: null,
      mixer: null,
      disposed: false,
    }
    states.set(component.eid, state)

    void fetch(url)
      .then(r => (r.ok ? r.json() : null))
      .then((manifest: AgeManifest | null) => {
        if (state.disposed || !manifest || !Array.isArray(manifest.lods) || manifest.lods.length === 0) {
          return
        }
        manifest.lods.sort((a, b) => a.level - b.level)
        state.manifest = manifest
        const initial = component.schema.mode === 'manual'
          ? component.schema.manualLevel
          : manifest.recommendedInitialLod
        state.activeLevel = initial
        void requestLod(world, component.eid, state, initial)
      })
      .catch(() => {})
  },

  tick: (world, component) => {
    const state = states.get(component.eid)
    if (!state || !state.manifest) return

    const THREE = (window as any).THREE
    const root = world.three.entityToObject.get(component.eid)
    if (!root) return

    // Mantener oculto el modelo base de `gltf-system` solo cuando ya hay un LOD activo montado
    if (state.activeChild !== null) {
      for (const child of root.children) {
        if (child.userData && child.userData.gltf === true && !child.userData.ageLod && child.visible) {
          child.visible = false
        }
      }
    }

    if (state.manifest.lods.length <= 1) return

    const dtMs = Math.max(1, Math.min(250, world.time.delta || 16.67))
    state.emaFrameMs = state.frameSamples === 0 ? dtMs : state.emaFrameMs * 0.9 + dtMs * 0.1
    state.frameSamples += 1
    const fps = 1000 / Math.max(1, state.emaFrameMs)

    if (state.frameSamples >= 12) {
      if (fps < 28 && state.perfBias < state.manifest.lods.length - 1) state.perfBias += 1
      else if (fps >= 50 && state.perfBias > 0) state.perfBias -= 1
    }

    let desired = state.activeLevel
    if (component.schema.mode === 'manual') {
      desired = component.schema.manualLevel
    } else {
      const cam = findActiveCamera(world)
      const coverage = computeCoverage(
        THREE,
        root,
        cam,
        state.manifest.bounds.center,
        state.manifest.bounds.radius
      ) * (component.schema.bias || 1)

      const lods = state.manifest.lods
      let desiredIdx = lods.length - 1
      for (let i = 0; i < lods.length; i += 1) {
        const l = lods[i]
        const threshold = l.level < state.activeLevel
          ? l.screenSizeThreshold * 1.15
          : l.screenSizeThreshold * 0.85
        if (coverage >= threshold) {
          desiredIdx = i
          break
        }
      }
      desiredIdx = Math.min(lods.length - 1, desiredIdx + Math.floor(state.perfBias * 0.5))
      desired = lods[desiredIdx].level
    }

    if (desired !== state.activeLevel) {
      const cached = state.cache.get(desired)
      const now = performance.now()
      if (cached !== undefined && now - state.lastSwitchAt >= 800) {
        state.lastSwitchAt = now
        mountLod(world, component.eid, state, cached)
      } else if (cached === undefined) {
        void requestLod(world, component.eid, state, desired)
      }
    }
  },

  remove: (world, component) => {
    const state = states.get(component.eid)
    if (!state) return
    state.disposed = true
    const root = world.three.entityToObject.get(component.eid)
    if (root) {
      if (state.activeChild && state.activeChild.parent === root) {
        root.remove(state.activeChild)
      }
      for (const child of root.children) {
        if (child.userData && child.userData.gltf === true && !child.userData.ageLod && !child.visible) {
          child.visible = true
          if (typeof world.three?.notifyChanged === 'function') {
            world.three.notifyChanged(child)
          }
        }
      }
      if (typeof world.three?.notifyChanged === 'function') {
        world.three.notifyChanged(root)
      }
    }
    state.activeChild = null
    state.cache.forEach(entry => disposeSubtree(entry.scene))
    state.cache.clear()
    states.delete(component.eid)
  },
})
