import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { AcademyResponseDto } from './dto/academy-response.dto';
import { CreateAcademyInput } from './dto/create-academy.schema';
import { UpdateAcademyInput } from './dto/update-academy.schema';
import { Academy } from './entities/academy.entity';
import { Group } from './entities/group.entity';
import { AcademyStatus } from './enums/academy-status.enum';
import { toAcademyResponseDto } from './mappers/academy.mapper';

// Academy existence/status of its *Group* is already enforced by
// GroupPermissionsGuard (via :groupId, see group-permissions.guard.ts)
// before any handler here runs - this service only re-validates the
// Academy's own lifecycle status, which the guard has no visibility into.
@Injectable()
export class AcademiesService {
  constructor(private readonly em: EntityManager) {}

  async create(
    groupId: string,
    input: CreateAcademyInput,
  ): Promise<AcademyResponseDto> {
    const academy = new Academy();
    academy.group = this.em.getReference(Group, groupId);
    this.applyFields(academy, input);

    await this.em.persist(academy).flush();
    return toAcademyResponseDto(academy);
  }

  async list(groupId: string): Promise<AcademyResponseDto[]> {
    const academies = await this.em.find(
      Academy,
      { group: groupId },
      { orderBy: { createdAt: 'asc' } },
    );
    return academies.map(toAcademyResponseDto);
  }

  async getById(
    groupId: string,
    academyId: string,
  ): Promise<AcademyResponseDto> {
    const academy = await this.loadOrFail(groupId, academyId);
    return toAcademyResponseDto(academy);
  }

  async update(
    groupId: string,
    academyId: string,
    input: UpdateAcademyInput,
  ): Promise<AcademyResponseDto> {
    const academy = await this.loadOrFail(groupId, academyId);
    this.assertIsWritable(academy);
    this.applyFields(academy, input);
    await this.em.flush();
    return toAcademyResponseDto(academy);
  }

  async archive(
    groupId: string,
    academyId: string,
  ): Promise<AcademyResponseDto> {
    const academy = await this.loadOrFail(groupId, academyId);
    this.assertIsWritable(academy);
    academy.status = AcademyStatus.ARCHIVED;
    await this.em.flush();
    return toAcademyResponseDto(academy);
  }

  private assertIsWritable(academy: Academy): void {
    if (academy.status === AcademyStatus.ARCHIVED) {
      throw new ConflictException({
        code: 'ACADEMY_ARCHIVED',
        message:
          'This academy is archived and is read-only until it is restored',
      });
    }
  }

  private applyFields(academy: Academy, input: CreateAcademyInput): void {
    academy.name = input.name;
    academy.address = input.address;
    academy.latitude = input.latitude;
    academy.longitude = input.longitude;
    academy.contactEmail = input.contactEmail;
    academy.contactPhone = input.contactPhone;
    academy.openingHours = input.openingHours;
    academy.photoUrls = input.photoUrls;
    academy.description = input.description;
  }

  private async loadOrFail(
    groupId: string,
    academyId: string,
  ): Promise<Academy> {
    const academy = await this.em.findOne(
      Academy,
      { id: academyId, group: groupId },
      { populate: ['group'] },
    );
    if (!academy) {
      throw new NotFoundException({
        code: 'ACADEMY_NOT_FOUND',
        message: 'Academy not found',
      });
    }
    return academy;
  }
}
