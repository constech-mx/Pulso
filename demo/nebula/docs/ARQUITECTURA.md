# Arquitectura de Nébula

## Capas

- `core`: grafo, índices y eventos.
- `layouts`: fuerza, árbol y radial.
- `render`: WebGL y dibujo de etiquetas.
- `api`: fachada pública.

## Decisión pendiente

El layout de fuerza corre en el hilo principal. Para 10 000 nodos bloquea la
interfaz durante varios segundos. La propuesta es moverlo a un worker y enviar
posiciones por lotes.

## Rendimiento medido

| Nodos | FPS | Frame |
|---|---|---|
| 1 000 | 60 | 16 ms |
| 5 000 | 52 | 19 ms |
| 10 000 | 38 | 26 ms |

## Riesgos

- El worker añade complejidad al ciclo de vida de la instancia.
- Safari no está cubierto por las pruebas visuales.
