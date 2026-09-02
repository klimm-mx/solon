'use strict';

/**
 * plantillaF1.js — Mensaje de primer contacto de Klimm (Función 1).
 * ----------------------------------------------------------------
 * Anclado en el mensaje REAL que usa Klimm (convierte muy alto) + reglas de
 * negocio confirmadas con el líder sobre 50 leads reales de SUME:
 *
 *   TONO: de usted, consistente (el original mezclaba tú/usted; se unifica).
 *   REGLA DURA: NO existe lista de precios. El catálogo es una liga a la web
 *     con productos SIN precio. Para dar precio hay que COTIZAR. Por eso el
 *     mensaje nunca promete "lista de precios"; encamina a cotización.
 *   CIERRE CONDICIONAL:
 *     - Con Texto usable  -> línea IA que refleja el pedido y encamina a
 *       cotización, haciendo ESPEJO de la palabra del lead ("cotización" si
 *       él la usó; verbo neutro si no). La produce redactarLineaTexto.js.
 *     - Sin Texto usable  -> la PREGUNTA original de Klimm, literal.
 *
 * Coherencia: si falta el nombre, el saludo arranca sin él ("Buen día.")
 * sin dejar hueco. Nunca sale "Buen día, ." ni frases colgando.
 *
 * Este archivo es determinista: ensambla piezas ya limpias. No llama a la IA
 * ni parsea. La única parte variable (lineaTexto) llega ya redactada.
 */

// La pregunta original de Klimm, para cuando el lead NO escribió qué quiere.
// Es el cierre que ya convierte; se usa TAL CUAL (plural, como el original).
const PREGUNTA_VACIO =
  '¿En qué productos están interesados, para poder entregarles una propuesta?';

/**
 * Saludo de apertura. Con nombre usable: "Buen día, Francisco.".
 * Sin nombre: "Buen día." (arranque natural, sin hueco).
 * @param {string|null} primerNombre
 * @returns {string}
 */
function construirSaludo(primerNombre) {
  return primerNombre ? `Buen día, ${primerNombre}.` : 'Buen día.';
}

// Presentación fija de Klimm (parte del mensaje que convierte).
function construirPresentacion() {
  return 'Le escribo de la empresa Klimm.';
}

/**
 * Ensambla el mensaje final.
 *
 * @param {object} piezas
 * @param {string|null} piezas.primerNombre  Del parser (saludo.primerNombre).
 * @param {string|null} piezas.lineaTexto    Línea IA (refleja el pedido), o null.
 * @returns {string}  Mensaje listo para wa.me.
 *
 * Estructura:
 *   [saludo] [presentacion] [linea IA  |  pregunta original]
 */
function ensamblarMensaje({ primerNombre, lineaTexto }) {
  const partes = [construirSaludo(primerNombre), construirPresentacion()];

  if (lineaTexto && lineaTexto.trim()) {
    partes.push(lineaTexto.trim());
  } else {
    partes.push(PREGUNTA_VACIO);
  }

  return partes.join(' ');
}

module.exports = {
  construirSaludo,
  construirPresentacion,
  ensamblarMensaje,
  PREGUNTA_VACIO,
};
