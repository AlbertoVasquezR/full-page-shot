<p align="center">
  <img src="assets/banner.svg" alt="Full Page Shot" width="100%"/>
</p>

<p align="center">
  <a href="https://github.com/AlbertoVasquezR/full-page-shot"><img src="https://img.shields.io/github/stars/AlbertoVasquezR/full-page-shot?style=social" alt="GitHub stars"/></a>
  <a href="https://github.com/AlbertoVasquezR/full-page-shot/blob/main/LICENSE"><img src="https://img.shields.io/badge/License-MIT-047857?style=flat-square" alt="MIT License"/></a>
  <img src="https://img.shields.io/badge/Manifest-V3-4f46e5?style=flat-square" alt="Manifest V3"/>
  <img src="https://img.shields.io/badge/TypeScript-strict-3178c6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript"/>
  <img src="https://img.shields.io/badge/bundler-esbuild-ffcf00?style=flat-square" alt="esbuild"/>
  <img src="https://img.shields.io/badge/browser-Microsoft%20Edge-0078d4?style=flat-square&logo=microsoftedge&logoColor=white" alt="Microsoft Edge"/>
</p>

<p align="center">
  <strong>Captura toda la página, por larga que sea, en un solo clic.</strong><br/>
  <sub>PNG o JPEG · Portapapeles · Carpeta de destino · Modo automático inteligente</sub>
</p>

<p align="center">
  <a href="#-instalación">Instalación</a> ·
  <a href="#-uso">Uso</a> ·
  <a href="#-características">Características</a> ·
  <a href="#-problemas-frecuentes">FAQ</a> ·
  <a href="#-licencia">Licencia</a>
</p>

---

## 🎯 ¿Qué es Full Page Shot?

Una extensión para **Microsoft Edge** que captura la **página completa** (todo el scroll, sin importar la longitud) y la guarda como **PNG** o **JPEG**. Escrita en **TypeScript** y empaquetada con **esbuild**.

A diferencia de las capturas normales del navegador, que solo toman lo visible, Full Page Shot usa el **Chrome DevTools Protocol** para renderizar la página a su tamaño real y devolver **una sola imagen sin costuras**. Y cuando el contenido solo aparece al desplazarse, detecta el caso y recorre la página pantalla a pantalla.

---

## ✨ Características

### Captura
- 📄 **Captura completa real** con `Page.captureScreenshot` + `captureBeyondViewport`.
- 🧠 **Modo Automático** (por defecto): analiza la página y decide si conviene recorrerla por scroll. Detecta carga diferida, `content-visibility: auto`, animaciones de entrada, contenedores con scroll interno, listas virtualizadas, iframes pesados, scroll-snap, parallax, imágenes de fondo diferidas y cambios por `IntersectionObserver`.
- 📜 **Modo Por scroll**: baja la vista pantalla a pantalla y une las capturas. Para contenido que solo aparece al desplazarse.
- ⚡ **Modo Rápido**: una sola pasada, sin desplazar la página.
- 👁️ **Modo Visible**: captura solo lo que se ve ahora (ideal para estados con hover o menús abiertos).
- 📏 **Páginas gigantes**: si superan el límite de la GPU se capturan por segmentos y se unen en un lienzo, con reducción automática si hace falta (etiqueta `reducida`).
- 🐢 **Carga diferida (lazy loading)**: opción para recorrer la página antes de capturar en modo rápido.
- ♾️ **Scroll infinito**: opción para seguir capturando mientras la página siga creciendo (feeds, listas que cargan más al bajar).
- 🍪 **Cierre de banners de cookies** antes de capturar (OneTrust, Cookiebot, Didomi, Quantcast…).
- 🧹 **Preparación de la página**: espera fuentes, pausa animaciones/transiciones, fuerza `content-visibility: visible` y elimina `contain` que podría ocultar contenido. Todo se restaura al terminar.
- 🎨 **Repintado previo**: mejora la captura de Canvas/WebGL y animaciones.
- 📐 **Páginas con scroll interno**: detecta y recorre contenedores desplazables (paneles con `html { overflow: hidden }`).

