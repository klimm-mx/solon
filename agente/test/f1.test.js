'use strict';

/**
 * f1.test.js — Prueba la matriz de casos de F1 sin red.
 * Corre con:  node agente/test/f1.test.js
 *
 * Verifica la regla dura acordada: el mensaje NUNCA deja un hueco visible,
 * pase lo que pase con nombre / empresa / texto. Y que los guardarraíles de
 * tono descartan salidas de IA que violen las reglas.
 */

const assert = require('assert');
const { procesarCorreoEntrante } = require('../f1/primerContacto');
const { lineaRespetaTono, textoEsUsable } = require('../f1/redactarLineaTexto');

let pasadas = 0;
let fallidas = 0;
function test(nombre, fn) {
  return fn()
    .then(() => { pasadas++; console.log(`  ✓ ${nombre}`); })
    .catch((e) => { fallidas++; console.log(`  ✗ ${nombre}\n      ${e.message}`); });
}
function testSync(nombre, fn) {
  try { fn(); pasadas++; console.log(`  ✓ ${nombre}`); }
  catch (e) { fallidas++; console.log(`  ✗ ${nombre}\n      ${e.message}`); }
}

// callLLM falso: devuelve una línea de reflejo válida basada en el texto.
const llmOk = async () => 'Veo que requiere guantes de nitrilo por volumen.';
// callLLM que viola el tono (pregunta) -> debe ser descartado.
const llmPregunta = async () => '¿Qué cantidad de guantes necesita?';
// callLLM que tutea -> descartado.
const llmTuteo = async () => 'Vi que necesitas guantes de nitrilo.';
// callLLM que truena -> fallback a mensaje base.
const llmError = async () => { throw new Error('503'); };
// callLLM lento -> timeout -> fallback.
const llmLento = () => new Promise((r) => setTimeout(() => r('tarde'), 500));

// Sin ningún hueco visible: no debe contener ", ." ni " ." colgando, ni
// dobles espacios, ni terminar con preposición suelta.
function sinHuecos(msg) {
  assert.ok(!/,\s*\./.test(msg), `hueco ", ." en: "${msg}"`);
  assert.ok(!/\s{2,}/.test(msg), `doble espacio en: "${msg}"`);
  assert.ok(!/\b(en|de|sobre|para)\s*\.\s*$/.test(msg), `preposición colgando en: "${msg}"`);
  assert.ok(msg.trim().length > 0, 'mensaje vacío');
}

const correoCompleto = [
  'Nombre Completo: Francisco Ramírez',
  'Teléfono: 55 3412 7788',
  'Nombre de la empresa: Aceros del Norte',
  'Ubicación: Monterrey',
  'Texto: Necesito cotización de 200 cajas de guantes de nitrilo',
].join('\n');

const correoSinNombre = [
  'Nombre Completo: .',
  'Teléfono: 5534127788',
  'Texto: Busco proveedor de papel higiénico institucional',
].join('\n');

const correoSoloTelYTextoGenerico = [
  'Teléfono: 5534127788',
  'Texto: info',
].join('\n');

const correoMinimo = [
  'Teléfono: 5534127788',
].join('\n');

const correoTelMalo = [
  'Nombre Completo: Laura Méndez',
  'Teléfono: 123',
  'Texto: Quiero cotizar trapeadores y fibras',
].join('\n');

const correoSinTel = [
  'Nombre Completo: Laura Méndez',
  'Texto: Quiero cotizar trapeadores',
].join('\n');

