/*
 * Pantalla de espera de la experiencia. Archivo generado por INRE; se reescribe en
 * cada publicación, así que los cambios que se hagan aquí se pierden.
 *
 * No toca la escena ni los marcadores: solo enseña y esconde una capa encima del
 * lienzo. Si algo falla dentro, se retira sola para no dejar la pantalla tapada.
 */

const MARCADORES = ["2026111403501386_d23ed4a3c1c4a4ae1c11cbffb4a276a3","cube1","e1_marcador","e2_marcador"]

/**
 * Cuenta las descargas en curso de archivos del proyecto (assets/ o blobs) para
 * saber si todavía hay modelos, vídeos o texturas pesados bajando en segundo plano.
 */
let descargasActivas = 0
const oyentesDescarga = new Set<() => void>()
const notificarDescargas = () => {
  for (const fn of oyentesDescarga) {
    fn()
  }
}

if (typeof window.fetch === 'function') {
  const fetchOriginal = window.fetch.bind(window)
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : input.url
    const esAsset = url.indexOf('assets/') !== -1
    if (!esAsset) {
      return fetchOriginal(input, init)
    }
    descargasActivas += 1
    notificarDescargas()
    return fetchOriginal(input, init).finally(() => {
      descargasActivas = Math.max(0, descargasActivas - 1)
      notificarDescargas()
    })
  }
}

/*
 * ┌─ iOS: el permiso de sensores de movimiento ─────────────────────────────────┐
 * │ Safari exige que DeviceMotionEvent.requestPermission() salga de un toque.    │
 * │ El motor lo intenta sin toque, falla, y pinta su propio aviso (.prompt-box-8w │
 * │ en permissions-helper.ts) con un botón Continue que repite la petición       │
 * │ dentro del gesto. Hasta que se toca, NO pide la cámara: el estado nunca pasa  │
 * │ a requesting. En Android no existe ese paso, por eso allí todo funcionaba.   │
 * │                                                                             │
 * │ Ese aviso nace con z-index 888 y esta capa tiene 2147483646: quedaba tapado, │
 * │ y el iPhone se quedaba en «Cargando experiencia…» sin nada que tocar.        │
 * │ Aquí se sube por encima (CSS de arriba), se traduce y se avisa a la capa.    │
 * └─────────────────────────────────────────────────────────────────────────────┘
 */
type EstadoSensores = 'ninguno' | 'visible' | 'continuar' | 'cancelar'
let avisoSensores: EstadoSensores = 'ninguno'
const oyentesSensores = new Set<(estado: EstadoSensores) => void>()
const cambiarSensores = (estado: EstadoSensores) => {
  avisoSensores = estado
  for (const fn of oyentesSensores) {
    fn(estado)
  }
}

const prepararAvisoSensores = (caja: HTMLElement) => {
  if (caja.dataset.inre === '1') {
    return
  }
  caja.dataset.inre = '1'
  const texto = caja.querySelector('p')
  if (texto !== null) {
    texto.textContent = 'Para ver la realidad aumentada, permite el acceso a los sensores de movimiento.'
  }
  const botones = caja.querySelectorAll('button')
  const cancelar = botones[0]
  const continuar = botones[1]
  if (cancelar !== undefined) {
    cancelar.textContent = 'Cancelar'
    cancelar.addEventListener('click', () => cambiarSensores('cancelar'), {once: true})
  }
  if (continuar !== undefined) {
    continuar.textContent = 'Continuar'
    continuar.addEventListener('click', () => cambiarSensores('continuar'), {once: true})
  }
  cambiarSensores('visible')
}

if (typeof MutationObserver === 'function' && document.body !== null) {
  new MutationObserver((cambios) => {
    for (const cambio of cambios) {
      cambio.addedNodes.forEach((nodo) => {
        if (nodo instanceof HTMLElement && nodo.classList.contains('prompt-box-8w')) {
          prepararAvisoSensores(nodo)
        }
      })
    }
  }).observe(document.body, {childList: true})
}

/** El motor, tal como lo ve este archivo. */
interface Motor {
  addCameraPipelineModule: (module: Record<string, unknown>) => void
}