### Salida
- 🖼️ **PNG y JPEG** con control de calidad.
- 📋 **Copiar al portapapeles** como imagen real (no texto ni HTML).
- 📁 **Carpeta de destino**: subcarpeta dentro de Descargas o diálogo nativo de Windows.
- 🔔 **Notificación al terminar**: al pulsarla se abre la imagen capturada.
- ⌨️ **Atajos de teclado**: `Ctrl+Shift+S` (página completa) y `Ctrl+Shift+V` (solo visible).
- ⏱️ **Retardo configurable** (0–10 s) para capturar estados con hover.
- 🕘 **Historial** de las últimas capturas en el popup.
- 🌙 **Tema claro/oscuro** automático.

> **¿Cuál elijo?** Por defecto **Automático** ya decide por ti. Si quieres forzar un comportamiento concreto, cámbialo en el popup o en Opciones.

---

## 🧩 Cómo funciona el portapapeles

Chromium **solo** admite copiar una imagen por código con la API asíncrona del portapapeles, y esa API exige que el documento **tenga el foco**. Por eso:

1. La copia la hace el **popup**, que ya está enfocado mientras ves el progreso.
2. Si cierras el popup antes de que acabe, la extensión abre una **ventana auxiliar diminuta y enfocada** que copia y se cierra sola.

Un documento *offscreen* no sirve aquí: nunca puede tener foco, y el viejo `document.execCommand("copy")` solo deja texto y HTML en el portapapeles, no una imagen. (Véanse chromium/issues/40252021 y 40288517.)

---

## 🚀 Instalación

```powershell
npm install
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

---

## 🎯 Uso

1. Abre la página que quieras capturar (una normal, `http` o `https`).
2. Pulsa el icono de la extensión.
3. Elige el **formato** y el **recorrido de la página** (Automático / Rápido / Por scroll / Visible).
4. Pulsa **Capturar página completa** (o usa `Ctrl+Shift+S`).
5. La imagen se guarda y, si lo activaste, se copia al portapapeles.

---

## 📜 Scripts

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

---

## 📂 Estructura

```
full-page-shot/
├── assets/
│   └── banner.svg          banner del README
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
├── tools/
│   ├── make-icons.mjs      generador de iconos (PNG propio, sin librerías)
│   ├── smoke-test.mjs      prueba de extremo a extremo
│   └── verify-clipboard.mjs verificación del portapapeles
├── build.mjs               script de esbuild + copia de estáticos
└── tsconfig.json
```

---

## 🔐 Permisos y por qué

| Permiso | Motivo |
| --- | --- |
| `debugger` | Único modo de capturar la página completa de verdad. |
| `downloads` | Guardar el archivo donde elijas. |
| `storage` | Guardar tus preferencias (`storage.sync`). |
| `clipboardWrite` | Copiar la imagen al portapapeles sin pedir gesto en cada captura. |
| `notifications` | Avisarte cuando termina. |
| `activeTab` | Respaldo de captura para páginas restringidas. |
| `scripting` | Inyectar scripts de preparación (cookies, fuentes, etc.). |

**No pide acceso a sitios web** (`host_permissions`): la URL y el título se leen por el
protocolo DevTools, no inyectando código.

---

## ⚠️ Límites reales (esto no lo puede saltar ninguna extensión)

- **Páginas internas y PDFs**: cuando el depurador está bloqueado, la extensión intenta al menos una captura de la vista visible con `chrome.tabs.captureVisibleTab` (requiere hacer clic en el icono sobre esa página). No es captura completa, pero evita quedarse sin nada. También reintenta automáticamente si una captura falla.
- **PDFs** abiertos en el visor interno: bloqueado por Edge; respaldo de vista visible.
- **Contenido de iframes de otros dominios** puede salir en blanco.
- **Canvas/WebGL**: mejorado con repintado previo, pero algunos contextos no se renderizan.
- **DevTools abierto** en la misma pestaña: solo se admite un depurador a la vez. Ciérralo.
- **Políticas de empresa** pueden bloquear la captura (`Screenshot capture is restricted by policy`).
- **Captura de una sola toma**: `chrome.debugger` rechaza capturas de más de ~16 000 px de alto, así que las páginas más largas se capturan **por segmentos** y se unen.
- **Páginas de más de ~30 000 px de alto**: se reducen proporcionalmente para caber en el lienzo del navegador (la etiqueta `reducida` lo indica).
- **Copiar al portapapeles** necesita una página de la extensión con foco; si cierras el popup durante la captura, se usa una ventana auxiliar.
- **Modo por scroll**: más lento (una captura por pantalla). Por defecto se detiene al final que tenía la página al empezar; con **Seguir el scroll infinito** activado, sigue capturando mientras la página siga creciendo (feeds, listas que cargan más al bajar), con un tope de seguridad. Captura fielmente lo que solo aparece al desplazarse.
- **Páginas con scroll interno**: algunas aplicaciones (paneles con `html { overflow: hidden }` y el contenido desplazándose dentro del `body` o de un contenedor) se capturan midiendo y recorriendo ese contenedor.

---

## 🛠️ Problemas frecuentes

| Síntoma | Solución |
| --- | --- |
| "Ya hay un depurador conectado" | Cierra DevTools (F12) en esa pestaña. |
| "Edge no permite capturar esta página" | Estás en una página interna. Usa una web normal o haz clic en el icono sobre esa página para al menos capturar la vista visible. |
| La captura sale en blanco | Activa *Recorrer la página antes de capturar* en Opciones. |
| Faltan bloques o salen repetidos | Cambia el **recorrido** a *Por scroll* (contenido que solo aparece al bajar). |
| Cambié el código y no pasa nada | Pulsa **Recargar** en `edge://extensions/`. |

