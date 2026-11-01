# Intro de Pulso

Composición de [HyperFrames](https://github.com/heygen-com/hyperframes) que genera
el GIF de portada del README: `docs/pulso.gif`.

- Formato: 1920 × 1080, 12,9 s.
- Salida del GIF: 960 × 540, 12 fps, paleta de 256 colores.
- Capturas: datos ficticios de la demo. No hay rutas, nombres ni claves reales.

## Archivos

- `index.html`: composición, estilos y línea de tiempo GSAP.
- `assets/`: capturas usadas en el video.
- `render-gif.ps1`: renderiza el MP4 y lo convierte a GIF.

## Requisitos

Node.js 22 o superior y FFmpeg. En Windows, si no tienes FFmpeg en el `PATH`:

```powershell
npm install --no-save ffmpeg-static ffprobe-static
```

## Render

```powershell
npm run check
.\render-gif.ps1
```

El script deja el GIF final en `docs/pulso.gif`. Para ver la composición en el
navegador:

```powershell
npx hyperframes preview
```
