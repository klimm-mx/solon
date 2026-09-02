'use strict';

/**
 * watcherIMAP.js — Vigilante del buzón para la Función 1 (primer contacto).
 * -----------------------------------------------------------------------
 * QUÉ HACE, EN CORTO:
 *   Se queda mirando el buzón de Klimm (hola@klimm.mx). Cada 15 segundos
 *   pregunta "¿llegó correo nuevo?". Si el correo es de SUME (el proveedor de
 *   leads), lo pasa por procesarCorreoEntrante() —la MISMA función que ya
 *   probamos con los 1,547 leads reales— y el resultado (la TarjetaF1) se
 *   entrega al panel. Si el correo NO es de SUME, lo ignora.
 *
 * DÓNDE ENCAJA:
 *   Este es el "enchufe" que el módulo agente ya tenía previsto. No cambia
 *   nada aguas abajo: parseLead, la línea de IA y la plantilla siguen igual.
 *   El watcher solo aporta el DISPARO (cuándo hay un correo) y el CUERPO del
 *   correo. Patrón Solón intacto: esto NO envía WhatsApp; solo prepara la
 *   tarjeta. El envío sigue siendo el clic humano en el panel.
 *
 * DECISIONES YA CERRADAS CON EL LÍDER (sesión del panel):
 *   - Sondeo cada 15 s, constante. Render despierto siempre. (Configurable.)
 *   - Filtra por remitente: solo notificacion@sumeclientes.com.
 *   - Al encender, SOLO procesa correos NUEVOS de ahí en adelante. Los 1,547
 *     que ya están en el buzón NO se tocan (ya fueron atendidos).
 *   - Si un correo de SUME no se puede leer, el aviso viaja en la tarjeta y
 *     se pinta en el panel (parseLead ya es defensivo y explica el motivo).
 *
 * PENDIENTES CONOCIDOS (no bloquean, anotados en el maestro):
 *   - Ventana horaria opcional (ej. 06:00–22:00) si algún día se quiere que
 *     el watcher descanse de noche. Hoy: constante.
 *   - callLLM real: mientras no se inyecte, los leads con texto caen al
 *     mensaje base (sin personalización). No es error; el panel lo indica.
 *
 * LIBRERÍAS (instalar en Solón, NO en este entorno):
 *   npm install imapflow mailparser
 *   - imapflow   : cliente IMAP moderno y estable para Node.
 *   - mailparser : convierte el correo crudo (MIME) a texto limpio.
 */

const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const { procesarCorreoEntrante } = require('./f1/primerContacto');

// --- Configuración -------------------------------------------------------
// El remitente de SUME confirmado contra los 1,547 correos reales del buzón.
const REMITENTE_SUME = 'notificacion@sumeclientes.com';

// Cada cuánto preguntar por correo nuevo. 15 s = ágil y tranquilo para el
// servidor. Subir a 30000/60000 si alguna vez se quiere aflojar; bajar de
// ~5000 empieza a incomodar al servidor de correo. Una sola línea.
const INTERVALO_MS = 15 * 1000;

/**
 * crearWatcher — arma (pero no arranca) el vigilante del buzón.
 *
 * @param {object} cfg
 * @param {object} cfg.imap        Credenciales del buzón:
 *        { host, port, secure, auth: { user, pass } }
 *        Ej. Hostinger: host 'imap.hostinger.com', port 993, secure true.
 * @param {function} cfg.onTarjeta async (tarjetaF1, meta) => void
 *        Se llama por CADA lead de SUME procesado. `tarjetaF1` es lo que
 *        devuelve procesarCorreoEntrante (lo que el panel pinta). `meta` trae
 *        { uid, fecha, remitente } por si el panel quiere ordenar/mostrar.
 * @param {function} [cfg.callLLM]  async (prompt)=>string. La IA real. Si no
 *        se pasa, los leads con texto usan el mensaje base (sin línea IA).
 * @param {function} [cfg.onError]  (err, contexto) => void. Para avisos de
 *        salud (conexión caída, correo ilegible). Si no se pasa, va a consola.
 * @param {number} [cfg.intervaloMs] Sobrescribe INTERVALO_MS.
 * @param {string} [cfg.buzon]     Carpeta a vigilar (default 'INBOX').
 * @returns {{ iniciar: function, detener: function }}
 */
