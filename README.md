# Full Page Shot

Extensión para **Microsoft Edge** que toma una captura de **toda la página**, por larga que sea,
y la guarda como **PNG** o **JPEG**. Escrita en **TypeScript** y empaquetada con **esbuild**.

No pega trozos a ciegas: usa el **Chrome DevTools Protocol** para que el navegador
renderice la página y devuelva **una sola imagen sin costuras**. Y si el contenido
solo aparece al desplazarse, tiene un **modo por scroll** que recorre la página
pantalla a pantalla.

---

## Qué hace

- **Tres formas de recorrer la página** (se elige en el popup o en Opciones):
  - **Automático** (por defecto): analiza la página y decide si conviene el
    recorrido por scroll. Detecta carga diferida, `content-visibility: auto`,
    animaciones de entrada, contenedores que se desplazan por dentro, listas
    virtualizadas, iframes pesados, diseño con scroll-snap, parallax, imágenes de
    fondo diferidas, scroll suave y, como prueba final, desplaza la página para
    ver si aparecen nodos o clases de visibilidad nuevas. Empieza por aquí.
  - **Rápido**: una sola pasada con `Page.captureScreenshot` +
    `captureBeyondViewport`. Devuelve **una sola imagen sin costuras**.
  - **Por scroll**: baja la vista **pantalla a pantalla**, espera a que cada tramo
    se pinte y los une. Es lo que hace falta cuando el contenido solo aparece al
    desplazarse (imágenes con carga diferida, listas virtualizadas, animaciones de
    entrada). Más lento, pero captura lo que de verdad se ve.
- **Páginas gigantes**: si superan el límite de la superficie de la GPU se capturan por
  segmentos y se unen en un lienzo, con presupuesto de memoria y reducción automática si
  hace falta (te avisa con la etiqueta `reducida`).
- **Carga diferida (lazy loading)**: opción para recorrer la página antes de capturar en
  modo rápido, para que las imágenes que aún no se habían cargado aparezcan.
- **PNG y JPEG** con control de calidad.
- **Copiar al portapapeles** como imagen de verdad (no como texto ni HTML).
- **Notificación al terminar**: si la activas, al pulsarla se abre la imagen
  capturada (o se muestra en la carpeta si no hay visor disponible).
- **Atajos de teclado**: `Ctrl+Shift+S` captura la página completa y
  `Ctrl+Shift+V` solo la vista visible, sin abrir el popup. El progreso se ve en
  el icono de la barra.
- **Cerrar banners de cookies** antes de capturar (activado por defecto).
- **Retardo configurable** (0–10 s) para capturar menús desplegados o estados
  con hover.
- **Modo "Visible"**: captura solo lo que se ve ahora, sin desplazarse.
- **Historial de las últimas capturas** en el popup, con botón "Ver".
- **Restaurar valores por defecto** en Opciones.

> **¿Cuál elijo?** Por defecto **Automático** ya decide por ti. Si quieres forzar
> un comportamiento concreto (p. ej. "Rápido" para ir rápido en páginas simples, o
> "Por scroll" en una página que el automático no detecta bien), cámbialo en el
> popup o en Opciones.

## Copiar al portapapeles: cómo funciona

Chromium **solo** admite copiar una imagen por código con la API asíncrona del
portapapeles, y esa API exige que el documento **tenga el foco**. Por eso:

- La copia la hace el **popup**, que ya está enfocado mientras ves el progreso.
- Si cierras el popup antes de que acabe (clic en la página, diálogo de "Guardar como"…),
  la extensión abre una **ventana auxiliar diminuta y enfocada** que copia y se cierra sola.

Un documento *offscreen* no sirve aquí: nunca puede tener foco, y el viejo
`document.execCommand("copy")` solo deja texto y HTML en el portapapeles, no una imagen.
(Véanse chromium/issues/40252021 y 40288517.)

## Instalación

```powershell
npm install      # ya está hecho si clonaste con node_modules
npm run build    # compila a dist/
```

Luego, en Edge:

1. Abre `edge://extensions/`.
2. Activa **Modo de desarrollador** (abajo a la izquierda).
3. Pulsa **Cargar descomprimida** y elige la carpeta **`dist`** (no la raíz del proyecto).
4. Fija la extensión en la barra con el icono de pieza de puzzle.

> Al instalar, Edge avisará que la extensión "puede leer y cambiar todos tus datos".
> Es el aviso obligatorio del permiso `debugger`, que es justo el que permite la captura
> completa. Mientras se toma una captura aparece una barra amarilla de "está depurando este
> navegador": es normal y desaparece al terminar.

## Uso

1. Abre la página que quieras capturar (una normal, `http` o `https`).
2. Pulsa el icono de la extensión.
3. Elige el **formato** y el **recorrido de la página** (*Rápido* o *Por scroll*).
4. Pulsa **Capturar página completa**.
5. La imagen se guarda y, si lo activaste, se copia al portapapeles.

## Scripts