/** Crea la capa una sola vez (o reutiliza la del arranque inicial en index.html). */
const crearCapa = (): {raiz: HTMLElement, titulo: HTMLElement, pista: HTMLElement} => {
  const existente = document.getElementById('inre-espera')
  const estilos = `
      #inre-espera {
        position: fixed;
        inset: 0;
        z-index: 2147483646;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 18px;
        padding: 32px 24px;
        box-sizing: border-box;
        overflow-y: auto;
        background: #06060a;
        color: #f2f4f8;
        font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
        text-align: center;
        transition: opacity 420ms ease, visibility 420ms ease, background 300ms ease;
      }
      /*
       * Modo flotante (sin fondo): cuando la cámara ya está abierta y se está
       * cargando o esperando un marcador, la cámara debe verse detrás.
       */
      #inre-espera.inre-flotante {
        inset: auto 0 28px 0;
        background: transparent;
        pointer-events: none;
        padding: 0 16px;
        gap: 10px;
        overflow: visible;
      }
      #inre-espera.inre-flotante .inre-marca {
        display: none;
      }
      #inre-espera.inre-flotante .inre-indicador {
        margin: 0;
        transform: scale(0.42);
        height: 32px;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      #inre-espera.inre-flotante .inre-titulo {
        font-size: 13px;
        text-shadow: 0 1px 6px rgba(0, 0, 0, 0.85);
      }
      #inre-espera.inre-flotante .inre-pista {
        font-size: 12px;
        color: rgba(242, 244, 248, 0.88);
        text-shadow: 0 1px 6px rgba(0, 0, 0, 0.85);
      }
      @media (max-height: 360px) {
        #inre-espera:not(.inre-flotante) { gap: 8px; padding: 12px 16px; }
        #inre-espera:not(.inre-flotante) .inre-indicador { margin: 8px 0 10px; transform: scale(.72); }
      }
      #inre-espera.inre-fuera { opacity: 0; visibility: hidden; pointer-events: none; }
      /*
       * El mismo cubo ortográfico del arranque (apps/editor/index.html).
       * Sus seis caras necesitan preserve-3d: poner filtros o animar la opacidad
       * del propio cubo aplana el volumen. La salida se anima en su envoltorio.
       */
      #inre-espera .inre-indicador { margin: 24px 0 30px; }
      #inre-espera .inre-cubo {
        position: relative;
        width: 70.4px;
        height: 70.4px;
        --clr: #a78bfa;
        --clr-alpha: rgba(124, 92, 255, .1);
        transform-style: preserve-3d;
        animation: inre-cubo 1.6s infinite ease;
      }
      #inre-espera .inre-cubo > div {
        position: absolute;
        width: 100%;
        height: 100%;
        background: var(--clr-alpha);
        border: 3.5px solid var(--clr);
      }
      #inre-espera .inre-cubo > div:nth-child(1) {
        transform: translateZ(-35.2px) rotateY(180deg);
      }
      #inre-espera .inre-cubo > div:nth-child(2) {
        transform: rotateY(-270deg) translateX(50%);
        transform-origin: top right;
      }
      #inre-espera .inre-cubo > div:nth-child(3) {
        transform: rotateY(270deg) translateX(-50%);
        transform-origin: center left;
      }
      #inre-espera .inre-cubo > div:nth-child(4) {
        transform: rotateX(90deg) translateY(-50%);
        transform-origin: top center;
      }
      #inre-espera .inre-cubo > div:nth-child(5) {
        transform: rotateX(-90deg) translateY(50%);
        transform-origin: bottom center;
      }
      #inre-espera .inre-cubo > div:nth-child(6) { transform: translateZ(35.2px); }
      @keyframes inre-cubo {
        0% { transform: rotate(45deg) rotateX(-25deg) rotateY(25deg); }
        50% { transform: rotate(45deg) rotateX(-385deg) rotateY(25deg); }
        100% { transform: rotate(45deg) rotateX(-385deg) rotateY(385deg); }
      }
      /* Más lento al escanear: conserva tu señal de actividad mientras se apunta. */
      #inre-espera.inre-quieto .inre-cubo { animation-duration: 3.4s; }
      #inre-espera.inre-fuera .inre-indicador {
        animation: inre-cerrar 380ms ease forwards;
      }
      @keyframes inre-cerrar {
        0% { transform: scale(1); }
        60% { transform: scale(1.15); }
        100% { transform: scale(.4); }
      }
      /* Un error no debe parecer trabajo en curso ni depender de la animación. */
      #inre-espera.inre-error .inre-cubo {
        animation-play-state: paused;
        --clr: #f0b4b1;
      }
      @media (prefers-reduced-motion: reduce) {
        #inre-espera .inre-cubo {
          animation: none;
          transform: rotate(45deg) rotateX(-25deg) rotateY(25deg);
        }
        #inre-espera.inre-fuera .inre-indicador { animation: none; }
        #inre-espera, #inre-espera .inre-aviso { transition: none; }
      }
      #inre-espera .inre-titulo {
        font-size: 13px;
        font-weight: 500;
        margin: 4px 0 0;
        color: rgba(242, 244, 248, 0.78);
      }
      #inre-espera .inre-marca {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 4px;
        margin: 2px 0;
        text-align: center;
      }
      #inre-espera .inre-marca-zence {
        font-size: clamp(28px, 6vw, 34px);
        font-weight: 900;
        letter-spacing: 0.12em;
        line-height: 1;
        text-transform: uppercase;
        color: #ffffff;
        text-indent: 0.12em;
      }
      #inre-espera .inre-marca-sub {
        font-size: 11.5px;
        font-weight: 800;
        letter-spacing: 0.19em;
        line-height: 1.2;
        text-transform: uppercase;
        color: #ece9f8;
        text-indent: 0.19em;
      }
      #inre-espera .inre-marca-beta {
        margin-top: 5px;
        font-size: 10px;
        font-weight: 500;
        letter-spacing: 0.26em;
        text-transform: uppercase;
        color: rgba(185, 163, 255, 0.72);
        text-indent: 0.26em;
      }
      #inre-espera .inre-pista {
        font-size: 14px;
        line-height: 1.6;
        margin: 0;
        max-width: 34ch;
        color: rgba(242, 244, 248, 0.72);
      }
      #inre-espera .inre-aviso {
        overflow: hidden;
        max-height: 0;
        opacity: 0;
        transition: max-height 260ms ease, opacity 260ms ease;
        font-size: 13px;
        line-height: 1.55;
        max-width: 36ch;
        padding: 0 14px;
        border-radius: 10px;
        background: rgba(224, 134, 130, 0.14);
        border: 1px solid rgba(224, 134, 130, 0.34);
        color: #f0b4b1;
      }
      #inre-espera.inre-error .inre-aviso { max-height: 240px; opacity: 1; padding: 12px 14px; }
      /* iOS: el aviso de sensores del motor va POR ENCIMA de esta capa (ver avisoSensores). */
      .prompt-box-8w, .immersive-enter-button-8w, .immersive-background-8w {
        z-index: 2147483647 !important;
      }
  `

  if (existente !== null) {
    const style = document.createElement('style')
    style.textContent = estilos
    document.head.appendChild(style)
    return {
      raiz: existente,
      titulo: existente.querySelector('.inre-titulo') as HTMLElement,
      pista: existente.querySelector('.inre-pista') as HTMLElement,
    }
  }

  const raiz = document.createElement('div')
  raiz.id = 'inre-espera'
  raiz.setAttribute('role', 'status')
  raiz.setAttribute('aria-live', 'polite')
  raiz.innerHTML = `
    <style>${estilos}</style>
    <div class="inre-indicador" aria-hidden="true">
      <div class="inre-cubo">
        <div></div><div></div><div></div><div></div><div></div><div></div>
      </div>
    </div>
    <div class="inre-marca" aria-label="Zence Inverse Reality Beta 1.0.1">
      <span class="inre-marca-zence">Zence</span>
      <span class="inre-marca-sub">Inverse Reality</span>
      <span class="inre-marca-beta">Beta 1.0.1</span>
    </div>
    <p class="inre-titulo">Cargando experiencia…</p>
    <p class="inre-pista"></p>
    <p class="inre-aviso"></p>
  `
  document.body.appendChild(raiz)

  return {
    raiz,
    titulo: raiz.querySelector('.inre-titulo') as HTMLElement,
    pista: raiz.querySelector('.inre-pista') as HTMLElement,
  }
}

