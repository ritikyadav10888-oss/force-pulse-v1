import { Injectable, UnauthorizedException } from '@nestjs/common';
import { OAuth2Client } from 'google-auth-library';

/** A verified identity from an external sign-in method. Google today; phone OTP can implement this later. */
export interface VerifiedIdentity {
  /** Stable provider subject id (Google "sub"). Accounts link on this, never on email. */
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string;
  picture?: string;
}

export interface AuthProvider {
  verify(credential: string): Promise<VerifiedIdentity>;
}

export const AUTH_PROVIDER = Symbol('AUTH_PROVIDER');

@Injectable()
export class GoogleAuthProvider implements AuthProvider {
  private readonly client = new OAuth2Client();

  async verify(idToken: string): Promise<VerifiedIdentity> {
    const audience = process.env.GOOGLE_CLIENT_ID;
    if (!audience) throw new Error('GOOGLE_CLIENT_ID is not set');
    try {
      // Checks signature, expiry, issuer and that the token was minted for our client id.
      const payload = (await this.client.verifyIdToken({ idToken, audience })).getPayload();
      if (!payload?.sub || !payload.email) throw new Error('missing claims');
      return {
        sub: payload.sub,
        email: payload.email,
        emailVerified: payload.email_verified === true,
        name: payload.name ?? payload.email,
        picture: payload.picture,
      };
    } catch {
      throw new UnauthorizedException('Invalid Google credential');
    }
  }
}
