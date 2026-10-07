// tests/sanctions.test.js
// Reglas del sistema de sanciones por bajas (functions/sanctions.js). Lógica
// pura: no necesita emulador. Correr con `npx vitest run tests/sanctions.test.js`.
import { describe, test, expect } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { evaluateSanction, sortWithPenalties } = require('../functions/sanctions.js')

const DAY = 24 * 3600000
const NOW = Date.UTC(2026, 9, 1)

// Una baja de titular, `daysAgo` días atrás, con `hours` de anticipación.
const baja = (daysAgo, hours, extra = {}) => ({
  kind: 'left',
  wasStarter: true,
  hoursBeforeMatch: hours,
  droppedAtMs: NOW - daysAgo * DAY,
  ...extra,
})

describe('evaluateSanction', () => {
  test('3 bajas con tiempo (entre 24hs y 5 días) todavía no sancionan', () => {
    const r = evaluateSanction([baja(1, 48), baja(5, 72), baja(9, 100)], NOW)
    expect(r.triggers).toBe(false)
    expect(r.bajas).toBe(3)
  })

  test('la 4ta baja sanciona', () => {
    const r = evaluateSanction([baja(1, 48), baja(5, 72), baja(9, 100), baja(12, 30)], NOW)
    expect(r).toMatchObject({ triggers: true, reason: 'bajas', bajas: 4 })
  })

  test('2 bajas tardías (menos de 24hs) sancionan', () => {
    const r = evaluateSanction([baja(2, 5), baja(10, 20)], NOW)
    expect(r).toMatchObject({ triggers: true, reason: 'tardes', tardes: 2 })
  })

  test('1 tardía sola no sanciona', () => {
    expect(evaluateSanction([baja(2, 5)], NOW).triggers).toBe(false)
  })

  test('3 bajas y una tardía sancionan', () => {
    const r = evaluateSanction([baja(1, 48), baja(5, 72), baja(9, 3)], NOW)
    expect(r).toMatchObject({ triggers: true, reason: 'mixta', bajas: 3, tardes: 1 })
  })

  test('3 bajas ninguna tardía NO sancionan', () => {
    expect(evaluateSanction([baja(1, 48), baja(5, 72), baja(9, 30)], NOW).triggers).toBe(false)
  })

  test('bajarse con 5 días o más no cuenta', () => {
    const rows = [baja(1, 120), baja(2, 200), baja(3, 500), baja(4, 130)]
    const r = evaluateSanction(rows, NOW)
    expect(r.bajas).toBe(0)
    expect(r.triggers).toBe(false)
  })

  test('las bajas de hace más de 2 meses salen de la ventana', () => {
    const r = evaluateSanction([baja(61, 2), baja(70, 2), baja(1, 2)], NOW)
    expect(r.tardes).toBe(1)
    expect(r.triggers).toBe(false)
  })

  test('un reemplazo ("no vino") cuenta como tardía aunque la anticipación sea grande', () => {
    // Se reemplazó con 30hs de margen: igual no vino, es de las feas.
    const r = evaluateSanction([baja(1, 30, { kind: 'replaced' }), baja(3, 10)], NOW)
    expect(r).toMatchObject({ triggers: true, reason: 'tardes', tardes: 2 })
  })

  test('bajarse siendo suplente no cuenta', () => {
    const rows = [baja(1, 2, { wasStarter: false }), baja(2, 2, { wasStarter: false })]
    expect(evaluateSanction(rows, NOW).bajas).toBe(0)
  })

  test('sin dato de anticipación no se castiga', () => {
    expect(evaluateSanction([baja(1, null), baja(2, undefined)], NOW).bajas).toBe(0)
  })

  test('cumplir la sanción reinicia el conteo: solo cuentan las bajas posteriores', () => {
    const rows = [baja(20, 2), baja(15, 2), baja(1, 2)]
    const countedFrom = NOW - 10 * DAY // se anotó "en sanción" hace 10 días
    const r = evaluateSanction(rows, NOW, countedFrom)
    expect(r.bajas).toBe(1)
    expect(r.triggers).toBe(false)
  })
})

describe('sortWithPenalties', () => {
  const r = (id, position, penalized = false) => ({ id, position, penalized })

  test('sin sancionados, el orden no cambia', () => {
    const out = sortWithPenalties([r('a', 1), r('b', 2), r('c', 3)])
    expect(out.map((x) => x.id)).toEqual(['a', 'b', 'c'])
  })

  test('el sancionado queda detrás de los demás, cada grupo en su orden de llegada', () => {
    const out = sortWithPenalties([r('a', 1), r('tomi', 2, true), r('b', 3), r('c', 4), r('pepe', 5, true)])
    expect(out.map((x) => x.id)).toEqual(['a', 'b', 'c', 'tomi', 'pepe'])
  })

  test('con cupo 3 y 4 anotados, el sancionado es el que queda de suplente', () => {
    const out = sortWithPenalties([r('a', 1), r('tomi', 2, true), r('b', 3), r('nuevo', 4)])
    const suplentes = out.slice(3).map((x) => x.id)
    expect(suplentes).toEqual(['tomi'])
  })
})