const montar = () => {
  let capa: ReturnType<typeof crearCapa> | null = null
  let errorAparecido = false
  let retirada = false
  let escaneando = false
  let marcadorEncontrado = false

  const arrancar = () => {
    if (capa === null) {
      capa = crearCapa()
    }
    return capa
  }

  /** Retira la capa con su transición y la quita del árbol al terminar. */
  const retirar = () => {
    if (retirada) {
      return
    }
    const objetivo = capa?.raiz ?? document.getElementById('inre-espera')
    if (objetivo === null) {
      return
    }
    retirada = true
    objetivo.classList.add('inre-fuera')
    window.setTimeout(() => objetivo.remove(), 460)
  }

  /** Cambia los textos sin tocar el resto. */
  const escribir = (titulo: string, pista: string, quieto: boolean) => {
    const actual = arrancar()
    actual.titulo.textContent = titulo
    actual.pista.textContent = pista
    actual.raiz.classList.toggle('inre-quieto', quieto)
    // Un aviso de error ya visible no se tapa con el texto de progreso: es lo único
    // que explica por qué la experiencia no avanza.
    if (!errorAparecido) {
      actual.raiz.classList.remove('inre-error')
    }
  }

  /** Pasa al cubo pequeño sin fondo sobre la cámara cuando ya se puede apuntar. */
  const pasarAFlotante = () => {
    if (errorAparecido || retirada) {
      return
    }
    const actual = arrancar()
    actual.raiz.classList.add('inre-flotante')
  }

  const actualizarTextoFlotante = () => {
    if (retirada || errorAparecido) {
      return
    }
    if (marcadorEncontrado) {
      if (descargasActivas === 0) {
        escribir('Marcador reconocido', 'Mostrando el contenido.', false)
        retirar()
      } else {
        pasarAFlotante()
        escribir(
          'Cargando marcador…',
          `Descargando contenido (${descargasActivas} pendiente${descargasActivas === 1 ? '' : 's'}).`,
          false
        )
      }
      return
    }
    if (!escaneando) {
      return
    }
    pasarAFlotante()
    if (descargasActivas > 0) {
      escribir(
        'Cargando marcador…',
        `Descargando archivos (${descargasActivas} en curso). Apunta al marcador.`,
        false
      )
    } else {
      escribir(
        'Apunta al marcador',
        MARCADORES.length > 0
          ? 'Enfoca la imagen completa, de frente y con buena luz.'
          : 'Ya puedes mirar alrededor.',
        true
      )
    }
  }

  oyentesDescarga.add(actualizarTextoFlotante)

  const avisar = (texto: string) => {
    const actual = arrancar()
    errorAparecido = true
    ;(actual.raiz.querySelector('.inre-aviso') as HTMLElement).textContent = texto
    actual.raiz.classList.remove('inre-flotante')
    actual.raiz.classList.add('inre-error')
    actual.raiz.classList.remove('inre-quieto')
  }

  const motor = (window as unknown as {XR8?: Motor}).XR8

  if (motor === undefined || typeof motor.addCameraPipelineModule !== 'function') {
    // Sin motor AR (p.ej. escena 3D sin cámara): retira la pantalla de inicio en
    // cuanto terminen las descargas de assets o tras un instante breve.
    if (descargasActivas === 0) {
      window.setTimeout(retirar, 600)
    } else {
      const esperarAssets = () => {
        if (descargasActivas === 0) {
          oyentesDescarga.delete(esperarAssets)
          retirar()
        }
      }
      oyentesDescarga.add(esperarAssets)
      window.setTimeout(retirar, 15000)
    }
    return
  }

  arrancar()

  const sinMarcadores = MARCADORES.length === 0
  let estadoCamara = 'inicial'

  /* El aviso de sensores de iOS (ver avisoSensores): la capa explica qué tocar. */
  const alCambiarSensores = (estado: EstadoSensores) => {
    if (retirada || errorAparecido) {
      return
    }
    if (estado === 'visible') {
      escribir(
        'Permiso necesario',
        'Toca «Continuar» en el aviso y después «Permitir» para los sensores de movimiento.',
        false
      )
      return
    }
    if (estado === 'cancelar') {
      avisar(
        'Sin acceso a los sensores de movimiento la realidad aumentada no puede arrancar. '
        + 'Recarga la página y toca «Continuar».'
      )
      return
    }
    if (estado === 'continuar') {
      escribir('Preparando la experiencia…', 'Pidiendo permisos.', false)
      // Si en el diálogo de Safari se eligió «No permitir», el motor se rinde sin
      // cambiar el estado de la cámara: sin este plazo la capa giraría para siempre.
      window.setTimeout(() => {
        if (!retirada && !errorAparecido && estadoCamara === 'inicial') {
          avisar(
            'No se concedió el acceso a los sensores de movimiento. Cierra la pestaña, '
            + 'vuelve a abrir el enlace en Safari y toca «Permitir». Si no aparece, '
            + 'revísalo en Ajustes › Safari › Movimiento y orientación.'
          )
        }
      }, 9000)
    }
  }
  oyentesSensores.add(alCambiarSensores)
  if (avisoSensores !== 'ninguno') {
    alCambiarSensores(avisoSensores)
  }
  let temporizadorPermiso: number | null = null
  const limpiarPermiso = () => {
    if (temporizadorPermiso !== null) {
      window.clearTimeout(temporizadorPermiso)
      temporizadorPermiso = null
    }
  }

  try {
    motor.addCameraPipelineModule({
      name: 'inre-espera',

      listeners: [
        {
          event: 'reality.imageloading',
          process: () => {
            if (!escaneando) {
              escribir(
                'Preparando la experiencia…',
                MARCADORES.length > 0
                  ? 'Analizando la imagen del marcador.'
                  : 'Preparando el contenido.',
                false
              )
            }
          },
        },
        {
          event: 'reality.imagescanning',
          process: () => {
            escaneando = true
            actualizarTextoFlotante()
          },
        },
        {
          event: 'reality.imagefound',
          process: () => {
            marcadorEncontrado = true
            // Una vez visto el marcador, los cubos 3D en escena toman el relevo visual de carga.
            retirar()
          },
        },
        {
          event: 'reality.imageupdated',
          process: () => {
            marcadorEncontrado = true
            retirar()
          },
        },
      ],

      onCameraStatusChange: (evento: {status?: string, reason?: string}) => {
        const estado = evento.status
        if (estado !== undefined) {
          estadoCamara = estado
        }

        if (estado === 'requesting') {
          escribir('Preparando la experiencia…', 'Pidiendo permiso para la cámara.', false)
          limpiarPermiso()
          temporizadorPermiso = window.setTimeout(() => {
            if (!retirada && !errorAparecido && estadoCamara === 'requesting') {
              escribir(
                'Permiso de cámara pendiente',
                'Acepta el aviso del navegador. Si usas un lector QR o visor interno, ábrelo en Safari o Chrome.',
                false
              )
            }
          }, 7500)
          return
        }

        limpiarPermiso()

        if (estado === 'hasStream' || estado === 'hasVideo') {
          if (estado === 'hasVideo') {
            pasarAFlotante()
            if (sinMarcadores) {
              window.setTimeout(() => {
                if (!errorAparecido && descargasActivas === 0) {
                  retirar()
                }
              }, 900)
            }
          }
          escribir(
            MARCADORES.length > 0 ? 'Cargando marcador…' : 'Cargando contenido…',
            MARCADORES.length > 0
              ? 'Preparando la detección sobre la cámara.'
              : 'Terminando de preparar la escena.',
            false
          )
          return
        }

        /*
         * Los dos fallos que hay que contar, y que el motor calla:
         *
         *   failed        → el navegador no dio cámara. Sin cámara no hay marcador.
         *   hasDesktop3D  → el motor arrancó sin cámara, en su vista 3D. La escena se
         *                   ve, pero el reconocimiento de imágenes es imposible.
         *
         * En el segundo caso la capa NO se retira: dejarla puesta con el aviso es mejor
         * que enseñar una escena que parece funcionar y no reconoce nada.
         */
        if (estado === 'failed') {
          const sinHttps = !window.isSecureContext
          const sinApi = typeof navigator.mediaDevices?.getUserMedia !== 'function'
          avisar(
            sinHttps
              ? 'La cámara requiere HTTPS. Abre la experiencia con una URL https://.'
              : sinApi
                ? 'Este navegador o visor interno no permite usar la cámara. Abre el enlace directamente en Safari o Chrome.'
                : 'No se pudo abrir la cámara'
                  + (evento.reason !== undefined ? ` (${evento.reason})` : '')
                  + '. Si estás en el móvil, ábrelo en Safari/Chrome (no desde el lector de QR) y revisa los permisos de cámara.'
          )
          return
        }

        if (estado === 'hasDesktop3D') {
          avisar(
            'Este dispositivo no está abriendo la cámara, así que no se puede '
            + 'reconocer el marcador. Abre la experiencia en un móvil.'
          )
        }
      },
    })
  } catch {
    // Si el motor rechaza el módulo, la capa se retira: es peor tapar la experiencia
    // con una pantalla de espera eterna que quedarse sin ella.
    retirar()
  }

  /*
   * Red de seguridad: solo retira la capa automáticamente si la cámara ya arrancó
   * (`hasVideo` o `hasStream`). Mientras siga esperando permiso (`requesting`) o
   * inicializando, no se oculta la pantalla ni el aviso de permiso.
   */
  const revisarCierreSeguro = () => {
    if (errorAparecido || retirada) {
      return
    }
    if (estadoCamara === 'hasVideo' || estadoCamara === 'hasStream') {
      retirar()
      return
    }
    if (estadoCamara === 'requesting' || estadoCamara === 'inicial') {
      window.setTimeout(revisarCierreSeguro, 5000)
    }
  }
  window.setTimeout(revisarCierreSeguro, sinMarcadores ? 3500 : 35000)
}

