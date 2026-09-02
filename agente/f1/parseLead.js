'use strict';

/**
 * parseLead.js — Módulo `agente` de Solón (Función 1: primer contacto)
 * -------------------------------------------------------------------
 * Pieza AISLADA. Su única responsabilidad es tomar el cuerpo de un correo
 * de notificación de lead (proveedor de marketing "SUME Clientes") y
 * devolver los campos estructurados. NO escribe en base de datos, NO llama
 * a la IA, NO envía nada. Solo parsea y reporta.
 *
 * Diseño defensivo: si un campo esperado falta o el formato cambió, el lead
 * NO se descarta en silencio — se devuelve lo que se pudo extraer y una lista
 * de `warnings` para que la capa superior decida (mostrar en panel con aviso,
 * alertar al líder, etc.). El proveedor puede cambiar el formato sin avisar.
 */

// --- Etiquetas conocidas del correo actual (SUME Clientes) --------------
// Mapa: clave interna -> lista de etiquetas aceptadas (en orden de preferencia).
// Si el proveedor renombra una etiqueta, se agrega aquí sin tocar la lógica.
const FIELD_LABELS = {
  nombre:    ['Nombre Completo', 'Nombre completo', 'Nombre'],
  telefono:  ['Teléfono', 'Telefono', 'Tel'],
  correo:    ['Correo electronico', 'Correo electrónico', 'Correo', 'Email'],
  empresa:   ['Nombre de la empresa', 'Empresa'],
  ubicacion: ['Ubicación', 'Ubicacion'],
  texto:     ['Texto', 'Mensaje', 'Comentarios'],
  fuente:    ['Fuente de suscripción', 'Fuente de suscripcion', 'Fuente'],
};

// Campos sin los cuales NO se puede dar primer contacto por WhatsApp.
// Nota: el nombre NO es requerido para actuar — si es basura, se redacta
// sin dirigirse a nadie. Solo el teléfono bloquea el envío.
const REQUIRED = ['telefono'];

/**
 * ¿Este valor es un nombre/empresa REAL y usable para saludar?
 * Rechaza: vacío, null, una sola letra, un punto o signos, iniciales sueltas
 * ("A.", "J J"), o ruido sin vocales ("xdfg"). Es deliberadamente conservador:
 * ante la duda, mejor NO saludar por nombre que saludar con basura.
 * @returns {boolean}
 */
function isUsableName(value) {
  if (!value || typeof value !== 'string') return false;
  const v = value.trim();
  if (v.length < 2) return false;                       // "a", ".", "-"
  const letters = (v.match(/[A-Za-zÁÉÍÓÚáéíóúÑñ]/g) || []).length;
  if (letters < 2) return false;                        // ".", "5534", "J.", "- -"
  // Debe tener al menos una vocal (filtra ruido tipo "xdfg", "qwrt").
  if (!/[AEIOUÁÉÍÓÚaeiouáéíóú]/.test(v)) return false;
  // Debe contener al menos una "palabra" de 2+ letras seguidas.
  if (!/[A-Za-zÁÉÍÓÚáéíóúÑñ]{2,}/.test(v)) return false; // filtra "J J", "A B"
  return true;
}

/**
 * Normaliza el cuerpo del correo a texto plano línea por línea.
 * Acepta tanto texto plano como un HTML simple (quita etiquetas).
 */
function toPlainLines(raw) {
  if (typeof raw !== 'string') return [];
  let text = raw;

  // Si viene como HTML, colapsar etiquetas de bloque a saltos de línea
  // y quitar el resto de etiquetas, para que "Etiqueta: valor" sobreviva.
  if (/<[a-z][\s\S]*>/i.test(text)) {
    text = text
      .replace(/<\s*(br|\/p|\/div|\/tr|\/li|\/h[1-6])\s*>/gi, '\n')
      .replace(/<[^>]+>/g, '')       // quitar etiquetas restantes
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&aacute;/gi, 'á').replace(/&eacute;/gi, 'é')
      .replace(/&iacute;/gi, 'í').replace(/&oacute;/gi, 'ó')
      .replace(/&uacute;/gi, 'ú').replace(/&ntilde;/gi, 'ñ');
  }

  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

/**
 * Busca el valor de una etiqueta dentro de las líneas.
 * Soporta "Etiqueta: valor" en la misma línea, y también el caso en que el
 * valor viene en la(s) línea(s) siguiente(s) (etiqueta sola en su línea).
 * Devuelve { value, lineIndex } o null.
 */
