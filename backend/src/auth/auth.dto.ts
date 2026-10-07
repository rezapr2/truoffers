import { IsBoolean, IsEmail, IsEnum, IsOptional, IsString, Length, MaxLength, MinLength } from 'class-validator';
import { Role } from '../common/enums';

export class RegisterDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name: string;

  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  postcode?: string;

  @IsOptional()
  @IsEnum(Role)
  role?: Role;

  // "Email me offers and news": marketing consent, off unless ticked
  @IsOptional()
  @IsBoolean()
  marketingEmails?: boolean;
}

export class LoginDto {
  @IsEmail()
  email: string;

  @IsString()
  password: string;
}

export class TwoFactorChallengeDto {
  @IsString()
  challengeToken: string;
}

export class TwoFactorCodeDto {
  @IsString()
  challengeToken: string;

  @IsString()
  @Length(6, 6)
  code: string;
}

export class TokenDto {
  @IsString()
  @MinLength(10)
  token: string;
}

export class ForgotPasswordDto {
  @IsEmail()
  email: string;
}

export class ResetPasswordDto {
  @IsString()
  @MinLength(10)
  token: string;

  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password: string;
}
