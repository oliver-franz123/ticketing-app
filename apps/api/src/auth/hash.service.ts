import { Injectable, OnModuleInit } from '@nestjs/common';
import { argon2id, hash, verify } from 'argon2';
import { randomBytes } from 'node:crypto';

// Mínimo de OWASP para argon2id. Los defaults de la librería (64 MiB, t=3,
// p=4) en una VM de 256 MB de Fly se quedan sin memoria con ~4 logins a la
// vez. Los parámetros quedan dentro de cada hash: se pueden subir más tarde.
const OPCIONES = { type: argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

@Injectable()
export class HashService implements OnModuleInit {
  private senuelo = '';

  async onModuleInit() {
    this.senuelo = await hash(randomBytes(32).toString('base64'), OPCIONES);
  }

  hashear(password: string) {
    return hash(password, OPCIONES);
  }

  verificar(passwordHash: string, password: string) {
    return verify(passwordHash, password);
  }

  // Cuando el email no existe se gasta el mismo tiempo que con uno real: si no,
  // la diferencia (~1 ms frente a ~50 ms) revela qué emails están registrados.
  async verificarSenuelo(password: string) {
    await verify(this.senuelo, password);
    return false;
  }
}