/*
 * ┌─ Botón de instalar la app ──────────────────────────────────────────────────┐
 * │ Android/Chrome: el navegador avisa con beforeinstallprompt y el botón abre   │
 * │ su diálogo nativo.                                                          │
 * │                                                                             │
 * │ iPhone/iPad: Safari NO tiene ese evento ni ninguna API para instalar. La     │
 * │ única vía es Compartir › «Añadir a pantalla de inicio», a mano. Esperar el   │
 * │ evento dejaba el botón sin aparecer nunca en iOS; ahí se enseña siempre y    │
 * │ abre una hoja con los pasos.                                                │
 * └─────────────────────────────────────────────────────────────────────────────┘
 */
const ICONO_INSTALAR =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
  'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>' +
  '<polyline points="7 10 12 15 17 10"/>' +
  '<line x1="12" y1="15" x2="12" y2="3"/>' +
  '</svg>'

/** El icono de Compartir de Safari: un cuadro con una flecha hacia arriba. */
const ICONO_COMPARTIR =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
  'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M8 10H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-2"/>' +
  '<polyline points="16 6 12 2 8 6"/>' +
  '<line x1="12" y1="2" x2="12" y2="15"/>' +
  '</svg>'

const asegurarEstiloInstalar = () => {
  if (document.getElementById('inre-pwa-instalar-estilo') !== null) {
    return
  }
  const estilo = document.createElement('style')
  estilo.id = 'inre-pwa-instalar-estilo'
  estilo.textContent = [
    '#inre-pwa-instalar {',
    '  position: fixed;',
    '  right: max(14px, env(safe-area-inset-right));',
    '  bottom: max(14px, env(safe-area-inset-bottom));',
    '  z-index: 2147483647;',
    '  width: 36px; height: 36px; padding: 0;',
    '  display: inline-flex; align-items: center; justify-content: center;',
    '  border-radius: 10px;',
    '  border: 1px solid rgba(167, 139, 250, 0.36);',
    '  background: rgba(11, 11, 18, 0.78);',
    '  backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);',
    '  color: #c4b5fd; cursor: pointer;',
    '  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.36);',
    '  transition: transform 140ms ease, border-color 140ms ease, background 140ms ease;',
    '}',
    '#inre-pwa-instalar:hover { border-color: rgba(167, 139, 250, 0.7); background: rgba(18, 18, 30, 0.9); }',
    '#inre-pwa-instalar:active { transform: scale(0.94); }',
    '#inre-pwa-instalar svg { width: 16px; height: 16px; display: block; }',
    '#inre-pwa-hoja {',
    '  position: fixed; inset: 0; z-index: 2147483647;',
    '  display: flex; align-items: flex-end; justify-content: center;',
    '  background: rgba(0, 0, 0, 0.45);',
    '  font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;',
    '}',
    '#inre-pwa-hoja .inre-hoja-caja {',
    '  width: 100%; max-width: 420px; box-sizing: border-box;',
    '  margin: 0 10px max(10px, env(safe-area-inset-bottom));',
    '  padding: 18px 18px 14px; border-radius: 16px;',
    '  background: #11111b; color: #f2f4f8;',
    '  border: 1px solid rgba(167, 139, 250, 0.3);',
    '  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);',
    '}',
    '#inre-pwa-hoja h2 { margin: 0 0 10px; font-size: 16px; font-weight: 700; }',
    '#inre-pwa-hoja ol { margin: 0 0 14px; padding-left: 20px; font-size: 14px; line-height: 1.7; color: rgba(242, 244, 248, 0.85); }',
    '#inre-pwa-hoja svg { width: 17px; height: 17px; vertical-align: -3px; color: #4f9cff; }',
    '#inre-pwa-hoja p { margin: 0 0 14px; font-size: 14px; line-height: 1.6; color: rgba(242, 244, 248, 0.85); }',
    '#inre-pwa-hoja button {',
    '  width: 100%; padding: 10px; border: 0; border-radius: 10px;',
    '  background: #7c5cff; color: #fff; font-size: 15px; font-weight: 600; font-family: inherit;',
    '}',
  ].join('\n')
  document.head.appendChild(estilo)
}

