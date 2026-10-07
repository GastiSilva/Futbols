// tests/errors.test.js — traductor de errores para el usuario (src/utils/errors.js)
import { describe, test, expect, vi } from 'vitest'
import { errorMessage } from '../src/utils/errors.js'

vi.spyOn(console, 'error').mockImplementation(() => {})

function firebaseError(code, message = 'Missing or insufficient permissions.') {
  return Object.assign(new Error(message), { name: 'FirebaseError', code })
}

describe('errorMessage', () => {
  test('respeta los errores propios en castellano', () => {
    expect(errorMessage(new Error('Ya estás anotado en este partido.'))).toBe('Ya estás anotado en este partido.')
  })

  test('traduce un rechazo de las reglas de Firestore (nunca el inglés crudo)', () => {
    expect(errorMessage(firebaseError('permission-denied'))).toBe('No tenés permiso para hacer esto.')
  })

  test('el override por acción le gana al texto genérico del código', () => {
    const msg = errorMessage(firebaseError('permission-denied'), {
      overrides: { 'permission-denied': 'La lista todavía no abrió.' },
    })
    expect(msg).toBe('La lista todavía no abrió.')
  })

  test('respeta el mensaje en castellano de una Cloud Function propia', () => {
    const err = firebaseError('functions/resource-exhausted', 'Ya se reenvió el aviso hace poco.')
    expect(errorMessage(err)).toBe('Ya se reenvió el aviso hace poco.')
  })

  test('pero no el "internal" pelado que manda Firebase cuando la función explota', () => {
    expect(errorMessage(firebaseError('functions/internal', 'internal'))).toBe(
      'Falló el servidor. Probá de nuevo en un momento.',
    )
  })

  test('un bug de JavaScript no le muestra el stack técnico al usuario', () => {
    const msg = errorMessage(new TypeError("Cannot read properties of undefined (reading 'uid')"), {
      fallback: 'No se pudo cargar.',
    })
    expect(msg).toBe('No se pudo cargar.')
  })

  test('errores de login con código propio', () => {
    expect(errorMessage(firebaseError('auth/network-request-failed'))).toMatch(/conexión/)
  })
})
