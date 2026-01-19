# Preguntas Benchmark - Enterprise DocFlow Platform

## Contexto del Proyecto

| Métrica | Valor |
|---------|-------|
| **Archivos totales** | 27,985 |
| **Dominios .lk** | 26 |
| **Contexto .lk** | 100 KB |
| **Tokens** | ~18,980 |
| **Caracteres** | 66,427 |

## Resultados

| # | Nivel | LK | No-LK | Pregunta |
|---|-------|-----|-------|----------|
| 1 | Alto | 00:25 | 02:32 | ¿Cómo fluyen los datos desde la subida de un PDF hasta la generación del informe de cumplimiento final? |
| 2 | Alto | 00:55 | 01:35 | ¿Cuáles son las diferencias entre el procesamiento con Gemini API y Azure OpenAI? |
| 3 | Alto | 01:01 | 01:49 | ¿Cómo se integra el sistema con la API del ERP externo y qué datos se sincronizan? |
| 4 | Alto | 01:29 | 02:06 | ¿Qué estrategias de manejo de errores y reintentos implementa la capa de IA? |
| 5 | Medio | 01:06 | 01:03 | ¿Qué campos extrae el sistema de los Documentos y cómo se validan? |
| 6 | Medio | 01:10 | 01:06 | ¿Cómo funciona el proceso de validación de etiquetas en label/ia/ia.py? |
| 7 | Medio | 00:18 | 00:32 | ¿Qué comando de management ejecuta la IA sobre productos con errores? |
| 8 | Medio | 00:59 | 00:32 | ¿Cómo se estructura el modelo Document y qué relaciones tiene? |
| 9 | Bajo | 00:15 | 00:45 | ¿Qué endpoints API expone el módulo doc_reader? |
| 10 | Bajo | 00:19 | 01:25 | ¿Dónde se almacenan los archivos subidos (Azure Blob Storage)? |
| 11 | Bajo | 00:33 | 00:23 | ¿Qué dependencias principales usa el proyecto según settings/base.py? |
| 12 | Bajo | 00:14 | 00:20 | ¿Cómo se ejecuta el servidor de desarrollo? |
| 13 | Trivial | 00:13 | 00:18 | ¿Cuál es la versión del proyecto? |
| 14 | Trivial | 00:15 | 00:23 | ¿Qué motor OCR utiliza el sistema? |
| 15 | Trivial | 00:14 | 00:23 | ¿Cuál es el comando para generar un PDF de informe? |

## Resumen

### Totales

| Métrica | LK | No-LK | Diferencia |
|---------|-----|-------|------------|
| **Tiempo total** | 09:26 | 15:12 | -05:46 |
| **Promedio/pregunta** | 00:38 | 01:01 | -00:23 |
| **Victorias** | 11 | 4 | +7 |

**LK es 1.61x más rápido en promedio**

### Por Nivel de Complejidad

| Nivel | LK Total | No-LK Total | LK Promedio | No-LK Promedio | Ratio |
|-------|----------|-------------|-------------|----------------|-------|
| Alto (1-4) | 03:50 | 08:02 | 00:58 | 02:01 | 2.1x |
| Medio (5-8) | 03:33 | 03:13 | 00:53 | 00:48 | 0.9x |
| Bajo (9-12) | 01:21 | 02:53 | 00:20 | 00:43 | 2.1x |
| Trivial (13-15) | 00:42 | 01:04 | 00:14 | 00:21 | 1.5x |

### Conclusiones

- **Mayor beneficio**: Preguntas de nivel **Alto** y **Bajo** (2.1x más rápido)
- **Nivel Medio**: LK ligeramente más lento (0.9x), posiblemente por overhead de contexto innecesario
- **Consistencia**: LK ganó en 11/15 preguntas (73%)
- **Ahorro total**: 5 minutos 46 segundos en 15 preguntas
