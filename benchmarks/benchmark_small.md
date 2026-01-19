# Preguntas Benchmark - Latent-K

## Contexto del Proyecto

| Métrica | Valor |
|---------|-------|
| **Archivos totales** | 6,596 |
| **Dominios .lk** | 4 |
| **Contexto .lk** | 12 KB |
| **Tokens** | ~2,086 |
| **Caracteres** | 7,301 |

## Resultados

| # | Nivel | LK | No-LK | Pregunta |
|---|-------|-----|-------|----------|
| 1 | Alto | 00:49 | 01:55 | ¿Cómo fluyen los datos desde el parseo de archivos del proyecto hasta la generación del contexto .lk? |
| 2 | Alto | 00:27 | 01:14 | ¿Cuáles son las diferencias entre la integración con Claude Code y Gemini CLI? |
| 3 | Alto | 02:10 | 01:40 | ¿Cómo funciona el sistema de hooks y cómo se integra con los asistentes de IA? |
| 4 | Alto | 00:53 | 01:26 | ¿Qué estrategias usa el parser para clasificar archivos en dominios? |
| 5 | Medio | 00:50 | 01:27 | ¿Qué información extrae el parser de cada archivo y cómo la estructura? |
| 6 | Medio | 00:30 | 00:40 | ¿Cómo funciona el comando sync y qué pasos ejecuta? |
| 7 | Medio | 00:43 | 00:33 | ¿Cómo se gestiona el estado de sincronización en state.json? |
| 8 | Medio | 00:54 | 00:38 | ¿Cómo se estructura el archivo project.lk y qué contiene? |
| 9 | Bajo | 00:26 | 00:36 | ¿Qué comandos CLI expone el proyecto? |
| 10 | Bajo | 00:45 | 01:03 | ¿Dónde se almacenan los archivos de contexto generados? |
| 11 | Bajo | 00:13 | 00:38 | ¿Qué dependencias principales usa el proyecto? |
| 12 | Bajo | 00:38 | 00:37 | ¿Cómo se ejecuta latent-k en modo desarrollo? |
| 13 | Trivial | 00:28 | 00:34 | ¿Cuál es la versión del proyecto? |
| 14 | Trivial | 00:28 | 01:06 | ¿Qué modelos de IA soporta el sistema? |
| 15 | Trivial | 00:28 | 00:37 | ¿Cuál es el comando para ver el estado de sincronización? |

## Resumen

### Totales

| Métrica | LK | No-LK | Diferencia |
|---------|-----|-------|------------|
| **Tiempo total** | 10:42 | 14:44 | -04:02 |
| **Promedio/pregunta** | 00:43 | 00:59 | -00:16 |
| **Victorias** | 11 | 4 | +7 |

**LK es 1.38x más rápido en promedio**

### Por Nivel de Complejidad

| Nivel | LK Total | No-LK Total | LK Promedio | No-LK Promedio | Ratio |
|-------|----------|-------------|-------------|----------------|-------|
| Alto (1-4) | 04:19 | 06:15 | 01:05 | 01:34 | 1.45x |
| Medio (5-8) | 02:57 | 03:18 | 00:44 | 00:50 | 1.12x |
| Bajo (9-12) | 02:02 | 02:54 | 00:31 | 00:44 | 1.43x |
| Trivial (13-15) | 01:24 | 02:17 | 00:28 | 00:46 | 1.63x |

### Conclusiones

- **Mayor beneficio**: Preguntas de nivel **Trivial** (1.63x más rápido)
- **Menor beneficio**: Preguntas de nivel **Medio** (1.12x más rápido)
- **Consistencia**: LK ganó en 11/15 preguntas (73%)
- **Ahorro total**: 4 minutos 2 segundos en 15 preguntas
