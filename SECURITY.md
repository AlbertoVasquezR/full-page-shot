# Política de seguridad

## Reportar una vulnerabilidad

Si encuentras una vulnerabilidad de seguridad en Full Page Shot, **no abras un issue público**. En su lugar:

1. Ve a la pestaña **Security** del repositorio en GitHub.
2. Pulsa **Report a vulnerability** (GitHub Private Vulnerability Reporting).
3. Describe el problema, los pasos para reproducirlo y el impacto.

Responderé lo antes posible y coordinaremos la publicación del fix.

## Alcance

- El permiso `debugger` es inherente a la funcionalidad: la extensión necesita acceso al DevTools Protocol para capturar la página completa. Eso no es una vulnerabilidad.
- La extensión no envía datos a servidores externos: toda la captura y el guardado ocurren localmente.
- La extensión no solicita `host_permissions`: la URL y el título se leen por CDP.

## Versiones soportadas

| Versión | Soportada |
| --- | --- |
| 1.x (actual) | ✅ |
| < 1.0 | ❌ |
