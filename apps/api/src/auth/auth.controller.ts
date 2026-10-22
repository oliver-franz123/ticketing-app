import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import { Publico } from './decoradores';
import { LoginDto } from './dto/login.dto';
import { RegistroDto } from './dto/registro.dto';

@Publico()
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('registro')
  registrar(@Body() datos: RegistroDto) {
    return this.auth.registrar(datos);
  }

  @Post('login')
  @HttpCode(200)
  login(@Body() datos: LoginDto) {
    return this.auth.login(datos);
  }
}
