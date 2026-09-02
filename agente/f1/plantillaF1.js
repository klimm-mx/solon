'use strict';

/**
 * plantillaF1.js — Tono destilado del corpus (Función 1: primer contacto)
 * -----------------------------------------------------------------------
 * El mensaje ACTUAL de primer contacto convierte al 99.8% (839/841 en el
 * corpus). NO se reescribe. Esta plantilla replica su patrón, verificado:
 *
 *   - De usted (nunca tuteo).
 *   - Disposición inmediata: "con gusto le cotizamos" / "le comparto".
 *   - No pregunta lo que el lead ya dijo.
 *   - Presentación de Klimm + puente a la acción.
 *
 * La ÚNICA parte variable que produce la IA es `lineaTexto`: una sola línea
 * que refleja lo que el lead pidió en su `Texto`. Todo lo demás es fijo.
 *
 * Regla dura de coherencia: si un campo (nombre, empresa, lineaTexto) es
 * null/vacío, la frase que lo usaría DESAPARECE completa. Nunca queda un
 * hueco visible ("Buen día, ." / "sobre su interés en .").
 *
 * Este archivo NO llama a la IA ni parsea nada. Solo ensambla texto a partir
 * de piezas ya limpias. Es determinista y testeable en aislamiento.
 */

/**
 * Construye el saludo de apertura.
 * @param {string|null} primerNombre  Ya validado por el parser (o null).
 * @returns {string}
 */
function construirSaludo(primerNombre) {
  // Con nombre usable: "Buen día, Francisco."
  // Sin nombre: "Buen día." — arranque natural, sin hueco.
  if (primerNombre) {
    return `Buen día, ${primerNombre}.`;
  }
  return 'Buen día.';
}

/**
 * Línea de presentación de Klimm. Fija (parte del 99.8%).
 * @returns {string}
 */
function construirPresentacion() {
  return 'Le escribo de la empresa Klimm.';
}

/**
 * Cuerpo de disposición inmediata. Fijo. Es el núcleo que convierte.
 * NO pregunta nada que el lead ya haya dicho; ofrece la acción.
 * @returns {string}
 */
function construirDisposicion() {
  return 'Con gusto le atiendo y le comparto la información que necesita.';
}

/**
 * Ensambla el mensaje final a partir de piezas ya limpias.
 *
 * @param {object} piezas
 * @param {string|null} piezas.primerNombre  Del parser (saludo.primerNombre).
 * @param {string|null} piezas.lineaTexto    Línea IA que refleja el Texto, o null.
 * @returns {string}  Mensaje listo para precargar en wa.me.
 */
function ensamblarMensaje({ primerNombre, lineaTexto }) {
  const partes = [];

  partes.push(construirSaludo(primerNombre));
  partes.push(construirPresentacion());

  // Si hay línea que refleja el Texto del lead, va ANTES de la disposición:
  // primero "entendí lo que pidió", luego "con gusto se lo atiendo".
  if (lineaTexto && lineaTexto.trim()) {
    partes.push(lineaTexto.trim());
  }

  partes.push(construirDisposicion());

  // Un espacio entre frases; el mensaje va en una sola burbuja de WhatsApp.
  return partes.join(' ');
}

module.exports = {
  construirSaludo,
  construirPresentacion,
  construirDisposicion,
  ensamblarMensaje,
};
