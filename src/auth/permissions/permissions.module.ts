import { Module } from '@nestjs/common';
import { PermissionsGuard } from '../guards/permissions.guard';
import { RolesGuard } from '../guards/roles.guard';
import { PermissionService } from './permission.service';

/**
 * Shared leaf module: any feature module that needs @Permissions()/@Roles()
 * enforcement imports this to get PermissionService and both guards.
 */
@Module({
  providers: [PermissionService, PermissionsGuard, RolesGuard],
  exports: [PermissionService, PermissionsGuard, RolesGuard],
})
export class PermissionsModule {}
