import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { ClerkModule } from '../auth/clerk/clerk.module';
import { User } from './entities/user.entity';
import { UserService } from './user.service';
import { UsersController } from './users.controller';

@Module({
  imports: [MikroOrmModule.forFeature([User]), ClerkModule],
  controllers: [UsersController],
  providers: [UserService],
  exports: [UserService],
})
export class UsersModule {}
