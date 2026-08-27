# Cómo contribuir

Gracias por el interés en mejorar Chess Manager. Este documento explica cómo trabajar en el
proyecto y qué se espera de una contribución.

## Antes de escribir código

- Si vas a proponer un cambio grande (reglas de emparejamiento, cambios de esquema, una
  dependencia nueva), abre primero un *issue* para discutirlo. Evita trabajo perdido.
- Para correcciones puntuales y mejoras chicas, ve directo al *pull request*.
- Si encuentras un error, incluye los pasos para reproducirlo. En un gestor de torneos, el
  detalle importante suele ser el estado: cuántos jugadores, cuántas rondas jugadas, si el
  número de jugadores era par o impar, si alguien estaba retirado.

## Entorno de desarrollo

```bash
npm install
npm run hash-password          # genera el hash de una contraseña de prueba
export ORGANIZER_PASSWORD_HASH='scrypt:...'
export SESSION_COOKIE_SECRET='cualquier-cadena-larga-para-desarrollo'

npm run dev:server             # API en :3001
npm run dev                    # interfaz en :5173
```

Para no ensuciar tu base de desarrollo, apunta a otra carpeta:

```bash
DATA_DIR=/tmp/chess-dev npm run dev:server
```

## Antes de abrir el pull request

Los tres comandos tienen que pasar:

```bash
npm run lint
npm run build      # incluye la verificación de tipos
npm test
```

`npm run build` corre `tsc -b`, así que un error de tipos rompe la compilación. No lo saltes.

## Estilo de código

- **TypeScript en todo el proyecto.** Sin `any` salvo que no haya alternativa razonable.
- **Sentencias preparadas siempre.** Toda consulta usa marcadores `?`. Nunca construyas SQL
  concatenando cadenas, ni siquiera con valores que parezcan seguros.
- **Comentarios que expliquen el porqué, no el qué.** El código ya dice lo que hace. Los
  comentarios valiosos son los que explican una decisión no evidente o una trampa conocida.
- **Los textos de la interfaz van en español neutro**, tratando de "tú" a quien organiza.
  Sin voseo ni regionalismos. Los mensajes de error se muestran tal cual al usuario: que
  digan qué pasó y qué hacer, no un código interno.

## Reglas del dominio que conviene respetar

Estas restricciones existen por una razón y romperlas corrompe torneos:

1. **Valida en el servidor, no solo en la interfaz.** Ocultar o deshabilitar un botón es
   comodidad para quien usa la app, nunca la única defensa. Toda regla se hace cumplir en el
   endpoint correspondiente.
2. **Una ronda cerrada no se modifica.** Los puntajes de una ronda alimentan los
   emparejamientos de las siguientes; cambiarlos después deja los cruces posteriores
   inconsistentes. La única excepción es reabrir la **última** ronda cerrada mientras no se
   haya emparejado otra.
3. **Un jugador retirado sale de los emparejamientos pero conserva sus puntos.** Retirarse
   no borra la historia de lo que ya jugó.
4. **Los byes no cuentan como rival** para Buchholz ni Sonneborn-Berger.
5. **Borrar un torneo es reversible.** El borrado normal lo envía a la papelera; un torneo en
   la papelera se comporta como inexistente para toda la API pública (no aparece en listados
   ni responde por sus jugadores, rondas o posiciones). El borrado definitivo exige que ya
   esté en la papelera: son dos acciones separadas antes de perder datos de verdad.

## Pruebas

Toda corrección de un error debería venir con una prueba que falle sin el arreglo. Una forma
práctica de comprobar que la prueba sirve: aplica la prueba, revierte tu corrección y
verifica que efectivamente falle.

- **Lógica pura** (emparejamiento, desempates): pruebas unitarias junto al módulo, como
  `server/pairing/pairing.test.ts`.
- **Endpoints**: `server/routes/routes.test.ts`, con supertest sobre `DB_PATH=":memory:"`.
  Cada prueba usa una cabecera `CF-Connecting-IP` distinta, porque el límite de intentos de
  acceso agrupa por esa cabecera y varias sesiones seguidas agotarían la cuota.

## Cambios de esquema

La base se crea y migra en `server/db.ts` al arrancar el proceso. Si necesitas cambiar el
esquema:

- Escribe la migración de forma **idempotente**: arrancar dos veces no debe fallar ni
  duplicar datos.
- **Preserva los identificadores.** Rondas y partidas referencian a los jugadores; recrear
  filas con identificadores nuevos rompe torneos ya jugados.
- Pruébala contra una copia de una base con el esquema anterior y datos reales antes de
  proponerla, no solo contra una base vacía.

## Mensajes de commit

Una primera línea corta en modo imperativo y, si el cambio lo amerita, un cuerpo que explique
**por qué**. Si corriges un error, describe el comportamiento incorrecto que tenía antes.

## Licencia

Al contribuir aceptas que tu aporte se distribuya bajo la [licencia MIT](LICENSE) del
proyecto.
