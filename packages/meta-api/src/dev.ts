/**
 * Credenciales de desarrollo, en duro.
 *
 * Viven acá y no en el simulador para que el cliente pueda usarlas por defecto
 * cuando `simulate: true`, sin depender del paquete del simulador (que es una
 * devDependency y no existe en producción). El simulador las reexporta.
 *
 * No son secretos: sólo sirven contra el simulador, que nunca corre en
 * producción. Están en el código a propósito, para que no haya nada que
 * configurar ni dos valores que puedan desincronizarse.
 */

export const DEV_APP_SECRET = 'meta-simulator-dev-secret'
export const DEV_VERIFY_TOKEN = 'meta-simulator-dev-token'
export const DEV_SIMULATOR_URL = 'http://localhost:4000'
