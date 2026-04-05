export type UserId = string;

export interface User {
  id: UserId;
  name: string;
  email: string;
}

export enum Role {
  Admin,
  User,
  Guest,
}

export const MAX_RETRIES = 3;

export let counter = 0;

export function processUser(user: User): string {
  return user.name;
}
