// Admin list row (GET /admin/instruments) - includes inactive records and
// isActive itself, unlike the public InstrumentListItemResponseDto.
export interface AdminInstrumentListItemDto {
  id: string;
  slug: string;
  name: string;
  displayOrder: number;
  isActive: boolean;
}
