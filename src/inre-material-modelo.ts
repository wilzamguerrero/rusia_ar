import * as ecs from '@8thwall/ecs'

interface Marca {
  fuente: any
  hijos: number
  lodVersion: number
  claveSchema: string
}

const originales = new WeakMap<any, any>()
const copias = new WeakMap<any, any>()
const texturasClonadas = new WeakMap<any, any[]>()
const uvsAgregadas = new WeakSet<any>()
const marcas = new WeakMap<any, Marca>()

const RANURAS_EMBEBIDAS = [
  'map',
  'normalMap',
  'roughnessMap',
  'metalnessMap',
  'aoMap',
  'emissiveMap',
  'alphaMap',
]

const CLAVES_FISICAS = [
  'transmission',
  'ior',
  'thickness',
  'attenuationDistance',
  'clearcoat',
  'clearcoatRoughness',
  'sheen',
  'sheenRoughness',
  'iridescence',
  'iridescenceIOR',
  'specularIntensity',
]

const esDelMotor = (material: any): boolean =>
  material != null && material.userData != null && material.userData.disposable === true

const mallas = (raiz: any, visitar: (nodo: any) => void) => {
  raiz.traverse((nodo: any) => {
    if (nodo !== raiz && nodo.isMesh === true) {
      visitar(nodo)
    }
  })
}

const tieneTextura = (mat: any): boolean =>
  mat != null && RANURAS_EMBEBIDAS.some((k) => mat[k] != null)

const asegurarUvs = (geometry: any) => {
  if (geometry == null || geometry.getAttribute?.('uv') != null) {
    return
  }
  const pos = geometry.getAttribute?.('position')
  if (pos == null || pos.count === 0) {
    return
  }
  if (geometry.getAttribute?.('normal') == null && typeof geometry.computeVertexNormals === 'function') {
    geometry.computeVertexNormals()
  }
  const norm = geometry.getAttribute?.('normal')
  if (typeof geometry.computeBoundingBox === 'function') {
    geometry.computeBoundingBox()
  }
  const box = geometry.boundingBox
  const minX = box?.min?.x ?? 0
  const minY = box?.min?.y ?? 0
  const minZ = box?.min?.z ?? 0
  const sizeX = Math.max(1e-5, (box?.max?.x ?? 1) - minX)
  const sizeY = Math.max(1e-5, (box?.max?.y ?? 1) - minY)
  const sizeZ = Math.max(1e-5, (box?.max?.z ?? 1) - minZ)

  const uvs = new Float32Array(pos.count * 2)
  const idx = geometry.getIndex?.()

  const proyectarTri = (ia: number, ib: number, ic: number) => {
    const nx = Math.abs((norm?.getX(ia) ?? 0) + (norm?.getX(ib) ?? 0) + (norm?.getX(ic) ?? 0))
    const ny = Math.abs((norm?.getY(ia) ?? 0) + (norm?.getY(ib) ?? 0) + (norm?.getY(ic) ?? 0))
    const nz = Math.abs((norm?.getZ(ia) ?? 0) + (norm?.getZ(ib) ?? 0) + (norm?.getZ(ic) ?? 0))

    for (const vi of [ia, ib, ic]) {
      const px = (pos.getX(vi) - minX) / sizeX
      const py = (pos.getY(vi) - minY) / sizeY
      const pz = (pos.getZ(vi) - minZ) / sizeZ
      if (nx >= ny && nx >= nz) {
        uvs[vi * 2] = pz
        uvs[vi * 2 + 1] = py
      } else if (ny >= nx && ny >= nz) {
        uvs[vi * 2] = px
        uvs[vi * 2 + 1] = pz
      } else {
        uvs[vi * 2] = px
        uvs[vi * 2 + 1] = py
      }
    }
  }

  if (idx != null) {
    for (let i = 0; i + 2 < idx.count; i += 3) {
      proyectarTri(idx.getX(i), idx.getX(i + 1), idx.getX(i + 2))
    }
  } else {
    for (let i = 0; i + 2 < pos.count; i += 3) {
      proyectarTri(i, i + 1, i + 2)
    }
  }

  const AttrCtor = pos.constructor
  if (typeof geometry.setAttribute === 'function' && AttrCtor != null) {
    geometry.setAttribute('uv', new AttrCtor(uvs, 2))
    uvsAgregadas.add(geometry)
  }
}

const aplicar = (raiz: any, fuente: any) => {
  mallas(raiz, (nodo) => {
    if (!originales.has(nodo)) {
      originales.set(nodo, nodo.material)
    }
    if (
      nodo.geometry != null
      && nodo.geometry.getAttribute?.('position') != null
      && nodo.geometry.getAttribute?.('normal') == null
    ) {
      nodo.geometry.computeVertexNormals()
    }
    if (tieneTextura(fuente)) {
      asegurarUvs(nodo.geometry)
    }
    if (nodo.material !== fuente) {
      nodo.material = fuente
    }
  })
}

const modoRepeticionThree = (wrap: string): number => {
  if (wrap === 'clamp') return 1001 // THREE.ClampToEdgeWrapping
  if (wrap === 'mirroredRepeat') return 1002 // THREE.MirroredRepeatWrapping
  return 1000 // THREE.RepeatWrapping
}

