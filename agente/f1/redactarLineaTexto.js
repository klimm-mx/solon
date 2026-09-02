'use strict';

/**
 * redactarLineaTexto.js — La ÚNICA parte de F1 que usa IA.
 * --------------------------------------------------------
 * Toma el `Texto` que el lead escribió en la landing (lo que pidió, con sus
 * palabras) y produce UNA sola línea que refleje ese pedido, para insertarla
 * en la plantilla de tono. No redacta el mensaje completo: el saludo, la
 * presentación y la disposición son plantilla fija (plantillaF1.js).
 *
 * Por qué así: el mensaje base convierte al 99.8%. La IA no lo reescribe;
 * solo agrega la señal de "sí, entendí lo que pidió". Menos superficie de
 * error, tono blindado, menos créditos.
 *
 * Diseño defensivo (hereda la filosofía del parser):
 *   - Si NO hay Texto usable -> devuelve null (la plantilla usa solo el base).
 *   - Si la IA falla, tarda, o devuelve algo que viola el tono -> null.
 *   - null NUNCA es un error fatal: significa "manda el mensaje base", que
 *     por sí solo ya convierte. Personalizar es mejora, no requisito.
 *
 * La llamada real a la API se inyecta (callLLM) para poder testear sin red
 * y para no acoplar este archivo a un SDK concreto.
 */

// Texto que no vale la pena reflejar: genérico, vacío, o ruido.
// Si el lead solo puso "info" o "cotización", no hay nada que personalizar;
// el mensaje base de disposición inmediata ya cubre eso.
// Solo lo VERDADERAMENTE vacío de intención cae aquí (usa la pregunta original).
// Nota: "cotización", "catálogo", "precios" YA NO son genéricos — expresan una
// intención clara que la línea IA puede reflejar y encaminar a cotización.
const TEXTO_GENERICO = new Set([
  'info', 'informacion', 'información', 'informes',
  'hola', 'buenas', 'buenos dias', 'buenos días', 'buenas tardes',
  'interesado', 'interesada', 'mas informacion', 'más información',
]);

/**
 * ¿El Texto del lead tiene sustancia suficiente para reflejar?
 * @param {string|null} texto
 * @returns {boolean}
 */
function textoEsUsable(texto) {
  if (!texto || typeof texto !== 'string') return false;
  const t = texto.trim().toLowerCase();
  if (t.length < 4) return false;                 // "ok", "sí"
  if (TEXTO_GENERICO.has(t)) return false;        // genéricos exactos
  // Debe tener al menos una palabra de contenido (>=4 letras).
  if (!/[a-záéíóúñ]{4,}/i.test(t)) return false;
  return true;
}

/**
 * Guardarraíl de tono: rechaza salidas de la IA que violen las reglas duras.
 * Devuelve true si la línea es ACEPTABLE.
 *
 * Reglas:
 *   - No preguntar lo que el lead ya dijo (nada que termine en '?' ni que
 *     empiece con interrogativos: qué/cuál/cuándo/cuánto/dónde/cómo).
 *   - No tutear (rechaza "tú", "te ", "tu ", "tienes", "quieres", "necesitas").
 *   - Una sola línea, breve (evita que la IA escriba un párrafo).
 * @param {string} linea
 * @returns {boolean}
 */
function lineaRespetaTono(linea) {
  if (!linea || typeof linea !== 'string') return false;
  const l = linea.trim();
  if (l.length === 0 || l.length > 160) return false;   // ni vacío ni párrafo
  if (l.includes('\n')) return false;                   // una sola línea

  // No preguntas (el lead ya dijo lo que quería; no re-preguntar).
  if (l.includes('?') || l.includes('¿')) return false;
  if (/^\s*(qué|que|cuál|cual|cuándo|cuando|cuánto|cuanto|dónde|donde|cómo|como)\b/i.test(l)) {
    return false;
  }

  // No tuteo (el tono es de usted).
  if (/\b(tú|tu|te|tienes|quieres|necesitas|puedes|tuyo|tuya|contigo)\b/i.test(l)) {
    return false;
  }

  return true;
}

/**
 * Prompt para la IA. Estricto a propósito: una línea, de usted, que refleje
 * el pedido sin re-preguntarlo ni prometer precios concretos.
 * @param {string} texto  El Texto del lead (usable).
 * @returns {string}
 */