(async () => {
  console.log('\nMatriz de casos F1 (mensaje coherente siempre):\n');

  await test('completo: nombre + empresa + texto -> personalizado, con nombre', async () => {
    const t = await procesarCorreoEntrante(correoCompleto, { callLLM: llmOk });
    assert.strictEqual(t.ok, true, 'debe poder enviarse');
    assert.strictEqual(t.personalizado, true, 'debe personalizar');
    assert.ok(t.mensaje.includes('Francisco'), 'debe saludar por nombre');
    assert.ok(t.mensaje.includes('guantes'), 'debe reflejar el texto');
    assert.ok(t.waLink && t.waLink.startsWith('https://wa.me/525534127788?text='), 'waLink correcto');
    sinHuecos(t.mensaje);
  });

  await test('sin nombre usable (".") -> arranca sin nombre, sin hueco', async () => {
    const t = await procesarCorreoEntrante(correoSinNombre, { callLLM: llmOk });
    assert.strictEqual(t.ok, true);
    assert.ok(!/Buen día,\s*\./.test(t.mensaje), 'no debe quedar "Buen día, ."');
    assert.ok(t.mensaje.startsWith('Buen día.'), `debe arrancar "Buen día." -> "${t.mensaje}"`);
    sinHuecos(t.mensaje);
  });

  await test('texto genérico ("info") -> mensaje base, sin personalizar', async () => {
    const t = await procesarCorreoEntrante(correoSoloTelYTextoGenerico, { callLLM: llmOk });
    assert.strictEqual(t.personalizado, false, 'no debe personalizar texto genérico');
    assert.ok(t.ok, 'debe poder enviarse (hay tel)');
    sinHuecos(t.mensaje);
  });

  await test('mínimo: solo teléfono -> mensaje base completo, sin nadie', async () => {
    const t = await procesarCorreoEntrante(correoMinimo, { callLLM: llmOk });
    assert.strictEqual(t.personalizado, false);
    assert.ok(t.mensaje.startsWith('Buen día.'), 'sin nombre');
    assert.ok(t.mensaje.includes('Klimm'), 'presentación presente');
    sinHuecos(t.mensaje);
  });

  await test('IA pregunta -> descartada, cae a mensaje base', async () => {
    const t = await procesarCorreoEntrante(correoCompleto, { callLLM: llmPregunta });
    assert.strictEqual(t.personalizado, false, 'pregunta debe descartarse');
    assert.ok(!t.mensaje.includes('?'), 'sin signos de pregunta');
    assert.ok(t.avisos.some((a) => a.includes('viola-tono')), 'aviso de tono');
    sinHuecos(t.mensaje);
  });

  await test('IA tutea -> descartada, cae a mensaje base', async () => {
    const t = await procesarCorreoEntrante(correoCompleto, { callLLM: llmTuteo });
    assert.strictEqual(t.personalizado, false, 'tuteo debe descartarse');
    sinHuecos(t.mensaje);
  });

  await test('IA truena -> fallback a mensaje base, no fatal', async () => {
    const t = await procesarCorreoEntrante(correoCompleto, { callLLM: llmError });
    assert.strictEqual(t.personalizado, false);
    assert.strictEqual(t.ok, true, 'sigue siendo enviable');
    assert.ok(t.avisos.some((a) => a.includes('error-ia')), 'aviso de error IA');
    sinHuecos(t.mensaje);
  });

  await test('IA lenta -> timeout -> fallback', async () => {
    const t = await procesarCorreoEntrante(correoCompleto, { callLLM: llmLento, timeoutMs: 100 });
    assert.strictEqual(t.personalizado, false);
    assert.ok(t.avisos.some((a) => a.includes('timeout')), 'aviso de timeout');
    sinHuecos(t.mensaje);
  });

  await test('teléfono malo -> mensaje listo pero envío BLOQUEADO', async () => {
    const t = await procesarCorreoEntrante(correoTelMalo, { callLLM: llmOk });
    assert.strictEqual(t.ok, false, 'no debe poder enviarse');
    assert.strictEqual(t.waLink, null, 'sin waLink');
    assert.ok(t.bloqueoEnvio && t.bloqueoEnvio.includes('formato inesperado'), 'motivo de bloqueo');
    assert.ok(t.mensaje.length > 0, 'mensaje redactado igual, para revisión');
    sinHuecos(t.mensaje);
  });

  await test('sin teléfono -> envío bloqueado con motivo claro', async () => {
    const t = await procesarCorreoEntrante(correoSinTel, { callLLM: llmOk });
    assert.strictEqual(t.ok, false);
    assert.ok(t.bloqueoEnvio && t.bloqueoEnvio.includes('No llegó teléfono'), 'motivo claro');
    sinHuecos(t.mensaje);
  });

  await test('sin callLLM inyectado -> mensaje base, no truena', async () => {
    const t = await procesarCorreoEntrante(correoCompleto, {});
    assert.strictEqual(t.personalizado, false);
    assert.ok(t.ok, 'enviable');
    sinHuecos(t.mensaje);
  });

  console.log('\nGuardarraíles de tono (unidad):\n');

  testSync('lineaRespetaTono rechaza pregunta', () => {
    assert.strictEqual(lineaRespetaTono('¿Cuántas cajas necesita?'), false);
  });
  testSync('lineaRespetaTono rechaza tuteo', () => {
    assert.strictEqual(lineaRespetaTono('Vi que necesitas guantes.'), false);
  });
  testSync('lineaRespetaTono rechaza párrafo largo', () => {
    assert.strictEqual(lineaRespetaTono('a '.repeat(100)), false);
  });
  testSync('lineaRespetaTono acepta línea de usted', () => {
    assert.strictEqual(lineaRespetaTono('Veo que requiere guantes de nitrilo.'), true);
  });
  testSync('textoEsUsable rechaza genérico', () => {
    assert.strictEqual(textoEsUsable('cotización'), false);
  });
  testSync('textoEsUsable acepta pedido real', () => {
    assert.strictEqual(textoEsUsable('Necesito 200 cajas de guantes'), true);
  });

  console.log(`\nResultado: ${pasadas} pasadas, ${fallidas} fallidas\n`);
  process.exit(fallidas === 0 ? 0 : 1);
})();
