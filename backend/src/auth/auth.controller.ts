import { Body, Controller, Get, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { AuthService } from './auth.service';
import { OAuthService } from './oauth.service';
import { LoginDto, RegisterDto } from './auth.dto';
import { CurrentUser, Public } from '../common/decorators';
import { Role } from '../common/enums';

export class GoogleLoginDto {
  @IsString()
  idToken: string;

  @IsOptional()
  @IsEnum(Role)
  role?: Role;
}

export class AppleLoginDto {
  @IsString()
  identityToken: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsEnum(Role)
  role?: Role;
}

// Tighter limit on credential endpoints to slow brute-force attempts
const CREDENTIAL_LIMIT = { default: { limit: 10, ttl: 60_000 } };
// Read-only session endpoints run on every page load, so they keep the normal site-wide limit.
const SESSION_LIMIT = { default: { limit: 100, ttl: 60_000 } };

@Throttle(CREDENTIAL_LIMIT)
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly oauthService: OAuthService,
  ) {}

  @Public()
  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Public()
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Public()
  @Throttle(SESSION_LIMIT)
  @Get('providers')
  providers() {
    return {
      google: this.oauthService.googleEnabled,
      apple: this.oauthService.appleEnabled,
    };
  }

  @Public()
  @Post('google')
  async google(@Body() dto: GoogleLoginDto) {
    const profile = await this.oauthService.verifyGoogleToken(dto.idToken);
    return this.authService.oauthLogin(profile, dto.role);
  }

  @Public()
  @Post('apple')
  async apple(@Body() dto: AppleLoginDto) {
    const profile = await this.oauthService.verifyAppleToken(dto.identityToken, dto.name);
    return this.authService.oauthLogin(profile, dto.role);
  }

  @Throttle(SESSION_LIMIT)
  @Get('me')
  me(@CurrentUser('userId') userId: string) {
    return this.authService.me(userId);
  }
}