const soloAspecto = (raiz: any, fuente: any, schema: any) => {
  const rx = typeof schema.repeatX === 'number' ? schema.repeatX : 1
  const ry = typeof schema.repeatY === 'number' ? schema.repeatY : 1
  const ox = typeof schema.offsetX === 'number' ? schema.offsetX : 0
  const oy = typeof schema.offsetY === 'number' ? schema.offsetY : 0
  const wrapMode = modoRepeticionThree(typeof schema.wrap === 'string' ? schema.wrap : 'repeat')

  mallas(raiz, (nodo) => {
    if (!originales.has(nodo)) {
      originales.set(nodo, nodo.material)
    }

    let copia = copias.get(nodo)
    if (copia === undefined) {
      copia = originales.get(nodo).clone()
      const propias: any[] = []
      for (const ranura of RANURAS_EMBEBIDAS) {
        const tex = copia[ranura]
        if (tex != null && typeof tex.clone === 'function') {
          const clon = tex.clone()
          clon.needsUpdate = true
          copia[ranura] = clon
          propias.push(clon)
        }
      }
      if (propias.length > 0) {
        texturasClonadas.set(copia, propias)
      }
      copias.set(nodo, copia)
    }

    if (copia.color != null && fuente.color != null) {
      copia.color.copy(fuente.color)
    }
    if (copia.emissive != null && fuente.emissive != null) {
      copia.emissive.copy(fuente.emissive)
      copia.emissiveIntensity = fuente.emissiveIntensity
    }
    if (typeof fuente.roughness === 'number' && typeof copia.roughness === 'number') {
      copia.roughness = fuente.roughness
    }
    if (typeof fuente.metalness === 'number' && typeof copia.metalness === 'number') {
      copia.metalness = fuente.metalness
    }
    if (copia.normalScale != null && fuente.normalScale != null) {
      copia.normalScale.copy(fuente.normalScale)
    }
    for (const k of CLAVES_FISICAS) {
      if (typeof fuente[k] === 'number' && k in copia) {
        copia[k] = fuente[k]
      }
    }
    if (copia.sheenColor != null && fuente.sheenColor != null) {
      copia.sheenColor.copy(fuente.sheenColor)
    }

    copia.opacity = fuente.opacity
    copia.transparent = fuente.transparent
    copia.alphaTest = fuente.alphaTest
    copia.side = fuente.side
    copia.blending = fuente.blending
    copia.depthTest = fuente.depthTest
    copia.depthWrite = fuente.depthWrite
    copia.wireframe = fuente.wireframe

    for (const ranura of RANURAS_EMBEBIDAS) {
      const tex = copia[ranura]
      if (tex == null) continue
      tex.repeat.set(rx, ry)
      tex.offset.set(ox, oy)
      tex.wrapS = wrapMode
      tex.wrapT = wrapMode
      tex.needsUpdate = true
    }

    if (tieneTextura(copia)) {
      asegurarUvs(nodo.geometry)
    }

    copia.needsUpdate = true

    if (nodo.material !== copia) {
      nodo.material = copia
    }
  })
}

const restaurar = (raiz: any) => {
  mallas(raiz, (nodo) => {
    if (nodo.geometry != null && uvsAgregadas.has(nodo.geometry)) {
      nodo.geometry.deleteAttribute?.('uv')
      uvsAgregadas.delete(nodo.geometry)
    }
    if (originales.has(nodo)) {
      nodo.material = originales.get(nodo)
      originales.delete(nodo)
    }
    const copia = copias.get(nodo)
    if (copia !== undefined) {
      const propias = texturasClonadas.get(copia)
      if (propias !== undefined) {
        for (const t of propias) {
          t.dispose?.()
        }
        texturasClonadas.delete(copia)
      }
      copia.dispose?.()
      copias.delete(nodo)
    }
  })
}

ecs.registerComponent({
  name: 'inre-material-modelo',
  schema: {
    conservarTexturas: ecs.boolean,
    repeatX: ecs.f32,
    repeatY: ecs.f32,
    offsetX: ecs.f32,
    offsetY: ecs.f32,
    wrap: ecs.string,
  },
  schemaDefaults: {
    conservarTexturas: false,
    repeatX: 1,
    repeatY: 1,
    offsetX: 0,
    offsetY: 0,
    wrap: 'repeat',
  },

  tick: (world, component) => {
    const raiz: any = world.three.entityToObject.get(component.eid)
    if (raiz == null) {
      return
    }

    const fuente = raiz.material
    const marca = marcas.get(raiz)

    if (!esDelMotor(fuente)) {
      if (marca !== undefined) {
        restaurar(raiz)
        marcas.delete(raiz)
      }
      return
    }

    const s = component.schema
    const claveSchema = `${s.conservarTexturas}:${s.repeatX}:${s.repeatY}:${s.offsetX}:${s.offsetY}:${s.wrap}`
    const lodVersion = typeof raiz.userData?.ageLodVersion === 'number' ? raiz.userData.ageLodVersion : 0
    if (
      marca !== undefined
      && marca.fuente === fuente
      && marca.hijos === raiz.children.length
      && marca.lodVersion === lodVersion
      && marca.claveSchema === claveSchema
    ) {
      return
    }

    if (s.conservarTexturas) {
      soloAspecto(raiz, fuente, s)
    } else {
      aplicar(raiz, fuente)
    }

    marcas.set(raiz, {fuente, hijos: raiz.children.length, lodVersion, claveSchema})
  },

  remove: (world, component) => {
    const raiz: any = world.three.entityToObject.get(component.eid)
    if (raiz == null) {
      return
    }
    restaurar(raiz)
    marcas.delete(raiz)
  },
})