const crearBotonInstalar = (alTocar: () => void) => {
  if (document.getElementById('inre-pwa-instalar') !== null) {
    return
  }
  asegurarEstiloInstalar()
  const boton = document.createElement('button')
  boton.id = 'inre-pwa-instalar'
  boton.type = 'button'
  boton.title = 'Instalar app'
  boton.setAttribute('aria-label', 'Instalar app')
  boton.innerHTML = ICONO_INSTALAR
  boton.addEventListener('click', alTocar)
  document.body.appendChild(boton)
}

window.addEventListener('beforeinstallprompt', (evento: Event) => {
  const promptEvento = evento as Event & {prompt?: () => Promise<void>}
  if (typeof promptEvento.prompt !== 'function') {
    return
  }
  evento.preventDefault()
  crearBotonInstalar(() => {
    void promptEvento.prompt?.().catch(() => {})
    document.getElementById('inre-pwa-instalar')?.remove()
  })
})

window.addEventListener('appinstalled', () => {
  document.getElementById('inre-pwa-instalar')?.remove()
})

const esIos = /iPad|iPhone|iPod/.test(navigator.userAgent)
  // iPadOS 13+ se presenta como un Mac de escritorio; lo delata la pantalla táctil.
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

const yaInstalada = (navigator as Navigator & {standalone?: boolean}).standalone === true
  || (typeof window.matchMedia === 'function'
    && window.matchMedia('(display-mode: standalone)').matches)

