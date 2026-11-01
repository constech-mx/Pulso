# Orión

Herramienta de línea de comandos para programar respaldos incrementales,
verificarlos y restaurarlos en un solo paso.

## Uso

```bash
orion backup --source /datos --target /respaldos
orion verify --target /respaldos
orion restore --target /respaldos --destination /prueba
```

## Estado

La versión 1.4.0 lleva semanas ejecutándose en producción. Las copias se
verifican automáticamente después de cada ejecución.

## Operación

- Programación diaria a las 02:00.
- Aviso por correo si una copia falla.
- Retención pendiente de definir.

## Siguiente

1. Restaurar un servidor limpio y medir el tiempo total.
2. Acordar la retención de incrementales.
3. Añadir alerta de espacio libre.
