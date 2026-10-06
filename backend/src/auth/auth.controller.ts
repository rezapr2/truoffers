import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import type { Request } from 'express';
import { AuthService, RequestMeta } from './auth.service';
import { OAuthService } from './oauth.service';
import {
  ForgotPasswordDto,
  LoginDto,
  RegisterDto,
  ResetPasswordDto,
  TokenDto,
  TwoFactorChallengeDto,
  TwoFactorCodeDto,
} from './auth.dto';
import { AuthUser, CurrentUser, Public } from '../common/decorators';
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

const meta = (req: Request): RequestMeta => ({ ip: req.ip, userAgent: req.headers['user-agent'] });

@Throttle(CREDENTIAL_LIMIT)
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly oauthService: OAuthService,
  ) {}

  @Public()
  @Post('register')
  register(@Body() dto: RegisterDto, @Req() req: Request) {
    return this.authService.register(dto, meta(req));
  }

  @Public()
  @Post('login')
  login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.authService.login(dto, meta(req));
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
  async google(@Body() dto: GoogleLoginDto, @Req() req: Request) {
    const profile = await this.oauthService.verifyGoogleToken(dto.idToken);
    return this.authService.oauthLogin(profile, dto.role, meta(req));
  }

  @Public()
  @Post('apple')
  async apple(@Body() dto: AppleLoginDto, @Req() req: Request) {
    const profile = await this.oauthService.verifyAppleToken(dto.identityToken, dto.name);
    return this.authService.oauthLogin(profile, dto.role, meta(req));
  }

  // ---- Staff second factor ----

  @Public()
  @Post('2fa/setup')
  twoFactorSetup(@Body() dto: TwoFactorChallengeDto) {
    return this.authService.twoFactorSetup(dto.challengeToken);
  }

  @Public()
  @Post('2fa/enable')
  twoFactorEnable(@Body() dto: TwoFactorCodeDto, @Req() req: Request) {
    return this.authService.twoFactorEnable(dto.challengeToken, dto.code, meta(req));
  }

  @Public()
  @Post('2fa/verify')
  twoFactorVerify(@Body() dto: TwoFactorCodeDto, @Req() req: Request) {
    return this.authService.twoFactorVerify(dto.challengeToken, dto.code, meta(req));
  }

  // ---- Email verification and password reset ----

  @Public()
  @Post('email/verify')
  verifyEmail(@Body() dto: TokenDto) {
    return this.authService.verifyEmail(dto.token);
  }

  @Post('email/resend')
  resend(@CurrentUser('userId') userId: string) {
    return this.authService.resendVerification(userId);
  }

  @Public()
  @Post('password/forgot')
  forgot(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto.email);
  }

  @Public()
  @Post('password/reset')
  reset(@Body() dto: ResetPasswordDto, @Req() req: Request) {
    return this.authService.resetPassword(dto.token, dto.password, meta(req));
  }

  @Throttle(SESSION_LIMIT)
  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.authService.me(user.userId, user.impersonatedBy);
  }
}