| Comando | Qué hace |
| --- | --- |
| `npm run build` | Compila `src/` a `dist/` y copia `public/`. |
| `npm run dev` | Lo mismo en modo vigilancia (recompila al guardar). |
| `npm run typecheck` | Solo comprueba tipos, sin generar archivos. |
| `npm run check` | `typecheck` + `build`. |
| `npm run icons` | Regenera los iconos PNG sin dependencias. |
| `node tools/smoke-test.mjs` | Prueba de extremo a extremo real: lanza Edge, captura páginas largas y comprueba el PNG/JPEG descargado, en modo rápido y por scroll. Con `--include-segments` añade una página de 65 000 px y una de scroll de 20 000 px. Con `--only=scroll` filtra por nombre y con `--keep` conserva las descargas. |
| `node tools/verify-clipboard.mjs` | Comprueba que el portapapeles recibe una imagen PNG real (lee el portapapeles de vuelta), por los dos caminos: popup y ventana auxiliar. |

Tras cambiar código hay que pulsar **Recargar** en `edge://extensions/`.

## Estructura

```
full-page-shot/
├── public/                 recursos estáticos (se copian tal cual a dist/)
│   ├── manifest.json       Manifest V3
│   ├── popup.html/.css     interfaz del botón
│   ├── options.html/.css   página de opciones
│   ├── helper.html         ventana auxiliar que copia al portapapeles
│   └── icons/              iconos generados
├── src/
│   ├── background.ts       service worker: orquesta la captura, el copiado y la descarga
│   ├── capture.ts          lógica del DevTools Protocol (medir, capturar, unir)
│   ├── cdp.ts              envoltura tipada de chrome.debugger
│   ├── popup.ts            interfaz rápida
│   ├── options.ts          página de opciones
│   ├── helper.ts           ventana auxiliar (respaldo del portapapeles)
│   ├── clipboard.ts        escritura de imágenes en el portapapeles
│   ├── settings.ts         lectura/escritura de preferencias
│   ├── types.ts            tipos y mensajes compartidos
│   └── util.ts             base64, nombres de archivo, formato de tamaños
├── tools/make-icons.mjs    generador de iconos (PNG propio, sin librerías)
├── build.mjs               script de esbuild + copia de estáticos
└── tsconfig.json
```

## Permisos y por qué

| Permiso | Motivo |
| --- | --- |
| `debugger` | Único modo de capturar la página completa de verdad. |
| `downloads` | Guardar el archivo donde elijas. |
| `storage` | Guardar tus preferencias (`storage.sync`). |
| `clipboardWrite` | Copiar la imagen al portapapeles sin pedir gesto en cada captura. |
| `notifications` | Avisarte cuando termina. |

**No pide acceso a sitios web** (`host_permissions`): la URL y el título se leen por el
protocolo DevTools, no inyectando código.

## Límites reales (esto no lo puede saltar ninguna extensión)

- **Páginas internas**: `edge://`, `chrome://`, la tienda de complementos de Edge, pestañas
  nuevas y páginas de extensiones. Edge bloquea el depurador ahí por seguridad.
- **PDFs** abiertos en el visor interno.
- **Contenido de iframes de otros dominios** puede salir en blanco.
- **Canvas/WebGL** a veces no se renderiza en la captura.
- **DevTools abierto** en la misma pestaña: solo se admite un depurador a la vez. Ciérralo.
- **Políticas de empresa** pueden bloquear la captura (`Screenshot capture is restricted by policy`).
- **Captura de una sola toma**: `chrome.debugger` rechaza capturas de más de ~16 000 px de alto,
  así que las páginas más largas se capturan **por segmentos** y se unen.
- **Páginas de más de ~30 000 px de alto**: se reducen proporcionalmente para caber en el
  lienzo del navegador (la etiqueta `reducida` lo indica). Una página de 45 000 px sale como
  una imagen de 30 000 px de alto, completa y sin cortes, pero más pequeña.
- **Copiar al portapapeles** necesita una página de la extensión con foco; si cierras el popup
  durante la captura, se usa una ventana auxiliar.
- **Páginas con scroll interno**: algunas aplicaciones (por ejemplo, paneles con
  `html { overflow: hidden }` y el contenido desplazándose dentro del `body` o de un
  contenedor) no se capturaban antes. Ahora la extensión detecta el contenedor
  principal desplazable, mide su altura real y recorre ese contenedor.

## Problemas frecuentes

| Síntoma | Solución |
| --- | --- |
| "Ya hay un depurador conectado" | Cierra DevTools (F12) en esa pestaña. |
| "Edge no permite capturar esta página" | Estás en una página interna. Usa una web normal. |
| La captura sale en blanco | Activa *Recorrer la página antes de capturar* en Opciones. |
| Faltan bloques o salen repetidos | Cambia el **recorrido** a *Por scroll* (contenido que solo aparece al bajar). |
| Cambié el código y no pasa nada | Pulsa **Recargar** en `edge://extensions/`. |