function construirPrompt(texto) {
  return [
    'Eres el redactor de primer contacto de Klimm (distribuidora de productos',
    'de limpieza e insumos). Un prospecto llegó por la landing y escribió lo',
    'que necesita. Tu tarea: redactar UNA sola línea, breve y natural, que',
    'refleje que entendiste lo que pidió y lo encamine, para insertarla en un',
    'mensaje de WhatsApp de primer contacto.',
    '',
    'Reglas duras del negocio:',
    '- De usted. Nunca tutees.',
    '- NO hagas preguntas. El prospecto ya dijo lo que quiere; no se lo vuelvas a preguntar.',
    '- Klimm NO tiene lista de precios. El catálogo es una liga a la web SIN precios.',
    '  Para dar precio se hace una COTIZACIÓN. Por eso NUNCA prometas "lista de',
    '  precios" ni "le envío precios". Si pide precios, encamina a cotización.',
    '- Puedes ofrecer compartir el catálogo (la liga) y preparar una cotización.',
    '- ESPEJO: si el prospecto usó la palabra "cotizar/cotización", úsala tú también.',
    '  Si NO la usó, encamina con un verbo neutro ("con gusto le atiendo",',
    '  "le preparo lo que necesita") sin forzar la palabra cotización.',
    '- NO prometas plazos ni existencias concretas (no los sabes).',
    '- NO saludes ni te presentes (eso ya está en el mensaje).',
    '- Una sola línea, máximo ~22 palabras. Sin saltos de línea.',
    '- Refleja el producto o necesidad tal como lo dijo, pero con tu redacción',
    '  limpia (no copies sus mayúsculas ni sus faltas de ortografía).',
    '',
    'Ejemplos:',
    'Pedido: "Saber el mayoreo de escobas, mechudos y palos de metal"',
    'Línea: "Veo que le interesan escobas, mechudos y palos de metal; con gusto le preparo una cotización."',
    '',
    'Pedido: "quisiera cotizar un listado de 39 artículos"',
    'Línea: "Veo que requiere cotizar un listado de artículos; con gusto lo reviso y le preparo su cotización."',
    '',
    'Pedido: "Quiero catalogo o precios de mayoreo"',
    'Línea: "Con gusto le comparto el catálogo y le preparo una cotización de lo que necesite."',
    '',
    `Pedido: "${texto.trim()}"`,
    'Línea:',
  ].join('\n');
}

/**
 * redactarLineaTexto — produce la línea de reflejo, o null.
 *
 * @param {string|null} texto        El campo `Texto` del lead (fields.texto).
 * @param {object} opts
 * @param {function} opts.callLLM    async (prompt) => string. Inyectado.
 * @param {number} [opts.timeoutMs]  Corte de tiempo (default 8000).
 * @returns {Promise<{ linea: string|null, motivo: string }>}
 *          `linea` = null significa "usa solo el mensaje base" (no es error).
 *          `motivo` explica por qué (para logs/panel, no para el cliente).
 */
async function redactarLineaTexto(texto, opts = {}) {
  const { callLLM, timeoutMs = 8000 } = opts;

  if (!textoEsUsable(texto)) {
    return { linea: null, motivo: 'texto-no-usable' };
  }
  if (typeof callLLM !== 'function') {
    return { linea: null, motivo: 'sin-callLLM' };
  }

  let salida;
  try {
    salida = await withTimeout(callLLM(construirPrompt(texto)), timeoutMs);
  } catch (err) {
    return { linea: null, motivo: `error-ia:${err && err.message ? err.message : 'desconocido'}` };
  }

  const linea = (salida || '')
    .toString()
    .trim()
    .replace(/^["'«»]+|["'«»]+$/g, '')   // quitar comillas envolventes
    .replace(/\s+/g, ' ');

  if (!lineaRespetaTono(linea)) {
    // La IA devolvió algo que viola el tono -> descartar, usar base.
    return { linea: null, motivo: 'viola-tono' };
  }

  return { linea, motivo: 'ok' };
}

/**
 * Corta una promesa si tarda demasiado. Protege el reloj de R1:
 * más vale mandar el mensaje base ya que esperar a la IA.
 */
function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    Promise.resolve(promise).then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

module.exports = {
  redactarLineaTexto,
  textoEsUsable,
  lineaRespetaTono,
  construirPrompt,
};