function findByLabels(lines, labels) {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const label of labels) {
      // Coincidencia de etiqueta al inicio de la línea, seguida de ':'
      const re = new RegExp('^' + escapeRegExp(label) + '\\s*:\\s*(.*)$', 'i');
      const m = line.match(re);
      if (m) {
        let value = m[1].trim();
        // Etiqueta sola: el valor está en las siguientes líneas no-etiqueta.
        if (value === '') {
          const collected = [];
          for (let j = i + 1; j < lines.length; j++) {
            if (looksLikeLabel(lines[j])) break;
            collected.push(lines[j]);
          }
          value = collected.join(' ').trim();
        }
        return { value, lineIndex: i };
      }
    }
  }
  return null;
}

// ¿La línea parece ser "Etiqueta: ..."? (para saber dónde termina un valor multilínea)
function looksLikeLabel(line) {
  return /^[A-Za-zÁÉÍÓÚáéíóúÑñ ]{2,40}\s*:/.test(line);
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// --- Normalizadores de valor -------------------------------------------

/**
 * Normaliza un teléfono mexicano a dígitos y produce el formato E.164 para wa.me
 * (México: prefijo 52, sin el '1' antiguo). Devuelve { raw, digits, e164, waNumber, ok }.
 * NO inventa: si no logra un número plausible, ok=false y lo reporta.
 */
function normalizePhoneMX(rawPhone) {
  const out = { raw: rawPhone || '', digits: '', e164: '', waNumber: '', ok: false };
  if (!rawPhone) return out;

  let d = String(rawPhone).replace(/\D+/g, ''); // solo dígitos
  out.digits = d;

  // Quitar 00 internacional o + ya removido por \D
  if (d.startsWith('00')) d = d.slice(2);

  // Casos:
  // 10 dígitos -> número nacional MX sin lada país: anteponer 52
  // 12 dígitos con 52 -> ya trae país
  // 13 dígitos con 521 -> formato viejo; quitar el 1 tras el 52
  if (d.length === 10) {
    d = '52' + d;
  } else if (d.length === 12 && d.startsWith('52')) {
    // ok
  } else if (d.length === 13 && d.startsWith('521')) {
    d = '52' + d.slice(3);
  } else {
    // Longitud inesperada: reportar sin romper.
    out.e164 = d ? '+' + d : '';
    out.waNumber = d;
    out.ok = false;
    return out;
  }

  out.e164 = '+' + d;
  out.waNumber = d; // wa.me usa dígitos sin '+'
  out.ok = d.length === 12;
  return out;
}

// --- API principal ------------------------------------------------------

/**
 * parseLead(rawBody) -> objeto estructurado.
 * @param {string} rawBody  Cuerpo del correo (texto plano o HTML simple).
 * @returns {{
 *   ok: boolean,
 *   fields: object,
 *   phone: object,
 *   warnings: string[],
 *   missingRequired: string[]
 * }}
 */
function parseLead(rawBody) {
  const warnings = [];
  const lines = toPlainLines(rawBody);

  if (lines.length === 0) {
    return {
      ok: false,
      fields: {},
      phone: normalizePhoneMX(''),
      warnings: ['Cuerpo de correo vacío o ilegible.'],
      missingRequired: [...REQUIRED],
    };
  }

  const fields = {};
  for (const [key, labels] of Object.entries(FIELD_LABELS)) {
    const hit = findByLabels(lines, labels);
    if (hit && hit.value) {
      fields[key] = hit.value;
    } else {
      fields[key] = null;
      // Solo avisamos de faltantes que importan o que solían venir.
      warnings.push(`No se encontró el campo "${key}" (etiquetas probadas: ${labels.join(' / ')}).`);
    }
  }

  // Teléfono normalizado para wa.me
  const phone = normalizePhoneMX(fields.telefono);
  if (fields.telefono && !phone.ok) {
    warnings.push(`Teléfono con formato inesperado ("${fields.telefono}"): revisar antes de enviar.`);
  }

  // ¿Nombre / empresa usables para saludar? (vacío, una letra, punto, ruido -> no)
  const usableName = isUsableName(fields.nombre);
  const usableEmpresa = isUsableName(fields.empresa);
  if (fields.nombre && !usableName) {
    warnings.push(`Nombre no usable para saludar ("${fields.nombre}"): se redactará sin dirigirse a nadie.`);
  }

  // La capa de redacción usa esto: primer nombre limpio, o null si no hay.
  const saludo = {
    usableName,
    usableEmpresa,
    primerNombre: usableName ? fields.nombre.trim().split(/\s+/)[0] : null,
    empresa: usableEmpresa ? fields.empresa.trim() : null,
  };

  // Requeridos para poder actuar (solo teléfono; el nombre no bloquea)
  const missingRequired = REQUIRED.filter((k) => !fields[k]);
  const ok = missingRequired.length === 0 && phone.ok;

  return { ok, fields, phone, saludo, warnings, missingRequired };
}

module.exports = { parseLead, normalizePhoneMX, FIELD_LABELS };
