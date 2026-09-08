import { Controller, Get, Param, Query } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PaginatedResponse } from '../common/pagination/pagination.types';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { User } from '../users/entities/user.entity';
import { CitySearchService } from './city-search.service';
import { DiscoveredResourceDto } from './discovery-response.dto';
import { DiscoveryService } from './discovery.service';
import { CityResultDto } from './dto/city-result.dto';
import {
  CitySearchQueryDto,
  citySearchQuerySchema,
} from './dto/city-search-query.schema';
import { CommunitySearchResultDto } from './dto/community-search-result.dto';
import {
  DiscoverySearchQueryDto,
  discoverySearchQuerySchema,
} from './dto/discovery-search-query.schema';
import { PlaceSearchResultDto } from './dto/place-search-result.dto';
import {
  PlaceSearchQueryDto,
  placeSearchQuerySchema,
} from './dto/place-search-query.schema';

@Controller('discovery')
export class DiscoveryController {
  constructor(
    private readonly discoveryService: DiscoveryService,
    private readonly citySearchService: CitySearchService,
  ) {}

  /**
   * GET /discovery/resolve/:code
   *
   * Resolve any resource (Group or User) by its publicCode.
   * Works even for isHidden resources - the public code is the bypass.
   * The code is case-insensitive.
   */
  @Get('resolve/:code')
  resolveByCode(
    @Param('code') code: string,
    @CurrentUser() user: User,
  ): Promise<DiscoveredResourceDto> {
    return this.discoveryService.resolveByCode(code, user);
  }

  /**
   * GET /discovery/search?name=&country=&city=&type=&page=&limit=
   *
   * "Discover Community" - the only way to browse Groups/Sections. At
   * least one of name/country/city is required (400 VALIDATION_ERROR
   * otherwise) - there is deliberately no unfiltered "list everything"
   * endpoint. `type=GROUP`/`type=SECTION` narrows to one tab; omit it for
   * the "All" tab. See discoverySearchQuerySchema and
   * DiscoveryService.search for the full contract.
   */
  @Get('search')
  search(
    @Query(new ZodValidationPipe(discoverySearchQuerySchema))
    query: DiscoverySearchQueryDto,
  ): Promise<PaginatedResponse<CommunitySearchResultDto>> {
    return this.discoveryService.search(query);
  }

  /**
   * GET /discovery/cities?country=&search=&limit=
   *
   * Cities of one country (`country` is required - there is no "browse
   * every city" mode), optionally narrowed by name. Backs a "pick your
   * city" step constrained to a previously-chosen country (see
   * create-group.schema.ts / create-section.schema.ts - the same values
   * this endpoint returns are the ones accepted there). Not a Group/Section
   * search - see CitySearchService and common/geo/city-directory.ts for the
   * static reference dataset this reads from.
   */
  @Get('cities')
  searchCities(
    @Query(new ZodValidationPipe(citySearchQuerySchema))
    query: CitySearchQueryDto,
  ): CityResultDto[] {
    return this.citySearchService.search(query);
  }

  /**
   * GET /discovery/places?search=&limit=
   *
   * Global (every-country) place search with real lat/lng - backs the
   * manual "wyszukaj miejscowość" step of discovery-location
   * (users/user-location.service.ts), which must work with no GPS/location
   * permission at all. Not scoped to a pre-chosen country (unlike
   * GET /discovery/cities above) - a caller here only ever has a bare typed
   * place name. See CitySearchService#searchPlaces and
   * common/geo/city-directory.ts for the static reference dataset this
   * reads from (no third-party geocoding provider, no API key).
   */
  @Get('places')
  searchPlaces(
    @Query(new ZodValidationPipe(placeSearchQuerySchema))
    query: PlaceSearchQueryDto,
  ): PlaceSearchResultDto[] {
    return this.citySearchService.searchPlaces(query);
  }
}
