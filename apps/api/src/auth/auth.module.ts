import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule, type JwtSignOptions } from '@nestjs/jwt';
import { JwtGuard } from './jwt.guard';
import { RolesGuard } from './roles.guard';
import { leerSecretoJwt } from './secreto-jwt';

@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: leerSecretoJwt(config),
        signOptions: { algorithm: 'HS256', expiresIn: config.get('JWT_EXPIRES_IN', '60m') as JwtSignOptions['expiresIn'] },
        verifyOptions: { algorithms: ['HS256'] },
      }),
    }),
  ],
  providers: [
    // Globales y en este orden: primero quién es (401), después qué puede hacer (403).
    { provide: APP_GUARD, useClass: JwtGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AuthModule {}
