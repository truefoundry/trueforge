import { HTTPException } from 'hono/http-exception';

export const ASSUME_USER_HEADER = 'assume-user';

export enum AssumeUser {
  SessionCreator = 'session-creator',
}

const ASSUME_USER_BY_VALUE: Record<string, AssumeUser> = {
  [AssumeUser.SessionCreator]: AssumeUser.SessionCreator,
};

export function parseAssumeUserHeader(header: string | undefined): AssumeUser {
  const raw = header?.trim();
  if (!raw) {
    throw new HTTPException(400, { message: `Missing ${ASSUME_USER_HEADER} header` });
  }
  const assumed = ASSUME_USER_BY_VALUE[raw];
  if (!assumed) {
    throw new HTTPException(400, {
      message: `Invalid ${ASSUME_USER_HEADER}: only "${AssumeUser.SessionCreator}" is supported`,
    });
  }
  return assumed;
}
