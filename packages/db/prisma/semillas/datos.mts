// Datos de las semillas (T7, doc 09 §3). Sin contraseñas: salen de SEED_PASSWORD.
import { Rol } from '../../dist/index.js';

export const DEPARTAMENTOS = [
  { codigo: 'CB', nombre: 'Cochabamba' },
  { codigo: 'LP', nombre: 'La Paz' },
  { codigo: 'SC', nombre: 'Santa Cruz' },
  { codigo: 'OR', nombre: 'Oruro' },
  { codigo: 'PT', nombre: 'Potosí' },
  { codigo: 'CH', nombre: 'Chuquisaca' },
  { codigo: 'TJ', nombre: 'Tarija' },
  { codigo: 'BE', nombre: 'Beni' },
  { codigo: 'PD', nombre: 'Pando' },
] as const;

// Los 7 municipios de la Región Metropolitana Kanata (Ley 533 de 2014), donde
// están los recintos del lanzamiento. El slug es único en todo el país: cuando
// se agregue Oruro, su Vinto tendrá que ser 'vinto-oruro'.
export const CIUDADES = [
  { departamento: 'CB', nombre: 'Cochabamba', slug: 'cochabamba' },
  { departamento: 'CB', nombre: 'Quillacollo', slug: 'quillacollo' },
  { departamento: 'CB', nombre: 'Sacaba', slug: 'sacaba' },
  { departamento: 'CB', nombre: 'Tiquipaya', slug: 'tiquipaya' },
  { departamento: 'CB', nombre: 'Colcapirhua', slug: 'colcapirhua' },
  { departamento: 'CB', nombre: 'Vinto', slug: 'vinto' },
  { departamento: 'CB', nombre: 'Sipe Sipe', slug: 'sipe-sipe' },
] as const;

// Dominio .test (RFC 2606): nunca recibe correo real. Sin teléfono (minimización de datos).
export const DOMINIO_USUARIOS = '@entradas.test';

export const USUARIOS = [
  { email: `admin${DOMINIO_USUARIOS}`, nombre: 'Admin Semilla', rol: Rol.ADMIN },
  { email: `organizador${DOMINIO_USUARIOS}`, nombre: 'Organizador Semilla', rol: Rol.ORGANIZADOR },
  { email: `validador${DOMINIO_USUARIOS}`, nombre: 'Validador Semilla', rol: Rol.VALIDADOR },
  { email: `comprador${DOMINIO_USUARIOS}`, nombre: 'Comprador Semilla', rol: Rol.COMPRADOR },
] as const;
