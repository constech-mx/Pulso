# Atlas

Aplicación de escritorio para organizar notas, referencias y tareas por proyecto.
Funciona sin conexión y guarda todo en una base local.

## Estado

La versión 0.9.2 tiene la interfaz cerrada y la migración de datos en curso.
Consulta [docs/ESTADO.md](docs/ESTADO.md) para el detalle.

## Cómo ejecutarla

```bash
npm install
npm run dev
```

La primera ejecución crea la base local en el directorio de datos del usuario.

## Estructura

- `src/editor`: bloques, atajos y búsqueda.
- `src/library`: adjuntos y vista previa.
- `src/storage`: acceso a la base y migraciones.
- `docs/`: estado y decisiones.

## Pendiente

- Migrar notas del formato anterior sin perder adjuntos.
- Definir permisos de espacios compartidos.
