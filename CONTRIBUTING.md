# Contribuir a Full Page Shot

¡Gracias por tu interés! Este documento explica cómo contribuir.

## Requisitos

- Node.js 18+
- Microsoft Edge (para las pruebas de extremo a extremo)
- Git

## Configuración del entorno

```powershell
git clone https://github.com/AlbertoVasquezR/full-page-shot.git
cd full-page-shot
npm install
npm run build
```

Carga la extensión en Edge desde `edge://extensions/` → **Modo de desarrollador** → **Cargar descomprimida** → selecciona `dist/`.

## Flujo de trabajo

1. Crea una rama: `git checkout -b feat/mi-mejora`
2. Haz tus cambios.
3. Verifica tipos y build: `npm run check`
4. Ejecuta las pruebas:
   - `node tools/smoke-test.mjs` (extremo a extremo)
   - `node tools/verify-clipboard.mjs` (portapapeles)
5. Haz commit con un mensaje claro.
6. Abre un Pull Request.

## Convenciones de código

- **TypeScript estricto** (`strict: true`), sin JavaScript plano.
- **esbuild** como bundler único.
- Comentarios y mensajes al usuario en **español**.
- Nombres de funciones/variables en **camelCase** en inglés (estilo TS).
- No añadir `host_permissions` ni content scripts: la captura se hace por CDP.
- Si añades una opción nueva: actualiza `types.ts`, `settings.ts`, `options.html/.ts`, el popup si aplica, y el README.

## Pruebas

- `npm run typecheck` — solo tipos.
- `npm run check` — tipos + build.
- `node tools/smoke-test.mjs` — lanza Edge real, captura páginas largas, comprueba PNG/JPEG.
  - `--include-segments` añade escenarios de 65 000 px y scroll de 20 000 px.
  - `--only=scroll` filtra por nombre.
  - `--keep` conserva las descargas.
- `node tools/verify-clipboard.mjs` — verifica que el portapapeles recibe una imagen PNG real.

## Commits

- Mensajes descriptivos en español o inglés.
- **No añadas co-autoría de IA** (sin trailers `Co-authored-by` de modelos).
- Un commit por cambio lógico.

## Reportar bugs

Abre un issue con:
- Pasos para reproducir.
- Página afectada (URL si es pública).
- Salida de la consola (si aplica).
- Versión de Edge y del sistema operativo.

## Código de conducta

Sé respetuoso y constructivo. Este es un proyecto personal; las críticas técnicas son bienvenidas, los ataques personales no.