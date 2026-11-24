# Cambios manuales (archivos que no se reemplazaron)

## src/seed.js
Corregir la fecha inválida (`T200:00:00Z`):

    - `2026-11-${String(18 + round).padStart(2, "0")}T2${m}0:00:00Z`,
    + `2026-11-${String(18 + round).padStart(2, "0")}T2${m}:00:00Z`,

## public/index.html (dentro de <head>)
Para instalar como app en iPhone y mostrar el prompt de instalación:

    <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
    <meta name="mobile-web-app-capable" content="yes">

## Instalar como app
Requiere HTTPS (o localhost). En Chrome/Edge: icono de instalar en la barra.
En Android: menú ⋮ > Instalar app. En iPhone (Safari): Compartir > Añadir a pantalla de inicio.
