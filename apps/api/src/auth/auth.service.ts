import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { AUTH_PROVIDER, type AuthProvider } from './auth.provider';
import { ACCESS_TTL_SECONDS, REFRESH_TTL_SECONDS } from './cookies';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export interface Tokens {
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    @Inject(AUTH_PROVIDER) private readonly provider: AuthProvider,
  ) {}

  async signIn(credential: string): Promise<Tokens & { userId: string }> {
    const id = await this.provider.verify(credential);
    const user = await this.prisma.user.upsert({
      where: { googleSub: id.sub },
      create: { googleSub: id.sub, email: id.email, name: id.name, avatarUrl: id.picture },
      update: { email: id.email, name: id.name, avatarUrl: id.picture },
    });
    if (user.deletedAt) throw new UnauthorizedException('Account deleted');

    // Bootstrap only: platform super admins come from config, matched on a Google-verified email.
    // The flag grants platform powers (later: rule packs, abuse) and no tournament powers.
    const admins = (process.env.SUPER_ADMIN_EMAILS ?? '')
      .toLowerCase()
      .split(',')
      .map((s) => s.trim());
    if (id.emailVerified && admins.includes(id.email.toLowerCase()) && !user.isSuperAdmin) {
      await this.prisma.user.update({ where: { id: user.id }, data: { isSuperAdmin: true } });
    }
    return { userId: user.id, ...(await this.issue(user.id)) };
  }

  /** Rotates the refresh token. Reusing an already-rotated token revokes every session of that user. */
  async refresh(refreshToken: string | undefined): Promise<Tokens> {
    if (!refreshToken) throw new UnauthorizedException();
    const row = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: sha256(refreshToken) },
      include: { user: { select: { deletedAt: true } } },
    });
    if (!row) throw new UnauthorizedException();
    if (row.revokedAt) {
      await this.revokeAll(row.userId);
      throw new UnauthorizedException();
    }
    if (row.expiresAt < new Date() || row.user.deletedAt) throw new UnauthorizedException();

    // Conditional update so two concurrent refreshes can't both rotate the same token.
    const { count } = await this.prisma.refreshToken.updateMany({
      where: { id: row.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (count === 0) throw new UnauthorizedException();
    return this.issue(row.userId);
  }

  async logout(refreshToken: string | undefined) {
    if (!refreshToken) return;
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: sha256(refreshToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private revokeAll(userId: string) {
    return this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Issues a session for an existing user. Only the test-login route uses this directly. */
  issueFor(userId: string) {
    return this.issue(userId);
  }

  private async issue(userId: string): Promise<Tokens> {
    const refreshToken = randomBytes(32).toString('base64url');
    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: sha256(refreshToken),
        expiresAt: new Date(Date.now() + REFRESH_TTL_SECONDS * 1000),
      },
    });
    const accessToken = await this.jwt.signAsync(
      { sub: userId },
      { expiresIn: ACCESS_TTL_SECONDS },
    );
    return { accessToken, refreshToken };
  }
}
