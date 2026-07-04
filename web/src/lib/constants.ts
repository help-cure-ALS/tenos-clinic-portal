/** Meta tag marking an Organization as verification-enabled. */
export const VERIFICATION_TAG = {
  system: 'urn:hca:verification',
  code: 'enabled',
} as const;

/** FHIR List code identifying clinic-study assignments. */
export const CLINIC_STUDIES_LIST = {
  system: 'http://help-cure-als.org/list-type',
  code: 'clinic-studies',
} as const;

/** Flag marking a clinic-study entry as open for patient applications. */
export const STUDY_APPLICATION_FLAG = {
  system: 'http://help-cure-als.org/study-flag',
  code: 'open-for-applications',
} as const;
