# Nébula

Biblioteca de visualización de grafos para la web. Renderiza redes grandes con
WebGL y expone una API declarativa.

## Instalación

```bash
npm install nebula-graph
```

## Uso

```js
import { createGraph } from 'nebula-graph';

const graph = createGraph('#canvas', {
  layout: 'force',
  nodes,
  edges
});
```

## Estado

Versión 2.1 en optimización. La API está congelada; el trabajo actual es el
render de redes densas. Ver [docs/ARQUITECTURA.md](docs/ARQUITECTURA.md).

## Compatibilidad

- Chrome y Edge: completo.
- Firefox: completo.
- Safari: pendiente de pruebas.
