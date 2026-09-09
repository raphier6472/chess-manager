# Enroque

Gestor de torneos de ajedrez por **sistema suizo**, pensado para que una sola persona
pueda dirigir un torneo desde el celular mientras camina entre las mesas.

> El producto se llama **Enroque**. El repositorio de GitHub, el dominio público y el
> nombre del servicio systemd siguen usando `chess-manager` por razones históricas —
> es un cambio de nombre de marca, no de infraestructura.

Cubre el ciclo completo: inscribir jugadores, generar los emparejamientos de cada ronda,
cargar resultados, y publicar la tabla de posiciones con desempates y el podio final.
La interfaz está en español.

> **Estado:** en uso real para dirigir torneos. La lógica de emparejamiento y desempates
> está cubierta con pruebas automatizadas.

---

## Índice

- [Qué hace](#qué-hace)
- [Cómo funcionan los emparejamientos](#cómo-funcionan-los-emparejamientos)
- [Puesta en marcha](#puesta-en-marcha)
- [Configuración](#configuración)
- [Despliegue en producción](#despliegue-en-producción)
- [Arquitectura](#arquitectura)
- [API](#api)
- [Pruebas](#pruebas)
- [Cómo contribuir](#cómo-contribuir)
- [Licencia](#licencia)

---

## Qué hace

**Para quien dirige el torneo (organizador)**

- Crear torneos indicando fecha y cantidad de rondas (1 a 30).
- Inscribir jugadores con apellido, nombre y Elo opcional. El formulario devuelve el foco
  al campo *Apellido* después de cada alta, para poder anotar la lista sin usar el mouse.
- Editar los datos de un jugador en cualquier momento del torneo.
- Retirar a un jugador que abandona: deja de entrar en los emparejamientos, pero conserva
  los puntos que ya ganó. También se lo puede reincorporar.
- Generar los emparejamientos de cada ronda con un botón.
- Cargar resultados (1-0, ½-½, 0-1) directamente sobre cada mesa.
- **Reabrir la última ronda cerrada** para corregir un resultado mal cargado, mientras
  todavía no se haya emparejado la ronda siguiente.
- Enviar un torneo a la **papelera** en cualquier estado, y restaurarlo después. Borrar un
  torneo por accidente perdería un evento entero, así que el borrado normal es reversible;
  eliminarlo de verdad exige entrar a la papelera y confirmarlo por separado.

**Para el público (sin necesidad de entrar)**

- Ver los emparejamientos de cada ronda, con el Elo y el puntaje acumulado de cada rival.
- Consultar la tabla de posiciones con desempates.
- Ver el podio de los tres primeros cuando el torneo termina.

Las páginas de lectura son públicas: se puede compartir el enlace del torneo con los
jugadores. Todo lo que modifica datos exige haber iniciado sesión como organizador.

**Detalles de interfaz**

- Modo claro y oscuro, con conmutador y detección automática de la preferencia del sistema.
- Diseño adaptado a celular: en pantallas angostas cada mesa se apila en tres filas para
  que los nombres completos entren sin recortarse.

---

## Cómo funcionan los emparejamientos

### Primera ronda: siembra por rating (*fold*)

Es el método estándar (Harkness), el mismo que usan Swiss Manager y Vega:

1. Se ordenan los jugadores activos por Elo descendente. Los que no tienen Elo van al
   final. Los empates se resuelven alfabéticamente por **apellido** y luego por nombre.
2. La lista se parte por la mitad. El jugador *i* de la mitad superior se empareja con el
   jugador *i* de la mitad inferior: 1 contra n/2+1, 2 contra n/2+2, y así sucesivamente.
3. El color de la **mesa 1 se sortea** y a partir de ahí **alterna por mesa**: si en la
   mesa 1 el jugador de la mitad superior lleva blancas, en la mesa 2 lleva negras, en la
   mesa 3 blancas otra vez. Por eso la ronda 1 no da siempre el mismo resultado.
4. Si el número de jugadores es impar, el de menor clasificación recibe *bye* (1 punto).

### Rondas siguientes: grupos de puntaje, plegado y flotantes

A partir de la segunda ronda los jugadores se reparten en **grupos de puntaje exactos** y
los grupos se recorren de arriba hacia abajo:

1. Dentro del grupo se ordena por Elo descendente y se **pliega**: se parte el grupo en dos
   mitades y el jugador *i* de la mitad de arriba juega contra el jugador *i* de la de
   abajo.
2. Si el grupo tiene un número impar de jugadores, el de **menor Elo baja** ("flota") al
   grupo siguiente y juega contra el de **mayor Elo** que quede libre ahí. Eso puede dejar
   impar al grupo de abajo y encadenar otro flotante, y así sucesivamente.
3. Dentro de cada grupo, la combinación concreta la resuelve un **emparejamiento de peso
   máximo** con el algoritmo de Blossom (`server/pairing/blossom.ts`), la misma técnica que
   usa [Coronate](https://github.com/johnridesabike/coronate): entre todas las
   combinaciones legales elige la que más se parece al plegado ideal. Si un grupo no tiene
   ninguna combinación legal, el algoritmo **retrocede** y prueba bajar a otro jugador.

Las mesas se ordenan por grupo de puntaje y, dentro del grupo, por Elo: el jugador de mayor
Elo del grupo puntero siempre juega en la mesa 1.

#### Colores

- Se alterna el color de una ronda a la otra siempre que se pueda.
- **Nunca** se juega el mismo color tres rondas seguidas.
- La diferencia entre partidas con blancas y con negras **nunca pasa de 1**: 3B/2N es
  válido, 4B/1N no.
- Si a los dos jugadores de una mesa les toca el mismo color, se lo queda el de **mayor
  Elo** y el otro cede.

#### Bye

- Lo recibe el jugador de **menor Elo del grupo de puntaje más bajo**.
- Un jugador **nunca** recibe dos byes en el mismo torneo: si al de menor Elo ya le tocó,
  pasa al siguiente elegible, subiendo de grupo si hace falta.

#### Cuando las reglas no se pueden cumplir todas

Con pocos jugadores y muchas rondas llega un punto en que ninguna ronda cumple todo a la
vez — por ejemplo, ocho jugadores en los que los cuatro que deben negras ya se enfrentaron
con todos los que deben blancas. En esos casos las reglas se ceden **de a una y en este
orden**, y solo después de comprobar que no existe ninguna ronda que las respete:

1. Se cambia a otro jugador elegible para el bye.
2. Se cede el equilibrio de colores, para los menos jugadores posibles.
3. Se repite un emparejamiento ya jugado.
4. Solo si todo lo anterior falla, se da un segundo bye.

En simulaciones de 840 torneos con formas realistas (de 8 a 80 jugadores, de 4 a 9 rondas)
no aparece **ninguna** revancha ni ningún bye repetido; el equilibrio de colores solo se
cede en torneos de 8 jugadores que llegan a la ronda 4, donde está demostrado que no existe
alternativa.

### Desempates

La tabla de posiciones ordena por puntos y, ante igualdad, aplica en orden:

1. **Buchholz** — suma de los puntos de todos los rivales enfrentados.
2. **Sonneborn-Berger** — suma de los puntos de los rivales vencidos, más la mitad de los
   puntos de aquellos con quienes se empató.

Los *byes* no cuentan como rival para ninguno de los dos desempates.

---

## Puesta en marcha

**Requisitos:** Node.js 20 o superior (probado en 24) y npm.

```bash
git clone https://github.com/raphier6472/chess-manager.git
cd chess-manager
npm install
```

Genera el hash de la contraseña del organizador:

```bash
npm run hash-password
```

Copia la línea completa que imprime (empieza con `scrypt:`) y expórtala junto con un
secreto de sesión:

```bash
export ORGANIZER_PASSWORD_HASH='scrypt:16384:8:1:...'
export SESSION_COOKIE_SECRET="$(node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))")"
```

Levanta el backend y el frontend en dos terminales:

```bash
npm run dev:server   # API en http://localhost:3001
npm run dev          # interfaz en http://localhost:5173
```

Vite redirige `/api` al backend, así que basta con abrir la dirección de la interfaz.

> Sin `ORGANIZER_PASSWORD_HASH` la aplicación arranca igual, pero en **modo solo lectura**:
> se pueden consultar torneos, pero el acceso de organizador queda deshabilitado.

---

## Configuración

Todas las variables se leen del entorno; el proyecto **no usa dotenv**. En producción se
definen en la unidad de systemd, el gestor de procesos o el perfil del shell.
`.env.example` documenta cada una.

| Variable | Obligatoria | Por defecto | Para qué sirve |
|---|---|---|---|
| `ORGANIZER_PASSWORD_HASH` | Sí, para poder editar | — | Hash scrypt de la contraseña del organizador. Se genera con `npm run hash-password`. Pégalo completo y en una sola línea: si el valor queda cortado, el servidor lo detecta al arrancar, avisa por consola y deja el acceso deshabilitado. |
| `ORGANIZER_NAME` | No | — | Nombre que se muestra en la interfaz mientras hay sesión de organizador activa. Sin ella, se muestra solo "Organizador". |
| `SESSION_COOKIE_SECRET` | Sí, en producción | secreto efímero | Firma la cookie de sesión. Si falta, se genera uno en memoria y las sesiones no sobreviven a un reinicio. |
| `SESSION_TTL_HOURS` | No | `12` | Duración de la sesión, renovada mientras haya actividad. |
| `PORT` | No | `3001` | Puerto del servidor. |
| `DATA_DIR` | No | `./data` | Carpeta de la base SQLite. |
| `DB_PATH` | No | `$DATA_DIR/chess-manager.db` | Ruta explícita del archivo. Acepta `:memory:`, que es lo que usan las pruebas. |
| `NODE_ENV` | No | — | Con `production` el servidor también sirve la interfaz compilada y marca la cookie como `secure`. |

> **Sobre `NODE_ENV=production` y HTTPS:** la cookie de sesión se emite con la bandera
> `secure`, así que el navegador solo la envía por HTTPS. Si publicas el sitio detrás de un
> proxy con TLS (Cloudflare Tunnel, nginx, Caddy) funciona sin más. Si intentas usar el modo
> producción por HTTP plano, el inicio de sesión no va a persistir.

---

## Despliegue en producción

Estos comandos describen cómo arranca el proceso en el servidor. Para llevar un cambio nuevo
hasta ahí (build + sincronizar + reiniciar + verificar), usar `./deploy.sh` desde el checkout
principal, en `main` y sin cambios sin commitear — hace las cuatro cosas en un solo paso y
compara el bundle que acaba de compilar contra el que producción efectivamente sirve, en vez de
asumir que el deploy funcionó por un `curl` a `/api/*`.

```bash
npm ci
npm run build          # compila la interfaz en dist/
NODE_ENV=production npm start
```

Con `NODE_ENV=production` un solo proceso sirve la API y la interfaz compilada, así que no
hace falta un servidor web aparte.

Unidad de systemd de referencia:

```ini
[Unit]
Description=Chess Manager
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/chess-manager
Environment=NODE_ENV=production
Environment=PORT=3001
Environment=DATA_DIR=/opt/chess-manager-data
Environment=ORGANIZER_PASSWORD_HASH=scrypt:...
Environment=SESSION_COOKIE_SECRET=...
ExecStart=/opt/chess-manager/node_modules/.bin/tsx server/index.ts
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

### Copias de seguridad

Todo el torneo vive en un único archivo SQLite (`$DATA_DIR/chess-manager.db`). Para
respaldarlo con el servicio detenido basta con copiar ese archivo. Si el servicio está
corriendo, la base usa modo WAL: consolida primero los cambios pendientes.

```bash
node -e "const D=require('better-sqlite3');const db=new D(process.argv[1]);db.pragma('wal_checkpoint(FULL)');db.close()" \
  /opt/chess-manager-data/chess-manager.db
cp /opt/chess-manager-data/chess-manager.db respaldo-$(date +%F).db
```

---

## Arquitectura

```
server/
  app.ts            construcción de la aplicación Express (importable desde las pruebas)
  index.ts          punto de entrada: crea la app y escucha
  db.ts             SQLite (better-sqlite3), esquema y migraciones al arrancar
  auth/             hash scrypt de contraseñas y sesiones en base
  middleware/       requireAuth y opciones de la cookie
  pairing/          algoritmo suizo: siembra inicial, grupos de puntaje, colores y Blossom
  scoring/          puntajes y desempates
  routes/           endpoints REST y sus pruebas
shared/types.ts     tipos compartidos entre servidor e interfaz
src/                interfaz React (Vite, React Router)
```

**Decisiones que conviene conocer antes de tocar el código**

- **SQLite embebido, sin ORM.** Todas las consultas usan sentencias preparadas con
  marcadores `?`. Un torneo entero es un archivo; no hay servicio de base que administrar.
- **Migraciones al arrancar.** `server/db.ts` crea el esquema y aplica las migraciones
  necesarias cuando el proceso inicia. Son idempotentes: arrancar dos veces no rompe nada.
- **Un solo rol.** No hay usuarios: hay una contraseña de organizador. Todo lo que escribe
  exige sesión; todo lo que lee es público.
- **La interfaz nunca es la única defensa.** Cada regla (no cambiar resultados de una ronda
  cerrada, no reabrir una ronda que ya tiene otra posterior) se valida **en el servidor**.
  Ocultar un botón es comodidad, no seguridad.

**Seguridad**

- Contraseña con scrypt y comparación en tiempo constante.
- Tokens de sesión guardados hasheados con SHA-256; la cookie es `httpOnly`, firmada,
  `sameSite=lax` y `secure` en producción.
- Límite de intentos de acceso: 5 fallos cada 15 minutos. Los ingresos correctos **no**
  consumen cuota, para que quien dirige el torneo no pueda bloquearse a sí mismo.
- Cabeceras de seguridad con helmet, incluida una CSP con `script-src 'self'`.

---

## API

Base: `/api`. Los endpoints marcados con 🔒 exigen sesión de organizador.

| Método | Ruta | Qué hace |
|---|---|---|
| `POST` | `/auth/login` | Inicia sesión. Cuerpo: `{ password }`. |
| `POST` | `/auth/logout` | Cierra la sesión. |
| `GET` | `/auth/me` | Indica si la sesión está activa. |
| `GET` | `/tournaments` | Lista los torneos. |
| `POST` | 🔒 `/tournaments` | Crea un torneo. Cuerpo: `{ name, date, numRounds }`. |
| `GET` | `/tournaments/:id` | Datos de un torneo. |
| `DELETE` | 🔒 `/tournaments/:id` | Envía el torneo a la papelera (reversible). |
| `GET` | 🔒 `/tournaments-papelera` | Lista los torneos en la papelera. |
| `POST` | 🔒 `/tournaments/:id/restaurar` | Saca el torneo de la papelera. |
| `DELETE` | 🔒 `/tournaments/:id/definitivo` | Borra el torneo y todo su contenido. Solo si ya está en la papelera. |
| `GET` | `/tournaments/:id/standings` | Posiciones con Buchholz y Sonneborn-Berger. |
| `GET` | `/tournaments/:id/players` | Lista de inscritos. |
| `POST` | 🔒 `/tournaments/:id/players` | Inscribe un jugador. Cuerpo: `{ lastName, firstName?, rating? }`. |
| `PATCH` | 🔒 `/players/:id` | Modifica nombre, Elo o estado de retiro. |
| `DELETE` | 🔒 `/players/:id` | Quita un jugador; solo antes de que empiece el torneo. |
| `GET` | `/tournaments/:id/rounds` | Rondas con sus mesas. |
| `POST` | 🔒 `/tournaments/:id/rounds/generate` | Genera los emparejamientos de la ronda siguiente. |
| `POST` | 🔒 `/matches/:id/result` | Carga un resultado. Cuerpo: `{ result: "white" \| "black" \| "draw" }`. |
| `POST` | 🔒 `/rounds/:id/complete` | Cierra la ronda. |
| `POST` | 🔒 `/rounds/:id/reopen` | Reabre la última ronda cerrada para corregir un resultado. |

Los errores devuelven `{ "error": "mensaje" }` con el código HTTP correspondiente
(400 datos inválidos, 401 sin sesión, 404 no encontrado, 409 conflicto de estado).
Los mensajes están en español y se muestran tal cual en la interfaz.

---

## Pruebas

```bash
npm test       # pruebas unitarias y de endpoints
npm run lint   # oxlint
npm run build  # verificación de tipos y compilación
```

Las pruebas cubren dos niveles:

- **Unitarias** sobre la lógica pura: siembra inicial, reglas de color, grupos de puntaje,
  flotantes, bye, Blossom y desempates. Incluyen torneos completos simulados con
  resultados deterministas, que verifican las reglas después de **cada** ronda.
- **De endpoints** (`server/routes/routes.test.ts`) con supertest sobre una base
  `:memory:`, sin tocar el disco. Verifican, entre otras cosas, que las escrituras exijan
  sesión, que no se pueda alterar una ronda ya cerrada y que el límite de intentos no se
  pueda evadir falsificando cabeceras.

---

## Cómo contribuir

Las contribuciones son bienvenidas. Lee [CONTRIBUTING.md](CONTRIBUTING.md) para el flujo de
trabajo, el estilo de código y qué se espera de un *pull request*.

Áreas donde una mejora rinde especialmente:

- **Reglas FIDE de emparejamiento.** Ya hay grupos de puntaje exactos, plegado por Elo,
  flotantes y restricciones de color estrictas, pero no es el sistema holandés completo:
  faltan, entre otras, las reglas de flotante repetido entre rondas consecutivas.
- **Más desempates.** Progresivo acumulativo, Koya, cantidad de partidas con negras.
- **Exportar e imprimir.** Publicar planillas de emparejamientos y posiciones en PDF.
- **Traducciones.** La interfaz está en español y los textos hoy están dentro de los
  componentes; el primer paso sería extraerlos.

---

## Licencia

[MIT](LICENSE).

### Código de terceros

`server/pairing/blossom.ts` es una adaptación a TypeScript de la función
`max_weight_matching` de [NetworkX](https://networkx.org/), distribuida por los
NetworkX Developers bajo licencia
[BSD-3-Clause](https://github.com/networkx/networkx/blob/main/LICENSE.txt). Esa licencia es
compatible con MIT y exige conservar el aviso de copyright, que se mantiene en la cabecera
del archivo. El algoritmo original se apoya en el trabajo de Zvi Galil (*Efficient
Algorithms for Finding Maximum Matching in Graphs*, ACM Computing Surveys, 1986) y en la
implementación de referencia de Joris van Rantwijk.

Si reutilizas este proyecto, conserva ese archivo con su cabecera intacta.