/*
 * Los navegadores internos (Instagram, Facebook, LINE…) no tienen «Añadir a pantalla
 * de inicio»: ahí lo útil es decir que se abra en Safari.
 */
const navegadorInterno = /FBAN|FBAV|Instagram|Line\/|Twitter|TikTok|Snapchat/i
  .test(navigator.userAgent)

const mostrarHojaIos = () => {
  if (document.getElementById('inre-pwa-hoja') !== null) {
    return
  }
  asegurarEstiloInstalar()
  const hoja = document.createElement('div')
  hoja.id = 'inre-pwa-hoja'
  hoja.setAttribute('role', 'dialog')
  hoja.setAttribute('aria-label', 'Instalar app')
  hoja.innerHTML = navegadorInterno
    ? '<div class="inre-hoja-caja"><h2>Instalar app</h2>'
      + '<p>Este visor no permite instalar apps. Abre el enlace en <b>Safari</b> '
      + '(menú ··· › Abrir en el navegador) y vuelve a tocar este botón.</p>'
      + '<button type="button">Entendido</button></div>'
    : '<div class="inre-hoja-caja"><h2>Instalar app</h2><ol>'
      + '<li>Toca <b>Compartir</b> ' + ICONO_COMPARTIR + ' en la barra del navegador.</li>'
      + '<li>Desliza y elige <b>«Añadir a pantalla de inicio»</b>.</li>'
      + '<li>Toca <b>«Añadir»</b>.</li>'
      + '</ol><button type="button">Entendido</button></div>'
  const cerrar = () => hoja.remove()
  hoja.addEventListener('click', (e) => {
    if (e.target === hoja) {
      cerrar()
    }
  })
  hoja.querySelector('button')?.addEventListener('click', cerrar)
  document.body.appendChild(hoja)
}

