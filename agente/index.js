'use strict';

/**
 * agente/index.js — Punto de montaje del módulo `agente` en Solón.
 * ---------------------------------------------------------------
 * El módulo `agente` es HERMANO del cotizador, no parte de él. El cotizador
 * vive donde nace la oportunidad (pedido -> catálogo -> cotización borrador);
 * el `agente` vive donde nace el CONTACTO (lead -> mensaje -> clic humano).
 * Comparten backend (Solón) pero no código ni rutas.
 *
 * Estructura del módulo:
 *   agente/
 *     index.js              <- esto: arma el router y lo cuelga del backend
 *     f1/                    <- Función 1: primer contacto (R1)
 *       parseLead.js         <- parser del correo (pieza aislada, ya probada)
 *       plantillaF1.js       <- tono destilado del corpus (determinista)
 *       redactarLineaTexto.js<- única parte IA: refleja el Texto del lead
 *       primerContacto.js    <- orquestador + ENCHUFE del watcher IMAP
 *     lib/                   <- (futuro) cliente IA, cliente IMAP compartidos
 *     test/                  <- pruebas de la matriz de casos
 *
 * Futuro (con el panel, prioridad 2 del §11):
 *   f2/                      <- seguimiento de enfriados (R2)
 *   watcher/                 <- vigilante IMAP que dispara procesarCorreoEntrante
 *
 * Patrón Solón: este módulo LEE y prepara BORRADORES. No envía, no confirma,
 * no borra. El único envío es el clic humano en el panel (wa.me).
 */

const express = require('express');
const { procesarCorreoEntrante } = require('./f1/primerContacto');

/**
 * Construye el router del módulo agente.
 * @param {object} deps
 * @param {function} [deps.callLLM]  Cliente IA inyectado (async prompt=>string).
 *                                   Se inyecta desde el arranque de Solón para
 *                                   no acoplar el módulo a un SDK concreto.
 * @returns {express.Router}
 */
function crearRouterAgente(deps = {}) {
  const router = express.Router();

  // Salud del módulo (para el chequeo diario, Fricción F2).
  router.get('/health', (_req, res) => {
    res.json({ modulo: 'agente', ok: true, funciones: ['f1'] });
  });

  /**
   * POST /agente/f1/preparar
   * Cuerpo: { rawBody: string }  (el cuerpo del correo de SUME)
   * Responde: TarjetaF1 (ver primerContacto.js)
   *
   * Este endpoint es el que el PANEL consumirá para pintar la tarjeta.
   * Hoy también sirve para probar a mano pegándole un correo real.
   * El watcher IMAP, cuando exista, NO pasará por HTTP: llamará a
   * procesarCorreoEntrante() directo (mismo proceso). Este endpoint queda
   * para pruebas y para disparos manuales desde el panel.
   */
  router.post('/f1/preparar', async (req, res) => {
    try {
      const rawBody = req.body && req.body.rawBody;
      if (typeof rawBody !== 'string' || rawBody.trim() === '') {
        return res.status(400).json({
          ok: false,
          error: 'Falta rawBody (cuerpo del correo) en el cuerpo de la petición.',
        });
      }
      const tarjeta = await procesarCorreoEntrante(rawBody, deps);
      return res.json(tarjeta);
    } catch (err) {
      // Nunca tumbar el backend por un correo raro: reportar y seguir.
      return res.status(500).json({
        ok: false,
        error: 'Error al preparar el primer contacto.',
        detalle: err && err.message ? err.message : String(err),
      });
    }
  });

  return router;
}

module.exports = { crearRouterAgente, procesarCorreoEntrante };

/**
 * === Cómo se cuelga del backend (en el arranque de Solón, p.ej. app.js) ===
 *
 *   const { crearRouterAgente } = require('./agente');
 *   const callLLM = require('./lib/claude');   // cliente Claude ya existente
 *   app.use('/agente', crearRouterAgente({ callLLM }));
 *
 * Queda en /agente/*, hermano de /cotizador/*. Sin tocar el cotizador.
 */
