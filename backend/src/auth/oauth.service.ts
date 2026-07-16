import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createRemoteJWKSet, jwtVerify } from 'jose';

export interface OAuthProfile {
  provider: 'google' | 'apple';
  providerId: string;
  email: string;
  name?: string;
  emailVerified: boolean;
}

const APPLE_JWKS = createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'));

/**
 * Verifies third-party identity tokens server-side. The frontend only ever
 * sends us the provider's ID token — never trusts client-supplied profile data.
 */
@Injectable()
export class OAuthService {
  constructor(private config: ConfigService) {}

  get googleEnabled() {
    return !!this.config.get('GOOGLE_CLIENT_ID');
  }

  get appleEnabled() {
    return !!this.config.get('APPLE_CLIENT_ID');
  }

  async verifyGoogleToken(idToken: string): Promise<OAuthProfile> {
    const clientId = this.config.get<string>('GOOGLE_CLIENT_ID');
    if (!clientId) {
      throw new BadRequestException('Google sign-in is not configured (GOOGLE_CLIENT_ID missing)');
    }
    // Google's tokeninfo endpoint validates signature, expiry and issuer for us
    const res = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`,
      { signal: AbortSignal.timeout(6000) },
    );
    if (!res.ok) throw new UnauthorizedException('Invalid Google token');
    const payload: any = await res.json();
    if (payload.aud !== clientId) {
      throw new UnauthorizedException('Google token was issued for a different app');
    }
    if (!payload.email) throw new UnauthorizedException('Google account has no email');
    return {
      provider: 'google',
      providerId: payload.sub,
      email: String(payload.email).toLowerCase(),
      name: payload.name || payload.given_name || undefined,
      emailVerified: payload.email_verified === 'true' || payload.email_verified === true,
    };
  }

  async verifyAppleToken(identityToken: string, nameHint?: string): Promise<OAuthProfile> {
    const clientId = this.config.get<string>('APPLE_CLIENT_ID');
    if (!clientId) {
      throw new BadRequestException('Apple sign-in is not configured (APPLE_CLIENT_ID missing)');
    }
    let payload: any;
    try {
      const result = await jwtVerify(identityToken, APPLE_JWKS, {
        issuer: 'https://appleid.apple.com',
        audience: clientId,
      });
      payload = result.payload;
    } catch {
      throw new UnauthorizedException('Invalid Apple token');
    }
    if (!payload.email) throw new UnauthorizedException('Apple account has no email');
    return {
      provider: 'apple',
      providerId: String(payload.sub),
      email: String(payload.email).toLowerCase(),
      // Apple only sends the name on first authorisation — the client passes it through
      name: nameHint,
      emailVerified: payload.email_verified === 'true' || payload.email_verified === true,
    };
  }
}
