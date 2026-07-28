import { Injectable } from '@nestjs/common';
import { ChildRef, ChildrenDirectoryPort } from './children-directory.port';

// Default binding for ChildrenDirectoryPort until a real Children module
// exists - see children-directory.port.ts. Intentionally fails closed
// (never grants access, never lists anything) rather than
// permissive-by-default, so a CHILD_ACCOUNT registration is always
// rejected today, never silently allowed on the caller's unverified say-so.
/* eslint-disable @typescript-eslint/no-unused-vars -- both methods' parameters are fixed by ChildrenDirectoryPort's signature; this implementation intentionally ignores them until a real Children module exists */
@Injectable()
export class NullChildrenDirectoryService implements ChildrenDirectoryPort {
  listChildrenOf(parentUserId: string): Promise<ChildRef[]> {
    return Promise.resolve([]);
  }

  canRegisterChildAccount(
    parentUserId: string,
    childUserId: string,
  ): Promise<boolean> {
    return Promise.resolve(false);
  }
}
/* eslint-enable @typescript-eslint/no-unused-vars */
