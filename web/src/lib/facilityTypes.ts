import type { TFunction } from 'i18next';

// Facility types for clinics (FHIR Organization). The codes are
// persisted in `Organization.type[0].coding[0].code`; the labels are
// resolved through i18n at render time via `getFacilityTypes(t)`.
export const FACILITY_TYPE_CODES = [
  'ambulanz',
  'zentrum',
  'klinik',
  'rehaklinik',
  'forschung',
  'organisation',
] as const;

export function getFacilityTypes(
  t: TFunction
): Array<{ value: string; label: string }> {
  return FACILITY_TYPE_CODES.map((code) => ({
    value: code,
    label: t(`clinics.facilityTypes.${code}`),
  }));
}