function crearWatcher(cfg) {
  const {
    imap,
    onTarjeta,
    callLLM,
    onError,
    intervaloMs = INTERVALO_MS,
    buzon = 'INBOX',
  } = cfg;

  if (!imap || !imap.auth) throw new Error('Falta configuración IMAP (host/auth).');
  if (typeof onTarjeta !== 'function') throw new Error('Falta onTarjeta(tarjeta, meta).');

  const avisar = typeof onError === 'function'
    ? onError
    : (err, ctx) => console.error('[watcher]', ctx || '', err && err.message ? err.message : err);

  let cliente = null;
  let corriendo = false;
  let temporizador = null;

  // "Marca de agua": el UID más alto que YA vimos. Al encender, se fija en el
  // último correo existente, de modo que SOLO se procesa lo que llegue DESPUÉS.
  // Así los 1,547 correos viejos del buzón nunca se reprocesan.
  let ultimoUidVisto = 0;

  /**
   * Conecta y fija la marca de agua en el correo más reciente actual.
   */
  async function conectar() {
    cliente = new ImapFlow({
      host: imap.host,
      port: imap.port || 993,
      secure: imap.secure !== false, // TLS por defecto
      auth: { user: imap.auth.user, pass: imap.auth.pass },
      logger: false,
    });

    await cliente.connect();
    const lock = await cliente.getMailboxLock(buzon);
    try {
      // El mailbox trae 'uidNext' = el UID que tendrá el PRÓXIMO correo.
      // Todo lo existente tiene UID < uidNext. Fijamos la marca justo ahí:
      // solo lo que llegue de ahora en adelante superará esta marca.
      const info = cliente.mailbox;
      ultimoUidVisto = (info && info.uidNext ? info.uidNext : 1) - 1;
    } finally {
      lock.release();
    }
  }

  /**
   * Una pasada de sondeo: busca correos con UID mayor a la marca de agua,
   * y de esos, procesa solo los de SUME.
   */
  async function sondear() {
    if (!cliente || !cliente.usable) {
      // Conexión caída: intentar reconectar. Este es el punto frágil del
      // IMAP; por eso avisamos si falla (chequeo de salud del maestro).
      try {
        await conectar();
      } catch (err) {
        avisar(err, 'reconexión');
        return;
      }
    }

    const lock = await cliente.getMailboxLock(buzon);
    try {
      // Traer solo lo NUEVO: UID estrictamente mayor a la marca.
      const rango = `${ultimoUidVisto + 1}:*`;
      let maxUid = ultimoUidVisto;

      for await (const msg of cliente.fetch(
        { uid: rango },
        { uid: true, envelope: true, source: true },
      )) {
        // '*' puede devolver el último aunque no sea nuevo; filtrar por UID.
        if (msg.uid <= ultimoUidVisto) continue;
        if (msg.uid > maxUid) maxUid = msg.uid;

        // ¿Es de SUME? Revisar el remitente del envelope.
        const from = msg.envelope && msg.envelope.from && msg.envelope.from[0]
          ? (msg.envelope.from[0].address || '').toLowerCase()
          : '';

        if (from !== REMITENTE_SUME) {
          // No es lead: ignorar en silencio (el buzón recibe mucho más).
          continue;
        }

        // Es lead de SUME: extraer el cuerpo y procesarlo.
        await procesarUno(msg);
      }

      // Avanzar la marca de agua tras la pasada.
      if (maxUid > ultimoUidVisto) ultimoUidVisto = maxUid;
    } catch (err) {
      avisar(err, 'sondeo');
    } finally {
      lock.release();
    }
  }

  /**
   * Convierte UN correo de SUME en TarjetaF1 y lo entrega al panel.
   * Envolver en try individual: un correo ilegible NO tumba al watcher ni
   * frena a los demás. El aviso viaja al panel.
   */
  async function procesarUno(msg) {
    try {
      // De MIME crudo a texto plano limpio (SUME manda texto/HTML simple).
      const parsed = await simpleParser(msg.source);
      const rawBody = (parsed.text && parsed.text.trim())
        ? parsed.text
        : (parsed.html || '');

      // LA MISMA función ya validada contra 1,547 leads. No se toca.
      const tarjeta = await procesarCorreoEntrante(rawBody, { callLLM });

      const meta = {
        uid: msg.uid,
        fecha: parsed.date || (msg.envelope && msg.envelope.date) || new Date(),
        remitente: REMITENTE_SUME,
      };

      await onTarjeta(tarjeta, meta);
    } catch (err) {
      // No perdemos el lead en silencio: entregamos una tarjeta mínima con
      // el aviso, para que el panel lo pinte en rojo y alguien lo revise.
      avisar(err, `correo uid=${msg.uid} ilegible`);
      try {
        await onTarjeta(
          {
            ok: false,
            mensaje: null,
            waLink: null,
            personalizado: false,
            lead: { nombre: null, empresa: null, ubicacion: null, texto: null, telefono: null },
            phone: null,
            avisos: [`No se pudo leer este correo de SUME (uid ${msg.uid}). Revisar manualmente en el buzón.`],
            bloqueoEnvio: 'Correo ilegible: el formato pudo haber cambiado. Revisar en hola@klimm.mx.',
          },
          { uid: msg.uid, fecha: new Date(), remitente: REMITENTE_SUME },
        );
      } catch (_) { /* si hasta esto falla, ya se avisó por onError */ }
    }
  }

  /**
   * iniciar — conecta y arranca el sondeo periódico.
   */
  async function iniciar() {
    if (corriendo) return;
    corriendo = true;
    try {
      await conectar();
    } catch (err) {
      avisar(err, 'conexión inicial');
      corriendo = false;
      throw err;
    }
    // Primera pasada inmediata (por si ya entró algo entre conectar y arrancar),
    // luego cada intervalo.
    const tic = async () => {
      if (!corriendo) return;
      await sondear();
      if (corriendo) temporizador = setTimeout(tic, intervaloMs);
    };
    tic();
  }

  /**
   * detener — corta el sondeo y cierra la conexión limpiamente.
   */
  async function detener() {
    corriendo = false;
    if (temporizador) { clearTimeout(temporizador); temporizador = null; }
    if (cliente && cliente.usable) {
      try { await cliente.logout(); } catch (_) { /* nada */ }
    }
    cliente = null;
  }

  return { iniciar, detener };
}

module.exports = { crearWatcher, REMITENTE_SUME, INTERVALO_MS };