---

## 🤝 Contribuir

¡Las contribuciones son bienvenidas! Si quieres mejorar Full Page Shot:

1. **Haz un fork** del repositorio.
2. **Crea una rama** para tu cambio: `git checkout -b feat/mi-mejora`.
3. **Instala dependencias y compila**: `npm install && npm run check`.
4. **Prueba tus cambios**:
   - `npm run typecheck` (tipos).
   - `node tools/smoke-test.mjs` (prueba de extremo a extremo real).
   - `node tools/verify-clipboard.mjs` (portapapeles).
5. **Haz commit** con un mensaje claro y sin co-autoría de IA.
6. **Abre un Pull Request** describiendo el cambio y cómo probarlo.

### Convenciones

- **TypeScript estricto**, sin JavaScript plano.
- **esbuild** como bundler; no añadas otros bundlers.
- Mantén el estilo del código existente (nombres en español en comentarios, mensajes al usuario en español).
- No añadas `host_permissions` ni inyectes content scripts: la captura se hace por CDP.
- Si añades una opción nueva, actualiza `types.ts`, `settings.ts`, `options.html/.ts` y el README.
- Los mensajes de commit deben ser descriptivos; evita trailers de co-autoría automatizados.

### Ideas para contribuir

- Soporte para capturar un área seleccionada.
- Mejorar la detección automática (nuevos patrones de carga diferida).
- Atajos de teclado configurables.
- Internacionalización (i18n).
- Tests para nuevas rutas de captura.

¿Dudas o sugerencias? Abre un **issue** en el repositorio.

---

## 📝 Licencia

Este proyecto se distribuye bajo la **licencia MIT**, es decir, uso libre: puedes usarlo, copiarlo, modificarlo, fusionarlo, publicarlo, distribuirlo, sublicenciarlo y/o venderlo, siempre que mantengas el aviso de copyright y la licencia. Consulta el archivo [`LICENSE`](./LICENSE) para el texto completo.

Las dependencias (esbuild, typescript, @types/chrome, puppeteer-core) se rigen por sus propias licencias.

---

<p align="center">
  <sub>Hecho con ☕ para capturar páginas largas sin complicaciones.</sub>
</p>