if (esIos && !yaInstalada) {
  crearBotonInstalar(mostrarHojaIos)
}

/*
 * Se engancha en cuanto el motor existe. Se comprueba antes por si llegó primero: ese
 * evento no se vuelve a lanzar, y esperarlo dejaría la capa sin montar para siempre.
 *
 * En redes móviles lentas `xr.js` puede tardar más de 12 s: se muestra un aviso de
 * descarga en curso en vez de abandonar `xrloaded`, y solo se avisa de fallo si
 * el script falla o excede el margen largo.
 */
if ((window as unknown as {XR8?: Motor}).XR8 !== undefined) {
  montar()
} else {
  let montado = false
  let temporizadorLento: number | null = null
  let temporizadorFallo: number | null = null
  const limpiarTemporizadores = () => {
    if (temporizadorLento !== null) {
      window.clearTimeout(temporizadorLento)
      temporizadorLento = null
    }
    if (temporizadorFallo !== null) {
      window.clearTimeout(temporizadorFallo)
      temporizadorFallo = null
    }
  }
  const lanzar = () => {
    if (montado) {
      return
    }
    montado = true
    limpiarTemporizadores()
    montar()
  }
  window.addEventListener('xrloaded', lanzar)
  const scriptMotor = document.querySelector('script[src*="xr.js"]')
  if (scriptMotor === null) {
    window.setTimeout(lanzar, 400)
  } else {
    const mostrarErrorMotor = (mensaje: string) => {
      limpiarTemporizadores()
      const raiz = document.getElementById('inre-espera')
      const aviso = raiz?.querySelector('.inre-aviso') as HTMLElement | null
      if (raiz !== null && aviso !== null) {
        aviso.textContent = mensaje
        raiz.classList.remove('inre-flotante', 'inre-quieto')
        raiz.classList.add('inre-error')
      }
    }
    scriptMotor.addEventListener('error', () => {
      if (!montado) {
        mostrarErrorMotor('No se pudo descargar el motor AR. Revisa tu conexión a internet y recarga la página.')
      }
    })
    temporizadorLento = window.setTimeout(() => {
      if (!montado) {
        const pista = document.querySelector('#inre-espera .inre-pista')
        if (pista !== null) {
          pista.textContent = 'Descargando el motor AR (conexión lenta)…'
        }
      }
    }, 10000)
    temporizadorFallo = window.setTimeout(() => {
      if (!montado) {
        mostrarErrorMotor('El motor AR tardó demasiado en cargar. Revisa tu conexión y recarga la página.')
      }
    }, 45000)
  }
}
