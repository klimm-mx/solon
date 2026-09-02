'use strict';

/**
 * primerContacto.js — Orquestador de la Función 1 (primer contacto R1).
 * --------------------------------------------------------------------
 * Encadena las piezas de F1 en el orden del "diario":
 *
 *   correo (rawBody)
 *     -> parseLead()            [campos limpios: saludo, phone, texto]
 *     -> redactarLineaTexto()   [IA: 1 línea que refleja el Texto, o null]
 *     -> ensamblarMensaje()     [plantilla de tono + línea; coherente siempre]
 *     -> objeto TarjetaF1        [listo para pintar en el panel + botón wa.me]
 *
 * Patrón Solón respetado: esta pieza NO envía nada. Produce un borrador y el
 * link wa.me; el envío es un CLIC HUMANO en el panel. Superficie con Meta = 0.
 *
 * === EL ENCHUFE DEL WATCHER IMAP ===
 * `procesarCorreoEntrante(rawBody, deps)` es el único punto de entrada. Hoy
 * lo llamas a mano (o los tests) pasándole el cuerpo de un correo. Mañana, el
 * watcher IMAP —cuando se construya junto al panel— llamará EXACTAMENTE esta
 * misma función con el cuerpo del correo que reciba. No cambia nada aguas
 * abajo: el watcher solo aporta el disparo y el rawBody.
 */

const { parseLead } = require('./parseLead');
const { redactarLineaTexto } = require('./redactarLineaTexto');
const { ensamblarMensaje } = require('./plantillaF1');

/**
 * Construye el link wa.me con el mensaje precargado.
 * @param {string} waNumber  Dígitos con país, sin '+', del parser (phone.waNumber).
 * @param {string} mensaje   Mensaje final.
 * @returns {string|null}    URL, o null si no hay número usable.
 */
function construirLinkWaMe(waNumber, mensaje) {
  if (!waNumber) return null;
  return `https://wa.me/${waNumber}?text=${encodeURIComponent(mensaje)}`;
}

/**
 * procesarCorreoEntrante — ENCHUFE del watcher IMAP y punto de prueba manual.
 *
 * @param {string} rawBody   Cuerpo del correo de SUME (texto plano o HTML simple).
 * @param {object} [deps]
 * @param {function} [deps.callLLM]   async (prompt)=>string. Si falta, no hay
 *                                    personalización (usa solo mensaje base).
 * @param {number} [deps.timeoutMs]   Corte de tiempo de la IA.
 * @returns {Promise<TarjetaF1>}
 *
 * TarjetaF1 = {
 *   ok,                // ¿se puede dar el clic de envío? (tel válido)
 *   mensaje,           // texto final, coherente pase lo que pase
 *   waLink,            // link wa.me listo, o null si no hay tel
 *   personalizado,     // ¿la IA aportó línea de reflejo?
 *   lead: {            // resumen para pintar la tarjeta
 *     nombre, empresa, ubicacion, texto, telefono
 *   },
 *   phone,             // objeto phone del parser (para el panel)
 *   avisos,            // warnings del parser + motivo de redacción (para el líder)
 *   bloqueoEnvio,      // razón si NO se puede enviar, o null
 * }
 */
async function procesarCorreoEntrante(rawBody, deps = {}) {
  const { callLLM, timeoutMs } = deps;

  // 1) Parseo (pieza aislada, ya probada contra 5 escenarios).
  const parsed = parseLead(rawBody);

  // 2) Redacción de la línea de reflejo (única parte IA). Nunca fatal.
  const { linea, motivo } = await redactarLineaTexto(parsed.fields.texto, {
    callLLM,
    timeoutMs,
  });

  // 3) Ensamblado del mensaje. Coherente aunque falten nombre/empresa/texto.
  const mensaje = ensamblarMensaje({
    primerNombre: parsed.saludo ? parsed.saludo.primerNombre : null,
    lineaTexto: linea,
  });

  // 4) Link wa.me (solo si hay teléfono usable).
  const waLink = parsed.phone.ok
    ? construirLinkWaMe(parsed.phone.waNumber, mensaje)
    : null;

  // 5) Motivo de bloqueo de envío, explícito para el panel.
  let bloqueoEnvio = null;
  if (!parsed.phone.ok) {
    bloqueoEnvio = parsed.fields.telefono
      ? `Teléfono con formato inesperado ("${parsed.fields.telefono}"). Revisar antes de enviar.`
      : 'No llegó teléfono en el correo. No se puede iniciar el WhatsApp.';
  }

  return {
    ok: parsed.ok,                          // tel válido presente
    mensaje,
    waLink,
    personalizado: linea !== null,
    lead: {
      nombre: parsed.fields.nombre || null,
      empresa: parsed.fields.empresa || null,
      ubicacion: parsed.fields.ubicacion || null,
      texto: parsed.fields.texto || null,
      telefono: parsed.fields.telefono || null,
    },
    phone: parsed.phone,
    avisos: [
      ...parsed.warnings,
      motivo !== 'ok' && motivo !== 'texto-no-usable'
        ? `Redacción: sin personalización (${motivo}); se usó el mensaje base.`
        : null,
    ].filter(Boolean),
    bloqueoEnvio,
  };
}

module.exports = { procesarCorreoEntrante, construirLinkWaMe };
